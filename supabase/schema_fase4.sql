-- Panorama — Bear & Trend · Esquema Fase 4 (costos reales y margen por prenda)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de los esquemas 1–3.

-- Costos por prenda. Se guardan SOLO los insumos (costos y precios);
-- ganancias y márgenes se calculan al vuelo — nunca se almacenan derivados.
-- costo_total es columna generada: siempre coherente con sus componentes.
create table if not exists costos_prendas (
  id uuid primary key default gen_random_uuid(),
  producto text not null unique,
  nombre_tela text not null default '',
  costo_tela numeric(10,2) not null default 0,
  maquila numeric(10,2) not null default 0,
  dtf numeric(10,2) not null default 0,
  corte numeric(10,2) not null default 0,
  insumos numeric(10,2) not null default 0,
  etiqueta numeric(10,2) not null default 0,
  costo_total numeric(10,2) generated always as
    (costo_tela + maquila + dtf + corte + insumos + etiqueta) stored,
  pvp_vatex numeric(10,2),
  precio_online numeric(10,2),
  precio_mayoreo_1_2 numeric(10,2),
  precio_mayoreo_3_5 numeric(10,2),
  precio_mayoreo_6plus numeric(10,2),
  -- Palabras clave para auto-asignar costo a las líneas de venta VATEX por
  -- descripción (todas deben aparecer; gana el match con más palabras).
  match_keywords text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Vínculo manual código VATEX → costo (prioridad sobre keywords).
create table if not exists costos_vinculos (
  codigo text primary key,
  costo_id uuid not null references costos_prendas (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table costos_prendas enable row level security;
alter table costos_vinculos enable row level security;
create policy "authenticated_all_costos_prendas" on costos_prendas
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_costos_vinculos" on costos_vinculos
  for all to authenticated using (true) with check (true);
