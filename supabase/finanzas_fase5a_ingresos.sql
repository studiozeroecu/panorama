-- Panorama — Finanzas · Fase 5A "INGRESOS": cobros con abonos, ventas directas y "Mi sueldo"
-- ============================================================
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de finanzas_v2_sql1_ampliar.sql.
--
-- • UN SOLO bloque DO: se aplica TODO o NADA. Sin begin/commit.
-- • Repetible sin daño ("if not exists", "create or replace", "drop … if exists").
-- • Solo AGREGA: no borra ni renombra nada. El código publicado sigue funcionando.
-- • Las variables se asignan con  v := (select …)  y los ids se generan
--   antes del insert (regla del SQL Editor de Supabase; ver CLAUDE.md raíz).
--   OJO: ni en comentarios se escribe la forma prohibida — el editor también
--   la detecta ahí y corta el script.
-- • Probarlo antes con finanzas_fase5a_ingresos_prueba_en_seco.sql.
--
-- Al final, un resumen en español simple de qué crea y qué NO cambia.
-- ============================================================

do $ingresos$
declare
  fin_rec record;   -- solo para recorrer restricciones viejas
begin

-- ============================================================
-- 1) Ganancia del dueño por prenda ("Mi sueldo")
--    VATEX: $2,50 por prenda · fuera de VATEX (otros clientes, en línea,
--    ferias): $5,00 por prenda. Cambiar la tarifa = create or replace de
--    esta función: solo afecta lo que se registre DESPUÉS, porque cada
--    factura y cada venta guardan su tarifa al crearse (no se recalcula
--    lo de antes).
-- ============================================================

create or replace function fn_ganancia_por_prenda(p_es_vatex boolean) returns numeric
language sql immutable set search_path = public as
$$ select (case when coalesce(p_es_vatex, false) then 2.50 else 5.00 end)::numeric(10,2) $$;


-- ============================================================
-- 2) Facturas por cobrar (cuentas_por_cobrar): campos nuevos
--    • es_vatex: VATEX va aparte, como UNA sola cuenta.
--    • prendas: cuántas prendas se vendieron en esa factura (para Mi sueldo).
--    • ganancia_por_prenda: la tarifa del día en que se registró (congelada).
--    • cuenta: a qué cuenta suman los abonos ("vatex" o el nombre del
--      cliente sin mayúsculas ni espacios de más). Columna generada.
--    • fecha_vencimiento (ya existía) = fecha en que se espera el cobro.
-- ============================================================

alter table cuentas_por_cobrar add column if not exists es_vatex            boolean not null default false;
alter table cuentas_por_cobrar add column if not exists numero_factura      text not null default '';
alter table cuentas_por_cobrar add column if not exists prendas             integer not null default 0;
alter table cuentas_por_cobrar add column if not exists ganancia_por_prenda numeric(10,2) not null default 0;
alter table cuentas_por_cobrar add column if not exists es_saldo_inicial    boolean not null default false;
alter table cuentas_por_cobrar add column if not exists anulada             boolean not null default false;
alter table cuentas_por_cobrar add column if not exists cuenta text
  generated always as (case when es_vatex then 'vatex' else lower(btrim(cliente)) end) stored;

alter table cuentas_por_cobrar drop constraint if exists fin_cxc_prendas;
alter table cuentas_por_cobrar add  constraint fin_cxc_prendas check (prendas >= 0);
alter table cuentas_por_cobrar drop constraint if exists fin_cxc_ganancia;
alter table cuentas_por_cobrar add  constraint fin_cxc_ganancia check (ganancia_por_prenda >= 0);

create index if not exists idx_cxc_cuenta_fecha on cuentas_por_cobrar (cuenta, fecha_factura);

-- La tarifa la pone la base (no la pantalla) y queda congelada.
-- Si se marca VATEX, el cliente se llama siempre "VATEX".
create or replace function fn_trg_cxc_ganancia() returns trigger
language plpgsql set search_path = public as
$$
begin
  if new.es_vatex then
    new.cliente := 'VATEX';
  end if;
  if tg_op = 'INSERT' or new.es_vatex is distinct from old.es_vatex then
    new.ganancia_por_prenda := fn_ganancia_por_prenda(new.es_vatex);
  else
    new.ganancia_por_prenda := old.ganancia_por_prenda;
  end if;
  return new;
end
$$;

drop trigger if exists fin_cxc_ganancia on cuentas_por_cobrar;
create trigger fin_cxc_ganancia
  before insert or update on cuentas_por_cobrar
  for each row execute function fn_trg_cxc_ganancia();


-- ============================================================
-- 3) Cobros (abonos que me hacen). Un abono va a la CUENTA del cliente
--    (no a una factura): se aplica sola a la factura más antigua primero
--    (lo calcula v_cxc; no se guarda).
-- ============================================================

create table if not exists cobros (
  id uuid primary key default gen_random_uuid(),   -- lo genera la pantalla: protege del doble clic
  created_at timestamptz not null default now(),
  fecha date not null default ((now() at time zone 'America/Guayaquil')::date),
  cliente text not null,
  es_vatex boolean not null default false,
  cuenta text generated always as (case when es_vatex then 'vatex' else lower(btrim(cliente)) end) stored,
  monto numeric(12,2) not null check (monto > 0),
  medio text not null default 'transferencia' check (medio in ('cheque', 'transferencia', 'efectivo')),
  notas text not null default '',
  origen text not null default 'web',
  anulado boolean not null default false
);
create index if not exists idx_cobros_cuenta_fecha on cobros (cuenta, fecha);


-- ============================================================
-- 4) Ventas directas (en línea y ferias): la plata ya está en mano.
--    Una feria de dos días = dos registros con el mismo "evento".
-- ============================================================

create table if not exists ventas_directas (
  id uuid primary key default gen_random_uuid(),   -- lo genera la pantalla
  created_at timestamptz not null default now(),
  fecha date not null default ((now() at time zone 'America/Guayaquil')::date),
  canal text not null check (canal in ('en_linea', 'feria')),
  evento text not null default '',                 -- nombre de la feria
  monto numeric(12,2) not null check (monto > 0),
  prendas integer not null default 0 check (prendas >= 0),
  ganancia_por_prenda numeric(10,2) not null default 0 check (ganancia_por_prenda >= 0),
  notas text not null default '',
  origen text not null default 'web',
  anulada boolean not null default false,
  constraint fin_ventas_feria_con_nombre check (canal <> 'feria' or btrim(evento) <> '')
);
create index if not exists idx_ventas_directas_fecha on ventas_directas (fecha);

create or replace function fn_trg_venta_ganancia() returns trigger
language plpgsql set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    new.ganancia_por_prenda := fn_ganancia_por_prenda(false);
  else
    new.ganancia_por_prenda := old.ganancia_por_prenda;
  end if;
  return new;
end
$$;

drop trigger if exists fin_venta_ganancia on ventas_directas;
create trigger fin_venta_ganancia
  before insert or update on ventas_directas
  for each row execute function fn_trg_venta_ganancia();


-- ============================================================
-- 5) Pagos de "Mi sueldo" (lo que el dueño se paga a sí mismo, por partes).
--    Se aplican al registro de ganancia más antiguo primero (lo calcula
--    v_sueldo_dueno_registros; no se guarda).
-- ============================================================

create table if not exists sueldo_dueno_pagos (
  id uuid primary key default gen_random_uuid(),   -- lo genera la pantalla
  created_at timestamptz not null default now(),
  fecha date not null default ((now() at time zone 'America/Guayaquil')::date),
  monto numeric(12,2) not null check (monto > 0),
  medio text not null default 'transferencia' check (medio in ('cheque', 'transferencia', 'efectivo')),
  notas text not null default '',
  origen text not null default 'web',
  anulado boolean not null default false
);
create index if not exists idx_sueldo_pagos_fecha on sueldo_dueno_pagos (fecha);


-- ============================================================
-- 6) Movimientos: de qué cobro, venta o pago de sueldo salió cada uno.
--    Uno a uno (índices únicos): un cobro = un ingreso, una venta = un
--    ingreso, un pago de sueldo = un gasto. Nunca dos.
--    Categoría nueva "ventas" para los ingresos.
-- ============================================================

alter table movimientos add column if not exists cobro_id         uuid;
alter table movimientos add column if not exists venta_directa_id uuid;
alter table movimientos add column if not exists sueldo_pago_id   uuid;

alter table movimientos drop constraint if exists fin_movimientos_cobro_fk;
alter table movimientos add  constraint fin_movimientos_cobro_fk
  foreign key (cobro_id) references cobros (id) on delete restrict;
alter table movimientos drop constraint if exists fin_movimientos_venta_fk;
alter table movimientos add  constraint fin_movimientos_venta_fk
  foreign key (venta_directa_id) references ventas_directas (id) on delete restrict;
alter table movimientos drop constraint if exists fin_movimientos_sueldo_fk;
alter table movimientos add  constraint fin_movimientos_sueldo_fk
  foreign key (sueldo_pago_id) references sueldo_dueno_pagos (id) on delete restrict;

create unique index if not exists fin_movimientos_un_ingreso_por_cobro
  on movimientos (cobro_id) where cobro_id is not null;
create unique index if not exists fin_movimientos_un_ingreso_por_venta
  on movimientos (venta_directa_id) where venta_directa_id is not null;
create unique index if not exists fin_movimientos_un_gasto_por_sueldo
  on movimientos (sueldo_pago_id) where sueldo_pago_id is not null;

alter table movimientos drop constraint if exists fin_movimientos_categoria;
alter table movimientos add  constraint fin_movimientos_categoria check (categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'sueldos', 'otros', 'ventas'));


-- ============================================================
-- 7) Vistas (calculan; nada se guarda). Todas con security_invoker.
-- ============================================================

-- 7.1) Cada factura con lo cobrado (abonos aplicados a la más antigua
--      primero, dentro de su cuenta), saldo, días de atraso y la ganancia
--      del dueño. Las marcadas "cobrado" con la pantalla vieja cuentan como
--      cobradas enteras y no reciben abonos.
create or replace view v_cxc with (security_invoker = true) as
select
  x.id, x.created_at, x.cliente, x.es_vatex, x.cuenta, x.numero_factura, x.concepto, x.monto,
  x.fecha_factura, x.fecha_esperada, x.prendas, x.ganancia_por_prenda, x.ganancia_dueno,
  x.es_saldo_inicial, x.anulada, x.notas,
  x.cobrado,
  x.monto - x.cobrado as saldo,
  case
    when x.anulada then 0
    when x.monto - x.cobrado > 0 and x.fecha_esperada < fn_hoy_ecuador() then fn_hoy_ecuador() - x.fecha_esperada
    else 0
  end as dias_atraso,
  case
    when x.anulada then 'anulada'
    when x.monto - x.cobrado <= 0 then 'cobrada'
    when x.cobrado > 0 then 'abonada'
    else 'pendiente'
  end as estado_calculado
from (
  select
    c.id, c.created_at, c.cliente, c.es_vatex, c.cuenta, c.numero_factura, c.concepto, c.monto,
    c.fecha_factura, c.fecha_vencimiento as fecha_esperada, c.prendas, c.ganancia_por_prenda,
    (c.prendas * c.ganancia_por_prenda)::numeric(12,2) as ganancia_dueno,
    c.es_saldo_inicial, c.anulada, c.notas,
    case
      when c.anulada then c.monto            -- anulada: no debe nada
      when c.estado = 'cobrado' then c.monto -- marcada con la pantalla vieja
      else least(c.monto, greatest(coalesce(k.total, 0) - coalesce(a.antes, 0), 0))
    end::numeric(12,2) as cobrado
  from cuentas_por_cobrar c
  left join (
    select f.id,
           coalesce(sum(f.monto) over (partition by f.cuenta
                                       order by f.fecha_factura, f.created_at, f.id
                                       rows between unbounded preceding and 1 preceding), 0) as antes
      from cuentas_por_cobrar f
     where not f.anulada and f.estado <> 'cobrado'
  ) a on a.id = c.id
  left join (
    select cuenta, sum(monto) as total from cobros where not anulado group by cuenta
  ) k on k.cuenta = c.cuenta
) x;

-- 7.2) Una fila por cliente (VATEX es una sola): cuánto me debe en total.
create or replace view v_cxc_cuentas with (security_invoker = true) as
select
  v.cuenta,
  case when bool_or(v.es_vatex) then 'VATEX' else min(v.cliente) end as cliente,
  bool_or(v.es_vatex) as es_vatex,
  sum(v.monto)   as total_facturado,
  sum(v.cobrado) as total_cobrado,
  sum(v.saldo)   as saldo,
  count(*) filter (where v.saldo > 0)              as facturas_abiertas,
  min(v.fecha_factura) filter (where v.saldo > 0)  as factura_abierta_mas_antigua,
  coalesce(max(v.dias_atraso), 0)                  as dias_atraso_max,
  sum(v.prendas) as prendas
from v_cxc v
where not v.anulada
group by v.cuenta;

-- 7.3) Mi sueldo: cada factura o venta con prendas genera ganancia; los
--      pagos que me hago se aplican al registro más antiguo primero.
create or replace view v_sueldo_dueno_registros with (security_invoker = true) as
with devengos as (
  select 'factura'::text as fuente, c.id as fuente_id, c.fecha_factura as fecha, c.created_at,
         (case when c.es_vatex then 'VATEX' else c.cliente end)
           || case when c.numero_factura <> '' then ' · factura ' || c.numero_factura else '' end as descripcion,
         c.es_vatex as en_vatex, c.prendas, c.ganancia_por_prenda,
         (c.prendas * c.ganancia_por_prenda)::numeric(12,2) as monto
    from cuentas_por_cobrar c
   where not c.anulada and c.prendas > 0
  union all
  select 'venta'::text, v.id, v.fecha, v.created_at,
         case when v.canal = 'feria' then 'Feria ' || v.evento else 'Venta en línea' end,
         false, v.prendas, v.ganancia_por_prenda,
         (v.prendas * v.ganancia_por_prenda)::numeric(12,2)
    from ventas_directas v
   where not v.anulada and v.prendas > 0
),
ordenados as (
  select d.*,
         coalesce(sum(d.monto) over (order by d.fecha, d.created_at, d.fuente_id
                                     rows between unbounded preceding and 1 preceding), 0) as antes
    from devengos d
),
pagos as (
  select coalesce(sum(monto), 0) as total from sueldo_dueno_pagos where not anulado
)
select
  o.fuente, o.fuente_id, o.fecha, o.descripcion, o.en_vatex, o.prendas, o.ganancia_por_prenda, o.monto,
  least(o.monto, greatest(p.total - o.antes, 0))::numeric(12,2) as pagado,
  (o.monto - least(o.monto, greatest(p.total - o.antes, 0)))::numeric(12,2) as saldo
from ordenados o
cross join pagos p;

-- 7.4) Mi sueldo, en una sola fila: ganado, pagado y lo que la empresa me debe.
create or replace view v_sueldo_dueno with (security_invoker = true) as
select
  g.ganado,
  p.pagado,
  (g.ganado - p.pagado)::numeric(12,2) as saldo
from (select coalesce(sum(monto), 0)::numeric(12,2) as ganado from v_sueldo_dueno_registros) g
cross join (select coalesce(sum(monto), 0)::numeric(12,2) as pagado from sueldo_dueno_pagos where not anulado) p;

-- 7.5) v_movimientos: se agregan las columnas de cobro, venta y sueldo, y
--      los pagos de MI SUELDO no cuentan para rentabilidad: el sueldo se
--      cuenta como gasto UNA vez, al ganarlo (v_sueldo_dueno_registros).
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
  m.cobro_id, m.venta_directa_id, m.sueldo_pago_id
from movimientos m
left join cuentas_por_pagar d on d.id = m.cuenta_por_pagar_id;


-- ============================================================
-- 8) Funciones de la app (todo o nada, sin duplicar)
-- ============================================================

-- 8.1) Registrar un abono que me hacen. Va a la cuenta del cliente (VATEX o
--      el nombre del cliente) y no puede pasar de lo que me debe. Crea el
--      ingreso ligado. p_id lo genera la pantalla: repetido → "ya_registrado".
create or replace function registrar_cobro(
  p_id uuid,
  p_cliente text,
  p_es_vatex boolean,
  p_monto numeric,
  p_fecha date default null,
  p_medio text default 'transferencia',
  p_notas text default '',
  p_origen text default 'web'
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_vatex boolean := coalesce(p_es_vatex, false);
  v_cliente text := case when coalesce(p_es_vatex, false) then 'VATEX' else btrim(coalesce(p_cliente, '')) end;
  v_cuenta text;
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_saldo numeric;
  v_mov uuid := gen_random_uuid();
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar cobros.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if exists (select 1 from cobros where id = p_id) then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;
  if v_cliente = '' then
    raise exception 'Falta el cliente.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El abono debe ser mayor a 0.';
  end if;

  v_cuenta := case when v_vatex then 'vatex' else lower(v_cliente) end;
  -- dos abonos a la misma cuenta a la vez se hacen uno detrás del otro
  perform pg_advisory_xact_lock(hashtext('fin_cobro:' || v_cuenta));

  v_saldo := coalesce((select sum(saldo) from v_cxc where cuenta = v_cuenta and not anulada), 0);
  if v_saldo <= 0 then
    raise exception '% no tiene facturas pendientes de cobro.', v_cliente;
  end if;
  if p_monto > v_saldo then
    raise exception 'El abono (%) es mayor a lo que te debe % (%).', p_monto, v_cliente, v_saldo;
  end if;

  insert into cobros (id, fecha, cliente, es_vatex, monto, medio, notas, origen)
  values (p_id, v_fecha, v_cliente, v_vatex, p_monto, coalesce(nullif(p_medio, ''), 'transferencia'),
          coalesce(p_notas, ''), coalesce(p_origen, 'web'))
  on conflict (id) do nothing;
  if not found then
    -- otra llamada con la misma operación ganó la carrera
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;

  insert into movimientos (id, tipo, monto, concepto, categoria, ambito, fecha, origen, cobro_id)
  values (v_mov, 'ingreso', p_monto, 'Cobro ' || v_cliente || case when coalesce(p_notas, '') <> '' then ' · ' || p_notas else '' end,
          'ventas', 'empresa', v_fecha, coalesce(p_origen, 'web'), p_id);

  return jsonb_build_object('resultado', 'cobrado', 'movimiento_id', v_mov, 'saldo_restante', v_saldo - p_monto);
end
$$;

-- 8.2) Registrar una venta directa (en línea o un día de feria): la venta y
--      su ingreso, juntos. p_id lo genera la pantalla.
create or replace function registrar_venta_directa(
  p_id uuid,
  p_canal text,
  p_monto numeric,
  p_prendas integer,
  p_fecha date default null,
  p_evento text default '',
  p_notas text default '',
  p_origen text default 'web'
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_evento text := btrim(coalesce(p_evento, ''));
  v_mov uuid := gen_random_uuid();
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar ventas.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if exists (select 1 from ventas_directas where id = p_id) then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;
  if p_canal is null or p_canal not in ('en_linea', 'feria') then
    raise exception 'Indica si la venta fue "en línea" o en una "feria".';
  end if;
  if p_canal = 'feria' and v_evento = '' then
    raise exception 'Falta el nombre de la feria.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto vendido debe ser mayor a 0.';
  end if;
  if p_prendas is null or p_prendas < 0 then
    raise exception 'Las prendas vendidas no pueden ser negativas.';
  end if;

  insert into ventas_directas (id, fecha, canal, evento, monto, prendas, notas, origen)
  values (p_id, v_fecha, p_canal, v_evento, p_monto, p_prendas, coalesce(p_notas, ''), coalesce(p_origen, 'web'))
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;

  insert into movimientos (id, tipo, monto, concepto, categoria, ambito, fecha, origen, venta_directa_id)
  values (v_mov, 'ingreso', p_monto,
          case when p_canal = 'feria' then 'Venta feria ' || v_evento else 'Venta en línea' end
            || ' · ' || p_prendas || ' prenda' || case when p_prendas <> 1 then 's' else '' end,
          'ventas', 'empresa', v_fecha, coalesce(p_origen, 'web'), p_id);

  return jsonb_build_object('resultado', 'registrada', 'movimiento_id', v_mov);
end
$$;

-- 8.3) Pagarme parte de "Mi sueldo". No puede pasar de lo que la empresa me
--      debe. Crea el gasto (categoría sueldos), que NO cuenta otra vez para
--      rentabilidad (ya contó al ganarlo). p_id lo genera la pantalla.
create or replace function pagar_mi_sueldo(
  p_id uuid,
  p_monto numeric,
  p_fecha date default null,
  p_medio text default 'transferencia',
  p_notas text default '',
  p_origen text default 'web'
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_saldo numeric;
  v_mov uuid := gen_random_uuid();
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar pagos de sueldo.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if exists (select 1 from sueldo_dueno_pagos where id = p_id) then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El pago debe ser mayor a 0.';
  end if;

  perform pg_advisory_xact_lock(hashtext('fin_sueldo_dueno'));
  v_saldo := coalesce((select saldo from v_sueldo_dueno), 0);
  if p_monto > v_saldo then
    raise exception 'El pago (%) es mayor a lo que la empresa te debe de sueldo (%).', p_monto, v_saldo;
  end if;

  insert into sueldo_dueno_pagos (id, fecha, monto, medio, notas, origen)
  values (p_id, v_fecha, p_monto, coalesce(nullif(p_medio, ''), 'transferencia'), coalesce(p_notas, ''), coalesce(p_origen, 'web'))
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('resultado', 'ya_registrado');
  end if;

  insert into movimientos (id, tipo, monto, concepto, categoria, ambito, fecha, origen, sueldo_pago_id)
  values (v_mov, 'gasto', p_monto, 'Mi sueldo (pago)' || case when coalesce(p_notas, '') <> '' then ' · ' || p_notas else '' end,
          'sueldos', 'empresa', v_fecha, coalesce(p_origen, 'web'), p_id);

  return jsonb_build_object('resultado', 'pagado', 'movimiento_id', v_mov, 'saldo_restante', v_saldo - p_monto);
end
$$;


-- ============================================================
-- 9) Seguridad
-- ============================================================

alter table cobros             enable row level security;
alter table ventas_directas    enable row level security;
alter table sueldo_dueno_pagos enable row level security;

drop policy if exists "admin_all_cobros" on cobros;
create policy "admin_all_cobros" on cobros
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_ventas_directas" on ventas_directas;
create policy "admin_all_ventas_directas" on ventas_directas
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_sueldo_dueno_pagos" on sueldo_dueno_pagos;
create policy "admin_all_sueldo_dueno_pagos" on sueldo_dueno_pagos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

revoke all on table cobros, ventas_directas, sueldo_dueno_pagos from anon;
grant select, insert, update, delete on table cobros, ventas_directas, sueldo_dueno_pagos to authenticated;
grant all on table cobros, ventas_directas, sueldo_dueno_pagos to service_role;

revoke all on table v_cxc, v_cxc_cuentas, v_sueldo_dueno_registros, v_sueldo_dueno, v_movimientos from anon;
grant select on table v_cxc, v_cxc_cuentas, v_sueldo_dueno_registros, v_sueldo_dueno, v_movimientos
  to authenticated, service_role;

revoke all on function fn_ganancia_por_prenda(boolean) from public, anon;
grant execute on function fn_ganancia_por_prenda(boolean) to authenticated, service_role;

revoke all on function registrar_cobro(uuid, text, boolean, numeric, date, text, text, text) from public, anon;
grant execute on function registrar_cobro(uuid, text, boolean, numeric, date, text, text, text) to authenticated, service_role;

revoke all on function registrar_venta_directa(uuid, text, numeric, integer, date, text, text, text) from public, anon;
grant execute on function registrar_venta_directa(uuid, text, numeric, integer, date, text, text, text) to authenticated, service_role;

revoke all on function pagar_mi_sueldo(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function pagar_mi_sueldo(uuid, numeric, date, text, text, text) to authenticated, service_role;

-- funciones internas (solo triggers)
revoke all on function fn_trg_cxc_ganancia()   from public, anon, authenticated;
revoke all on function fn_trg_venta_ganancia() from public, anon, authenticated;

end
$ingresos$;


-- ============================================================
-- RESUMEN EN ESPAÑOL SIMPLE
-- ============================================================
--
-- QUÉ CREA
--  • Facturas por cobrar con datos nuevos: si es de VATEX (VATEX es UNA
--    sola cuenta), número de factura, cuántas prendas se vendieron, la
--    ganancia por prenda del día (congelada), "viene de antes de octubre"
--    y "anulada".
--  • cobros: los abonos que te hacen. Van a la cuenta del cliente (por
--    ejemplo "VATEX me abonó $1.000") y se aplican solos a la factura más
--    antigua primero. No pueden pasar de lo que te deben. Cada abono crea
--    su ingreso (categoría "ventas"), uno solo aunque se haga doble clic.
--  • ventas_directas: ventas en línea y días de feria, con monto y prendas.
--    Es ingreso directo (la plata ya la tienes). Una feria de 2 días = 2
--    registros con el mismo nombre de feria.
--  • Mi sueldo: cada factura o venta con prendas te genera ganancia
--    (VATEX $2,50 por prenda; fuera de VATEX $5,00). La empresa te la debe.
--    sueldo_dueno_pagos guarda lo que te pagas, por partes; cada pago se
--    aplica al registro más antiguo primero y crea su gasto (categoría
--    sueldos), que NO se vuelve a contar en la rentabilidad.
--  • Vistas que calculan (no guardan): v_cxc (cada factura con cobrado,
--    saldo y días de atraso), v_cxc_cuentas (cuánto te debe cada cliente),
--    v_sueldo_dueno_registros (cada ganancia con lo pagado y lo que falta)
--    y v_sueldo_dueno (ganado, pagado y lo que te deben).
--  • v_movimientos gana las columnas de cobro, venta y pago de sueldo.
--  • Funciones todo o nada: registrar_cobro, registrar_venta_directa y
--    pagar_mi_sueldo. Todas aguantan el doble clic.
--  • Seguridad: reglas de admin en las tablas nuevas, vistas con
--    security_invoker, nada para anon ni para "todos".
--
-- QUÉ NO CAMBIA
--  • No borra ni renombra nada. Las facturas que ya existan siguen igual;
--    las que se marcaron "cobrada" con la pantalla vieja cuentan como
--    cobradas enteras.
--  • No toca deudas, cheques, ni el calendario de pagos.
--  • No lee ni toca tablas de otras áreas (ventas, producción, costos,
--    logística, bot). Las prendas y montos se escriben a mano.
--  • No cambia las reglas de seguridad de las tablas que ya existían.
--  • No toca código de la app (eso es la fase 5B).
