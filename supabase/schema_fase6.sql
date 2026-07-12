-- Panorama — Bear & Trend · Esquema Fase 6 (roles + logística)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de los esquemas 1–5.
--
-- ⚠️ Este script REESCRIBE la seguridad de toda la base:
--   antes: cualquier usuario autenticado podía todo.
--   ahora: solo rol "admin" accede a datos de negocio; el rol "logistica"
--   solo puede subir guías, ver las suyas y leer el catálogo de productos.
-- El bot y los crons usan service role (omiten RLS) — no les afecta.

-- ============================================================
-- Roles
-- ============================================================

create table if not exists user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rol text not null check (rol in ('admin', 'logistica')),
  created_at timestamptz not null default now()
);

-- Bootstrap: todos los usuarios EXISTENTES pasan a admin (hoy: solo el dueño).
-- La cuenta de logística se crea DESPUÉS y se registra con el insert de abajo.
insert into user_roles (user_id, rol)
select id, 'admin' from auth.users
on conflict (user_id) do nothing;

-- Helpers (security definer para poder usarse dentro de políticas)
create or replace function fn_es_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from user_roles where user_id = auth.uid() and rol = 'admin') $$;

create or replace function fn_es_logistica() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from user_roles where user_id = auth.uid() and rol = 'logistica') $$;

alter table user_roles enable row level security;
drop policy if exists "roles_select_propio" on user_roles;
create policy "roles_select_propio" on user_roles
  for select to authenticated using (user_id = auth.uid() or fn_es_admin());
drop policy if exists "roles_admin_gestiona" on user_roles;
create policy "roles_admin_gestiona" on user_roles
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- ============================================================
-- Guías de transferencia
-- ============================================================

create table if not exists guias_transferencia (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default current_date,
  local_destino text not null check (local_destino in
    ('PK','LJ','GL','GT','BS','IBA','HUMZO','CV','HUMMER','QUITO','FRATELLI')),
  -- [{ codigo, descripcion, cantidad, precio_unitario }]
  items jsonb not null default '[]',
  total_unidades integer not null default 0,
  total_valor numeric(12,2) not null default 0,
  recibido_por text not null default '',
  foto_path text,
  subido_por uuid not null references auth.users (id) default auth.uid()
);
create index if not exists idx_guias_fecha on guias_transferencia (fecha);

-- Cruce con producción (decisión Fase 6): a qué local fue cada lote
alter table prod_envios_locales add column if not exists local_destino text;

-- ============================================================
-- Políticas de guías
-- ============================================================

alter table guias_transferencia enable row level security;
drop policy if exists "guias_insert" on guias_transferencia;
create policy "guias_insert" on guias_transferencia
  for insert to authenticated
  with check ((fn_es_logistica() or fn_es_admin()) and subido_por = auth.uid());
drop policy if exists "guias_select" on guias_transferencia;
create policy "guias_select" on guias_transferencia
  for select to authenticated
  using (fn_es_admin() or subido_por = auth.uid());
drop policy if exists "guias_update_propias" on guias_transferencia;
create policy "guias_update_propias" on guias_transferencia
  for update to authenticated
  using (fn_es_admin() or subido_por = auth.uid())
  with check (fn_es_admin() or subido_por = auth.uid());
drop policy if exists "guias_delete_admin" on guias_transferencia;
create policy "guias_delete_admin" on guias_transferencia
  for delete to authenticated using (fn_es_admin());

-- ============================================================
-- Reescritura: el resto de la base pasa a admin-only,
-- salvo products (lectura para ambos roles — logística arma guías con él)
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'snapshots','products','sales_lines','stock_lines',
    'movimientos','cheques','bot_pending_actions',
    'prod_prendas','prod_proveedores','prod_costos_fijos','prod_maquiladoras','prod_talleres',
    'prod_pedidos_tela','prod_cortes','prod_maquilas','prod_lotes_estampado',
    'prod_stock_online','prod_ventas_online','prod_envios_locales',
    'costos_prendas','costos_vinculos',
    'cuentas_por_cobrar','cuentas_por_pagar'
  ] loop
    -- elimina las políticas permisivas de fases anteriores
    execute format('drop policy if exists "authenticated_all_%s" on %I', t, t);
    execute format('drop policy if exists "authenticated_all_snapshots" on %I', t);
    execute format('drop policy if exists "admin_all_%s" on %I', t, t);
    execute format(
      'create policy "admin_all_%s" on %I for all to authenticated using (fn_es_admin()) with check (fn_es_admin())',
      t, t
    );
  end loop;
end $$;

-- nombres antiguos que no seguían el patrón exacto
drop policy if exists "authenticated_all_sales" on sales_lines;
drop policy if exists "authenticated_all_stock" on stock_lines;
drop policy if exists "authenticated_all_pending" on bot_pending_actions;
drop policy if exists "authenticated_all_cxc" on cuentas_por_cobrar;
drop policy if exists "authenticated_all_cxp" on cuentas_por_pagar;

-- products: lectura también para logística
drop policy if exists "products_lectura_todos" on products;
create policy "products_lectura_todos" on products
  for select to authenticated using (fn_es_admin() or fn_es_logistica());

-- ============================================================
-- Storage: bucket para fotos de guías
-- ============================================================

insert into storage.buckets (id, name, public)
values ('guias', 'guias', false)
on conflict (id) do nothing;

drop policy if exists "guias_storage_insert" on storage.objects;
create policy "guias_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'guias' and (fn_es_logistica() or fn_es_admin()));
drop policy if exists "guias_storage_select" on storage.objects;
create policy "guias_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'guias' and (fn_es_admin() or owner = auth.uid()));

-- ============================================================
-- Cuenta de logística (hacer DESPUÉS de crearla en Authentication → Users):
--   insert into user_roles (user_id, rol)
--   values ('<uuid-de-la-usuaria>', 'logistica')
--   on conflict (user_id) do update set rol = 'logistica';
-- ============================================================
