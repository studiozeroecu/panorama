-- SMOKE TEST de bajas justificadas y costo de insumos (fase 8p).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8p_bajas_y_costos.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- La que justifica el archivo: la 5. Un lote cuyas prendas buenas ya salieron
-- por Envío y que se CIERRA con una baja tiene que quedar procesado — si no,
-- se quedaría colgado para siempre como "pendiente de Envío" sin nada que enviar.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_ped  uuid := gen_random_uuid();
  v_res  jsonb;
  v_cor  uuid;
  v_mc   uuid;
  v_ent  uuid;
  v_ins  uuid := gen_random_uuid();
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select false' $q$;

  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, fecha_entrega_real)
  values (v_ped, 'ZZ_SMOKE 8p', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8p","metros":50}]'::jsonb,
          50, 5, 250, 'entregado', fn_hoy_ecuador());
  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1.5,
             '[{"color":"ZZNegro8p","tallas":{"S":5,"M":5}}]'::jsonb, gen_random_uuid(), null);
  v_cor := (v_res ->> 'corte_id')::uuid;
  v_mc := (select mc.id from prod_maquila_colores mc
           join prod_maquilas m on m.id = mc.maquila_id where m.corte_id = v_cor);

  -- ── 1. una sola versión de la función, la de 6 parámetros ──
  v_r := case when (select count(*) from pg_proc where proname = 'fn_registrar_entrega_maquila') = 1
               and (select pg_get_function_identity_arguments(oid) from pg_proc
                    where proname = 'fn_registrar_entrega_maquila') like '%p_motivo%'
              then 'OK — una sola, con p_tipo y p_motivo'
              else 'FALLA — sobrevive la vieja o falta la nueva' end;
  v_rep := v_rep || E'\n  1 · sin sobrecarga ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. entrega buena S:3 y Envío la procesa ──
  begin
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":3}'::jsonb);
    v_ent := (select id from prod_maquila_entregas where maquila_color_id = v_mc);
    perform fn_procesar_entrega_maquila(v_ent, 'online');
    v_r := 'OK — 3 buenas procesadas';
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  2 · entrega buena procesada ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. una baja SIN motivo se rechaza ──
  begin
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":1}'::jsonb, null, 'falla', '  ');
    v_r := 'FALLA — aceptó una falla sin motivo';
  exception when others then
    v_r := case when SQLERRM like '%motivo%' then 'OK — pide el motivo'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · baja sin motivo ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. falla S:1 con motivo: nace procesada (no va a Envío) ──
  begin
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":1}'::jsonb, null,
                                         'falla', 'Costura torcida');
    v_r := case when (select procesado from prod_maquila_entregas
                      where maquila_color_id = v_mc and tipo = 'falla')
                 and (select estado from prod_maquila_colores where id = v_mc) <> 'entregado'
                then 'OK — procesada de nacimiento; el lote sigue abierto'
                else 'FALLA — no nació procesada o cerró el lote' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  4 · falla con motivo ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. ⚠️ el faltante cierra el lote, y el color queda procesado ──
  begin
    v_res := fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":1,"M":5}'::jsonb, null,
                                          'faltante', 'La maquila no entregó la mitad');
    v_r := case when (v_res ->> 'completo')::boolean
                 and (select estado from prod_maquila_colores where id = v_mc) = 'entregado'
                 and (select procesado from prod_maquila_colores where id = v_mc)
                then 'OK — lote cerrado y procesado'
                else 'FALLA — ' || v_res::text end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · el faltante cierra el lote ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. Envío no ve ninguna baja ──
  v_r := case when not exists (select 1 from prod_maquila_entregas
                               where maquila_color_id = v_mc and not procesado)
              then 'OK — nada pendiente de Envío'
              else 'FALLA — quedó algo por procesar' end;
  v_rep := v_rep || E'\n  6 · bajas fuera de Envío ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. el costo del insumo solo lo pone el admin ──
  begin
    execute $q$ create or replace function fn_es_admin() returns boolean
                language sql stable as 'select false' $q$;
    insert into prod_corte_insumos (id, corte_id, descripcion, cantidad, costo)
    values (v_ins, v_cor, 'Botones', 200, 50);
    v_r := coalesce((select costo::text from prod_corte_insumos where id = v_ins), 'null');

    execute $q$ create or replace function fn_es_admin() returns boolean
                language sql stable as 'select true' $q$;
    update prod_corte_insumos set costo = 12 where id = v_ins;

    execute $q$ create or replace function fn_es_admin() returns boolean
                language sql stable as 'select false' $q$;
    update prod_corte_insumos set costo = 99, cantidad = 210 where id = v_ins;

    v_r := case when v_r = 'null'
                 and (select costo from prod_corte_insumos where id = v_ins) = 12
                 and (select cantidad from prod_corte_insumos where id = v_ins) = 210
                then 'OK — ella no pone costo; el admin sí; ella corrige la cantidad'
                else 'FALLA — al insertar quedó ' || v_r || ', al final '
                     || (select costo from prod_corte_insumos where id = v_ins) end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  7 · costo de insumo solo admin ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST bajas y costos (fase 8p) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
