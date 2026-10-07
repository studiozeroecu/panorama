-- Tres telas de PRÁCTICA para enseñarle a la cortadora el flujo completo.
-- NO forma parte de la cadena de migraciones.
--
-- Llegan "En camino" (para empezar recibiéndolas y midiendo el ancho), con
-- colores distintos, corrida por capa (para que al cortar le sugiera cantidades)
-- y una indicación distinta en cada una: locales, estampado y sin indicación.
--
-- Se llaman "PRACTICA …" a propósito: limpieza_pruebas_cortadora.sql las borra.
-- Idempotente: si ya existe una tela con ese nombre, no la duplica.
-- Proveedor y prenda: los primeros activos (una prenda distinta para cada tela,
-- si hay suficientes). total_pagar = total_metros × valor_metro.
--
-- ⚠️ SIN begin;/commit; y sin asignaciones de PL/pgSQL (ver schema_fase8l).

insert into prod_pedidos_tela
  (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
   total_metros, valor_metro, total_pagar, estado,
   proveedor_id, prenda_id, corrida_base, destino_indicado)
select
  v.nombre,
  fn_hoy_ecuador() - 3,
  'metros',
  v.ancho,
  v.colores,
  v.metros,
  v.valor_metro,
  round(v.metros * v.valor_metro, 2),
  'en_camino',
  (select id from prod_proveedores where archivada_en is null order by empresa limit 1),
  coalesce(
    (select x.id from (select id, row_number() over (order by nombre) - 1 as rn
                       from prod_prendas where archivada_en is null) x
     where x.rn = v.n_prenda),
    (select id from prod_prendas where archivada_en is null order by nombre limit 1)),
  v.corrida,
  v.destino
from (values
  ('PRACTICA 1 — Jersey algodón', 150, 75, 5.20, 0,
   '[{"color":"Negro","metros":30},{"color":"Blanco","metros":25},{"color":"Gris jaspe","metros":20}]'::jsonb,
   '{"S":2,"M":3,"L":2,"XL":1}'::jsonb, 'locales'),
  ('PRACTICA 2 — French terry', 180, 70, 7.50, 1,
   '[{"color":"Azul marino","metros":20},{"color":"Vino","metros":20},{"color":"Verde militar","metros":15},{"color":"Beige","metros":15}]'::jsonb,
   '{"S":1,"M":2,"L":2,"XL":1}'::jsonb, 'estampado'),
  ('PRACTICA 3 — Piqué', 160, 50, 6.00, 2,
   '[{"color":"Rosa palo","metros":25},{"color":"Celeste","metros":25}]'::jsonb,
   '{"S":2,"M":2,"L":1}'::jsonb, null)
) as v(nombre, ancho, metros, valor_metro, n_prenda, colores, corrida, destino)
where not exists (select 1 from prod_pedidos_tela p where p.nombre_tela = v.nombre);

-- Comprobación (solo mira): cada tela con sus colores, que crea solo el trigger.
select p.nombre_tela, p.estado, p.destino_indicado, pr.nombre as prenda,
       string_agg(c.color || ' ' || c.metros || ' m', ', ' order by c.orden) as colores
from prod_pedidos_tela p
left join prod_prendas pr on pr.id = p.prenda_id
left join prod_pedido_colores c on c.pedido_id = p.id
where p.nombre_tela like 'PRACTICA %'
group by p.nombre_tela, p.estado, p.destino_indicado, pr.nombre
order by p.nombre_tela;
