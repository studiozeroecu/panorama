-- Panorama — Bear & Trend · Esquema Fase 2 (bot de Telegram)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de schema.sql.

-- ============================================================
-- Movimientos: pagos/gastos e ingresos registrados por mensaje
-- ============================================================

create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('gasto', 'ingreso')),
  monto numeric(12,2) not null check (monto > 0),
  concepto text not null default '',
  categoria text not null default 'otros' check (categoria in
    ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'otros')),
  origen text not null default 'telegram'
);
create index if not exists idx_movimientos_fecha on movimientos (fecha);
create index if not exists idx_movimientos_categoria on movimientos (categoria);

-- ============================================================
-- Cheques: por cobrar y por pagar
-- ============================================================

create table if not exists cheques (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in ('por_cobrar', 'por_pagar')),
  monto numeric(12,2) not null check (monto > 0),
  beneficiario text not null default '',
  banco text not null default '',
  numero text not null default '',
  fecha_emision date,
  fecha_cobro date,                 -- cuándo se puede cobrar / vence
  estado text not null default 'pendiente' check (estado in
    ('pendiente', 'cobrado', 'rebotado', 'anulado')),
  foto_path text,                   -- ruta en Storage (bucket "cheques") si vino por foto
  notas text not null default ''
);
create index if not exists idx_cheques_estado on cheques (estado);
create index if not exists idx_cheques_fecha_cobro on cheques (fecha_cobro);

-- ============================================================
-- Acciones pendientes del bot (confirmaciones por botones)
-- ============================================================

create table if not exists bot_pending_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chat_id text not null,
  kind text not null check (kind in ('cheque', 'snapshot_conflict')),
  payload jsonb not null default '{}',
  resolved boolean not null default false
);
create index if not exists idx_pending_chat on bot_pending_actions (chat_id) where not resolved;

-- ============================================================
-- Seguridad: mismas políticas que Fase 1 (el bot usa service role,
-- que omite RLS; estas políticas cubren el acceso desde la web)
-- ============================================================

alter table movimientos enable row level security;
alter table cheques enable row level security;
alter table bot_pending_actions enable row level security;

create policy "authenticated_all_movimientos" on movimientos
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_cheques" on cheques
  for all to authenticated using (true) with check (true);
create policy "authenticated_all_pending" on bot_pending_actions
  for all to authenticated using (true) with check (true);

-- ============================================================
-- Storage: bucket privado para fotos de cheques
-- ============================================================

insert into storage.buckets (id, name, public)
values ('cheques', 'cheques', false)
on conflict (id) do nothing;

create policy "authenticated_cheques_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'cheques')
  with check (bucket_id = 'cheques');
