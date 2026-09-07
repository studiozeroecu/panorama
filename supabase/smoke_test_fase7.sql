-- SMOKE TEST de la fase 7. NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase7_colores.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — es decir, una sola sentencia. Eso importa: el SQL Editor de
-- Supabase reparte las sentencias de un script con `begin;` explícito entre varias
-- conexiones del pool, y entonces lo creado en una sentencia no existe para la
-- siguiente. Un bloque DO corre entero en una conexión y en una sola transacción.
--
-- ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO. Ese "error" ES el reporte: al lanzarlo,
--    PostgreSQL revierte todo lo que el bloque creó. No queda NADA en la base — ni los
--    datos de mentira, ni la sustitución temporal de fn_es_admin().
--    Verlo en rojo es lo esperado. Lee el texto del mensaje.
--
-- Qué prueba:
--   · que el trigger normaliza los colores de un pedido nuevo,
--   · fn_registrar_corte: corte + maquila + colores + tallas en un solo paso,
--   · fn_procesar_lote_maquila en sus 3 destinos (online / estampado / locales),
--   · que un lote ya procesado NO se puede procesar dos veces (el bug de duplicados),
--   · que en estampado parcial sum(tallas) = total_unidades (el arreglo del bug 1.2),
--   · que el saldo de tela bloquea un corte que se pasa de metros,
--   · y que las invariantes siguen cumpliéndose con los datos de prueba dentro.

do $SMOKE$
declare
  v_rep text := '';
  v_r   text;
  v_ok  int := 0;
  v_bad int := 0;
  v_prenda uuid; v_prov uuid; v_pedido uuid; v_corte uuid;
  v_mc_on uuid; v_mc_est uuid; v_mc_loc uuid;
  v_res jsonb; v_n int; v_m int; v_lote record;
begin
  -- fn_es_admin() consulta auth.uid(), que en el SQL Editor es NULL, así que las RPC
  -- rechazarían la llamada. La sustituimos aquí; el rollback final la restaura.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── catálogo de mentira ───────────────────────────────────
  insert into prod_prendas (nombre, consumo_metros, costo_maquila, precio_venta_local,
                            precio_venta_online, lleva_estampado, tallas, notas)
  values ('ZZ_SMOKE camiseta', 1.2, 1.50, 9, 12, true, array['S','M','L'], 'smoke test')
  returning id into v_prenda;

  insert into prod_proveedores (empresa, contacto_nombre, contacto, dias_entrega)
  values ('ZZ_SMOKE proveedor', '-', '-', 3) returning id into v_prov;

  -- ── 1. el trigger debe normalizar los colores del pedido nuevo ──
  insert into prod_pedidos_tela (nombre_tela, fecha_pedido, unidad, ancho_pedido, ancho_real,
                                 proveedor_id, prenda_id, colores, total_metros, valor_metro,
                                 total_pagar, estado, fecha_entrega_real)
  values ('ZZ_SMOKE tela', fn_hoy_ecuador(), 'metros', 150, 150, v_prov, v_prenda,
          '[{"color":"Negro","metros":60},{"color":"Blanco","metros":40},{"color":"Verde","metros":30}]'::jsonb,
          130, 5, 650, 'entregado', fn_hoy_ecuador())
  returning id into v_pedido;

  select count(*) into v_n from prod_pedido_colores where pedido_id = v_pedido;
  v_r := case when v_n = 3 then 'OK — 3 colores normalizados solos'
              else 'FALLA — se esperaban 3 colores, hay ' || v_n end;
  v_rep := v_rep || E'\n  1 · trigger de pedido ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── 2. fn_registrar_corte: 20 unidades en 3 colores ──
  v_corte := fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'smoke', 1.50,
    '[{"color":"Negro","tallas":{"S":4,"M":6,"L":2},"metros_usados":14.4},
      {"color":"Blanco","tallas":{"S":2,"M":3,"L":1},"metros_usados":7.2},
      {"color":"Verde","tallas":{"S":1,"M":1,"L":0},"metros_usados":2.4}]'::jsonb);

  select total_unidades into v_n from prod_cortes where id = v_corte;
  v_r := case when v_n = 20 then 'OK — 20 unidades'
              else 'FALLA — total_unidades = ' || v_n || ', se esperaban 20' end;
  v_rep := v_rep || E'\n  2 · fn_registrar_corte · total .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  select count(*) into v_n from prod_corte_colores where corte_id = v_corte;
  select count(*) into v_m from prod_corte_color_tallas t
    join prod_corte_colores cc on cc.id = t.corte_color_id where cc.corte_id = v_corte;
  v_r := case when v_n = 3 and v_m = 8 then 'OK — 3 colores, 8 tallas (las tallas en 0 no se guardan)'
              else 'FALLA — ' || v_n || ' colores y ' || v_m || ' tallas; se esperaban 3 y 8' end;
  v_rep := v_rep || E'\n  3 · filas normalizadas ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  select count(*) into v_n from prod_corte_colores
   where corte_id = v_corte and pedido_color_id is null;
  v_r := case when v_n = 0 then 'OK — los 3 colores enlazaron con su color de tela'
              else 'FALLA — ' || v_n || ' color(es) sin pedido_color_id' end;
  v_rep := v_rep || E'\n  4 · vínculo corte → color pedido .. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  select count(*) into v_n from prod_maquilas where corte_id = v_corte;
  select count(*) into v_m from prod_maquila_colores mc
    join prod_corte_colores cc on cc.id = mc.corte_color_id where cc.corte_id = v_corte;
  v_r := case when v_n = 1 and v_m = 3 then 'OK — 1 maquila con sus 3 colores'
              else 'FALLA — ' || v_n || ' maquila(s) y ' || v_m || ' color(es)' end;
  v_rep := v_rep || E'\n  5 · maquila automática ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- los 3 colores llegan de maquila para poder procesarlos
  update prod_maquila_colores mc
     set estado = 'entregado', fecha_entrega = fn_hoy_ecuador()
   where mc.corte_color_id in (select id from prod_corte_colores where corte_id = v_corte);

  select mc.id into v_mc_on from prod_maquila_colores mc
    join prod_corte_colores cc on cc.id = mc.corte_color_id
   where cc.corte_id = v_corte and cc.color = 'Negro';
  select mc.id into v_mc_est from prod_maquila_colores mc
    join prod_corte_colores cc on cc.id = mc.corte_color_id
   where cc.corte_id = v_corte and cc.color = 'Blanco';
  select mc.id into v_mc_loc from prod_maquila_colores mc
    join prod_corte_colores cc on cc.id = mc.corte_color_id
   where cc.corte_id = v_corte and cc.color = 'Verde';

  -- ── 6. destino online: las 12 unidades del Negro al stock ──
  v_res := fn_procesar_lote_maquila(v_mc_on, 'online');
  select coalesce(sum(disponibles), 0) into v_n from prod_stock_online
   where prenda_nombre = 'ZZ_SMOKE camiseta' and color = 'Negro' and estampado = '';
  v_r := case when v_n = 12 and (v_res ->> 'unidades')::int = 12
              then 'OK — 12 unidades al stock online'
              else 'FALLA — stock ' || v_n || ', rpc devolvió ' || coalesce(v_res ->> 'unidades','?') end;
  v_rep := v_rep || E'\n  6 · destino online ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── 7-9. destino estampado PARCIAL: 4 de 6 del Blanco ──
  v_res := fn_procesar_lote_maquila(v_mc_est, 'estampado',
    '[{"nombre":"ZZ logo","unidades":4}]'::jsonb, 2.00);

  select total_unidades, tallas, costo_total into v_lote
    from prod_lotes_estampado where prenda_nombre = 'ZZ_SMOKE camiseta' and color = 'Blanco';

  select coalesce(sum(t.value::int), 0) into v_n
    from jsonb_each_text(v_lote.tallas) as t(key, value);
  v_r := case when v_n = v_lote.total_unidades and v_n = 4
              then 'OK — sum(tallas)=4=total_unidades · ' || v_lote.tallas::text || ' ← arregla bug 1.2'
              else 'FALLA — sum(tallas)=' || v_n || ' vs total_unidades=' || v_lote.total_unidades end;
  v_rep := v_rep || E'\n  7 · estampado · tallas coherentes . ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  v_r := case when v_lote.costo_total = 8.00 then 'OK — 4 und. × $2.00 = $8.00'
              else 'FALLA — costo_total = ' || v_lote.costo_total end;
  v_rep := v_rep || E'\n  8 · estampado · costo ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  select coalesce(sum(disponibles), 0) into v_n from prod_stock_online
   where prenda_nombre = 'ZZ_SMOKE camiseta' and color = 'Blanco' and estampado = '';
  v_r := case when v_n = 2 then 'OK — las 2 no estampadas fueron al stock online'
              else 'FALLA — resto en stock = ' || v_n || ', se esperaban 2' end;
  v_rep := v_rep || E'\n  9 · estampado · resto al stock .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── 10-11. destino locales: 1 de las 2 del Verde ──
  v_res := fn_procesar_lote_maquila(v_mc_loc, 'local', '[]'::jsonb, 0,
    '{"S":1}'::jsonb, 'PK', 'ZZ-COD', 9.00, 2.00);

  select unidades, ingreso, margen into v_lote
    from prod_envios_locales where prenda_nombre = 'ZZ_SMOKE camiseta' and color = 'Verde';
  v_r := case when v_lote.unidades = 1 and v_lote.ingreso = 9.00 and v_lote.margen = 7.00
              then 'OK — 1 und., ingreso $9.00, margen $7.00'
              else 'FALLA — und=' || v_lote.unidades || ' ingreso=' || v_lote.ingreso
                   || ' margen=' || v_lote.margen end;
  v_rep := v_rep || E'\n 10 · destino locales ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  select coalesce(sum(disponibles), 0) into v_n from prod_stock_online
   where prenda_nombre = 'ZZ_SMOKE camiseta' and color = 'Verde' and estampado = '';
  v_r := case when v_n = 1 then 'OK — la unidad no enviada fue al stock online'
              else 'FALLA — resto en stock = ' || v_n || ', se esperaba 1' end;
  v_rep := v_rep || E'\n 11 · locales · resto al stock ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── 12-13. EL BUG DE DUPLICADOS: reprocesar debe fallar ──
  begin
    v_res := fn_procesar_lote_maquila(v_mc_on, 'online');
    v_r := 'FALLA — dejó procesar el mismo lote dos veces';
  exception when others then
    v_r := 'OK — rechazado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n 12 · reproceso bloqueado ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  select coalesce(sum(disponibles), 0) into v_n from prod_stock_online
   where prenda_nombre = 'ZZ_SMOKE camiseta' and color = 'Negro' and estampado = '';
  v_r := case when v_n = 12 then 'OK — sigue en 12, no se duplicó'
              else 'FALLA — stock = ' || v_n || ', debía seguir en 12' end;
  v_rep := v_rep || E'\n 13 · stock intacto tras reintento .. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── 14. el saldo de tela debe frenar un corte que se pasa ──
  begin
    perform fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'smoke exceso', 1.50,
      '[{"color":"Negro","tallas":{"S":1},"metros_usados":9999}]'::jsonb);
    v_r := 'FALLA — aceptó un corte que supera el saldo';
  exception when others then
    v_r := 'OK — rechazado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n 14 · saldo de tela ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── 15. invariantes, ahora con los datos de mentira dentro ──
  select count(*) into v_n from prod_cortes k
   where k.total_unidades <> coalesce((select sum(cc.unidades) from prod_corte_colores cc
                                        where cc.corte_id = k.id), 0);
  select count(*) into v_m from prod_corte_colores cc
   where cc.unidades <> coalesce((select sum(t.unidades) from prod_corte_color_tallas t
                                   where t.corte_color_id = cc.id), 0);
  v_r := case when v_n = 0 and v_m = 0 then 'OK — unidades y tallas cuadran en toda la base'
              else 'FALLA — ' || v_n || ' corte(s) y ' || v_m || ' color(es) descuadrados' end;
  v_rep := v_rep || E'\n 15 · invariantes tras las RPC ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST FASE 7 ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  CONTEOS (datos reales + los de prueba):\n    colores de pedido: %  ·  de corte: %  ·  tallas: %  ·  de maquila: %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad,
    case when v_bad = 0 then '✅' else '❌' end,
    (select count(*) from prod_pedido_colores),
    (select count(*) from prod_corte_colores),
    (select count(*) from prod_corte_color_tallas),
    (select count(*) from prod_maquila_colores);
end $SMOKE$;
