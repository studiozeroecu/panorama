-- SMOKE TEST: el admin corrige las cantidades de un corte (fase 8q).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8q_corregir_corte.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- La que justifica el archivo: la 3. Nunca se puede bajar una talla por debajo
-- de lo que la maquila ya entregó.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_ped  uuid := gen_random_uuid();
  v_res  jsonb;
  v_cor  uuid;
  v_cc   uuid;
  v_mc   uuid;
  v_maq  uuid;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, fecha_entrega_real)
  values (v_ped, 'ZZ_SMOKE 8q', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8q","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador());
  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1.5,
             '[{"color":"ZZNegro8q","tallas":{"S":5,"M":5}}]'::jsonb, gen_random_uuid(), null);
  v_cor := (v_res ->> 'corte_id')::uuid;
  v_cc  := (select id from prod_corte_colores where corte_id = v_cor);
  v_maq := (select id from prod_maquilas where corte_id = v_cor);
  v_mc  := (select id from prod_maquila_colores where corte_color_id = v_cc);

  -- ── 1. subir S de 5 a 7: cuadran los cinco sitios ──
  begin
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{"S":7,"M":5}'::jsonb)));
    v_r := case
      when (select unidades from prod_corte_color_tallas where corte_color_id = v_cc and talla = 'S') = 7
       and (select unidades from prod_corte_colores where id = v_cc) = 12
       and (select total_unidades from prod_cortes where id = v_cor) = 12
       and (select total_unidades from prod_maquilas where id = v_maq) = 12
       and (select colores -> 0 -> 'tallas' ->> 'S' from prod_cortes where id = v_cor) = '7'
       and (select colores -> 0 -> 'tallas' ->> 'S' from prod_maquilas where id = v_maq) = '7'
      then 'OK — talla, color, corte, maquila y respaldos en 12'
      else 'FALLA — algún sitio no cuadró' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · los cinco sitios cuadran ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. una talla nueva dentro del color ──
  begin
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{"S":7,"M":5,"XL":2}'::jsonb)));
    v_r := case when (select unidades from prod_corte_color_tallas
                      where corte_color_id = v_cc and talla = 'XL') = 2
                 and (select total_unidades from prod_cortes where id = v_cor) = 14
                then 'OK — XL:2 agregada, total 14'
                else 'FALLA — no se agregó la talla' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  2 · talla nueva ..................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. ⚠️ no se baja por debajo de lo entregado ──
  perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":4}'::jsonb);
  begin
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{"S":3,"M":5,"XL":2}'::jsonb)));
    v_r := 'FALLA — dejó S en 3 con 4 ya entregadas';
  exception when others then
    v_r := case when SQLERRM like '%ya entregó%' then 'OK — rechazado: ya se entregaron 4'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · nunca bajo lo entregado ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. entregado el resto, subir una talla lo reabre ──
  begin
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":3,"M":5,"XL":2}'::jsonb);
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{"S":7,"M":6,"XL":2}'::jsonb)));
    v_r := case when (select estado from prod_maquila_colores where id = v_mc) = 'enviado'
                 and not (select procesado from prod_maquila_colores where id = v_mc)
                 and fn_tallas_pendientes_maquila(v_mc) = '{"M":1}'::jsonb
                then 'OK — vuelve a "enviado"; falta M:1'
                else 'FALLA — estado: ' || (select estado from prod_maquila_colores where id = v_mc) end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  4 · subir reabre el lote ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. bajar hasta lo entregado lo vuelve a cerrar ──
  begin
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{"S":7,"M":5,"XL":2}'::jsonb)));
    v_r := case when (select estado from prod_maquila_colores where id = v_mc) = 'entregado'
                then 'OK — vuelve a "entregado"'
                else 'FALLA — quedó ' || (select estado from prod_maquila_colores where id = v_mc) end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · bajar lo cierra ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. un corte no puede quedar en cero ──
  begin
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{}'::jsonb)));
    v_r := 'FALLA — dejó el corte sin unidades';
  exception when others then
    v_r := 'OK — rechazado';
  end;
  v_rep := v_rep || E'\n  6 · no queda en cero ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. solo admin ──
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  begin
    perform fn_corregir_corte(v_cor, jsonb_build_array(jsonb_build_object(
      'corte_color_id', v_cc, 'tallas', '{"S":8,"M":5,"XL":2}'::jsonb)));
    v_r := 'FALLA — alguien sin ser admin corrigió el corte';
  exception when others then
    v_r := case when SQLERRM like '%administrador%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  7 · solo admin ..................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST corregir corte (fase 8q) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
