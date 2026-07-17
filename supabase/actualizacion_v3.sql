-- Panorama — Actualización v3: bot DTF, categorías de costo con prioridad,
-- dedupe de Telegram y acciones de urgencias.
-- Ejecutar en el SQL Editor DESPUÉS de actualizacion_match_y_bot.sql.

-- ============================================================
-- 1) Lotes de estampado DTF registrados por el bot (Telegram)
--    Sistema independiente de prod_lotes_estampado (coexisten a propósito).
--    Regla de metros: ceil(claras/por_metro) + ceil(oscuras/por_metro) —
--    claros y oscuros nunca comparten metro de film.
-- ============================================================

create table if not exists dtf_lotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default current_date,
  prenda text not null,
  modelo text not null default '',
  tecnica text not null default 'DTF' check (tecnica in ('DTF', 'Serigrafía', 'Sublimación')),
  unidades_claras integer not null default 0 check (unidades_claras >= 0),
  unidades_oscuras integer not null default 0 check (unidades_oscuras >= 0),
  total_unidades integer not null default 0,
  por_metro integer not null check (por_metro > 0),
  precio_metro numeric(10,2) not null default 0,
  metros_claros integer not null default 0,
  metros_oscuros integer not null default 0,
  metros integer not null default 0,
  valor_total numeric(12,2) not null default 0,
  valor_unitario numeric(10,4) not null default 0,
  origen text not null default 'telegram',
  notas text not null default ''
);
create index if not exists idx_dtf_lotes_fecha on dtf_lotes (fecha);

alter table dtf_lotes enable row level security;
drop policy if exists "admin_all_dtf_lotes" on dtf_lotes;
create policy "admin_all_dtf_lotes" on dtf_lotes
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- ============================================================
-- 2) Dedupe de updates de Telegram: si Telegram reintenta la entrega
--    (respuestas lentas), el webhook procesaba el mismo mensaje dos veces.
-- ============================================================

create table if not exists telegram_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
alter table telegram_updates enable row level security;
-- solo el service role la usa; sin políticas = sin acceso desde la web

-- ============================================================
-- 3) Nuevos tipos de acción pendiente del bot
-- ============================================================

alter table bot_pending_actions drop constraint if exists bot_pending_actions_kind_check;
alter table bot_pending_actions add constraint bot_pending_actions_kind_check
  check (kind in ('cheque', 'snapshot_conflict', 'guia', 'dtf_lote', 'urgencias'));

-- ============================================================
-- 4) Categorías de costo con PRIORIDAD (rediseño):
--    reglas automáticas al cargar cualquier reporte, primera que aplica gana
--    (menor prioridad = se evalúa antes; CUELLO CHINO va antes que CAMISETA).
--    Cada entrada de "incluir" admite alternativas con "|" (cualquiera activa)
--    y todas las entradas deben cumplirse; "excluir" = ninguna debe aparecer.
--    Editables desde /costos.
-- ============================================================

create table if not exists costos_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  prioridad integer not null default 100,
  incluir text[] not null default '{}',
  excluir text[] not null default '{}',
  costo_id uuid references costos_prendas (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table costos_categorias enable row level security;
drop policy if exists "admin_all_costos_categorias" on costos_categorias;
create policy "admin_all_costos_categorias" on costos_categorias
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- Siembra de las 6 categorías (regla del dueño, jul 2026).
-- El costo asignado a "Cuello chino / Buzo" y "Ropa mujer" es un default
-- razonable — cámbialo desde /costos si otro representa mejor la categoría.
insert into costos_categorias (nombre, prioridad, incluir, excluir, costo_id) values
  ('Cuello chino / Buzo', 10, '{"CUELLO CHINO|BUZO"}', '{}',
    (select id from costos_prendas where producto = 'cuello chino')),
  ('Sudadera básica', 20, '{"HODDIE|SUDADERA","BASICA|COLOR ENTERO"}', '{}',
    (select id from costos_prendas where producto = 'hoddie basica')),
  ('Sudadera estampada', 30, '{"HODDIE|SUDADERA"}', '{"BASICA","COLOR ENTERO"}',
    (select id from costos_prendas where producto = 'hoddies')),
  ('Camiseta básica', 40, '{"CAMISETA","BASICA|COLOR ENTERO"}', '{}',
    (select id from costos_prendas where producto = 'camiseta basica')),
  ('Camiseta estampada', 50, '{"CAMISETA"}', '{"BASICA","COLOR ENTERO"}',
    (select id from costos_prendas where producto = 'camiseta')),
  ('Ropa mujer', 60, '{"MUJER|CONJUNTO|PANTALON|BLUZA|BLUSA"}', '{}',
    (select id from costos_prendas where producto = 'pant mujer'))
on conflict (nombre) do nothing;
