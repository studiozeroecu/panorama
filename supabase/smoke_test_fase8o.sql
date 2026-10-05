-- SMOKE TEST de entregas parciales, horas con tarifa y destino (fase 8o).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8o_maquila_entregas.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA — ni el
-- stock online que suma, ni las funciones de mentira, ni el cambio de rol.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- Las que justifican el archivo:
--   · 5 y 6: una entrega PARCIAL se procesa en Envío sin esperar el resto, y el
--     color NO queda procesado mientras falte algo;
--   · 4: un exceso sobre lo cortado se rechaza (la invariante de toda la fase);
--   · 9: Mateo marcando "entregado" a mano sigue llegando a Envío (trigger).

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_ped  uuid := gen_random_uuid();
  v_res  jsonb;
  v_cor  uuid;
  v_cor2 uuid;
  v_mc   uuid;
  v_mc2  uuid;
  v_ent  uuid;
  v_jor  uuid := gen_random_uuid();
begin
  -- Montaje como admin.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select false' $q$;

  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, fecha_entrega_real)
  values (v_ped, 'ZZ_SMOKE 8o', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8o","metros":50},{"color":"ZZCrudo8o","metros":50}]'::jsonb,
          100, 5, 500, 'entregado', fn_hoy_ecuador());

  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1.5,
             '[{"color":"ZZNegro8o","tallas":{"S":5,"M":5}}]'::jsonb, gen_random_uuid(), null);
  v_cor := (v_res ->> 'corte_id')::uuid;
  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1.5,
             '[{"color":"ZZCrudo8o","tallas":{"L":4}}]'::jsonb, gen_random_uuid(), null);
  v_cor2 := (v_res ->> 'corte_id')::uuid;
  v_mc  := (select mc.id from prod_maquila_colores mc
            join prod_maquilas m on m.id = mc.maquila_id where m.corte_id = v_cor);
  v_mc2 := (select mc.id from prod_maquila_colores mc
            join prod_maquilas m on m.id = mc.maquila_id where m.corte_id = v_cor2);

  -- ── 1. funciones: la vieja fuera, las nuevas únicas ──
  v_r := case
    when exists (select 1 from pg_proc where proname = 'fn_procesar_lote_maquila')
      then 'FALLA — fn_procesar_lote_maquila sigue viva'
    when (select count(*) from pg_proc where proname in
          ('fn_procesar_entrega_maquila', 'fn_registrar_entrega_maquila', 'fn_marcar_enviado_maquila')) <> 3
      then 'FALLA — faltan o sobran funciones nuevas'
    else 'OK — la vieja borrada, 3 nuevas' end;
  v_rep := v_rep || E'\n  1 · funciones ...................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- Desde aquí, la cortadora.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 2. marcar enviado, y el doble toque no da error ──
  begin
    perform fn_marcar_enviado_maquila(v_mc, fn_hoy_ecuador());
    v_res := fn_marcar_enviado_maquila(v_mc, fn_hoy_ecuador());
    v_r := case when (v_res ->> 'ya_enviado')::boolean
                 and (select estado from prod_maquila_colores where id = v_mc) = 'enviado'
                then 'OK — enviado; el segundo toque es aviso'
                else 'FALLA — ' || v_res::text end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  2 · marcar enviado ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. entrega parcial S:3, y su reintento no duplica ──
  begin
    v_res := fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":3}'::jsonb,
               'aaaaaaaa-0000-4000-8000-000000000008'::uuid);
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":3}'::jsonb,
               'aaaaaaaa-0000-4000-8000-000000000008'::uuid);
    v_r := case when (v_res ->> 'completo')::boolean = false
                 and (v_res -> 'faltan') = '{"S":2,"M":5}'::jsonb
                 and (select count(*) from prod_maquila_entregas where maquila_color_id = v_mc) = 1
                 and (select estado from prod_maquila_colores where id = v_mc) = 'enviado'
                then 'OK — parcial, faltan S:2 M:5, una sola entrega'
                else 'FALLA — ' || v_res::text end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  3 · entrega parcial + reintento .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. ⚠️ no se puede entregar más de lo cortado ──
  begin
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"M":6}'::jsonb, null);
    v_r := 'FALLA — aceptó 6 de M cuando faltaban 5';
  exception when others then
    v_r := case when SQLERRM like '%solo faltan%' then 'OK — ' || SQLERRM
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  4 · exceso rechazado ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- Envío es de Mateo.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 5. ⚠️ Envío procesa la entrega PARCIAL sin esperar el resto ──
  v_ent := (select id from prod_maquila_entregas where maquila_color_id = v_mc);
  begin
    v_res := fn_procesar_entrega_maquila(v_ent, 'online');
    v_r := case when (v_res ->> 'unidades')::int = 3
                 and (select procesado from prod_maquila_entregas where id = v_ent)
                 and (select disponibles from prod_stock_online
                      where color = 'ZZNegro8o' and talla = 'S' and estampado = '') = 3
                then 'OK — 3 al stock online'
                else 'FALLA — ' || v_res::text end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · procesa la parcial ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. ⚠️ y el color NO queda procesado: todavía falta ──
  v_r := case when not (select procesado from prod_maquila_colores where id = v_mc)
              then 'OK — sigue pendiente de lo que falta'
              else 'FALLA — se marcó procesado con piezas en maquila' end;
  v_rep := v_rep || E'\n  6 · color no procesado aún ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. entrega del resto: completa el color ──
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  begin
    v_res := fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":2,"M":5}'::jsonb, null);
    v_r := case when (v_res ->> 'completo')::boolean
                 and (select estado from prod_maquila_colores where id = v_mc) = 'entregado'
                 and (select count(*) from prod_maquila_entregas where maquila_color_id = v_mc) = 2
                then 'OK — entregado, 2 entregas (el trigger no añadió una tercera)'
                else 'FALLA — ' || v_res::text end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  7 · entrega del resto .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. procesar la segunda cierra el color, y no se reprocesa ──
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;
  v_ent := (select id from prod_maquila_entregas where maquila_color_id = v_mc and not procesado);
  begin
    perform fn_procesar_entrega_maquila(v_ent, 'online');
    begin
      perform fn_procesar_entrega_maquila(v_ent, 'online');
      v_r := 'FALLA — se procesó dos veces';
    exception when others then
      v_r := case when (select procesado from prod_maquila_colores where id = v_mc)
                  then 'OK — color procesado; el reproceso se rechaza'
                  else 'FALLA — el color no quedó procesado' end;
    end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  8 · cierre y sin reproceso ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. ⚠️ Mateo marca "entregado" a mano: el trigger crea la entrega ──
  begin
    update prod_maquila_colores set estado = 'entregado', fecha_entrega = fn_hoy_ecuador()
     where id = v_mc2;
    v_r := case when (select tallas from prod_maquila_entregas where maquila_color_id = v_mc2) = '{"L":4}'::jsonb
                then 'OK — entrega automática L:4, lista para Envío'
                else 'FALLA — no se creó la entrega' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  9 · trigger de MaquilaTab .......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 10. la cortadora no puede ponerse la tarifa ──
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  begin
    insert into prod_jornadas (id, fecha, horas, tarifa_hora) values (v_jor, fn_hoy_ecuador(), 3, 99);
    update prod_jornadas set tarifa_hora = 50 where id = v_jor;
    v_r := case when (select tarifa_hora from prod_jornadas where id = v_jor) = fn_tarifa_hora_cortadora()
                then 'OK — quedó en ' || fn_tarifa_hora_cortadora() || ' (pidió 99 y luego 50)'
                else 'FALLA — quedó en ' || (select tarifa_hora from prod_jornadas where id = v_jor) end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n 10 · tarifa congelada .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 11. destino indicado: solo locales o estampado ──
  begin
    update prod_pedidos_tela set destino_indicado = 'online' where id = v_ped;
    v_r := 'FALLA — aceptó online';
  exception when others then
    update prod_pedidos_tela set destino_indicado = 'estampado' where id = v_ped;
    v_r := 'OK — online rechazado, estampado aceptado';
  end;
  v_rep := v_rep || E'\n 11 · destino indicado .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 12. con RLS: la cortadora no inserta entregas directo ──
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select true' $q$;
  execute 'set local role authenticated';
  begin
    insert into prod_maquila_entregas (maquila_color_id, tallas, unidades)
    values (v_mc2, '{"L":1}'::jsonb, 1);
    v_r := 'FALLA — insertó una entrega sin pasar por la función';
  exception when others then
    v_r := case when SQLERRM ilike '%row-level security%' then 'OK — rechazado por RLS'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  execute 'reset role';
  v_rep := v_rep || E'\n 12 · sin escritura directa ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST entregas de maquila (fase 8o) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
