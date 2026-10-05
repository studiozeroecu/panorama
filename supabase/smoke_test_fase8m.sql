-- SMOKE TEST del candado de la cortadora sobre el pedido (fase 8m).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8m_lock_pedido_cortadora.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base — tampoco las
-- versiones de mentira de fn_es_admin / fn_es_cortadora ni el cambio de rol.
--
-- A DIFERENCIA de los otros smoke tests, este necesita que RLS APLIQUE: corriendo
-- como `postgres` (dueño de las tablas) las políticas se saltan y no se probaría
-- nada. Por eso las comprobaciones 3–6 cambian a `set local role authenticated`,
-- el mismo rol con el que entra la cortadora desde la web, y vuelven con
-- `reset role` antes de seguir.
--
-- Las dos comprobaciones que justifican el archivo entero:
--   · la 3, que la cortadora PUEDA bloquear la fila (sin esto, fn_registrar_corte
--     dice «El pedido de tela no existe», que es el fallo que arregló la 8m);
--   · la 4, que NO pueda modificarla: el `with check (false)` tiene que rechazar
--     cualquier update real.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_n    int;
  v_txt  text;
  v_ped  uuid;
  v_pend uuid;
  v_id   uuid;
  v_res  jsonb;
begin
  -- Simulación de roles. Se redefinen dentro de la transacción y el raise final
  -- las devuelve a su versión real.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 1. la política existe y es exactamente un candado ──
  select cmd || ' · using=' || qual || ' · check=' || coalesce(with_check, 'null')
    into v_txt
  from pg_policies
  where tablename = 'prod_pedidos_tela' and policyname = 'cortadora_bloquea_pedido';
  v_r := case when v_txt is null then 'FALLA — no existe cortadora_bloquea_pedido'
              when v_txt like 'UPDATE · %fn_es_cortadora()%entregado% · check=false'
                then 'OK — UPDATE, acotada a entregado, with check (false)'
              else 'FALLA — ' || v_txt end;
  v_rep := v_rep || E'\n  1 · la política es un candado ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. ninguna otra política deja escribir en prod_pedidos_tela ──
  --    Solo la de admin o candados `with check (false)`.
  select count(*), string_agg(policyname || ' [' || cmd || ']', ', ')
    into v_n, v_txt
  from pg_policies
  where tablename = 'prod_pedidos_tela'
    and cmd in ('UPDATE', 'ALL', 'INSERT', 'DELETE')
    and not (cmd = 'UPDATE' and with_check = 'false')
    and not (qual = 'fn_es_admin()' and with_check = 'fn_es_admin()');
  v_r := case when v_n = 0 then 'OK — solo admin escribe'
              else 'FALLA — no previstas: ' || v_txt end;
  v_rep := v_rep || E'\n  2 · sin otras políticas de escritura . ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── montaje (como postgres): un pedido entregado y uno pendiente ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, fecha_entrega_real)
  values ('ZZ_SMOKE 8m', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Negro","metros":60}]'::jsonb, 60, 5, 300, 'entregado', fn_hoy_ecuador())
  returning id into v_ped;
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE 8m pend', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Negro","metros":60}]'::jsonb, 60, 5, 300, 'pendiente')
  returning id into v_pend;

  -- ════ desde aquí, con RLS aplicando ════
  execute 'set local role authenticated';

  -- ── 3. ⚠️ puede BLOQUEAR el pedido entregado ──
  begin
    select id into v_id from prod_pedidos_tela where id = v_ped for update;
    v_r := case when v_id = v_ped then 'OK — el for update encuentra la fila'
                else 'FALLA — el for update no ve la fila (el fallo original)' end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  3 · bloquea el pedido entregado ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. ⚠️ NO puede modificarlo ──
  --    El update tiene que fallar por RLS, no quedarse en 0 filas: el `using`
  --    deja pasar la fila y es el `with check (false)` quien la rechaza.
  begin
    update prod_pedidos_tela set valor_metro = 999, corrida_base = '{"M":9}'::jsonb
     where id = v_ped;
    v_r := 'FALLA — el update pasó: la cortadora puede modificar el pedido';
  exception when others then
    v_r := case when SQLERRM ilike '%row-level security%' then 'OK — rechazado por el with check'
                else 'FALLA — falló por otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  4 · no puede modificarlo ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. NO bloquea un pedido que no está entregado ──
  --    El candado está acotado a la tela que puede cortar. (Desde la 8l lo puede
  --    LEER; bloquearlo, no.)
  v_id := null;
  begin
    select id into v_id from prod_pedidos_tela where id = v_pend for update;
    v_r := case when v_id is null then 'OK — no lo bloquea'
                else 'FALLA — bloqueó un pedido pendiente' end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · no bloquea uno pendiente ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. fn_registrar_corte funciona COMO CORTADORA, de punta a punta ──
  --    Es la prueba de que el fallo «El pedido de tela no existe» está cerrado.
  begin
    v_res := fn_registrar_corte(
      v_ped, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"Negro","capas":2,"tallas":{"M":4},"metros_usados":5}]'::jsonb,
      gen_random_uuid(), null);
    v_r := case when (v_res ->> 'unidades')::int = 4 then 'OK — corte de 4 unidades registrado'
                else 'FALLA — devolvió ' || v_res::text end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · registra un corte como cortadora  ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  execute 'reset role';
  -- ════ fin de RLS ════

  -- ── 7. y el pedido quedó intacto ──
  select valor_metro || ' · ' || coalesce(corrida_base::text, 'null') into v_txt
  from prod_pedidos_tela where id = v_ped;
  v_r := case when v_txt = '5.0000 · null' then 'OK — precio y corrida sin tocar'
              else 'FALLA — quedó: ' || v_txt end;
  v_rep := v_rep || E'\n  7 · el pedido sigue intacto ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST candado del pedido (fase 8m) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
