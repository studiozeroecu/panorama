-- SMOKE TEST de convertir en conjunto un corte viejo (fase 8x).
-- NO forma parte de la cadena de migraciones. Requiere la 8x aplicada.
-- UN SOLO bloque DO que termina con un error a propósito: ese error ES el
-- reporte, y al lanzarlo PostgreSQL revierte todo.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_pr   uuid := gen_random_uuid();
  v_ped  uuid := gen_random_uuid();
  v_cor  uuid;
  v_cc   uuid;
  v_mq   uuid;
  v_res  jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- Un corte registrado como prenda SOLA (como antes de la 8r)...
  insert into prod_prendas (id, nombre) values (v_pr, 'ZZ Conjunto 8x');
  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores, total_metros,
     valor_metro, total_pagar, estado, fecha_entrega_real, prenda_id)
  values (v_ped, 'ZZ_SMOKE 8x', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8x","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador(), v_pr);
  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 3,
    '[{"color":"ZZNegro8x","tallas":{"S":2,"M":4}}]'::jsonb, gen_random_uuid(), null);
  v_cor := (v_res ->> 'corte_id')::uuid;
  v_cc := (select id from prod_corte_colores where corte_id = v_cor);
  v_mq := (select id from prod_maquilas where corte_id = v_cor);
  update prod_maquila_colores set estado = 'enviado', fecha_envio = fn_hoy_ecuador() where corte_color_id = v_cc;
  perform fn_registrar_entrega_maquila((select id from prod_maquila_colores where corte_color_id = v_cc),
                                       fn_hoy_ecuador(), '{"S":2,"M":4}'::jsonb);
  -- ...y DESPUÉS la prenda se marca como conjunto.
  update prod_prendas set es_conjunto = true where id = v_pr;
  insert into prod_prenda_partes (prenda_id, parte, nombre, costo_maquila)
  values (v_pr, 'superior', 'ZZBlusa', 1.2), (v_pr, 'inferior', 'ZZPant', 1.5);

  -- ── 1. ⚠️ el color se parte en dos, con maquila y entregas coherentes ──
  begin
    v_res := fn_convertir_a_conjunto(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'superior', '{"S":2,"M":4}'::jsonb, 'inferior', '{"S":2,"M":3}'::jsonb)));
    v_r := case
      when (select count(*) from prod_corte_colores where corte_id = v_cor) = 2
       and (select unidades from prod_corte_colores where corte_id = v_cor and parte = 'inferior') = 5
       and (select total_unidades from prod_cortes where id = v_cor) = 11
       and (select total_unidades from prod_maquilas where id = v_mq) = 11
       and (select count(*) from prod_maquila_colores where maquila_id = v_mq and estado = 'entregado') = 2
       and (select costo_unitario from prod_maquila_colores mc join prod_corte_colores cc on cc.id = mc.corte_color_id
             where mc.maquila_id = v_mq and cc.parte = 'inferior') = 1.5
       and (select count(*) from prod_maquila_entregas e join prod_maquila_colores mc on mc.id = e.maquila_color_id
             where mc.maquila_id = v_mq and not e.procesado) = 2
       and (select jsonb_array_length(colores) from prod_maquilas where id = v_mq) = 2
      then 'OK — blusa 6 + pantalón 5, entregadas y listas para Envío'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · convertir ........................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. un corte ya separado no se vuelve a convertir ──
  begin
    perform fn_convertir_a_conjunto(v_cor, '[]'::jsonb);
    v_r := 'FALLA — lo convirtió dos veces';
  exception when others then
    v_r := case when SQLERRM like '%ya está separado%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · no dos veces ..................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST convertir a conjunto (fase 8x) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
