-- Panorama — Bear & Trend · Esquema Fase 5 (deudas y flujo de caja)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de los esquemas 1–4.
-- Nota: el estado "vencido" NO se guarda — se calcula (pendiente + fecha pasada).

create table if not exists cuentas_por_cobrar (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cliente text not null,
  concepto text not null default '',
  monto numeric(12,2) not null check (monto > 0),
  fecha_factura date not null default current_date,
  fecha_vencimiento date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'cobrado')),
  fecha_cobro date,
  notas text not null default ''
);
create index if not exists idx_cxc_estado on cuentas_por_cobrar (estado, fecha_vencimiento);

create table if not exists cuentas_por_pagar (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  proveedor text not null,
  concepto text not null default '',
  monto numeric(12,2) not null check (monto > 0),
  fecha_factura date not null default current_date,
  fecha_vencimiento date,
  tipo_pago text not null default 'efectivo' check (tipo_pago in ('efectivo', 'cheque', 'transferencia')),
  -- categoría para el gasto automático en movimientos al marcar como pagada
  categoria text not null default 'otros' check (categoria in
    ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'otros')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado')),
  fecha_pago date,
  notas text not null default ''
);
create index if not exists idx_cxp_estado on cuentas_por_pagar (estado, fecha_vencimiento);

-- Extensión de cheques (Fase 2): vínculo opcional a una cuenta por pagar
alter table cheques add column if not exists cuenta_por_pagar_id uuid
  references cuentas_por_pagar (id) on delete set null;

alter table cuentas_por_cobrar enable row level security;
alter table cuentas_por_pagar enable row level security;
create policy "authenticated_all_cxc" on cuentas_por_cobrar
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_cxp" on cuentas_por_pagar
  for all to authenticated using (true) with check (true);
