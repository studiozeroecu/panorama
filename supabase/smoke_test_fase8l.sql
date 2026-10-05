-- SMOKE TEST de la recepción de tela por la cortadora (fase 8l).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8l_cortadora_recibe_tela.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base — tampoco las
-- versiones de mentira de fn_es_admin / fn_es_cortadora que usa para simular roles.
--
-- Requiere también la 8m (aplicada antes que esta), aunque no la prueba: eso
-- lo hace smoke_test_fase8m.sql.
--
-- Las comprobaciones que justifican el archivo entero:
--   · la 4, que la cortadora NO pueda MODIFICAR prod_pedidos_tela por ninguna
--     política: si pudiera, la RPC sería decorativa. El candado de la 8m
--     (`with check (false)`) se acepta porque bloquea sin escribir;
--   · la 6, que un doble toque NO dé error ni pise lo guardado;
--   · la 7, que recibir no dispare los triggers de colores ni de saldo.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_n    int;
  v_txt  text;
  v_ped  uuid;
  v_ped2 uuid;
  v_res  jsonb;
begin
  -- Simulación de roles. Se redefinen dentro de la transacción y el raise final
  -- las devuelve a su versión real.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 1. las dos columnas existen, y el check del rol cierra ──
  select count(*) into v_n from information_schema.columns
  where table_name = 'prod_pedidos_tela'
    and column_name in ('recibido_por_rol', 'ancho_recibido');
  v_r := case when v_n = 2 then 'OK — recibido_por_rol y ancho_recibido'
              else 'FALLA — hay ' || v_n || ' de 2' end;
  v_rep := v_rep || E'\n  1 · columnas nuevas ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. UNA sola fn_recibir_tela, y SECURITY DEFINER ──
  --    Sin definer necesitaría una política de update, que es lo que se evita.
  select count(*), bool_and(prosecdef) into v_n, v_r
  from pg_proc where proname = 'fn_recibir_tela';
  v_r := case when v_n <> 1 then 'FALLA — hay ' || v_n || ' versiones'
              when v_r::boolean then 'OK — una sola, security definer'
              else 'FALLA — no es security definer' end;
  v_rep := v_rep || E'\n  2 · una sola función, definer ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. anon NO puede ejecutarla ──
  v_r := case when not has_function_privilege('anon', 'fn_recibir_tela(uuid, numeric, date)', 'execute')
               and has_function_privilege('authenticated', 'fn_recibir_tela(uuid, numeric, date)', 'execute')
              then 'OK — solo authenticated'
              else 'FALLA — revisar los grants' end;
  v_rep := v_rep || E'\n  3 · permisos de ejecución ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. ⚠️ la cortadora NO puede modificar prod_pedidos_tela ──
  --    Toda política de escritura tiene que ser la de admin o un candado
  --    `with check (false)` como el de la 8m. Se juzga por lo que HACE, no por
  --    el nombre. Y su lectura ya no está acotada a 'entregado'.
  select count(*), string_agg(policyname || ' [' || cmd || ']', ', ')
    into v_n, v_r
  from pg_policies
  where tablename = 'prod_pedidos_tela'
    and cmd in ('UPDATE', 'ALL', 'INSERT', 'DELETE')
    and not (cmd = 'UPDATE' and with_check = 'false')
    and not (qual = 'fn_es_admin()' and with_check = 'fn_es_admin()');
  select qual into v_txt from pg_policies
  where tablename = 'prod_pedidos_tela' and policyname = 'cortadora_lee_pedidos';
  v_r := case when v_n > 0 then 'FALLA — políticas de escritura no previstas: ' || v_r
              when v_txt is null then 'FALLA — no existe cortadora_lee_pedidos'
              when v_txt ilike '%entregado%' then 'FALLA — la lectura sigue acotada: ' || v_txt
              else 'OK — solo admin escribe; lee todos los estados' end;
  v_rep := v_rep || E'\n  4 · sin escritura directa ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── montaje: un pedido en camino ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE 8l', fn_hoy_ecuador() - 5, 'metros', 150,
          '[{"color":"Negro","metros":60},{"color":"Crudo","metros":40}]'::jsonb,
          100, 5, 500, 'en_camino')
  returning id into v_ped;

  -- ── 5. la cortadora recibe: se escriben las cinco columnas y nada más ──
  begin
    v_res := fn_recibir_tela(v_ped, 152.5, fn_hoy_ecuador() - 1);
    select estado || ' · ' || ancho_real || ' · ' || ancho_recibido || ' · ' ||
           recibido_por_rol || ' · ' || (fecha_entrega_real = fn_hoy_ecuador() - 1) ||
           ' · ' || total_pagar
      into v_txt from prod_pedidos_tela where id = v_ped;
    v_r := case when v_txt = 'entregado · 152.50 · 152.50 · cortadora · true · 500.00'
                 and (v_res ->> 'ya_recibido')::boolean = false
                then 'OK — ' || v_txt
                else 'FALLA — quedó: ' || coalesce(v_txt, 'nada') end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · la cortadora recibe ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. ⚠️ doble toque: aviso, no error, y NO pisa lo guardado ──
  --    Se manda a propósito otro ancho: si la segunda llamada escribiera,
  --    quedaría 160.
  begin
    v_res := fn_recibir_tela(v_ped, 160, fn_hoy_ecuador());
    select ancho_real::text into v_txt from prod_pedidos_tela where id = v_ped;
    v_r := case when (v_res ->> 'ya_recibido')::boolean and v_txt = '152.50'
                then 'OK — ya_recibido, el ancho sigue en 152.50'
                else 'FALLA — ' || v_res::text || ' · ancho ' || v_txt end;
  exception when others then
    v_r := 'FALLA — el reintento dio error: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · doble toque idempotente ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. ⚠️ no dispara los triggers de colores ni de saldo (8g) ──
  --    Se fabrica un estado que la guarda B de la 8g RECHAZARÍA: un corte que
  --    consumió más metros (999) de los que tiene el pedido (100). Si el update
  --    de la recepción disparara ese trigger, esto fallaría. Y si disparara el de
  --    colores, las filas de prod_pedido_colores se recrearían con otros ids.
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE 8l b', fn_hoy_ecuador() - 5, 'metros', 150,
          '[{"color":"Negro","metros":100}]'::jsonb, 100, 5, 500, 'pendiente')
  returning id into v_ped2;
  insert into prod_cortes (pedido_id, fecha, colores, total_unidades, metros_consumidos)
  values (v_ped2, fn_hoy_ecuador(), '[]'::jsonb, 1, 999);
  select string_agg(id::text, ',' order by id) into v_txt
  from prod_pedido_colores where pedido_id = v_ped2;
  begin
    perform fn_recibir_tela(v_ped2, 180, fn_hoy_ecuador());
    select case when string_agg(id::text, ',' order by id) = v_txt
                then 'OK — ningún trigger saltó; colores intactos'
                else 'FALLA — las filas de color cambiaron' end
      into v_r
    from prod_pedido_colores where pedido_id = v_ped2;
  exception when others then
    v_r := 'FALLA — saltó un trigger: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  7 · sin triggers de 7 / 8g ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── montaje: un pedido pendiente para las validaciones ──
  update prod_pedidos_tela set estado = 'pendiente', ancho_real = null,
         ancho_recibido = null, recibido_por_rol = null, fecha_entrega_real = null
   where id = v_ped;

  -- ── 8. el ancho va en cm: rechaza metros, milímetros y vacío ──
  v_n := 0;
  begin perform fn_recibir_tela(v_ped, 1.5, fn_hoy_ecuador());
  exception when others then v_n := v_n + 1; end;
  begin perform fn_recibir_tela(v_ped, 1500, fn_hoy_ecuador());
  exception when others then v_n := v_n + 1; end;
  begin perform fn_recibir_tela(v_ped, null, fn_hoy_ecuador());
  exception when others then v_n := v_n + 1; end;
  select estado into v_txt from prod_pedidos_tela where id = v_ped;
  v_r := case when v_n = 3 and v_txt = 'pendiente' then 'OK — los 3 rechazados, sigue pendiente'
              else 'FALLA — ' || v_n || ' de 3 rechazados, estado ' || v_txt end;
  v_rep := v_rep || E'\n  8 · ancho en cm (1.5 / 1500 / null) . ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. fecha futura o vacía: rechazada ──
  v_n := 0;
  begin perform fn_recibir_tela(v_ped, 150, fn_hoy_ecuador() + 1);
  exception when others then v_n := v_n + 1; end;
  begin perform fn_recibir_tela(v_ped, 150, null);
  exception when others then v_n := v_n + 1; end;
  v_r := case when v_n = 2 then 'OK — las 2 rechazadas'
              else 'FALLA — solo ' || v_n || ' de 2' end;
  v_rep := v_rep || E'\n  9 · fecha futura o vacía ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 10. sin rol: rechazado ──
  --    Con SECURITY DEFINER la guarda es la única barrera. Tiene que funcionar.
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select false' $q$;
  begin
    perform fn_recibir_tela(v_ped, 150, fn_hoy_ecuador());
    v_r := 'FALLA — un usuario sin rol recibió la tela';
  exception when others then
    v_r := case when SQLERRM like '%permiso%' then 'OK — ' || SQLERRM
                else 'FALLA — falló por otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n 10 · sin rol, rechazado .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 11. admin: queda registrado como admin ──
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;
  begin
    perform fn_recibir_tela(v_ped, 150, fn_hoy_ecuador());
    select recibido_por_rol into v_txt from prod_pedidos_tela where id = v_ped;
    v_r := case when v_txt = 'admin' then 'OK — recibido_por_rol = admin'
                else 'FALLA — quedó ' || coalesce(v_txt, 'null') end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n 11 · Mateo recibe como admin ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST recepción de tela (fase 8l) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
