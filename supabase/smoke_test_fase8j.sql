-- SMOKE TEST de la escritura de la cortadora (fase 8j).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8j_cortadora_escritura.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- La comprobación 5 es la más importante de todas: que NO haya quedado una
-- sobrecarga de fn_registrar_corte. Si quedaran las dos versiones, la app
-- seguiría llamando a la vieja y capas/corrida se perderían EN SILENCIO — la
-- trampa que documentó la fase 8b.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_n    int;
  v_txt  text;
  v_ped  uuid;
  v_cor  uuid;
  v_jor  uuid;
  v_res  jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 1. las tres columnas nuevas, nullable ──
  select string_agg(table_name || '.' || column_name || '=' || is_nullable, ' ' order by table_name, column_name)
    into v_txt
  from information_schema.columns
  where (table_name = 'prod_pedidos_tela' and column_name = 'corrida_base')
     or (table_name = 'prod_cortes' and column_name in ('corrida_base', 'capas'));
  v_r := case when v_txt is null then 'FALLA — no existe ninguna'
              when v_txt like '%=NO%' then 'FALLA — alguna quedó NOT NULL: ' || v_txt
              when (select count(*) from information_schema.columns
                    where (table_name = 'prod_pedidos_tela' and column_name = 'corrida_base')
                       or (table_name = 'prod_cortes' and column_name in ('corrida_base','capas'))) = 3
              then 'OK — las 3, todas nullable'
              else 'FALLA — ' || v_txt end;
  v_rep := v_rep || E'\n  1 · columnas corrida_base y capas .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. las 4 tablas nuevas existen Y tienen RLS activada ──
  --    Sin RLS la tabla sería legible por cualquier autenticado. CLAUDE.md avisa
  --    de que el bug se ve como "no hay datos", no como un error.
  select count(*) into v_n
  from pg_class
  where relname in ('prod_corte_retazos','prod_jornadas','prod_jornada_cortes','prod_corte_insumos')
    and relrowsecurity;
  v_r := case when v_n = 4 then 'OK — las 4 con RLS activada'
              else 'FALLA — solo ' || v_n || ' de 4 con RLS' end;
  v_rep := v_rep || E'\n  2 · tablas nuevas con RLS ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. cada tabla nueva: admin_all + las 3 de cortadora ──
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public'
    and tablename in ('prod_corte_retazos','prod_jornadas','prod_jornada_cortes','prod_corte_insumos');
  v_r := case when v_n = 16 then 'OK — 16 políticas (4 por tabla)'
              else 'FALLA — ' || v_n || ' políticas, se esperaban 16' end;
  v_rep := v_rep || E'\n  3 · políticas de las tablas nuevas .. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. las 5 tablas viejas ganaron el insert de cortadora ──
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and policyname like 'cortadora_inserta_%'
    and tablename in ('prod_cortes','prod_corte_colores','prod_corte_color_tallas',
                      'prod_maquilas','prod_maquila_colores');
  v_r := case when v_n = 5 then 'OK — las 5'
              else 'FALLA — ' || v_n || ' de 5' end;
  v_rep := v_rep || E'\n  4 · insert de cortadora en las viejas ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. ⚠️ NO quedó sobrecarga de fn_registrar_corte ──
  --    Con dos versiones vivas, una llamada de 7 argumentos iría a la vieja y
  --    capas/corrida se perderían sin que nada fallara.
  select count(*), string_agg(pg_get_function_identity_arguments(oid), ' || ')
    into v_n, v_txt
  from pg_proc where proname = 'fn_registrar_corte';
  v_r := case when v_n <> 1 then 'FALLA — hay ' || v_n || ' versiones: ' || v_txt
              when v_txt like '%p_capas%' and v_txt like '%p_corrida_base%'
              then 'OK — una sola versión, con los 2 parámetros nuevos'
              else 'FALLA — versión única pero sin los parámetros: ' || v_txt end;
  v_rep := v_rep || E'\n  5 · sin sobrecarga de la función .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── montaje para las pruebas de escritura ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, corrida_base)
  values ('ZZ_SMOKE 8j', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Negro","metros":100}]'::jsonb, 100, 5, 500, 'entregado',
          '{"S":1,"M":2,"L":1}'::jsonb)
  returning id into v_ped;

  -- ── 6. fn_registrar_corte guarda capas y corrida ──
  begin
    v_res := fn_registrar_corte(
      v_ped, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"Negro","tallas":{"S":5,"M":10,"L":5},"metros_usados":40}]'::jsonb,
      gen_random_uuid(), 5, '{"S":1,"M":2,"L":1}'::jsonb);
    v_cor := (v_res ->> 'corte_id')::uuid;
    select capas::text || ' capas · ' || corrida_base::text into v_txt
      from prod_cortes where id = v_cor;
    v_r := case when v_txt like '5 capas%' and v_txt like '%"M": 2%'
                then 'OK — ' || v_txt
                else 'FALLA — quedó: ' || coalesce(v_txt,'null') end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · el corte congela capas y corrida  ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. una llamada SIN los parámetros nuevos sigue valiendo ──
  --    Los defaults existen para que nada de lo que ya llama se rompa.
  begin
    v_res := fn_registrar_corte(
      v_ped, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"Negro","tallas":{"S":2},"metros_usados":10}]'::jsonb,
      gen_random_uuid());
    select capas is null into v_r from prod_cortes where id = (v_res ->> 'corte_id')::uuid;
    v_r := case when v_r::boolean then 'OK — 7 argumentos siguen funcionando, capas en null'
                else 'FALLA — capas no quedó en null' end;
  exception when others then
    v_r := 'FALLA — una llamada de 7 argumentos ya no sirve: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  7 · compatibilidad con 7 argumentos . ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. editar la corrida del PLAN no toca la FOTO del corte ──
  --    Y de paso: el trigger de la fase 8g no se dispara con esta columna, así
  --    que se puede editar el plan de un pedido que ya tiene cortes.
  begin
    update prod_pedidos_tela set corrida_base = '{"S":9,"M":9}'::jsonb where id = v_ped;
    select corrida_base::text into v_txt from prod_cortes where id = v_cor;
    v_r := case when v_txt like '%"M": 2%'
                then 'OK — el corte conserva su foto'
                else 'FALLA — la foto cambió con el plan: ' || v_txt end;
  exception when others then
    v_r := 'FALLA — el trigger bloqueó editar el plan: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  8 · el plan se edita sin tocar la foto ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. retazos, insumos y jornadas aceptan lo suyo ──
  begin
    insert into prod_corte_retazos (corte_id, talla, unidades, nota)
    values (v_cor, 'M', 3, 'de la punta');
    insert into prod_corte_insumos (corte_id, descripcion, cantidad)
    values (v_cor, 'botones', 200);
    insert into prod_jornadas (fecha, horas) values (fn_hoy_ecuador(), 7.5)
    returning id into v_jor;
    insert into prod_jornada_cortes (jornada_id, corte_id) values (v_jor, v_cor);
    v_r := 'OK — retazo, insumo y jornada enlazada';
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  9 · retazos, insumos y jornadas ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 10. una jornada puede cubrir VARIOS cortes ──
  --    Es la razón de que haya tabla intermedia y no una FK directa.
  begin
    insert into prod_jornada_cortes (jornada_id, corte_id)
    select v_jor, id from prod_cortes where pedido_id = v_ped and id <> v_cor limit 1;
    select count(*) into v_n from prod_jornada_cortes where jornada_id = v_jor;
    v_r := case when v_n = 2 then 'OK — 2 cortes en la misma jornada'
                else 'FALLA — ' || v_n || ' cortes enlazados' end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n 10 · una jornada, varios cortes ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 11. los checks rechazan lo absurdo ──
  v_n := 0;
  begin insert into prod_corte_retazos (corte_id, talla, unidades) values (v_cor,'M',0);
  exception when others then v_n := v_n + 1; end;
  begin insert into prod_jornadas (fecha, horas) values (fn_hoy_ecuador(), 0);
  exception when others then v_n := v_n + 1; end;
  begin insert into prod_corte_insumos (corte_id, descripcion, cantidad) values (v_cor,'   ',5);
  exception when others then v_n := v_n + 1; end;
  begin update prod_cortes set capas = 0 where id = v_cor;
  exception when others then v_n := v_n + 1; end;
  v_r := case when v_n = 4 then 'OK — los 4 rechazados'
              else 'FALLA — solo ' || v_n || ' de 4 rechazados' end;
  v_rep := v_rep || E'\n 11 · checks de valores absurdos ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST escritura cortadora (fase 8j) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
