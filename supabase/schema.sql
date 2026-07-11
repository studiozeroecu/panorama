-- Panorama — Bear & Trend · Esquema Fase 1
-- Ejecutar en el SQL Editor de Supabase (una sola vez).

-- ============================================================
-- Tablas
-- ============================================================

-- Una fila por carga de reporte. Preparada para comparación entre
-- periodos (Fase 2): cada snapshot tiene su rango de fechas.
create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  periodo_desde date not null,
  periodo_hasta date not null,
  archivo_nombre text not null,
  archivo_path text,                -- ruta en Storage (bucket "reportes") para reprocesar
  -- resumen precalculado al cargar (evita agregar 4k filas para el listado)
  total_unidades integer not null default 0,
  total_neto numeric(12,2) not null default 0,
  num_alertas integer not null default 0,
  num_lineas_venta integer not null default 0,
  locales text[] not null default '{}',
  warnings text[] not null default '{}'
);

-- Catálogo de productos por código. `modelo_base` es el gancho para
-- Fase 2 (agrupar variantes talla/color, ej. MS016492 → MS0164) y la
-- futura tabla de costos referencia este mismo código.
create table if not exists products (
  codigo text primary key,
  descripcion text not null default '',
  modelo_base text,                 -- Fase 2: se llenará al definir la regla de agrupación
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_modelo_base on products (modelo_base);

-- Líneas de venta de un snapshot (hoja "resumen").
create table if not exists sales_lines (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references snapshots (id) on delete cascade,
  codigo text not null,
  descripcion text not null default '',
  cantidad integer not null default 0,
  pvp numeric(10,2) not null default 0,
  neto numeric(12,4)                -- "PRECIO TOTAL 61.2%" tal como viene del reporte
);
create index if not exists idx_sales_snapshot on sales_lines (snapshot_id);
create index if not exists idx_sales_codigo on sales_lines (codigo);

-- Stock por producto × local de un snapshot (hoja de existencia).
create table if not exists stock_lines (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references snapshots (id) on delete cascade,
  codigo text not null,
  descripcion text not null default '',
  local text not null,
  ing integer not null default 0,
  venta integer not null default 0,   -- negativa = salida por venta
  otros integer not null default 0,
  exist integer not null default 0,
  es_alerta boolean not null default false  -- exist<=5 y movimiento real (calculado al cargar)
);
create index if not exists idx_stock_snapshot on stock_lines (snapshot_id);
create index if not exists idx_stock_alerta on stock_lines (snapshot_id) where es_alerta;

-- ============================================================
-- Seguridad (RLS) — un solo usuario autenticado
-- ============================================================

alter table snapshots enable row level security;
alter table products enable row level security;
alter table sales_lines enable row level security;
alter table stock_lines enable row level security;

create policy "authenticated_all_snapshots" on snapshots
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_products" on products
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_sales" on sales_lines
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_stock" on stock_lines
  for all to authenticated using (true) with check (true);

-- ============================================================
-- Storage: bucket privado para los archivos originales
-- ============================================================

insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

create policy "authenticated_reportes_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'reportes')
  with check (bucket_id = 'reportes');
