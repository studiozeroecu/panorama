-- Panorama — Bear & Trend · Esquema Fase 3 (Control de Producción)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de schema.sql y schema_fase2.sql.

-- ============================================================
-- Catálogos
-- ============================================================

create table if not exists prod_prendas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null,
  consumo_metros numeric(8,2) not null default 0,
  costo_maquila numeric(10,2) not null default 0,
  precio_venta_local numeric(10,2) not null default 0,
  precio_venta_online numeric(10,2) not null default 0,
  lleva_estampado boolean not null default false,
  tallas text[] not null default '{}',
  notas text not null default '',
  legacy_id text
);

create table if not exists prod_proveedores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  empresa text not null,
  contacto_nombre text not null default '',
  contacto text not null default '',
  dias_entrega integer not null default 1,
  legacy_id text
);

create table if not exists prod_costos_fijos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  valor numeric(10,4) not null default 0,
  legacy_id text
);

-- Mejora 5: maquiladoras y talleres como catálogo (no texto libre)
create table if not exists prod_maquiladoras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table if not exists prod_talleres (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

-- ============================================================
-- Cadena de producción
-- ============================================================

create table if not exists prod_pedidos_tela (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre_tela text not null,
  fecha_pedido date not null,
  unidad text not null default 'metros' check (unidad in ('metros', 'kilos')),
  rendimiento numeric(8,3),              -- metros por kilo (solo unidad=kilos)
  ancho_pedido numeric(8,2),             -- cm
  ancho_real numeric(8,2),               -- cm, al confirmar llegada
  proveedor_id uuid references prod_proveedores (id) on delete set null,
  prenda_id uuid references prod_prendas (id) on delete set null,
  -- [{ color, metros, kilos? }]
  colores jsonb not null default '[]',
  total_metros numeric(10,2) not null default 0,
  valor_metro numeric(10,4) not null default 0,
  total_pagar numeric(12,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_camino', 'entregado')),
  fecha_entrega_real date,
  legacy_id text
);
create index if not exists idx_prod_pedidos_estado on prod_pedidos_tela (estado);

-- Mejoras 1 y 2: varios cortes por pedido, con metros consumidos por corte
create table if not exists prod_cortes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pedido_id uuid not null references prod_pedidos_tela (id) on delete restrict,
  fecha date not null,
  maquiladora_id uuid references prod_maquiladoras (id) on delete set null,
  -- [{ color, tallas: {S: 6, ...}, unidades, metros_usados }]
  colores jsonb not null default '[]',
  total_unidades integer not null default 0,
  metros_consumidos numeric(10,2),       -- null = no registrado (datos migrados)
  observaciones text not null default '',
  legacy_id text
);
create index if not exists idx_prod_cortes_pedido on prod_cortes (pedido_id);

create table if not exists prod_maquilas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  corte_id uuid not null references prod_cortes (id) on delete cascade,
  maquiladora_id uuid references prod_maquiladoras (id) on delete set null,
  costo_unitario numeric(10,2) not null default 0,
  -- [{ color, tallas, unidades, estado: pendiente|enviado|entregado, fecha_envio, fecha_entrega, procesado: bool }]
  colores jsonb not null default '[]',
  total_unidades integer not null default 0,
  legacy_id text
);
create index if not exists idx_prod_maquilas_corte on prod_maquilas (corte_id);

-- Mejora 4: costo de estampado configurable + validación de unidades
create table if not exists prod_lotes_estampado (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  maquila_id uuid references prod_maquilas (id) on delete set null,
  prenda_id uuid references prod_prendas (id) on delete set null,
  prenda_nombre text not null default '',
  color text not null default '',
  tallas jsonb not null default '{}',    -- { S: 6, M: 4, ... }
  total_unidades integer not null default 0,
  disenos jsonb not null default '[]',   -- [{ nombre, unidades }]
  costo_unitario numeric(10,2) not null default 2,
  costo_total numeric(12,2) not null default 0,
  taller_id uuid references prod_talleres (id) on delete set null,
  fecha_envio date,
  fecha_retorno date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_taller', 'retornado'))
);
create index if not exists idx_prod_lotes_estado on prod_lotes_estampado (estado);

-- ============================================================
-- Stock y salidas
-- ============================================================

create table if not exists prod_stock_online (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  prenda_id uuid references prod_prendas (id) on delete set null,
  prenda_nombre text not null default '',
  color text not null default '',
  estampado text not null default '',
  talla text not null default '',
  disponibles integer not null default 0 check (disponibles >= 0),
  vendidas integer not null default 0,
  unique (prenda_nombre, color, estampado, talla)
);

-- Mejora 3: ventas online como eventos con fecha y precio
create table if not exists prod_ventas_online (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default current_date,
  stock_id uuid references prod_stock_online (id) on delete set null,
  prenda_nombre text not null default '',
  color text not null default '',
  estampado text not null default '',
  talla text not null default '',
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null default 0,
  total numeric(12,2) not null default 0
);
create index if not exists idx_prod_ventas_fecha on prod_ventas_online (fecha);

-- Mejora 6: envíos a locales con vínculo opcional al catálogo VATEX (products.codigo)
create table if not exists prod_envios_locales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default current_date,
  maquila_id uuid references prod_maquilas (id) on delete set null,
  prenda_id uuid references prod_prendas (id) on delete set null,
  prenda_nombre text not null default '',
  color text not null default '',
  tallas jsonb not null default '{}',
  unidades integer not null default 0,
  precio_unitario numeric(10,2) not null default 0,
  costo_unitario numeric(10,2) not null default 0,
  ingreso numeric(12,2) not null default 0,
  margen numeric(12,2) not null default 0,
  producto_codigo text                   -- vínculo suave a products.codigo (VATEX)
);
create index if not exists idx_prod_envloc_fecha on prod_envios_locales (fecha);

-- ============================================================
-- Seguridad: mismas políticas (web autenticada; el bot usa service role)
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'prod_prendas','prod_proveedores','prod_costos_fijos','prod_maquiladoras','prod_talleres',
    'prod_pedidos_tela','prod_cortes','prod_maquilas','prod_lotes_estampado',
    'prod_stock_online','prod_ventas_online','prod_envios_locales'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "authenticated_all_%s" on %I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;
