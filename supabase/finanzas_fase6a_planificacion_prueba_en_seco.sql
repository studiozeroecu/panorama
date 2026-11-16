-- Panorama — Finanzas · PRUEBA EN SECO de la Fase 6A (planificación) — NO GUARDA NADA
-- ============================================================
-- Un solo bloque DO que siempre termina con un error a propósito:
--   • "PRUEBA OK - se deshace todo ..." → todo pasó y no se guardó nada.
--   • "PRUEBA FALLÓ ..." o "SQL 6A falló ..." → dice qué falló; nada se guardó.
--
-- Ejecuta finanzas_fase6a_planificacion.sql DOS veces (prueba que se puede
-- repetir) y corre 17 pruebas con datos inventados ("ZZZ ...").
-- Córrela ANTES de ejecutar el de verdad.
-- Pega TODO el archivo en Supabase → SQL Editor → Run. Que salga en rojo es
-- lo esperado: lee el mensaje.
-- Se ARMA a partir de finanzas_fase6a_planificacion.sql.
-- ============================================================

do $prueba$
declare
  v_fallas  text := '';
  v_pasaron int  := 0;
  v_ctx     text;
  v_n       bigint;
  v_b       boolean;
  v_res     jsonb;
  v_txt     text;
  v_fijo uuid := gen_random_uuid();
  v_fijo2 uuid := gen_random_uuid();
  v_pago1 uuid := gen_random_uuid();
  v_gasto uuid := gen_random_uuid();
  v_est uuid := gen_random_uuid();
  v_tar uuid := gen_random_uuid();
  v_tar2 uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_cx uuid := gen_random_uuid();
  v_tp1 uuid := gen_random_uuid();
  v_admin uuid;
begin

  -- ##########################################################
  -- 1) SQL 6A, primera vez
  -- ##########################################################
  begin
    execute $archivo$
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

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'SQL 6A falló la PRIMERA vez (nada se guardó): % | dónde: %', sqlerrm, v_ctx;
  end;

  -- ##########################################################
  -- 2) SQL 6A, segunda vez (debe pasar: es repetible)
  -- ##########################################################
  begin
    execute $archivo$
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

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'SQL 6A falló la SEGUNDA vez, no es repetible (nada se guardó): % | dónde: %', sqlerrm, v_ctx;
  end;

  -- ---------------- A) Estructura y seguridad ----------------

  begin
    v_n := (select count(*) from information_schema.tables where table_schema = 'public'
             and table_name in ('gastos_fijos', 'gastos_fijos_pagos', 'estimados_gasto', 'estimados_mes',
                                'temporadas_mes', 'tarjetas', 'tarjeta_cortes', 'tarjeta_pagos'));
    if v_n <> 8 then raise exception 'hay % de 8 tablas nuevas', v_n; end if;
    v_n := (select count(*) from information_schema.columns where table_schema = 'public'
             and table_name = 'movimientos' and column_name in ('gasto_fijo_pago_id', 'tarjeta_pago_id'));
    if v_n <> 2 then raise exception 'hay % de 2 columnas nuevas en movimientos', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 01 tablas y columnas nuevas → ' || sqlerrm;
  end;

  begin
    v_n := (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
             and relname in ('v_tarjeta_cortes', 'v_tarjetas', 'v_movimientos')
             and 'security_invoker=true' = any (reloptions));
    if v_n <> 3 then raise exception 'hay % de 3', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 02 vistas con security_invoker → ' || sqlerrm;
  end;

  begin
    v_n := (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
             and relname in ('gastos_fijos', 'gastos_fijos_pagos', 'estimados_gasto', 'estimados_mes',
                             'temporadas_mes', 'tarjetas', 'tarjeta_cortes', 'tarjeta_pagos'));
    if v_n <> 8 then raise exception 'RLS en % de 8 tablas', v_n; end if;
    v_n := (select count(*) from pg_policies where schemaname = 'public' and policyname like 'admin_all_%'
             and tablename in ('gastos_fijos', 'gastos_fijos_pagos', 'estimados_gasto', 'estimados_mes',
                               'temporadas_mes', 'tarjetas', 'tarjeta_cortes', 'tarjeta_pagos'));
    if v_n <> 8 then raise exception '% reglas de admin de 8', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 03 RLS y reglas de admin → ' || sqlerrm;
  end;

  begin
    v_n := (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('fn_es_fecha_de_fijo', 'pagar_gasto_fijo', 'pagar_tarjeta', 'registrar_gasto'));
    v_b := (select bool_and(p.proacl is not null
                            and not has_function_privilege('anon', p.oid, 'EXECUTE')
                            and not exists (select 1 from aclexplode(p.proacl) a
                                             where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
              from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('fn_es_fecha_de_fijo', 'pagar_gasto_fijo', 'pagar_tarjeta', 'registrar_gasto'));
    if v_n <> 4 or not coalesce(v_b, false) then
      raise exception '% funciones (deben ser 4); alguna la puede usar anon o "todos"', v_n;
    end if;
    if has_table_privilege('anon', 'public.tarjetas', 'SELECT') or has_table_privilege('anon', 'public.v_tarjetas', 'SELECT')
       or has_table_privilege('anon', 'public.gastos_fijos', 'SELECT') then
      raise exception 'anon puede leer alguna tabla o vista nueva';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 04 nada para anon ni para "todos" → ' || sqlerrm;
  end;

  begin
    v_n := (select count(*) from temporadas_mes);
    if v_n <> 12 then raise exception 'hay % meses de 12', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 05 temporadas: los 12 meses → ' || sqlerrm;
  end;

  -- ---------------- B) Gastos fijos ----------------

  begin
    if not (fn_es_fecha_de_fijo('{10}', '2026-11-10') and not fn_es_fecha_de_fijo('{10}', '2026-11-11')
            and fn_es_fecha_de_fijo('{31}', '2027-02-28') and fn_es_fecha_de_fijo('{31}', '2026-11-30')
            and not fn_es_fecha_de_fijo('{31}', '2026-11-29') and fn_es_fecha_de_fijo('{15,30}', '2027-02-28')
            and fn_es_fecha_de_fijo('{15,30}', '2026-10-15')) then
      raise exception 'alguna fecha salió mal';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 10 fechas de los fijos (el 31 cae el último día si el mes es corto) → ' || sqlerrm;
  end;

  begin
    insert into gastos_fijos (id, nombre, monto, dias, fecha_inicio, fecha_fin, ambito, categoria)
    values (v_fijo, 'ZZZ Guardería', 280, '{10}', '2026-09-01', '2027-07-31', 'personal', 'otros');
    v_res := pagar_gasto_fijo(v_pago1, v_fijo, '2026-11-10', null, '2026-11-09');
    if v_res->>'resultado' <> 'pagado' then raise exception 'resultado: %', v_res; end if;
    v_res := pagar_gasto_fijo(v_pago1, v_fijo, '2026-11-10');
    if v_res->>'resultado' <> 'ya_registrado' then raise exception 'doble clic: %', v_res; end if;
    v_res := pagar_gasto_fijo(gen_random_uuid(), v_fijo, '2026-11-10');
    if v_res->>'resultado' <> 'ya_registrado' then raise exception 'pagar la misma fecha otra vez: %', v_res; end if;
    if not coalesce((select count(*) = 1 and bool_and(monto = 280 and ambito = 'personal' and tipo = 'gasto' and fecha = '2026-11-09')
                       from movimientos where gasto_fijo_pago_id = v_pago1), false) then
      raise exception 'el gasto no quedó bien';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 11 pagar un fijo: una sola vez por fecha, con su gasto → ' || sqlerrm;
  end;

  begin
    v_txt := '';
    begin perform pagar_gasto_fijo(gen_random_uuid(), v_fijo, '2026-11-11');
          v_txt := v_txt || 'aceptó una fecha que no es de pago; ';
    exception when others then if sqlerrm not ilike '%no es una fecha de pago%' then raise; end if; end;
    begin perform pagar_gasto_fijo(gen_random_uuid(), v_fijo, '2027-08-10');
          v_txt := v_txt || 'aceptó una fecha después del fin; ';
    exception when others then if sqlerrm not ilike '%no es una fecha de pago%' then raise; end if; end;
    begin perform pagar_gasto_fijo(gen_random_uuid(), v_fijo, '2026-08-10');
          v_txt := v_txt || 'aceptó una fecha antes del inicio; ';
    exception when others then if sqlerrm not ilike '%no es una fecha de pago%' then raise; end if; end;
    if v_txt <> '' then raise exception '%', v_txt; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 12 no se paga en fechas que no tocan (ni antes del inicio ni después del fin) → ' || sqlerrm;
  end;

  begin
    insert into gastos_fijos (id, nombre, monto, frecuencia, dias, fecha_inicio, categoria)
    values (v_fijo2, 'ZZZ Quincenal', 100, 'quincenal', '{15,31}', '2026-01-01', 'sueldos');
    v_res := pagar_gasto_fijo(gen_random_uuid(), v_fijo2, '2027-02-28');
    if v_res->>'resultado' <> 'pagado' then raise exception 'el 31 en febrero: %', v_res; end if;
    v_txt := '';
    begin insert into gastos_fijos (nombre, monto, frecuencia, dias) values ('ZZZ mal', 1, 'mensual', '{1,15}');
          v_txt := v_txt || 'aceptó mensual con dos días; ';
    exception when check_violation then null; end;
    begin insert into gastos_fijos (nombre, monto, dias) values ('ZZZ mal', 1, '{0}');
          v_txt := v_txt || 'aceptó el día 0; ';
    exception when check_violation then null; end;
    if v_txt <> '' then raise exception '%', v_txt; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 13 quincenal con dos días; reglas de los días → ' || sqlerrm;
  end;

  -- ---------------- C) Gastos hormiga y estimados ----------------

  begin
    v_res := registrar_gasto(v_gasto, 3.50, 'hormiga', 'ZZZ cinta y fundas');
    if v_res->>'resultado' <> 'registrado' then raise exception 'resultado: %', v_res; end if;
    v_res := registrar_gasto(v_gasto, 3.50, 'hormiga', 'ZZZ cinta y fundas');
    if v_res->>'resultado' <> 'ya_registrado' then raise exception 'doble clic: %', v_res; end if;
    if not coalesce((select count(*) = 1 and bool_and(cuenta_en_rentabilidad and categoria = 'hormiga' and ambito = 'empresa')
                       from v_movimientos where id = v_gasto), false) then
      raise exception 'el gasto hormiga no quedó como gasto del negocio';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 14 gasto hormiga: del negocio, sin duplicar → ' || sqlerrm;
  end;

  begin
    insert into estimados_gasto (id, nombre, categoria, base) values (v_est, 'ZZZ Maquila', 'maquila', 650);
    begin
      insert into estimados_gasto (nombre, categoria, base) values ('ZZZ Maquila 2', 'maquila', 500);
      raise exception 'aceptó dos estimados activos de la misma categoría';
    exception when unique_violation then null;
    end;
    insert into estimados_gasto (nombre, categoria, base, activo) values ('ZZZ Maquila vieja', 'maquila', 500, false);
    insert into estimados_mes (estimado_id, mes, monto) values (v_est, '2026-11-01', 800);
    begin
      insert into estimados_mes (estimado_id, mes, monto) values (v_est, '2026-12-15', 800);
      raise exception 'aceptó un mes que no empieza el día 1';
    exception when check_violation then null;
    end;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 15 estimados: uno activo por categoría; valor por mes → ' || sqlerrm;
  end;

  -- ---------------- D) Tarjetas ----------------

  begin
    insert into tarjetas (id, nombre, banco, dia_corte, dia_pago) values (v_tar, 'ZZZ Visa', 'Pichincha', 5, 20);
    insert into tarjeta_cortes (id, tarjeta_id, fecha_corte, fecha_pago, saldo_total, pago_minimo, pago_estimado)
    values (v_c1, v_tar, '2020-01-05', '2020-01-20', 1000, 50, 300);
    perform pagar_tarjeta(gen_random_uuid(), v_tar, 300, '2020-01-18', v_c1);
    insert into tarjeta_cortes (id, tarjeta_id, fecha_corte, fecha_pago, saldo_total, pago_minimo, pago_estimado)
    values (v_c2, v_tar, '2020-02-05', '2020-02-20', 1200, 60, 400);
    -- consumo del periodo = 1200 − (1000 − 300) = 500
    if not coalesce(
         (select consumo = 500 and pagos_entre_cortes = 300 and falta_de_lo_estimado = 400 from v_tarjeta_cortes where id = v_c2)
         and (select consumo is null and pagado_del_corte = 300 and falta_de_lo_estimado = 0 from v_tarjeta_cortes where id = v_c1)
         and (select saldo_estimado_hoy = 1200 and ultimo_corte = '2020-02-05' from v_tarjetas where id = v_tar), false) then
      raise exception 'el consumo o el saldo no salieron como se esperaba';
    end if;
    perform pagar_tarjeta(gen_random_uuid(), v_tar, 100, '2020-02-10', v_c2);
    if not coalesce(
         (select saldo_estimado_hoy = 1100 from v_tarjetas where id = v_tar)
         and (select falta_de_lo_estimado = 300 from v_tarjeta_cortes where id = v_c2), false) then
      raise exception 'el pago no bajó el saldo';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 16 tarjeta: consumo del periodo, lo que falta de lo pensado y saldo de hoy → ' || sqlerrm;
  end;

  begin
    v_res := pagar_tarjeta(v_tp1, v_tar, 50, '2020-02-12');
    if v_res->>'resultado' <> 'pagado' then raise exception 'resultado: %', v_res; end if;
    v_res := pagar_tarjeta(v_tp1, v_tar, 50, '2020-02-12');
    if v_res->>'resultado' <> 'ya_registrado' then raise exception 'doble clic: %', v_res; end if;
    if not coalesce((select count(*) = 1 and bool_and(categoria = 'tarjeta' and ambito = 'empresa' and cuenta_en_rentabilidad)
                       from v_movimientos where tarjeta_pago_id = v_tp1), false) then
      raise exception 'el pago de tarjeta no quedó como gasto del negocio';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 17 pagar tarjeta: gasto del negocio, sin duplicar → ' || sqlerrm;
  end;

  begin
    v_txt := '';
    begin insert into tarjeta_cortes (tarjeta_id, fecha_corte, fecha_pago, saldo_total) values (v_tar, '2020-02-05', '2020-02-20', 1);
          v_txt := v_txt || 'aceptó dos cortes el mismo día; ';
    exception when unique_violation then null; end;
    begin insert into tarjeta_cortes (tarjeta_id, fecha_corte, fecha_pago, saldo_total) values (v_tar, '2020-03-05', '2020-03-01', 1);
          v_txt := v_txt || 'aceptó un pago antes del corte; ';
    exception when check_violation then null; end;
    if v_txt <> '' then raise exception '%', v_txt; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 18 un corte por fecha; el pago no puede ser antes del corte → ' || sqlerrm;
  end;

  begin
    insert into tarjetas (id, nombre, dia_corte, dia_pago) values (v_tar2, 'ZZZ Master', 10, 25);
    insert into tarjeta_cortes (id, tarjeta_id, fecha_corte, fecha_pago, saldo_total) values (v_cx, v_tar2, '2020-01-10', '2020-01-25', 10);
    perform pagar_tarjeta(gen_random_uuid(), v_tar, 10, '2020-01-20', v_cx);
    v_fallas := v_fallas || E'\n• 19 aceptó pagar una tarjeta con el corte de otra';
  exception when others then
    if sqlerrm ilike '%no es de la tarjeta%' then v_pasaron := v_pasaron + 1;
    else v_fallas := v_fallas || E'\n• 19 corte de otra tarjeta: error inesperado → ' || sqlerrm; end if;
  end;

  -- ---------------- E) Como ADMIN desde la app ----------------

  v_admin := (select user_id from user_roles where rol = 'admin' limit 1);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(v_admin::text, ''), true);
  set local role authenticated;
  begin
    if v_admin is null or not fn_es_admin() then raise exception 'no encontré un usuario admin'; end if;
    insert into gastos_fijos (nombre, monto, dias, fecha_inicio, categoria) values ('ZZZ Arriendo admin', 650, '{17}', '2026-10-01', 'arriendo');
    v_res := pagar_gasto_fijo(gen_random_uuid(), (select id from gastos_fijos where nombre = 'ZZZ Arriendo admin'), '2026-10-17');
    if v_res->>'resultado' <> 'pagado' then raise exception 'fijo: %', v_res; end if;
    insert into tarjeta_cortes (tarjeta_id, fecha_corte, fecha_pago, saldo_total, pago_estimado) values (v_tar, '2020-03-05', '2020-03-20', 900, 200);
    v_res := pagar_tarjeta(gen_random_uuid(), v_tar, 200, '2020-03-15');
    if v_res->>'resultado' <> 'pagado' then raise exception 'tarjeta: %', v_res; end if;
    v_res := registrar_gasto(gen_random_uuid(), 2, 'hormiga', 'ZZZ admin');
    if v_res->>'resultado' <> 'registrado' then raise exception 'hormiga: %', v_res; end if;
    update temporadas_mes set factor = factor where mes = 12;
    v_n := (select count(*) from v_tarjeta_cortes where tarjeta_id = v_tar);
    if v_n <> 3 then raise exception 'el admin ve % cortes de 3', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 30 como admin desde la app: fijos, tarjetas, hormiga y temporadas → ' || sqlerrm;
  end;
  reset role;

  -- ---------------- F) Como ANÓNIMO: no puede nada ----------------

  set local role anon;
  begin
    v_txt := '';
    begin perform registrar_gasto(gen_random_uuid(), 1, 'hormiga');
          v_txt := v_txt || 'pudo registrar un gasto; ';
    exception when insufficient_privilege then null; end;
    begin perform pagar_tarjeta(gen_random_uuid(), gen_random_uuid(), 1);
          v_txt := v_txt || 'pudo pagar una tarjeta; ';
    exception when insufficient_privilege then null; end;
    begin perform count(*) from v_tarjetas;
          v_txt := v_txt || 'pudo leer las tarjetas; ';
    exception when insufficient_privilege then null; end;
    begin perform count(*) from gastos_fijos;
          v_txt := v_txt || 'pudo leer los gastos fijos; ';
    exception when insufficient_privilege then null; end;
    if v_txt <> '' then raise exception '%', v_txt; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 40 un anónimo no puede nada → ' || sqlerrm;
  end;
  reset role;

  -- ##########################################################
  -- RESULTADO: siempre termina con error para que NADA se guarde
  -- ##########################################################
  if v_fallas <> '' then
    raise exception E'PRUEBA FALLÓ - se deshace todo. Pasaron % de 17. Fallaron:%', v_pasaron, v_fallas;
  end if;
  if v_pasaron <> 17 then
    raise exception 'PRUEBA INCOMPLETA - se deshace todo. Pasaron % de 17.', v_pasaron;
  end if;
  raise exception 'PRUEBA OK - se deshace todo (17 de 17 pruebas pasaron; el SQL 6A corrió 2 veces sin error)';
end
$prueba$;
