-- Dos pedidos de prueba para estrenar el flujo de la cortadora.
-- NO forma parte de la cadena de migraciones: son DATOS, no schema.
--
-- ⚠️ SIN begin;/commit; — es un solo bloque DO, es decir una sola transacción.
--
-- No lleva uuids a pelo: busca el proveedor y la prenda POR NOMBRE y aborta con
-- la lista de opciones si no los encuentra. Un `prenda_id` nulo insertado en
-- silencio dejaría los dos pedidos sin estimación de unidades y sin tallas, que
-- es justo lo que se quiere probar.
--
-- Los colores se crean solos: `trg_sync_pedido_colores` normaliza el jsonb a
-- prod_pedido_colores en el mismo INSERT.
--
-- `corrida_base` queda en NULL a propósito — la define Mateo desde la pantalla,
-- que es el paso 1 de la prueba.

do $$
declare
  -- ⚠️ Si alguno de estos dos nombres no existe, el bloque aborta y te dice
  --    cuáles hay. Cámbialos aquí y vuelve a correrlo.
  v_prenda_nombre    text := 'Camiseta cuello chino';
  v_proveedor_nombre text := 'Franco abril';

  v_prenda uuid;
  v_prov   uuid;
  v_tec    uuid;
  v_pra    uuid;
  v_lista  text;
  v_n      int;
begin
  -- ── La prenda ──
  select id into v_prenda from prod_prendas
  where lower(btrim(nombre)) = lower(btrim(v_prenda_nombre)) limit 1;
  if v_prenda is null then
    select string_agg(nombre, ' · ' order by nombre) into v_lista
    from prod_prendas where archivada_en is null;
    raise exception 'No existe la prenda "%". Las que hay: %', v_prenda_nombre, v_lista;
  end if;

  -- ── El proveedor ──
  select id into v_prov from prod_proveedores
  where lower(btrim(empresa)) = lower(btrim(v_proveedor_nombre)) limit 1;
  if v_prov is null then
    select string_agg(empresa, ' · ' order by empresa) into v_lista
    from prod_proveedores where archivada_en is null;
    raise exception 'No existe el proveedor "%". Los que hay: %', v_proveedor_nombre, v_lista;
  end if;

  -- ── No duplicar si ya se corrió antes ──
  select count(*) into v_n from prod_pedidos_tela
  where nombre_tela like '%PRUEBA TECNICA%' or nombre_tela like '%PRACTICA CORTADORA%';
  if v_n > 0 then
    raise exception 'Ya existen % pedido(s) de prueba. Bórralos antes de volver a crearlos.', v_n;
  end if;

  -- ══════════════════════════════════════════════════════════
  -- 1) PRUEBA TECNICA — 2 colores, 60 m. Para validar el flujo y borrar.
  -- ══════════════════════════════════════════════════════════
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, ancho_real,
     proveedor_id, prenda_id, colores, total_metros, valor_metro, total_pagar,
     estado, fecha_entrega_real)
  values (
    'Jersey algodón 30/1 — PRUEBA TECNICA',
    fn_hoy_ecuador() - 7, 'metros', 150, 150,
    v_prov, v_prenda,
    '[{"color":"Negro","metros":30},{"color":"Blanco hueso","metros":30}]'::jsonb,
    60, 6.50, 390.00,
    'entregado', fn_hoy_ecuador() - 2)
  returning id into v_tec;

  -- ══════════════════════════════════════════════════════════
  -- 2) PRACTICA CORTADORA — 3 colores, 75 m. Se queda una temporada.
  --    Con una mesa de 9 m dan 8 capas completas, así que hay margen para
  --    practicar varios cortes sin quedarse sin saldo de tela.
  -- ══════════════════════════════════════════════════════════
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, ancho_real,
     proveedor_id, prenda_id, colores, total_metros, valor_metro, total_pagar,
     estado, fecha_entrega_real)
  values (
    'Jersey algodón 30/1 — PRACTICA CORTADORA',
    fn_hoy_ecuador() - 5, 'metros', 150, 150,
    v_prov, v_prenda,
    '[{"color":"Negro","metros":25},{"color":"Crudo","metros":25},{"color":"Verde militar","metros":25}]'::jsonb,
    75, 6.50, 487.50,
    'entregado', fn_hoy_ecuador() - 1)
  returning id into v_pra;

  -- ── Reporte. Esto NO revierte: es un insert de verdad. ──
  select count(*) into v_n from prod_pedido_colores where pedido_id in (v_tec, v_pra);
  raise notice E'\n  Prenda:     %\n  Proveedor:  %\n  TECNICA:    %  (60 m, 2 colores)\n  PRACTICA:   %  (75 m, 3 colores)\n  Colores normalizados por el trigger: %  (deben ser 5)\n',
    v_prenda_nombre, v_proveedor_nombre, v_tec, v_pra, v_n;
end $$;

-- Comprobación, para correr aparte (el NOTICE de arriba el editor a veces lo esconde):
--   select p.nombre_tela, p.estado, p.ancho_real, p.total_metros, p.corrida_base,
--          pr.nombre as prenda, pv.empresa as proveedor,
--          (select count(*) from prod_pedido_colores c where c.pedido_id = p.id) as colores
--   from prod_pedidos_tela p
--   left join prod_prendas pr on pr.id = p.prenda_id
--   left join prod_proveedores pv on pv.id = p.proveedor_id
--   where p.nombre_tela like '%PRUEBA TECNICA%' or p.nombre_tela like '%PRACTICA CORTADORA%';
