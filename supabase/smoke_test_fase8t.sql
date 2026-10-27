-- SMOKE TEST de los tres destinos con estampado y costo completo (fase 8t).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8t_destinos_y_costos.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- ⚠️ smoke_test_fase8s.sql queda OBSOLETO: llama con la forma de p_reparto de
-- la 8s (online / estampado como destino). Falla a propósito; no es regresión.
--
-- Las que justifican el archivo:
--   · la 1: una entrega a bodega, locales y feria, con estampados DENTRO de
--     cada destino, y el costo completo congelado en cada salida;
--   · la 6-8: cada lote vuelve del taller a SU destino, con su diseño y su costo.

do $SMOKE$
declare
  v_rep    text := '';
  v_r      text;
  v_ok     int := 0;
  v_bad    int := 0;
  v_prenda uuid := gen_random_uuid();
  v_ped    uuid := gen_random_uuid();
  v_feria  uuid := gen_random_uuid();
  v_feria2 uuid := gen_random_uuid();
  v_res    jsonb;
  v_cor    uuid;
  v_mc     uuid;
  v_ent    uuid;
  v_lote   uuid;
  v_reparto jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_prendas (id, nombre) values (v_prenda, 'ZZ Sudadera 8t');
  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores, total_metros,
     valor_metro, total_pagar, estado, fecha_entrega_real, prenda_id)
  values (v_ped, 'ZZ_SMOKE 8t', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8t","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador(), v_prenda);
  insert into prod_ferias (id, nombre) values (v_feria, 'ZZ Feria 8t');
  insert into prod_ferias (id, nombre, cerrada_en) values (v_feria2, 'ZZ Feria cerrada 8t', now());

  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1,
    '[{"color":"ZZNegro8t","tallas":{"S":10,"M":15}}]'::jsonb, gen_random_uuid(), null);
  v_cor := (v_res ->> 'corte_id')::uuid;
  v_mc := (select mc.id from prod_maquila_colores mc
           join prod_corte_colores cc on cc.id = mc.corte_color_id
           where cc.corte_id = v_cor);
  update prod_maquila_colores set estado = 'enviado', fecha_envio = fn_hoy_ecuador() where id = v_mc;
  perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":10,"M":15}'::jsonb);
  v_ent := (select id from prod_maquila_entregas where maquila_color_id = v_mc);

  --   bodega: básicos S2 M5 + ZZLogo S1        → S3 M5
  --   local:  básicos M2    + ZZOso M3         → M5
  --   feria:  básicos S4 M2 + ZZLogo S3 M3     → S7 M5
  v_reparto := ('{"costo_produccion":6,"costo_estampado":2.5,
     "bodega":{"basicos":{"S":2,"M":5},"disenos":[{"nombre":"ZZLogo","tallas":{"S":1}}]},
     "local":{"basicos":{"M":2},"disenos":[{"nombre":"ZZOso","tallas":{"M":3}},{"nombre":"","tallas":{}}],
              "local_destino":"PK","producto_codigo":"ZZ01","precio":12},
     "feria":{"basicos":{"S":4,"M":2},"disenos":[{"nombre":"ZZLogo","tallas":{"S":3,"M":3}}],
              "feria_id":"' || v_feria || '"}}')::jsonb;

  -- ── 2. si una talla no cuadra, no se guarda NADA ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      jsonb_set(v_reparto, '{bodega,basicos,M}', '4'::jsonb));
    v_r := 'FALLA — aceptó un reparto que no cuadra';
  exception when others then
    v_r := case when SQLERRM like '%Talla M%llegaron 15%repartiste 14%'
                then 'OK — "Talla M: llegaron 15 y repartiste 14"'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n   2 · talla que no cuadra ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. diseño con unidades y sin nombre ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      jsonb_set(v_reparto, '{bodega,disenos,0,nombre}', '" "'::jsonb));
    v_r := 'FALLA — aceptó un diseño sin nombre';
  exception when others then
    v_r := case when SQLERRM like 'Bodega%sin nombre%' then 'OK — "Bodega: … sin nombre"'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n   3 · diseño sin nombre ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. a una feria cerrada no se manda nada ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      jsonb_set(v_reparto, '{feria,feria_id}', to_jsonb(v_feria2::text)));
    v_r := 'FALLA — aceptó una feria cerrada';
  exception when others then
    v_r := case when SQLERRM like '%cerrada%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n   4 · feria cerrada ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 1. ⚠️ tres destinos con estampados dentro, y el costo completo ──
  begin
    v_res := fn_repartir_entrega_maquila(v_ent, v_reparto);
    v_r := case
      when (v_res -> 'bodega' ->> 'basicos')::int = 7 and (v_res -> 'bodega' ->> 'estampadas')::int = 1
       and (v_res -> 'feria' ->> 'basicos')::int = 6 and (v_res ->> 'lotes_estampado')::int = 3
       and (select disponibles from prod_stock_online
             where prenda_id = v_prenda and estampado = '' and talla = 'M') = 5
       and (select costo_unitario from prod_bodega_ingresos where prenda_id = v_prenda) = 6
       and (select costo_unitario from prod_envios_locales where prenda_id = v_prenda) = 8.5
       and (select margen from prod_envios_locales where prenda_id = v_prenda) = 7
       and (select costo_unitario from prod_feria_ingresos where feria_id = v_feria) = 11
       and (select count(*) from prod_lotes_estampado where prenda_id = v_prenda) = 3
       and (select tallas from prod_lotes_estampado where prenda_id = v_prenda and destino = 'feria')
             = '{"S":3,"M":3}'::jsonb
       and (select feria_id from prod_lotes_estampado where prenda_id = v_prenda and destino = 'feria') = v_feria
       and (select costo_unitario from prod_lotes_estampado where prenda_id = v_prenda and destino = 'local') = 2.5
       and (select procesado from prod_maquila_entregas where id = v_ent)
      then 'OK — básicas a destino, 3 lotes al taller, costos 6 / 8,50 / 11'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n   1 · tres destinos con estampado ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. un segundo clic no reparte dos veces ──
  begin
    perform fn_repartir_entrega_maquila(v_ent, v_reparto);
    v_r := 'FALLA — procesó la misma entrega dos veces';
  exception when others then
    v_r := case when SQLERRM like '%ya fue procesada%' then 'OK — "ya fue procesada"'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n   5 · reintento ..................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  update prod_lotes_estampado set estado = 'en_taller', fecha_envio = fn_hoy_ecuador()
   where prenda_id = v_prenda;

  -- ── 6. ⚠️ el lote de feria vuelve a la feria ──
  begin
    v_lote := (select id from prod_lotes_estampado where prenda_id = v_prenda and destino = 'feria');
    perform fn_retornar_lote_estampado(v_lote, fn_hoy_ecuador());
    v_r := case
      when (select tallas from prod_feria_ingresos where lote_estampado_id = v_lote) = '{"S":3,"M":3}'::jsonb
       and (select estampado from prod_feria_ingresos where lote_estampado_id = v_lote) = 'ZZLogo'
       and (select costo_unitario from prod_feria_ingresos where lote_estampado_id = v_lote) = 13.5
       and not exists (select 1 from prod_stock_online where prenda_id = v_prenda and estampado <> '')
      then 'OK — a la feria, ZZLogo S3 M3, $13,50 c/u'
      else 'FALLA — no entró bien a la feria' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n   6 · retorno a feria ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. ⚠️ el lote de locales vuelve como envío a locales ──
  begin
    v_lote := (select id from prod_lotes_estampado where prenda_id = v_prenda and destino = 'local');
    perform fn_retornar_lote_estampado(v_lote, fn_hoy_ecuador());
    v_r := case
      when (select unidades from prod_envios_locales where lote_estampado_id = v_lote) = 3
       and (select estampado from prod_envios_locales where lote_estampado_id = v_lote) = 'ZZOso'
       and (select costo_unitario from prod_envios_locales where lote_estampado_id = v_lote) = 11
       and (select margen from prod_envios_locales where lote_estampado_id = v_lote) = 3
       and (select local_destino from prod_envios_locales where lote_estampado_id = v_lote) = 'PK'
      then 'OK — a PK, ZZOso 3 und., $11 c/u, margen $3'
      else 'FALLA — no entró bien a locales' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n   7 · retorno a locales ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. el lote de bodega vuelve a la bodega con su diseño ──
  begin
    v_lote := (select id from prod_lotes_estampado where prenda_id = v_prenda and destino = 'bodega');
    perform fn_retornar_lote_estampado(v_lote, fn_hoy_ecuador());
    v_r := case
      when (select disponibles from prod_stock_online
             where prenda_id = v_prenda and estampado = 'ZZLogo' and talla = 'S') = 1
       and (select costo_unitario from prod_bodega_ingresos where lote_estampado_id = v_lote) = 8.5
      then 'OK — bodega ZZLogo S1, $8,50 c/u'
      else 'FALLA — no entró bien a la bodega' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n   8 · retorno a bodega .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. un lote viejo (sin destino ni tallas por diseño) vuelve como antes ──
  begin
    insert into prod_lotes_estampado (prenda_id, prenda_nombre, color, tallas, total_unidades,
                                      disenos, costo_unitario, costo_total, estado)
    values (v_prenda, 'ZZ Sudadera 8t', 'ZZViejo8t', '{"L":2}'::jsonb, 2,
            '[{"nombre":"ZZA","unidades":1},{"nombre":"ZZB","unidades":1}]'::jsonb, 2, 4, 'en_taller');
    v_lote := (select id from prod_lotes_estampado where color = 'ZZViejo8t');
    perform fn_retornar_lote_estampado(v_lote, fn_hoy_ecuador());
    v_r := case
      when (select disponibles from prod_stock_online
             where color = 'ZZViejo8t' and estampado = 'ZZA, ZZB' and talla = 'L') = 2
      then 'OK — a la bodega con "ZZA, ZZB"'
      else 'FALLA — el lote viejo no volvió como antes' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n   9 · lote anterior a la 8s ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 10. una sola versión de cada función ──
  v_r := case when (select count(*) from pg_proc where proname = 'fn_repartir_entrega_maquila') = 1
               and (select count(*) from pg_proc where proname = 'fn_retornar_lote_estampado') = 1
              then 'OK — sin sobrecargas'
              else 'FALLA — hay versiones de más' end;
  v_rep := v_rep || E'\n  10 · sin sobrecargas ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST destinos y costos (fase 8t) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
