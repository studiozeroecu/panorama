-- Panorama — Bear & Trend · Fase 8e: archivar catálogos en vez de borrarlos
-- Ejecutar DESPUÉS de schema_fase8d_venta_atomica.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Por qué: todas las FK hacia prod_prendas, prod_proveedores, prod_maquiladoras y
-- prod_talleres son `on delete set null`. Borrar nunca falla, pero desvincula el
-- historial en silencio: un corte registrado después entra con costo_maquila 0
-- (congelado para siempre en prod_maquilas), un despacho a local con ingreso 0, y
-- un pedido cuyo proveedor se borró deja de contarse como atrasado en el resumen
-- del lunes, sin aviso.
--
-- El evento real no es "borrar" sino "ya no trabajo con esto". Archivar lo
-- representa sin romper nada: el historial conserva su FK intacta y es reversible.
--
-- Esta migración es puramente aditiva: cuatro columnas nulas. No toca datos.

alter table prod_prendas      add column if not exists archivada_en timestamptz;
alter table prod_proveedores  add column if not exists archivada_en timestamptz;
alter table prod_maquiladoras add column if not exists archivada_en timestamptz;
alter table prod_talleres     add column if not exists archivada_en timestamptz;

-- null = activa. La app filtra por esta columna SOLO en los desplegables donde se
-- ELIGE un catálogo; en todos los demás sitios sigue leyendo el catálogo completo
-- para poder resolver ids del historial. Si se filtrara al cargar (useProduccion),
-- todo find() sobre el historial devolvería undefined y se reintroduciría el bug.

comment on column prod_prendas.archivada_en is
  'null = activa. Archivada: no se ofrece al crear pedidos, pero su historial sigue enlazado.';
comment on column prod_proveedores.archivada_en is
  'null = activo. Ver prod_prendas.archivada_en.';
comment on column prod_maquiladoras.archivada_en is
  'null = activa. Ver prod_prendas.archivada_en.';
comment on column prod_talleres.archivada_en is
  'null = activo. Ver prod_prendas.archivada_en.';

-- ============================================================
-- DESHACER:
--   alter table prod_prendas      drop column if exists archivada_en;
--   alter table prod_proveedores  drop column if exists archivada_en;
--   alter table prod_maquiladoras drop column if exists archivada_en;
--   alter table prod_talleres     drop column if exists archivada_en;
-- (Habría que revertir también el TypeScript: sin la columna, los filtros de
--  "elegir" y los botones de archivar dejan de compilar.)
-- ============================================================
