-- Panorama — Finanzas · PRUEBA EN SECO de la Fase 5A (ingresos) — NO GUARDA NADA
-- ============================================================
-- Un solo bloque DO. Siempre termina con un error a propósito para que
-- Postgres deshaga todo:
--   • "PRUEBA OK - se deshace todo ..." → todo pasó y no se guardó nada.
--   • "PRUEBA FALLÓ ..." o "SQL 5A falló ..." → dice qué falló; tampoco se guardó nada.
--
-- Qué hace: ejecuta finanzas_fase5a_ingresos.sql DOS veces (prueba que se
-- puede repetir) y corre 22 pruebas con datos inventados ("ZZZ ...").
-- Los datos de prueba usan fechas de 2020, así quedan como "los más
-- antiguos" y los abonos de prueba se les aplican a ellos aunque en tu base
-- ya existan facturas reales de VATEX. Las cuentas se comparan contra lo que
-- había antes, así tus datos reales no afectan el resultado.
--
-- Pega TODO el archivo en Supabase → SQL Editor → Run. Que salga en rojo es
-- lo esperado: lee el mensaje.
-- Se ARMA a partir de finanzas_fase5a_ingresos.sql; si ese cambia, se vuelve a armar.
-- ============================================================

do $prueba$
declare
  v_fallas  text := '';
  v_pasaron int  := 0;
  v_ctx     text;
  v_n       bigint;
  v_b       boolean;
  v_res     jsonb;
  v_res2    jsonb;
  v_txt     text;
  v_f1 uuid := gen_random_uuid();
  v_f2 uuid := gen_random_uuid();
  v_fc uuid := gen_random_uuid();
  v_fa uuid := gen_random_uuid();
  v_fx uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();
  v_v2 uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();
  v_saldo_vatex0 numeric;
  v_sueldo0 numeric;
  v_admin uuid;
begin

  -- ##########################################################
  -- 1) SQL 5A, primera vez
  -- ##########################################################
  begin
    execute $archivo$
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

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'SQL 5A falló la PRIMERA vez (nada se guardó): % | dónde: %', sqlerrm, v_ctx;
  end;

  -- ##########################################################
  -- 2) SQL 5A, segunda vez (debe pasar: es repetible)
  -- ##########################################################
  begin
    execute $archivo$
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

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'SQL 5A falló la SEGUNDA vez, no es repetible (nada se guardó): % | dónde: %', sqlerrm, v_ctx;
  end;

  -- lo que ya había (datos reales), para comparar
  v_saldo_vatex0 := coalesce((select saldo from v_cxc_cuentas where cuenta = 'vatex'), 0);
  v_sueldo0 := coalesce((select saldo from v_sueldo_dueno), 0);

  -- ---------------- A) Estructura y seguridad ----------------

  begin
    v_n := (select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'cuentas_por_cobrar'
               and column_name in ('es_vatex', 'numero_factura', 'prendas', 'ganancia_por_prenda',
                                   'es_saldo_inicial', 'anulada', 'cuenta'));
    if v_n <> 7 then raise exception 'hay % de 7 columnas nuevas en facturas', v_n; end if;
    v_n := (select count(*) from information_schema.tables
             where table_schema = 'public' and table_name in ('cobros', 'ventas_directas', 'sueldo_dueno_pagos'));
    if v_n <> 3 then raise exception 'hay % de 3 tablas nuevas', v_n; end if;
    v_n := (select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'movimientos'
               and column_name in ('cobro_id', 'venta_directa_id', 'sueldo_pago_id'));
    if v_n <> 3 then raise exception 'hay % de 3 columnas nuevas en movimientos', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 01 tablas y columnas nuevas → ' || sqlerrm;
  end;

  begin
    v_n := (select count(*) from pg_class
             where relnamespace = 'public'::regnamespace and relkind = 'v'
               and relname in ('v_cxc', 'v_cxc_cuentas', 'v_sueldo_dueno_registros', 'v_sueldo_dueno', 'v_movimientos')
               and 'security_invoker=true' = any (reloptions));
    if v_n <> 5 then raise exception 'hay % de 5', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 02 vistas con security_invoker → ' || sqlerrm;
  end;

  begin
    v_n := (select count(*) from pg_class
             where relnamespace = 'public'::regnamespace and relrowsecurity
               and relname in ('cobros', 'ventas_directas', 'sueldo_dueno_pagos'));
    if v_n <> 3 then raise exception 'RLS en % de 3 tablas', v_n; end if;
    v_n := (select count(*) from pg_policies
             where schemaname = 'public' and tablename in ('cobros', 'ventas_directas', 'sueldo_dueno_pagos')
               and policyname like 'admin_all_%');
    if v_n <> 3 then raise exception '% reglas de admin de 3', v_n; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 03 RLS y reglas de admin → ' || sqlerrm;
  end;

  begin
    v_b := (select bool_and(p.proacl is not null
                            and not has_function_privilege('anon', p.oid, 'EXECUTE')
                            and not exists (select 1 from aclexplode(p.proacl) a
                                             where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
              from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname in ('fn_ganancia_por_prenda', 'registrar_cobro', 'registrar_venta_directa',
                                 'pagar_mi_sueldo', 'fn_trg_cxc_ganancia', 'fn_trg_venta_ganancia'));
    v_n := (select count(*) from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname in ('fn_ganancia_por_prenda', 'registrar_cobro', 'registrar_venta_directa',
                                 'pagar_mi_sueldo', 'fn_trg_cxc_ganancia', 'fn_trg_venta_ganancia'));
    if v_n <> 6 or not coalesce(v_b, false) then
      raise exception '% funciones (deben ser 6, una por nombre); alguna la puede usar anon o "todos"', v_n;
    end if;
    if has_table_privilege('anon', 'public.v_cxc', 'SELECT') or has_table_privilege('anon', 'public.cobros', 'SELECT')
       or has_table_privilege('anon', 'public.v_sueldo_dueno', 'SELECT') or has_table_privilege('anon', 'public.ventas_directas', 'SELECT') then
      raise exception 'anon puede leer alguna vista o tabla nueva';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 04 nada para anon ni para "todos" → ' || sqlerrm;
  end;

  -- ---------------- B) Facturas VATEX y abonos ----------------

  begin
    -- como lo hará la pantalla: insert directo con id propio
    insert into cuentas_por_cobrar (id, cliente, es_vatex, numero_factura, concepto, monto, fecha_factura, fecha_vencimiento, prendas)
    values (v_f1, 'msvo', true, 'ZZZ-1', 'ZZZ prueba', 1000, '2020-01-01', '2020-01-15', 100),
           (v_f2, 'cualquiera', true, 'ZZZ-2', 'ZZZ prueba', 500, '2020-01-10', '2020-01-25', 40);
    if not coalesce(
         (select bool_and(cliente = 'VATEX' and cuenta = 'vatex' and ganancia_por_prenda = 2.50)
            from cuentas_por_cobrar where id in (v_f1, v_f2))
         and (select saldo from v_cxc_cuentas where cuenta = 'vatex') = v_saldo_vatex0 + 1500
         and (select ganancia_dueno from v_cxc where id = v_f1) = 250, false) then
      raise exception 'las facturas VATEX no quedaron como se esperaba';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 10 facturas VATEX: una sola cuenta, $2,50 por prenda → ' || sqlerrm;
  end;

  begin
    update cuentas_por_cobrar set ganancia_por_prenda = 99 where id = v_f1;
    if (select ganancia_por_prenda from cuentas_por_cobrar where id = v_f1) <> 2.50 then
      raise exception 'se pudo cambiar la ganancia por prenda a mano';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 11 la ganancia por prenda queda congelada → ' || sqlerrm;
  end;

  begin
    v_res := registrar_cobro(v_c1, null, true, 1200, '2026-10-15', 'transferencia', 'ZZZ abono');
    if not coalesce(
         v_res->>'resultado' = 'cobrado'
         and (select cobrado = 1000 and saldo = 0 and estado_calculado = 'cobrada' from v_cxc where id = v_f1)
         and (select cobrado = 200 and saldo = 300 and estado_calculado = 'abonada' from v_cxc where id = v_f2)
         and (select saldo from v_cxc_cuentas where cuenta = 'vatex') = v_saldo_vatex0 + 300
         and (select count(*) = 1 from movimientos where cobro_id = v_c1 and tipo = 'ingreso' and monto = 1200
                                                         and categoria = 'ventas' and ambito = 'empresa'), false) then
      raise exception 'resultado: %', v_res;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 12 abono VATEX: va a la factura más antigua y crea UN ingreso → ' || sqlerrm;
  end;

  begin
    v_res := registrar_cobro(v_c1, null, true, 1200, '2026-10-15');
    if not coalesce(v_res->>'resultado' = 'ya_registrado'
                    and (select count(*) = 1 from cobros where id = v_c1)
                    and (select count(*) = 1 from movimientos where cobro_id = v_c1), false) then
      raise exception 'resultado: %', v_res;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 13 doble clic en el abono no duplica → ' || sqlerrm;
  end;

  begin
    perform registrar_cobro(gen_random_uuid(), null, true, v_saldo_vatex0 + 300 + 1);
    v_fallas := v_fallas || E'\n• 14 aceptó un abono mayor a lo que debe VATEX';
  exception when others then
    if sqlerrm ilike '%mayor a lo que te debe%' then v_pasaron := v_pasaron + 1;
    else v_fallas := v_fallas || E'\n• 14 abono excesivo: error inesperado → ' || sqlerrm; end if;
  end;

  -- ---------------- C) Otros clientes ----------------

  begin
    insert into cuentas_por_cobrar (id, cliente, concepto, monto, fecha_factura, prendas)
    values (v_fc, 'ZZZ Cliente Prueba', 'ZZZ prueba', 100, '2020-01-05', 2);
    v_res := registrar_cobro(v_c2, '  zzz cliente prueba ', false, 30, '2026-10-15');
    if not coalesce(
         v_res->>'resultado' = 'cobrado'
         and (select ganancia_por_prenda = 5.00 and cobrado = 30 and saldo = 70 from v_cxc where id = v_fc)
         and (select saldo = 70 and not es_vatex from v_cxc_cuentas where cuenta = 'zzz cliente prueba'), false) then
      raise exception 'resultado: %', v_res;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 15 otro cliente: $5 por prenda; abono encuentra al cliente aunque se escriba distinto → ' || sqlerrm;
  end;

  begin
    perform registrar_cobro(gen_random_uuid(), 'ZZZ cliente que no existe', false, 10);
    v_fallas := v_fallas || E'\n• 16 aceptó un abono de un cliente sin facturas';
  exception when others then
    if sqlerrm ilike '%no tiene facturas pendientes%' then v_pasaron := v_pasaron + 1;
    else v_fallas := v_fallas || E'\n• 16 cliente sin facturas: error inesperado → ' || sqlerrm; end if;
  end;

  begin
    insert into cuentas_por_cobrar (id, cliente, concepto, monto, fecha_factura, fecha_vencimiento)
    values (v_fa, 'ZZZ Cliente Atrasado', 'ZZZ prueba', 50, fn_hoy_ecuador() - 20, fn_hoy_ecuador() - 5);
    if not coalesce((select dias_atraso = 5 from v_cxc where id = v_fa), false) then
      raise exception 'días de atraso: %', (select dias_atraso from v_cxc where id = v_fa);
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 17 días de atraso se calculan solos → ' || sqlerrm;
  end;

  begin
    insert into cuentas_por_cobrar (id, cliente, concepto, monto, fecha_factura, prendas, anulada)
    values (v_fx, 'ZZZ Cliente Anulado', 'ZZZ prueba', 999, '2020-01-02', 50, true);
    if not coalesce(
         (select saldo = 0 and estado_calculado = 'anulada' from v_cxc where id = v_fx)
         and not exists (select 1 from v_cxc_cuentas where cuenta = 'zzz cliente anulado')
         and not exists (select 1 from v_sueldo_dueno_registros where fuente_id = v_fx), false) then
      raise exception 'la factura anulada sigue contando';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 18 factura anulada no cuenta para cobros ni para el sueldo → ' || sqlerrm;
  end;

  -- ---------------- D) Ventas directas (feria de 2 días) ----------------

  begin
    v_res  := registrar_venta_directa(v_v1, 'feria', 300, 10, '2020-01-12', 'ZZZ Feria Navidad');
    v_res2 := registrar_venta_directa(v_v2, 'feria', 200, 6, '2020-01-13', 'ZZZ Feria Navidad');
    if not coalesce(
         v_res->>'resultado' = 'registrada' and v_res2->>'resultado' = 'registrada'
         and (select count(*) = 2 and bool_and(ganancia_por_prenda = 5.00) from ventas_directas where id in (v_v1, v_v2))
         and (select count(*) = 2 and sum(monto) = 500 and bool_and(tipo = 'ingreso' and categoria = 'ventas')
                from movimientos where venta_directa_id in (v_v1, v_v2)), false) then
      raise exception 'resultados: % / %', v_res, v_res2;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 20 feria de 2 días: 2 ventas, 2 ingresos, $5 por prenda → ' || sqlerrm;
  end;

  begin
    v_res := registrar_venta_directa(v_v1, 'feria', 300, 10, '2020-01-12', 'ZZZ Feria Navidad');
    if not coalesce(v_res->>'resultado' = 'ya_registrado'
                    and (select count(*) = 1 from movimientos where venta_directa_id = v_v1), false) then
      raise exception 'resultado: %', v_res;
    end if;
    begin
      perform registrar_venta_directa(gen_random_uuid(), 'feria', 10, 1, '2020-01-12', '   ');
      raise exception 'aceptó una feria sin nombre';
    exception when others then
      if sqlerrm not ilike '%nombre de la feria%' then raise; end if;
    end;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 21 venta: doble clic no duplica; feria necesita nombre → ' || sqlerrm;
  end;

  -- ---------------- E) Mi sueldo ----------------
  -- ganancias de prueba, de la más antigua a la más nueva:
  --   01-01 VATEX F1 100×2,50 = 250 · 01-05 cliente 2×5 = 10 · 01-10 VATEX F2 40×2,50 = 100
  --   01-12 feria 10×5 = 50 · 01-13 feria 6×5 = 30        → total 440

  begin
    if not coalesce(
         (select saldo from v_sueldo_dueno) = v_sueldo0 + 440
         and (select count(*) = 5 from v_sueldo_dueno_registros where fuente_id in (v_f1, v_fc, v_f2, v_v1, v_v2)), false) then
      raise exception 'sueldo ganado: % (esperado %)', (select saldo from v_sueldo_dueno), v_sueldo0 + 440;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 22 mi sueldo suma $2,50 por prenda en VATEX y $5 fuera → ' || sqlerrm;
  end;

  begin
    v_res := pagar_mi_sueldo(v_s1, 300, '2026-10-15', 'transferencia', 'ZZZ prueba');
    if not coalesce(
         v_res->>'resultado' = 'pagado'
         and (select saldo from v_sueldo_dueno) = v_sueldo0 + 140
         and (select pagado = 250 and saldo = 0 from v_sueldo_dueno_registros where fuente_id = v_f1)
         and (select pagado = 10 and saldo = 0 from v_sueldo_dueno_registros where fuente_id = v_fc)
         and (select pagado = 40 and saldo = 60 from v_sueldo_dueno_registros where fuente_id = v_f2)
         and (select pagado = 0 and saldo = 50 from v_sueldo_dueno_registros where fuente_id = v_v1)
         and (select count(*) = 1 from v_movimientos where sueldo_pago_id = v_s1 and tipo = 'gasto'
                                                       and categoria = 'sueldos' and not cuenta_en_rentabilidad), false) then
      raise exception 'resultado: %', v_res;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 23 pagarme $300: se aplica al registro más antiguo; el gasto no cuenta dos veces → ' || sqlerrm;
  end;

  begin
    v_res := pagar_mi_sueldo(v_s1, 300, '2026-10-15');
    if not coalesce(v_res->>'resultado' = 'ya_registrado'
                    and (select count(*) = 1 from movimientos where sueldo_pago_id = v_s1), false) then
      raise exception 'resultado: %', v_res;
    end if;
    begin
      perform pagar_mi_sueldo(gen_random_uuid(), v_sueldo0 + 140 + 1);
      raise exception 'aceptó pagarme más de lo que me deben';
    exception when others then
      if sqlerrm not ilike '%mayor a lo que la empresa te debe%' then raise; end if;
    end;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 24 sueldo: doble clic no duplica; no se paga más de lo ganado → ' || sqlerrm;
  end;

  begin
    if exists (select 1 from v_movimientos
                where (cobro_id in (v_c1, v_c2) or venta_directa_id in (v_v1, v_v2)) and cuenta_en_rentabilidad) then
      raise exception 'un ingreso aparece como gasto de rentabilidad';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 25 ingresos no se cuentan como gasto → ' || sqlerrm;
  end;

  -- ---------------- F) La pantalla vieja de "Por cobrar" sigue funcionando ----------------

  begin
    v_txt := 'ZZZ Cliente Viejo';
    insert into cuentas_por_cobrar (cliente, concepto, monto, fecha_factura, fecha_vencimiento, notas)
    values (v_txt, 'ZZZ prueba', 80, '2026-10-06', '2026-10-20', '');
    update cuentas_por_cobrar set estado = 'cobrado', fecha_cobro = '2026-10-15'
     where cliente = v_txt and estado = 'pendiente';
    if not coalesce((select cobrado = 80 and saldo = 0 and ganancia_por_prenda = 5.00
                       from v_cxc where cliente = v_txt), false) then
      raise exception 'la marca "cobrada" de la pantalla vieja no cuenta';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 26 la pantalla vieja de Por cobrar sigue funcionando → ' || sqlerrm;
  end;

  -- ---------------- G) Como ADMIN desde la app ----------------

  v_admin := (select user_id from user_roles where rol = 'admin' limit 1);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(v_admin::text, ''), true);
  set local role authenticated;
  begin
    if v_admin is null or not fn_es_admin() then
      raise exception 'no encontré un usuario admin en user_roles';
    end if;
    insert into cuentas_por_cobrar (cliente, es_vatex, concepto, monto, fecha_factura, prendas)
    values ('x', true, 'ZZZ admin', 40, '2020-01-03', 4);
    v_res  := registrar_cobro(gen_random_uuid(), null, true, 10, '2026-10-15');
    v_res2 := registrar_venta_directa(gen_random_uuid(), 'en_linea', 25, 1, '2026-10-15');
    v_txt  := pagar_mi_sueldo(gen_random_uuid(), 5, '2026-10-15')->>'resultado';
    v_n    := (select count(*) from v_cxc_cuentas);
    if not coalesce(v_res->>'resultado' = 'cobrado' and v_res2->>'resultado' = 'registrada' and v_txt = 'pagado', false) then
      raise exception 'cobro=% venta=% sueldo=%', v_res->>'resultado', v_res2->>'resultado', v_txt;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 30 como admin desde la app: facturar, cobrar, vender y pagarme → ' || sqlerrm;
  end;
  reset role;

  -- ---------------- H) Como ANÓNIMO: no puede nada ----------------

  set local role anon;
  begin
    v_txt := '';
    begin perform registrar_cobro(gen_random_uuid(), null, true, 1);
          v_txt := v_txt || 'pudo registrar un cobro; ';
    exception when insufficient_privilege then null; end;
    begin perform pagar_mi_sueldo(gen_random_uuid(), 1);
          v_txt := v_txt || 'pudo pagarse sueldo; ';
    exception when insufficient_privilege then null; end;
    begin perform count(*) from v_sueldo_dueno;
          v_txt := v_txt || 'pudo leer el sueldo; ';
    exception when insufficient_privilege then null; end;
    begin perform count(*) from cobros;
          v_txt := v_txt || 'pudo leer los cobros; ';
    exception when insufficient_privilege then null; end;
    if v_txt <> '' then raise exception '%', v_txt; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 40 un anónimo no puede nada → ' || sqlerrm;
  end;
  reset role;

  -- ##########################################################
  -- 4) RESULTADO: siempre termina con error para que NADA se guarde
  -- ##########################################################
  if v_fallas <> '' then
    raise exception E'PRUEBA FALLÓ - se deshace todo. Pasaron % de 22. Fallaron:%', v_pasaron, v_fallas;
  end if;
  if v_pasaron <> 22 then
    raise exception 'PRUEBA INCOMPLETA - se deshace todo. Pasaron % de 22 y no se registró ninguna falla.', v_pasaron;
  end if;
  raise exception 'PRUEBA OK - se deshace todo (22 de 22 pruebas pasaron; el SQL 5A corrió 2 veces sin error)';
end
$prueba$;
