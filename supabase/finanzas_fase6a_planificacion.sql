-- Panorama — Finanzas · Fase 6A "PLANIFICACIÓN": gastos fijos, estimados,
-- tarjetas de crédito, gastos hormiga y cuadre de caja
-- ============================================================
-- Ejecutar en el SQL Editor DESPUÉS de finanzas_fase5a2_editar_factura.sql.
--
-- • UN SOLO bloque DO: todo o nada. Sin begin/commit. Repetible sin daño.
-- • Solo AGREGA: no borra ni renombra nada.
-- • Las variables se asignan con  v := (select …)  y los ids se generan antes
--   del insert (regla del SQL Editor de Supabase; ver CLAUDE.md raíz).
-- • Probarlo antes con finanzas_fase6a_planificacion_prueba_en_seco.sql.
--
-- Al final, un resumen en español simple de qué crea y qué NO cambia.
-- ============================================================

do $plan$
begin

-- ============================================================
-- 1) GASTOS FIJOS: se registran una vez y aparecen solos cada mes
--    (guardería, arriendo…). Mensual (un día) o quincenal (dos días).
--    Fecha de fin opcional (la guardería termina; el arriendo no).
--    Si el día no existe en el mes (31 en febrero), cae el último día.
--    Las fechas de cada mes NO se guardan: se calculan. Solo se guarda
--    cada PAGO, una vez por fecha programada.
-- ============================================================

create table if not exists gastos_fijos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null,
  monto numeric(12,2) not null check (monto > 0),
  frecuencia text not null default 'mensual' check (frecuencia in ('mensual', 'quincenal')),
  dias integer[] not null default '{1}',
  fecha_inicio date not null default ((now() at time zone 'America/Guayaquil')::date),
  fecha_fin date,
  ambito text not null default 'empresa' check (ambito in ('empresa', 'personal')),
  categoria text not null default 'otros',
  medio text not null default 'transferencia' check (medio in ('cheque', 'transferencia', 'efectivo')),
  activo boolean not null default true,
  notas text not null default '',
  constraint fin_fijos_nombre check (btrim(nombre) <> ''),
  constraint fin_fijos_dias_validos check (cardinality(dias) between 1 and 2 and 1 <= all (dias) and 31 >= all (dias)),
  constraint fin_fijos_dias_frecuencia check (
    (frecuencia = 'mensual' and cardinality(dias) = 1) or (frecuencia = 'quincenal' and cardinality(dias) = 2)),
  constraint fin_fijos_fin check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

alter table gastos_fijos drop constraint if exists fin_fijos_categoria;
alter table gastos_fijos add  constraint fin_fijos_categoria check (categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'sueldos', 'otros', 'hormiga'));

create table if not exists gastos_fijos_pagos (
  id uuid primary key default gen_random_uuid(),   -- lo genera la pantalla
  created_at timestamptz not null default now(),
  gasto_fijo_id uuid not null references gastos_fijos (id) on delete restrict,
  fecha_programada date not null,                  -- qué fecha del calendario se pagó
  fecha_pago date not null,
  monto numeric(12,2) not null check (monto > 0),
  notas text not null default '',
  origen text not null default 'web',
  constraint fin_fijos_un_pago_por_fecha unique (gasto_fijo_id, fecha_programada)
);
create index if not exists idx_fijos_pagos_fijo on gastos_fijos_pagos (gasto_fijo_id, fecha_programada);

-- ¿Esa fecha es una de las del gasto fijo? (día pedido, o el último del mes
-- si el día no existe en ese mes)
create or replace function fn_es_fecha_de_fijo(p_dias integer[], p_fecha date) returns boolean
language sql immutable set search_path = public as
$$
  select exists (
    select 1 from unnest(p_dias) d
     where least(d, extract(day from (date_trunc('month', p_fecha) + interval '1 month - 1 day'))::int)
           = extract(day from p_fecha)::int
  )
$$;


-- ============================================================
-- 2) ESTIMADOS DEL MES (maquila, impresión DTF…): para planificar.
--    Una base por categoría; el valor de cada mes lo SUGIERE la app
--    (promedio de los meses anteriores × temporada) y se puede fijar a
--    mano en estimados_mes. Lo realmente gastado se calcula de los
--    gastos de esa categoría: no se guarda aquí.
-- ============================================================

create table if not exists estimados_gasto (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null,
  categoria text not null,
  base numeric(12,2) not null check (base > 0),
  ambito text not null default 'empresa' check (ambito in ('empresa', 'personal')),
  activo boolean not null default true,
  notas text not null default '',
  constraint fin_estimados_nombre check (btrim(nombre) <> '')
);

alter table estimados_gasto drop constraint if exists fin_estimados_categoria;
alter table estimados_gasto add  constraint fin_estimados_categoria check (categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'sueldos', 'otros', 'hormiga'));

-- una sola estimación activa por categoría (si no, el gasto real se contaría dos veces)
create unique index if not exists fin_estimados_una_por_categoria
  on estimados_gasto (categoria) where activo;

create table if not exists estimados_mes (
  estimado_id uuid not null references estimados_gasto (id) on delete restrict,
  mes date not null check (extract(day from mes) = 1),   -- primer día del mes
  monto numeric(12,2) not null check (monto >= 0),
  created_at timestamptz not null default now(),
  primary key (estimado_id, mes)
);

-- Temporadas: cuánto suben (o bajan) los gastos cada mes del año.
-- 1.00 = normal. Se siembran noviembre (fiestas de Cuenca) y diciembre
-- (Navidad) como el dueño los describió; se cambian desde la app.
-- "on conflict do nothing": volver a correr este archivo NO pisa sus cambios.
create table if not exists temporadas_mes (
  mes integer primary key check (mes between 1 and 12),
  factor numeric(5,2) not null default 1 check (factor > 0),
  nota text not null default ''
);
insert into temporadas_mes (mes, factor, nota) values
  (1, 1.00, ''), (2, 1.00, ''), (3, 1.00, ''), (4, 1.00, ''), (5, 1.00, ''), (6, 1.00, ''),
  (7, 1.00, ''), (8, 1.00, ''), (9, 1.00, ''), (10, 1.00, ''),
  (11, 1.20, 'fiestas de Cuenca'), (12, 1.50, 'Navidad')
on conflict (mes) do nothing;


-- ============================================================
-- 3) TARJETAS DE CRÉDITO. Las mismas sirven para el dueño y el negocio:
--    todo pago de tarjeta cuenta como GASTO DEL NEGOCIO (decisión del dueño).
--    En cada fecha de corte se anota: saldo total, pago mínimo y cuánto se
--    piensa pagar. Lo que se piensa pagar entra al calendario en la fecha de
--    pago. El consumo de cada periodo se CALCULA (no se guarda).
-- ============================================================

create table if not exists tarjetas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null,
  banco text not null default '',
  dia_corte integer not null check (dia_corte between 1 and 31),
  dia_pago integer not null check (dia_pago between 1 and 31),
  activa boolean not null default true,
  notas text not null default '',
  constraint fin_tarjetas_nombre check (btrim(nombre) <> '')
);

create table if not exists tarjeta_cortes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tarjeta_id uuid not null references tarjetas (id) on delete restrict,
  fecha_corte date not null,
  fecha_pago date not null,
  saldo_total numeric(12,2) not null check (saldo_total >= 0),
  pago_minimo numeric(12,2) not null default 0 check (pago_minimo >= 0),
  pago_estimado numeric(12,2) not null default 0 check (pago_estimado >= 0),
  notas text not null default '',
  constraint fin_cortes_uno_por_fecha unique (tarjeta_id, fecha_corte),
  constraint fin_cortes_pago_despues check (fecha_pago >= fecha_corte)
);
create index if not exists idx_cortes_tarjeta_fecha on tarjeta_cortes (tarjeta_id, fecha_corte);

create table if not exists tarjeta_pagos (
  id uuid primary key default gen_random_uuid(),   -- lo genera la pantalla
  created_at timestamptz not null default now(),
  tarjeta_id uuid not null references tarjetas (id) on delete restrict,
  corte_id uuid references tarjeta_cortes (id) on delete restrict,
  fecha date not null,
  monto numeric(12,2) not null check (monto > 0),
  notas text not null default '',
  origen text not null default 'web'
);
create index if not exists idx_tarjeta_pagos on tarjeta_pagos (tarjeta_id, fecha);


-- ============================================================
-- 4) Movimientos: de qué pago de gasto fijo o de tarjeta salió cada gasto
--    (uno a uno). Categorías nuevas: "hormiga" (gastitos del negocio que no
--    se anotan uno por uno) y "tarjeta" (pagos de tarjeta de crédito).
-- ============================================================

alter table movimientos add column if not exists gasto_fijo_pago_id uuid;
alter table movimientos add column if not exists tarjeta_pago_id    uuid;

alter table movimientos drop constraint if exists fin_movimientos_fijo_fk;
alter table movimientos add  constraint fin_movimientos_fijo_fk
  foreign key (gasto_fijo_pago_id) references gastos_fijos_pagos (id) on delete restrict;
alter table movimientos drop constraint if exists fin_movimientos_tarjeta_fk;
alter table movimientos add  constraint fin_movimientos_tarjeta_fk
  foreign key (tarjeta_pago_id) references tarjeta_pagos (id) on delete restrict;

create unique index if not exists fin_movimientos_un_gasto_por_fijo
  on movimientos (gasto_fijo_pago_id) where gasto_fijo_pago_id is not null;
create unique index if not exists fin_movimientos_un_gasto_por_tarjeta
  on movimientos (tarjeta_pago_id) where tarjeta_pago_id is not null;

alter table movimientos drop constraint if exists fin_movimientos_categoria;
alter table movimientos add  constraint fin_movimientos_categoria check (categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'sueldos', 'otros',
   'ventas', 'hormiga', 'tarjeta'));


-- ============================================================
-- 5) Vistas (calculan; nada se guarda). Todas con security_invoker.
-- ============================================================

-- 5.1) Cada corte de tarjeta con lo pagado, lo que falta de lo que se pensaba
--      pagar y el CONSUMO del periodo:
--      consumo = saldo de este corte − (saldo del corte anterior − pagos entre los dos)
create or replace view v_tarjeta_cortes with (security_invoker = true) as
select
  c.id, c.tarjeta_id, t.nombre as tarjeta, t.banco,
  c.fecha_corte, c.fecha_pago, c.saldo_total, c.pago_minimo, c.pago_estimado, c.notas,
  x.fecha_corte_anterior, x.saldo_anterior,
  coalesce((select sum(p.monto) from tarjeta_pagos p
             where p.tarjeta_id = c.tarjeta_id and x.fecha_corte_anterior is not null
               and p.fecha > x.fecha_corte_anterior and p.fecha <= c.fecha_corte), 0) as pagos_entre_cortes,
  case when x.fecha_corte_anterior is null then null
       else c.saldo_total - (x.saldo_anterior
            - coalesce((select sum(p.monto) from tarjeta_pagos p
                         where p.tarjeta_id = c.tarjeta_id
                           and p.fecha > x.fecha_corte_anterior and p.fecha <= c.fecha_corte), 0))
  end as consumo,
  coalesce((select sum(p.monto) from tarjeta_pagos p where p.corte_id = c.id), 0) as pagado_del_corte,
  greatest(c.pago_estimado - coalesce((select sum(p.monto) from tarjeta_pagos p where p.corte_id = c.id), 0), 0)
    as falta_de_lo_estimado
from tarjeta_cortes c
join tarjetas t on t.id = c.tarjeta_id
cross join lateral (
  select
    lag(c2.fecha_corte) over (order by c2.fecha_corte) as fecha_corte_anterior,
    lag(c2.saldo_total) over (order by c2.fecha_corte) as saldo_anterior,
    c2.id
  from tarjeta_cortes c2
  where c2.tarjeta_id = c.tarjeta_id
) x
where x.id = c.id;

-- 5.2) Cada tarjeta con su último corte y su saldo estimado de hoy
--      (saldo del último corte − lo pagado después de ese corte).
create or replace view v_tarjetas with (security_invoker = true) as
select
  t.id, t.nombre, t.banco, t.dia_corte, t.dia_pago, t.activa, t.notas,
  u.fecha_corte as ultimo_corte,
  u.saldo_total as saldo_ultimo_corte,
  coalesce((select sum(p.monto) from tarjeta_pagos p
             where p.tarjeta_id = t.id and u.fecha_corte is not null and p.fecha > u.fecha_corte), 0)
    as pagado_despues_del_corte,
  case when u.fecha_corte is null then null
       else u.saldo_total - coalesce((select sum(p.monto) from tarjeta_pagos p
                                       where p.tarjeta_id = t.id and p.fecha > u.fecha_corte), 0)
  end as saldo_estimado_hoy
from tarjetas t
left join lateral (
  select c.fecha_corte, c.saldo_total from tarjeta_cortes c
   where c.tarjeta_id = t.id order by c.fecha_corte desc limit 1
) u on true;

-- 5.3) v_movimientos: se agregan las dos columnas nuevas al final.
--      Pagos de tarjeta y gastos hormiga de empresa SÍ cuentan para
--      rentabilidad (regla general: gasto de empresa que no viene de una
--      deuda de préstamo/tarjeta/familia/sueldo ni de "Mi sueldo").
create or replace view v_movimientos with (security_invoker = true) as
select
  m.id, m.created_at, m.fecha, m.tipo, m.monto, m.concepto, m.categoria, m.ambito, m.origen,
  m.cheque_id, m.cuenta_por_pagar_id,
  d.tipo_deuda,
  coalesce(d.es_saldo_inicial, false) as de_deuda_anterior,
  (
    m.tipo = 'gasto'
    and m.ambito = 'empresa'
    and m.sueldo_pago_id is null
    and (d.id is null or (not d.es_saldo_inicial and d.tipo_deuda in ('proveedor', 'otra')))
  ) as cuenta_en_rentabilidad,
  m.cobro_id, m.venta_directa_id, m.sueldo_pago_id,
  m.gasto_fijo_pago_id, m.tarjeta_pago_id
from movimientos m
left join cuentas_por_pagar d on d.id = m.cuenta_por_pagar_id;


-- ============================================================
-- 6) Funciones de la app (todo o nada, sin duplicar)
-- ============================================================

-- 6.1) Pagar un gasto fijo en una de sus fechas. Una sola vez por fecha
--      programada (aunque se haga doble clic o se pague desde dos lados).
--      El monto, si no se da, es el del gasto fijo.
create or replace function pagar_gasto_fijo(
  p_id uuid,
  p_gasto_fijo_id uuid,
  p_fecha_programada date,
  p_monto numeric default null,
  p_fecha date default null,
  p_notas text default '',
  p_origen text default 'web'
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_nombre text; v_monto numeric; v_dias integer[]; v_inicio date; v_fin date;
  v_cat text; v_amb text;
  v_mov uuid := gen_random_uuid();
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar pagos.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if exists (select 1 from gastos_fijos_pagos where id = p_id)
     or exists (select 1 from gastos_fijos_pagos where gasto_fijo_id = p_gasto_fijo_id and fecha_programada = p_fecha_programada) then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;

  perform 1 from gastos_fijos where id = p_gasto_fijo_id for update;
  if not found then
    raise exception 'No existe ese gasto fijo.';
  end if;
  v_nombre := (select nombre from gastos_fijos where id = p_gasto_fijo_id);
  v_monto  := coalesce(p_monto, (select monto from gastos_fijos where id = p_gasto_fijo_id));
  v_dias   := (select dias from gastos_fijos where id = p_gasto_fijo_id);
  v_inicio := (select fecha_inicio from gastos_fijos where id = p_gasto_fijo_id);
  v_fin    := (select fecha_fin from gastos_fijos where id = p_gasto_fijo_id);
  v_cat    := (select categoria from gastos_fijos where id = p_gasto_fijo_id);
  v_amb    := (select ambito from gastos_fijos where id = p_gasto_fijo_id);

  if p_fecha_programada is null or p_fecha_programada < v_inicio
     or (v_fin is not null and p_fecha_programada > v_fin)
     or not fn_es_fecha_de_fijo(v_dias, p_fecha_programada) then
    raise exception 'El % no es una fecha de pago de "%".', p_fecha_programada, v_nombre;
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El pago debe ser mayor a 0.';
  end if;

  insert into gastos_fijos_pagos (id, gasto_fijo_id, fecha_programada, fecha_pago, monto, notas, origen)
  values (p_id, p_gasto_fijo_id, p_fecha_programada, v_fecha, v_monto, coalesce(p_notas, ''), coalesce(p_origen, 'web'))
  on conflict do nothing;
  if not found then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;

  insert into movimientos (id, tipo, monto, concepto, categoria, ambito, fecha, origen, gasto_fijo_pago_id)
  values (v_mov, 'gasto', v_monto, v_nombre || ' · ' || to_char(p_fecha_programada, 'DD/MM/YYYY'),
          v_cat, v_amb, v_fecha, coalesce(p_origen, 'web'), p_id);

  return jsonb_build_object('resultado', 'pagado', 'movimiento_id', v_mov);
end
$$;

-- 6.2) Pagar una tarjeta de crédito (todo o parte). Cuenta como gasto del
--      negocio (categoría "tarjeta"). Opcionalmente ligado al corte que paga.
create or replace function pagar_tarjeta(
  p_id uuid,
  p_tarjeta_id uuid,
  p_monto numeric,
  p_fecha date default null,
  p_corte_id uuid default null,
  p_notas text default '',
  p_origen text default 'web'
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_nombre text;
  v_mov uuid := gen_random_uuid();
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar pagos.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if exists (select 1 from tarjeta_pagos where id = p_id) then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;
  v_nombre := (select nombre from tarjetas where id = p_tarjeta_id);
  if v_nombre is null then
    raise exception 'No existe esa tarjeta.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El pago debe ser mayor a 0.';
  end if;
  if p_corte_id is not null
     and not exists (select 1 from tarjeta_cortes where id = p_corte_id and tarjeta_id = p_tarjeta_id) then
    raise exception 'Ese corte no es de la tarjeta %.', v_nombre;
  end if;

  insert into tarjeta_pagos (id, tarjeta_id, corte_id, fecha, monto, notas, origen)
  values (p_id, p_tarjeta_id, p_corte_id, v_fecha, p_monto, coalesce(p_notas, ''), coalesce(p_origen, 'web'))
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;

  insert into movimientos (id, tipo, monto, concepto, categoria, ambito, fecha, origen, tarjeta_pago_id)
  values (v_mov, 'gasto', p_monto, 'Pago tarjeta ' || v_nombre, 'tarjeta', 'empresa', v_fecha,
          coalesce(p_origen, 'web'), p_id);

  return jsonb_build_object('resultado', 'pagado', 'movimiento_id', v_mov);
end
$$;

-- 6.3) Registrar un gasto rápido (gastos hormiga, o un pago contra un
--      estimado como maquila). p_id = id del movimiento (lo genera la
--      pantalla): repetido → "ya_registrado".
create or replace function registrar_gasto(
  p_id uuid,
  p_monto numeric,
  p_categoria text,
  p_concepto text default '',
  p_ambito text default 'empresa',
  p_fecha date default null,
  p_origen text default 'web'
) returns jsonb
language plpgsql set search_path = public as
$$
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar gastos.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El gasto debe ser mayor a 0.';
  end if;

  insert into movimientos (id, tipo, monto, concepto, categoria, ambito, fecha, origen)
  values (p_id, 'gasto', p_monto, coalesce(p_concepto, ''), coalesce(nullif(p_categoria, ''), 'otros'),
          coalesce(nullif(p_ambito, ''), 'empresa'), coalesce(p_fecha, fn_hoy_ecuador()), coalesce(p_origen, 'web'))
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;
  return jsonb_build_object('resultado', 'registrado', 'movimiento_id', p_id);
end
$$;


-- ============================================================
-- 7) Seguridad
-- ============================================================

alter table gastos_fijos       enable row level security;
alter table gastos_fijos_pagos enable row level security;
alter table estimados_gasto    enable row level security;
alter table estimados_mes      enable row level security;
alter table temporadas_mes     enable row level security;
alter table tarjetas           enable row level security;
alter table tarjeta_cortes     enable row level security;
alter table tarjeta_pagos      enable row level security;

drop policy if exists "admin_all_gastos_fijos" on gastos_fijos;
create policy "admin_all_gastos_fijos" on gastos_fijos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_gastos_fijos_pagos" on gastos_fijos_pagos;
create policy "admin_all_gastos_fijos_pagos" on gastos_fijos_pagos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_estimados_gasto" on estimados_gasto;
create policy "admin_all_estimados_gasto" on estimados_gasto
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_estimados_mes" on estimados_mes;
create policy "admin_all_estimados_mes" on estimados_mes
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_temporadas_mes" on temporadas_mes;
create policy "admin_all_temporadas_mes" on temporadas_mes
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_tarjetas" on tarjetas;
create policy "admin_all_tarjetas" on tarjetas
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_tarjeta_cortes" on tarjeta_cortes;
create policy "admin_all_tarjeta_cortes" on tarjeta_cortes
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_tarjeta_pagos" on tarjeta_pagos;
create policy "admin_all_tarjeta_pagos" on tarjeta_pagos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

revoke all on table gastos_fijos, gastos_fijos_pagos, estimados_gasto, estimados_mes, temporadas_mes,
  tarjetas, tarjeta_cortes, tarjeta_pagos from anon;
grant select, insert, update, delete on table gastos_fijos, gastos_fijos_pagos, estimados_gasto, estimados_mes,
  temporadas_mes, tarjetas, tarjeta_cortes, tarjeta_pagos to authenticated;
grant all on table gastos_fijos, gastos_fijos_pagos, estimados_gasto, estimados_mes, temporadas_mes,
  tarjetas, tarjeta_cortes, tarjeta_pagos to service_role;

revoke all on table v_tarjeta_cortes, v_tarjetas, v_movimientos from anon;
grant select on table v_tarjeta_cortes, v_tarjetas, v_movimientos to authenticated, service_role;

revoke all on function fn_es_fecha_de_fijo(integer[], date) from public, anon;
grant execute on function fn_es_fecha_de_fijo(integer[], date) to authenticated, service_role;
revoke all on function pagar_gasto_fijo(uuid, uuid, date, numeric, date, text, text) from public, anon;
grant execute on function pagar_gasto_fijo(uuid, uuid, date, numeric, date, text, text) to authenticated, service_role;
revoke all on function pagar_tarjeta(uuid, uuid, numeric, date, uuid, text, text) from public, anon;
grant execute on function pagar_tarjeta(uuid, uuid, numeric, date, uuid, text, text) to authenticated, service_role;
revoke all on function registrar_gasto(uuid, numeric, text, text, text, date, text) from public, anon;
grant execute on function registrar_gasto(uuid, numeric, text, text, text, date, text) to authenticated, service_role;

end
$plan$;


-- ============================================================
-- RESUMEN EN ESPAÑOL SIMPLE
-- ============================================================
--
-- QUÉ CREA
--  • Gastos fijos (guardería, arriendo…): nombre, monto, día(s) de pago,
--    mensual o quincenal, fecha de inicio y fin opcional, empresa o
--    personal. Las fechas de cada mes se calculan solas; cada pago se
--    guarda una sola vez por fecha (sin duplicar) y crea su gasto.
--  • Estimados del mes (maquila, DTF…): una base por categoría, valores
--    fijados a mano por mes si se quiere, y una tabla de temporadas
--    (noviembre +20% fiestas de Cuenca, diciembre +50% Navidad; editable).
--    La sugerencia de cada mes la calcula la app con lo gastado antes.
--  • Tarjetas de crédito: día de corte y de pago; cada corte con saldo,
--    pago mínimo y cuánto se piensa pagar; los pagos (cuentan como gasto
--    del negocio). Vistas que calculan el consumo de cada periodo y el
--    saldo estimado de hoy.
--  • Gastos hormiga (categoría "hormiga") y una función para anotar
--    gastos rápidos sin duplicar (también sirve para pagos contra un
--    estimado, como maquila).
--  • Categoría "tarjeta" para los pagos de tarjeta.
--  • Seguridad: reglas de admin en las 8 tablas nuevas, vistas con
--    security_invoker, nada para anon ni para "todos".
--
-- QUÉ NO CAMBIA
--  • No borra ni renombra nada. Deudas, cheques, cobros, ventas y "Mi
--    sueldo" siguen igual.
--  • El cuadre de caja usa lo que ya existe (cuentas de dinero y fotos de
--    saldo); no necesita tablas nuevas.
--  • Volver a correr este archivo no pisa las temporadas que hayas cambiado.
--  • No toca otras áreas ni el código de la app (eso es la 6B).
