-- SMOKE TEST de las capas por color (fase 8k).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8k_capas_por_color.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- Las dos comprobaciones que justifican el archivo entero:
--   · la 4, que NO sobreviva ninguna firma vieja de fn_registrar_corte;
--   · la 6, que dos colores del MISMO corte puedan llevar capas distintas, que
--     es la razón de ser de esta fase.
--
-- ⚠️ El smoke de la fase 8j YA NO PASA después de aplicar esta migración, y es
-- correcto: su comprobación 6 lee prod_cortes.capas y llama con 9 argumentos.
-- Está probando un diseño que dejó de existir.

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
  v_res  jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 1. prod_corte_colores.capas existe y es nullable ──
  select data_type || ' · nullable=' || is_nullable into v_txt
  from information_schema.columns
  where table_name = 'prod_corte_colores' and column_name = 'capas';
  v_r := case when v_txt is null then 'FALLA — la columna no existe'
              when v_txt = 'integer · nullable=YES' then 'OK — ' || v_txt
              else 'FALLA — ' || v_txt end;
  v_rep := v_rep || E'\n  1 · capas en prod_corte_colores ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. prod_cortes.capas YA NO existe ──
  select count(*) into v_n from information_schema.columns
  where table_name = 'prod_cortes' and column_name = 'capas';
  v_r := case when v_n = 0 then 'OK — eliminada del corte'
              else 'FALLA — sigue ahí; sumar capas entre colores no significa nada' end;
  v_rep := v_rep || E'\n  2 · capas fuera de prod_cortes ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. corrida_base NO se fue por delante ──
  --    Esa sí es una sola para todo el corte y tenía que quedarse.
  select count(*) into v_n from information_schema.columns
  where (table_name = 'prod_cortes' and column_name = 'corrida_base')
     or (table_name = 'prod_pedidos_tela' and column_name = 'corrida_base');
  v_r := case when v_n = 2 then 'OK — sigue en el pedido y en el corte'
              else 'FALLA — solo quedan ' || v_n || ' de 2' end;
  v_rep := v_rep || E'\n  3 · corrida_base intacta ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. ⚠️ UNA sola versión de fn_registrar_corte, y sin p_capas ──
  --    Si sobreviviera la de 7 o la de 9, una llamada con ese número de
  --    argumentos iría a la vieja y las capas se perderían EN SILENCIO.
  select count(*), string_agg(pg_get_function_identity_arguments(oid), '  ||  ')
    into v_n, v_txt
  from pg_proc where proname = 'fn_registrar_corte';
  v_r := case when v_n <> 1 then 'FALLA — hay ' || v_n || ' versiones: ' || v_txt
              when v_txt like '%p_capas%' then 'FALLA — todavía tiene p_capas: ' || v_txt
              when v_txt like '%p_corrida_base%' then 'OK — una sola, sin p_capas'
              else 'FALLA — firma inesperada: ' || v_txt end;
  v_rep := v_rep || E'\n  4 · sin sobrecarga ni p_capas ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── montaje ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, corrida_base)
  values ('ZZ_SMOKE 8k', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Negro","metros":60},{"color":"Crudo","metros":40}]'::jsonb,
          100, 5, 500, 'entregado', '{"S":1,"M":2,"L":1}'::jsonb)
  returning id into v_ped;

  -- ── 5. la llamada vieja de 9 argumentos tiene que FALLAR ──
  --    Es la prueba positiva de que el drop se llevó la firma anterior.
  begin
    perform fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"Negro","tallas":{"M":2}}]'::jsonb, gen_random_uuid(), 5, '{}'::jsonb);
    v_r := 'FALLA — la firma de 9 argumentos sigue viva';
  exception
    when undefined_function then v_r := 'OK — la firma de 9 argumentos ya no existe';
    when others then v_r := 'FALLA — error inesperado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · la firma de 9 ya no responde .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. ⚠️ DOS COLORES, CAPAS DISTINTAS — la razón de esta fase ──
  --    Negro con 5 capas (corrida ×5 = 20 und.) y Crudo con 3 (×3 = 12 und.).
  begin
    v_res := fn_registrar_corte(
      v_ped, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"Negro","capas":5,"tallas":{"S":5,"M":10,"L":5},"metros_usados":40},
        {"color":"Crudo","capas":3,"tallas":{"S":3,"M":6,"L":3}, "metros_usados":25}]'::jsonb,
      gen_random_uuid(), '{"S":1,"M":2,"L":1}'::jsonb);
    v_cor := (v_res ->> 'corte_id')::uuid;

    select string_agg(color || '=' || coalesce(capas::text, 'null'), ' ' order by color)
      into v_txt
    from prod_corte_colores where corte_id = v_cor;
    v_r := case when v_txt = 'Crudo=3 Negro=5' then 'OK — ' || v_txt
                else 'FALLA — quedó: ' || coalesce(v_txt, 'nada') end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · capas distintas por color ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. el corte sigue congelando la corrida ──
  select corrida_base::text into v_txt from prod_cortes where id = v_cor;
  v_r := case when v_txt like '%"M": 2%' then 'OK — la foto se guardó'
              else 'FALLA — quedó: ' || coalesce(v_txt, 'null') end;
  v_rep := v_rep || E'\n  7 · el corte congela la corrida ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. las unidades del corte son la suma de los dos colores ──
  select total_unidades into v_n from prod_cortes where id = v_cor;
  v_r := case when v_n = 32 then 'OK — 20 + 12 = 32'
              else 'FALLA — ' || v_n || ', se esperaban 32' end;
  v_rep := v_rep || E'\n  8 · total del corte ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. un color SIN capas entra igual, con null ──
  --    Nullable de verdad: puede registrar un corte sin acordarse de las capas.
  begin
    v_res := fn_registrar_corte(
      v_ped, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"Negro","tallas":{"M":4},"metros_usados":5}]'::jsonb,
      gen_random_uuid(), null);
    select capas is null into v_r
      from prod_corte_colores where corte_id = (v_res ->> 'corte_id')::uuid;
    v_r := case when v_r::boolean then 'OK — queda en null, no en 0'
                else 'FALLA — no quedó en null' end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  9 · un color sin capas ...... ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 10. el check rechaza 0 y negativos ──
  --    null es "no lo anotó"; 0 sería un dato real y falso.
  v_n := 0;
  begin update prod_corte_colores set capas = 0 where corte_id = v_cor;
  exception when others then v_n := v_n + 1; end;
  begin update prod_corte_colores set capas = -2 where corte_id = v_cor;
  exception when others then v_n := v_n + 1; end;
  v_r := case when v_n = 2 then 'OK — los 2 rechazados'
              else 'FALLA — solo ' || v_n || ' de 2 rechazados' end;
  v_rep := v_rep || E'\n 10 · el check de capas .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST capas por color (fase 8k) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
