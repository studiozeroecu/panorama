-- Panorama — Finanzas v2 · SQL-1 "AMPLIAR"
-- ============================================================
-- Fase 1A. Ejecutar en el SQL Editor de Supabase DESPUÉS de todos los
-- esquemas anteriores (schema*.sql, actualizacion_*.sql, migracion_pagos.sql).
--
-- • Solo AGREGA: no borra ni renombra tablas ni columnas. El código que hoy
--   está publicado sigue funcionando igual.
-- • Se puede ejecutar varias veces sin daño (todo es "if not exists",
--   "create or replace" o "drop ... if exists" + "create").
-- • Es UN SOLO bloque DO (una sola sentencia): se aplica TODO o NADA,
--   aunque el editor de Supabase reparta las sentencias entre conexiones.
--   No lleva begin/commit.
-- • Para probarlo sin guardar nada usa finanzas_v2_sql1_prueba_en_seco.sql.
-- • Requiere Postgres 15 o más (vistas con security_invoker).
-- • No depende de tablas temporales ni de datos de la conexión.
--
-- Al final del archivo hay un resumen en español simple de qué crea y
-- qué NO cambia.
-- ============================================================

do $ampliar$
declare
  fin_rec record;   -- solo para recorrer restricciones viejas
begin


-- ============================================================
-- 0) Fecha de hoy en Ecuador
-- ============================================================

create or replace function fn_hoy_ecuador() returns date
language sql stable set search_path = public as
$$ select (now() at time zone 'America/Guayaquil')::date $$;

-- Valores por defecto de fecha en hora de Ecuador (antes: current_date,
-- que en el servidor es hora UTC y después de las 19:00 daba "mañana").
alter table movimientos        alter column fecha         set default ((now() at time zone 'America/Guayaquil')::date);
alter table cuentas_por_cobrar alter column fecha_factura set default ((now() at time zone 'America/Guayaquil')::date);
alter table cuentas_por_pagar  alter column fecha_factura set default ((now() at time zone 'America/Guayaquil')::date);

-- El documento (factura / nota de venta) pasa a ser opcional.
alter table cuentas_por_pagar alter column fecha_factura drop not null;


-- ============================================================
-- 1) Cuentas de dinero (bancos y efectivo)
--    Las usan los cheques ("cuenta de origen") y las fotos de saldo.
-- ============================================================

create table if not exists cuentas_dinero (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null unique,                 -- ej. "Pichincha empresa", "Efectivo"
  tipo text not null default 'banco' check (tipo in ('banco', 'efectivo')),
  banco text not null default '',
  ambito text not null default 'empresa' check (ambito in ('empresa', 'personal')),
  activa boolean not null default true,
  notas text not null default ''
);


-- ============================================================
-- 2) Saldo de caja: una FOTO con fecha por cuenta (la app no lo
--    mantiene sola). Antigüedad y aviso se calculan en v_caja_actual.
-- ============================================================

create table if not exists saldos_caja (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  cuenta_id uuid not null references cuentas_dinero (id) on delete restrict,
  monto numeric(12,2) not null,                -- puede ser negativo (sobregiro)
  notas text not null default '',
  constraint fin_saldos_caja_unica unique (cuenta_id, fecha)
);
create index if not exists idx_saldos_caja_cuenta_fecha on saldos_caja (cuenta_id, fecha desc);


-- ============================================================
-- 3) Deudas (cuentas_por_pagar): campos nuevos
-- ============================================================

-- (ya la crea migracion_pagos.sql; se repite por si no se ejecutó)
alter table cuentas_por_pagar add column if not exists ambito text not null default 'empresa'
  check (ambito in ('personal', 'empresa'));

alter table cuentas_por_pagar add column if not exists tipo_deuda       text not null default 'proveedor';
alter table cuentas_por_pagar add column if not exists exigibilidad     text not null default 'firme';
alter table cuentas_por_pagar add column if not exists fecha_estimada   date;
alter table cuentas_por_pagar add column if not exists es_saldo_inicial boolean not null default false;
alter table cuentas_por_pagar add column if not exists monto_original   numeric(12,2);
alter table cuentas_por_pagar add column if not exists cuota_mensual    numeric(12,2);
alter table cuentas_por_pagar add column if not exists saldo_al         date;
alter table cuentas_por_pagar add column if not exists documento_tipo   text;
alter table cuentas_por_pagar add column if not exists documento_numero text not null default '';
alter table cuentas_por_pagar add column if not exists anulada          boolean not null default false;
alter table cuentas_por_pagar add column if not exists alertado_hasta   date;

alter table cuentas_por_pagar drop constraint if exists fin_cxp_tipo_deuda;
alter table cuentas_por_pagar add  constraint fin_cxp_tipo_deuda
  check (tipo_deuda in ('proveedor', 'prestamo', 'tarjeta', 'familia', 'sueldo', 'otra'));

alter table cuentas_por_pagar drop constraint if exists fin_cxp_exigibilidad;
alter table cuentas_por_pagar add  constraint fin_cxp_exigibilidad
  check (exigibilidad in ('firme', 'flexible'));

-- la fecha estimada solo tiene sentido en deudas flexibles
alter table cuentas_por_pagar drop constraint if exists fin_cxp_fecha_estimada;
alter table cuentas_por_pagar add  constraint fin_cxp_fecha_estimada
  check (fecha_estimada is null or exigibilidad = 'flexible');

alter table cuentas_por_pagar drop constraint if exists fin_cxp_monto_original;
alter table cuentas_por_pagar add  constraint fin_cxp_monto_original
  check (monto_original is null or monto_original > 0);

alter table cuentas_por_pagar drop constraint if exists fin_cxp_cuota_mensual;
alter table cuentas_por_pagar add  constraint fin_cxp_cuota_mensual
  check (cuota_mensual is null or cuota_mensual > 0);

alter table cuentas_por_pagar drop constraint if exists fin_cxp_documento_tipo;
alter table cuentas_por_pagar add  constraint fin_cxp_documento_tipo
  check (documento_tipo is null or documento_tipo in ('factura', 'nota_venta', 'promedio', 'otro'));


-- ============================================================
-- 4) Categoría "sueldos" (antes "personal").
--    Por ahora se aceptan LAS DOS para no romper el código publicado;
--    SQL-2 quitará "personal".
-- ============================================================

-- quita las reglas viejas de categoría (nombre automático), no las nuestras (fin_*)
for fin_rec in
  select conrelid::regclass as tabla, conname
  from pg_constraint
  where contype = 'c'
    and conrelid in ('public.movimientos'::regclass, 'public.cuentas_por_pagar'::regclass)
    and pg_get_constraintdef(oid) ilike '%categoria%'
    and conname not like 'fin\_%'
loop
  execute format('alter table %s drop constraint %I', fin_rec.tabla, fin_rec.conname);
end loop;

alter table movimientos drop constraint if exists fin_movimientos_categoria;
alter table movimientos add  constraint fin_movimientos_categoria check (categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'sueldos', 'otros'));

alter table cuentas_por_pagar drop constraint if exists fin_cxp_categoria;
alter table cuentas_por_pagar add  constraint fin_cxp_categoria check (categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'sueldos', 'otros'));


-- ============================================================
-- 5) Cheques = TODOS los pagos programados (cuotas): cheque,
--    transferencia o efectivo. Un cheque puede existir sin deuda.
-- ============================================================

alter table cheques add column if not exists medio               text not null default 'cheque';
alter table cheques add column if not exists fecha_pago          date;
alter table cheques add column if not exists categoria           text;   -- solo para pagos sueltos (sin deuda)
alter table cheques add column if not exists ambito              text;   -- solo para pagos sueltos (sin deuda)
alter table cheques add column if not exists cuenta_origen_id    uuid;   -- de qué cuenta sale el dinero
alter table cheques add column if not exists fecha_original      date;   -- la primera fecha pactada; nunca se pisa
alter table cheques add column if not exists fecha_reprogramada  date;   -- fecha nueva de la última reprogramación
alter table cheques add column if not exists tipo_reprogramacion text;   -- acordada / cambiado_devuelto
alter table cheques add column if not exists nota_reprogramacion text not null default '';
alter table cheques add column if not exists alertado_hasta      date;

-- Estados: se agrega "pagado" (para lo que YO pago). "cobrado" sigue
-- aceptado también en por_pagar porque el código publicado lo usa;
-- SQL-2 lo dejará solo para cheques por cobrar.
for fin_rec in
  select conname
  from pg_constraint
  where contype = 'c'
    and conrelid = 'public.cheques'::regclass
    and pg_get_constraintdef(oid) ilike '%estado%'
    and conname not like 'fin\_%'
loop
  execute format('alter table cheques drop constraint %I', fin_rec.conname);
end loop;

alter table cheques drop constraint if exists fin_cheques_estado;
alter table cheques add  constraint fin_cheques_estado
  check (estado in ('pendiente', 'pagado', 'cobrado', 'rebotado', 'anulado'));

alter table cheques drop constraint if exists fin_cheques_medio;
alter table cheques add  constraint fin_cheques_medio
  check (medio in ('cheque', 'transferencia', 'efectivo'));

alter table cheques drop constraint if exists fin_cheques_categoria;
alter table cheques add  constraint fin_cheques_categoria check (categoria is null or categoria in
  ('maquila', 'estampado', 'corte', 'arriendo', 'servicios', 'transporte', 'personal', 'sueldos', 'otros'));

alter table cheques drop constraint if exists fin_cheques_ambito;
alter table cheques add  constraint fin_cheques_ambito
  check (ambito is null or ambito in ('empresa', 'personal'));

alter table cheques drop constraint if exists fin_cheques_tipo_reprogramacion;
alter table cheques add  constraint fin_cheques_tipo_reprogramacion
  check (tipo_reprogramacion is null or tipo_reprogramacion in ('acordada', 'cambiado_devuelto'));

-- fecha_reprogramada, si existe, es la fecha vigente
alter table cheques drop constraint if exists fin_cheques_reprogramada_vigente;
alter table cheques add  constraint fin_cheques_reprogramada_vigente
  check (fecha_reprogramada is null or fecha_reprogramada = fecha_cobro);

-- solo un pago "por pagar" puede pertenecer a una deuda
alter table cheques drop constraint if exists fin_cheques_deuda_solo_por_pagar;
alter table cheques add  constraint fin_cheques_deuda_solo_por_pagar
  check (cuenta_por_pagar_id is null or tipo = 'por_pagar');

alter table cheques drop constraint if exists fin_cheques_pagado_con_fecha;
alter table cheques add  constraint fin_cheques_pagado_con_fecha
  check (estado <> 'pagado' or fecha_pago is not null);

-- Vínculo cheque → deuda: antes "on delete set null" (borrar la deuda
-- desvinculaba el cheque sin avisar). Ahora NO se puede borrar una
-- deuda que tiene pagos: se anula.
for fin_rec in
  select conname
  from pg_constraint
  where contype = 'f'
    and conrelid = 'public.cheques'::regclass
    and confrelid = 'public.cuentas_por_pagar'::regclass
    and conname not like 'fin\_%'
loop
  execute format('alter table cheques drop constraint %I', fin_rec.conname);
end loop;

alter table cheques drop constraint if exists fin_cheques_deuda_fk;
alter table cheques add  constraint fin_cheques_deuda_fk
  foreign key (cuenta_por_pagar_id) references cuentas_por_pagar (id) on delete restrict;

alter table cheques drop constraint if exists fin_cheques_cuenta_origen_fk;
alter table cheques add  constraint fin_cheques_cuenta_origen_fk
  foreign key (cuenta_origen_id) references cuentas_dinero (id) on delete restrict;

create index if not exists idx_cheques_deuda         on cheques (cuenta_por_pagar_id);
create index if not exists idx_cheques_cuenta_origen on cheques (cuenta_origen_id);

-- Si ya hubiera cheques, su fecha actual es su fecha original.
update cheques set fecha_original = fecha_cobro
 where fecha_original is null and fecha_cobro is not null;


-- ============================================================
-- 6) Historial de reprogramaciones de cheques (solo se agrega,
--    nunca se edita). Lo llena la base sola (trigger del punto 9).
-- ============================================================

create table if not exists cheques_reprogramaciones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cheque_id uuid not null references cheques (id) on delete restrict,
  fecha_anterior date,
  fecha_nueva date,
  numero_anterior text not null default '',
  numero_nuevo text not null default '',
  estado_anterior text not null default '',
  -- null = se cambió la fecha directamente, sin indicar el motivo
  tipo text check (tipo is null or tipo in ('acordada', 'cambiado_devuelto')),
  nota text not null default '',
  hecho_por uuid default auth.uid()
);
create index if not exists idx_cheques_reprog_cheque on cheques_reprogramaciones (cheque_id, created_at);


-- ============================================================
-- 7) Movimientos: de dónde salió cada gasto, y ámbito
-- ============================================================

alter table movimientos add column if not exists ambito              text not null default 'empresa';
alter table movimientos add column if not exists cheque_id           uuid;
alter table movimientos add column if not exists cuenta_por_pagar_id uuid;

alter table movimientos drop constraint if exists fin_movimientos_ambito;
alter table movimientos add  constraint fin_movimientos_ambito
  check (ambito in ('empresa', 'personal'));

alter table movimientos drop constraint if exists fin_movimientos_cheque_fk;
alter table movimientos add  constraint fin_movimientos_cheque_fk
  foreign key (cheque_id) references cheques (id) on delete restrict;

alter table movimientos drop constraint if exists fin_movimientos_deuda_fk;
alter table movimientos add  constraint fin_movimientos_deuda_fk
  foreign key (cuenta_por_pagar_id) references cuentas_por_pagar (id) on delete restrict;

-- Un pago programado genera UN solo gasto (protección final contra duplicados)
create unique index if not exists fin_movimientos_un_gasto_por_pago
  on movimientos (cheque_id) where cheque_id is not null;
create index if not exists idx_movimientos_deuda        on movimientos (cuenta_por_pagar_id);
create index if not exists idx_movimientos_ambito_fecha on movimientos (ambito, fecha);


-- ============================================================
-- 8) Regla: los pagos de una deuda nunca pasan del total, y en una
--    deuda FIRME con pagos pendientes deben sumar EXACTO.
--    La revisa la base al final de cada operación (aunque se edite
--    desde el panel de Supabase). No cuentan los pagos anulados.
-- ============================================================

create or replace function fn_validar_cuotas_deuda(p_deuda uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_monto numeric;
  v_exig text;
  v_anulada boolean;
  v_prov text;
  v_suma numeric;
  v_pendientes int;
begin
  if p_deuda is null then return; end if;

  select monto, exigibilidad, anulada, proveedor
    into v_monto, v_exig, v_anulada, v_prov
    from cuentas_por_pagar where id = p_deuda;
  if not found or v_anulada then return; end if;

  select coalesce(sum(monto), 0), count(*) filter (where estado = 'pendiente')
    into v_suma, v_pendientes
    from cheques
   where cuenta_por_pagar_id = p_deuda and estado <> 'anulado';

  if v_suma > v_monto then
    raise exception using errcode = '23514',
      message = format('Los pagos de "%s" suman %s y la deuda es %s: no pueden pasarse del total.', v_prov, v_suma, v_monto);
  end if;

  if v_exig = 'firme' and v_pendientes > 0 and v_suma <> v_monto then
    raise exception using errcode = '23514',
      message = format('Los pagos de "%s" suman %s y la deuda es %s: en una deuda firme deben sumar exacto.', v_prov, v_suma, v_monto);
  end if;
end
$$;

create or replace function fn_trg_validar_cuotas() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if tg_table_name = 'cuentas_por_pagar' then
    perform fn_validar_cuotas_deuda(new.id);
    return null;
  end if;

  -- tabla cheques
  if tg_op = 'DELETE' then
    perform fn_validar_cuotas_deuda(old.cuenta_por_pagar_id);
    return null;
  end if;
  if tg_op = 'UPDATE' then
    perform fn_validar_cuotas_deuda(old.cuenta_por_pagar_id);
    if new.cuenta_por_pagar_id is distinct from old.cuenta_por_pagar_id then
      perform fn_validar_cuotas_deuda(new.cuenta_por_pagar_id);
    end if;
    return null;
  end if;
  perform fn_validar_cuotas_deuda(new.cuenta_por_pagar_id);
  return null;
end
$$;

drop trigger if exists fin_validar_cuotas on cheques;
create constraint trigger fin_validar_cuotas
  after insert or update or delete on cheques
  deferrable initially deferred
  for each row execute function fn_trg_validar_cuotas();

drop trigger if exists fin_validar_cuotas on cuentas_por_pagar;
create constraint trigger fin_validar_cuotas
  after update on cuentas_por_pagar
  deferrable initially deferred
  for each row execute function fn_trg_validar_cuotas();


-- ============================================================
-- 9) Fechas de cheques: la fecha original nunca se pisa y todo
--    cambio de fecha queda en el historial.
--    • fecha_cobro = fecha VIGENTE (la que usa todo el código).
--    • fecha_original = la primera; se guarda sola y no se puede cambiar.
--    • Si cambia fecha_cobro (por la función reprogramar_cheque o
--      directo), se agrega una fila a cheques_reprogramaciones.
-- ============================================================

create or replace function fn_trg_cheques_fechas() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  v_tipo text := nullif(current_setting('fin.reprog_tipo', true), '');
  v_nota text := coalesce(current_setting('fin.reprog_nota', true), '');
begin
  if tg_op = 'INSERT' then
    new.fecha_original := coalesce(new.fecha_original, new.fecha_cobro);
    new.fecha_reprogramada := case
      when new.fecha_cobro is not null and new.fecha_cobro is distinct from new.fecha_original
      then new.fecha_cobro end;
    new.tipo_reprogramacion := null;
    new.nota_reprogramacion := '';
    return new;
  end if;

  -- UPDATE: la fecha original no se toca (o se fija la primera vez)
  new.fecha_original := coalesce(old.fecha_original, old.fecha_cobro, new.fecha_cobro);

  if (old.fecha_cobro is not null and new.fecha_cobro is distinct from old.fecha_cobro)
     or (v_tipo is not null and new.numero is distinct from old.numero) then
    insert into cheques_reprogramaciones
      (cheque_id, fecha_anterior, fecha_nueva, numero_anterior, numero_nuevo, estado_anterior, tipo, nota)
    values
      (old.id, old.fecha_cobro, new.fecha_cobro, old.numero, new.numero, old.estado, v_tipo,
       case when v_tipo is null then 'cambio directo, sin indicar motivo' else v_nota end);
    new.fecha_reprogramada := new.fecha_cobro;
    new.tipo_reprogramacion := v_tipo;
    new.nota_reprogramacion := case when v_tipo is null then '' else v_nota end;
  else
    -- sin reprogramación: estos campos solo cambian reprogramando
    new.fecha_reprogramada := case when old.fecha_cobro is null then null else old.fecha_reprogramada end;
    new.tipo_reprogramacion := old.tipo_reprogramacion;
    new.nota_reprogramacion := old.nota_reprogramacion;
  end if;
  return new;
end
$$;

drop trigger if exists fin_cheques_fechas on cheques;
create trigger fin_cheques_fechas
  before insert or update on cheques
  for each row execute function fn_trg_cheques_fechas();


-- ============================================================
-- 10) Funciones de la app (todo o nada). Corren con los permisos
--     de quien llama (las reglas de admin siguen aplicando) y además
--     revisan que sea admin, el bot (service_role) o el SQL Editor.
-- ============================================================

-- 10.1) Crear una deuda con sus pagos programados, en una sola operación.
--   p_deuda: { id (opcional; si ya existe no hace nada → protege del doble
--              clic), proveedor, concepto, monto, fecha_documento,
--              documento_tipo, documento_numero, categoria, ambito,
--              tipo_deuda, exigibilidad, fecha_estimada, es_saldo_inicial,
--              monto_original, cuota_mensual, saldo_al, notas }
--   p_cuotas: [ { monto, fecha, medio, numero, banco, beneficiario,
--                 cuenta_origen_id, notas }, ... ]
create or replace function crear_deuda(p_deuda jsonb, p_cuotas jsonb default '[]'::jsonb) returns uuid
language plpgsql set search_path = public as
$$
declare
  v_id uuid := coalesce(nullif(p_deuda->>'id', '')::uuid, gen_random_uuid());
  v_monto numeric := (p_deuda->>'monto')::numeric;
  v_exig text := coalesce(nullif(p_deuda->>'exigibilidad', ''), 'firme');
  v_inicial boolean := coalesce((p_deuda->>'es_saldo_inicial')::boolean, false);
  v_proveedor text := trim(coalesce(p_deuda->>'proveedor', ''));
  v_n int;
  v_suma numeric := 0;
  c jsonb;
  v_cuota numeric;
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar deudas.';
  end if;

  -- doble clic / reintento: ya existe → devolver la misma
  if exists (select 1 from cuentas_por_pagar where id = v_id) then
    return v_id;
  end if;

  if v_proveedor = '' then
    raise exception 'Falta a quién se le debe.';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto de la deuda debe ser mayor a 0.';
  end if;
  if p_cuotas is null or jsonb_typeof(p_cuotas) <> 'array' then
    raise exception 'Los pagos programados deben venir como lista.';
  end if;

  v_n := jsonb_array_length(p_cuotas);
  if v_exig = 'firme' and not v_inicial and v_n = 0 then
    raise exception 'Una deuda firme nueva necesita al menos un pago programado (cheque o cuota).';
  end if;

  insert into cuentas_por_pagar (
    id, proveedor, concepto, monto, fecha_factura, documento_tipo, documento_numero,
    categoria, ambito, tipo_deuda, exigibilidad, fecha_estimada, es_saldo_inicial,
    monto_original, cuota_mensual, saldo_al, notas
  ) values (
    v_id, v_proveedor, coalesce(p_deuda->>'concepto', ''), v_monto,
    nullif(p_deuda->>'fecha_documento', '')::date,
    nullif(p_deuda->>'documento_tipo', ''),
    coalesce(p_deuda->>'documento_numero', ''),
    coalesce(nullif(p_deuda->>'categoria', ''), 'otros'),
    coalesce(nullif(p_deuda->>'ambito', ''), 'empresa'),
    coalesce(nullif(p_deuda->>'tipo_deuda', ''), 'proveedor'),
    v_exig,
    nullif(p_deuda->>'fecha_estimada', '')::date,
    v_inicial,
    nullif(p_deuda->>'monto_original', '')::numeric,
    nullif(p_deuda->>'cuota_mensual', '')::numeric,
    nullif(p_deuda->>'saldo_al', '')::date,
    coalesce(p_deuda->>'notas', '')
  );

  for c in select * from jsonb_array_elements(p_cuotas) loop
    v_cuota := (c->>'monto')::numeric;
    if v_cuota is null or v_cuota <= 0 then
      raise exception 'Cada pago programado debe tener un monto mayor a 0.';
    end if;
    if nullif(c->>'fecha', '') is null then
      raise exception 'Cada pago programado necesita fecha.';
    end if;
    insert into cheques (
      tipo, medio, monto, beneficiario, banco, numero, fecha_cobro, estado,
      cuenta_por_pagar_id, cuenta_origen_id, notas
    ) values (
      'por_pagar',
      coalesce(nullif(c->>'medio', ''), 'cheque'),
      v_cuota,
      coalesce(nullif(c->>'beneficiario', ''), v_proveedor),
      coalesce(c->>'banco', ''),
      coalesce(c->>'numero', ''),
      (c->>'fecha')::date,
      'pendiente',
      v_id,
      nullif(c->>'cuenta_origen_id', '')::uuid,
      coalesce(c->>'notas', '')
    );
    v_suma := v_suma + v_cuota;
  end loop;

  -- mensaje claro antes de que salte la regla general de la base
  if v_suma > v_monto then
    raise exception 'Los pagos suman % y la deuda es %: no pueden pasarse del total.', v_suma, v_monto;
  end if;
  if v_n > 0 and v_exig = 'firme' and v_suma <> v_monto then
    raise exception 'Los pagos suman % y la deuda es %: en una deuda firme deben sumar exacto.', v_suma, v_monto;
  end if;

  return v_id;
end
$$;

-- 10.2) Pagar un pago programado: lo marca pagado Y registra el gasto
--   ligado, juntos o nada. Si ya estaba pagado responde "ya_pagado"
--   (sin error y sin duplicar) → protege del doble clic / doble toque.
--   Los pagos personales también quedan registrados, con ámbito personal.
create or replace function pagar_cuota(p_cheque_id uuid, p_fecha date default null, p_origen text default 'web')
returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_monto numeric; v_deuda uuid; v_benef text; v_medio text; v_numero text; v_cat text; v_amb text;
  v_prov text; v_conc text; v_dcat text; v_damb text; v_anulada boolean;
  v_estado text;
  v_mov uuid;
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar pagos.';
  end if;

  -- solo si sigue pendiente (dos clics a la vez: el segundo espera y no encuentra nada)
  update cheques
     set estado = 'pagado', fecha_pago = v_fecha
   where id = p_cheque_id and tipo = 'por_pagar' and estado = 'pendiente'
  returning monto, cuenta_por_pagar_id, beneficiario, medio, numero, categoria, ambito
       into v_monto, v_deuda, v_benef, v_medio, v_numero, v_cat, v_amb;

  if not found then
    select estado into v_estado from cheques where id = p_cheque_id;
    if not found then
      raise exception 'No existe ese pago.';
    end if;
    if v_estado in ('pagado', 'cobrado') then
      return jsonb_build_object('resultado', 'ya_pagado',
        'movimiento_id', (select id from movimientos where cheque_id = p_cheque_id));
    end if;
    raise exception 'Este pago está "%" y no se puede marcar como pagado así.', v_estado;
  end if;

  select proveedor, concepto, categoria, ambito, anulada
    into v_prov, v_conc, v_dcat, v_damb, v_anulada
    from cuentas_por_pagar where id = v_deuda;
  if v_anulada then
    raise exception 'La deuda de este pago está anulada.';
  end if;

  insert into movimientos (tipo, monto, concepto, categoria, ambito, fecha, origen, cheque_id, cuenta_por_pagar_id)
  values (
    'gasto', v_monto,
    coalesce(v_prov, v_benef, '')
      || case when coalesce(v_conc, '') <> '' then ' — ' || v_conc else '' end
      || ' · ' || v_medio
      || case when coalesce(v_numero, '') <> '' then ' #' || v_numero else '' end,
    coalesce(v_dcat, v_cat, 'otros'),
    coalesce(v_damb, v_amb, 'empresa'),
    v_fecha, coalesce(p_origen, 'web'), p_cheque_id, v_deuda
  )
  returning id into v_mov;

  return jsonb_build_object('resultado', 'pagado', 'movimiento_id', v_mov);
end
$$;

-- 10.3) Abonar a una deuda SIN pagos programados (flexibles, sueldo,
--   deudas anteriores informativas). Crea el pago ya pagado y su gasto.
--   p_id_operacion lo genera la pantalla/bot al abrir el formulario: si
--   llega dos veces, la segunda responde "ya_registrado".
--   El abono no puede pasar de lo que queda sin programar.
--   (Si la deuda es de tipo sueldo/préstamo/familia/tarjeta, el gasto NO
--   cuenta para rentabilidad: lo decide la vista v_movimientos.)
create or replace function abonar_deuda(
  p_deuda_id uuid,
  p_monto numeric,
  p_id_operacion uuid,
  p_fecha date default null,
  p_medio text default 'efectivo',
  p_cuenta_origen_id uuid default null,
  p_origen text default 'web',
  p_notas text default ''
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date := coalesce(p_fecha, fn_hoy_ecuador());
  v_monto numeric; v_prov text; v_conc text; v_cat text; v_amb text; v_anulada boolean;
  v_comprometido numeric;
  v_nuevo uuid;
  v_mov uuid;
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para registrar pagos.';
  end if;
  if p_id_operacion is null then
    raise exception 'Falta el identificador de la operación (protege contra duplicados).';
  end if;
  if exists (select 1 from cheques where id = p_id_operacion) then
    return jsonb_build_object('resultado', 'ya_registrado',
      'movimiento_id', (select id from movimientos where cheque_id = p_id_operacion));
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El abono debe ser mayor a 0.';
  end if;

  -- bloquea la deuda: dos abonos a la vez se hacen uno detrás del otro
  select monto, proveedor, concepto, categoria, ambito, anulada
    into v_monto, v_prov, v_conc, v_cat, v_amb, v_anulada
    from cuentas_por_pagar where id = p_deuda_id
    for update;
  if not found then
    raise exception 'No existe esa deuda.';
  end if;
  if v_anulada then
    raise exception 'La deuda está anulada.';
  end if;

  select coalesce(sum(monto), 0) into v_comprometido
    from cheques where cuenta_por_pagar_id = p_deuda_id and estado <> 'anulado';
  if p_monto > v_monto - v_comprometido then
    raise exception 'El abono (%) es mayor a lo que queda sin programar en esta deuda (%).',
      p_monto, v_monto - v_comprometido;
  end if;

  insert into cheques (
    id, tipo, medio, monto, beneficiario, fecha_cobro, estado, fecha_pago,
    cuenta_por_pagar_id, cuenta_origen_id, notas
  ) values (
    p_id_operacion, 'por_pagar', coalesce(nullif(p_medio, ''), 'efectivo'), p_monto, v_prov,
    v_fecha, 'pagado', v_fecha, p_deuda_id, p_cuenta_origen_id,
    coalesce(nullif(p_notas, ''), 'abono')
  )
  on conflict (id) do nothing
  returning id into v_nuevo;

  if v_nuevo is null then
    -- otra llamada con la misma operación ganó la carrera
    return jsonb_build_object('resultado', 'ya_registrado',
      'movimiento_id', (select id from movimientos where cheque_id = p_id_operacion));
  end if;

  insert into movimientos (tipo, monto, concepto, categoria, ambito, fecha, origen, cheque_id, cuenta_por_pagar_id)
  values (
    'gasto', p_monto,
    v_prov || case when coalesce(v_conc, '') <> '' then ' — ' || v_conc else '' end || ' · abono',
    v_cat, v_amb, v_fecha, coalesce(p_origen, 'web'), p_id_operacion, p_deuda_id
  )
  returning id into v_mov;

  return jsonb_build_object('resultado', 'abonado', 'movimiento_id', v_mov);
end
$$;

-- 10.4) Reprogramar un cheque/cuota pendiente o rebotado.
--   p_tipo: 'acordada' (con el proveedor) o 'cambiado_devuelto'.
--   La fecha original se conserva y el cambio queda en el historial.
--   Un cheque rebotado que se reprograma vuelve a "pendiente" (resuelto).
create or replace function reprogramar_cheque(
  p_cheque_id uuid,
  p_nueva_fecha date,
  p_tipo text,
  p_nota text default '',
  p_nuevo_numero text default null
) returns jsonb
language plpgsql set search_path = public as
$$
declare
  v_fecha date; v_numero text; v_estado text;
begin
  if not (fn_es_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception using errcode = '42501', message = 'Sin permiso para reprogramar pagos.';
  end if;
  if p_tipo is null or p_tipo not in ('acordada', 'cambiado_devuelto') then
    raise exception 'Indica si la reprogramación fue "acordada" o "cambiado_devuelto".';
  end if;
  if p_nueva_fecha is null then
    raise exception 'Falta la fecha nueva.';
  end if;

  select fecha_cobro, numero, estado into v_fecha, v_numero, v_estado
    from cheques where id = p_cheque_id for update;
  if not found then
    raise exception 'No existe ese pago.';
  end if;
  if v_estado not in ('pendiente', 'rebotado') then
    raise exception 'Solo se reprograma un pago pendiente o rebotado (este está "%").', v_estado;
  end if;
  if v_fecha is not distinct from p_nueva_fecha
     and (nullif(p_nuevo_numero, '') is null or nullif(p_nuevo_numero, '') = v_numero) then
    raise exception 'La fecha nueva es igual a la actual: no hay nada que reprogramar.';
  end if;

  -- el trigger lee estos dos valores para el historial
  perform set_config('fin.reprog_tipo', p_tipo, true);
  perform set_config('fin.reprog_nota', coalesce(p_nota, ''), true);

  update cheques
     set fecha_cobro = p_nueva_fecha,
         numero = coalesce(nullif(p_nuevo_numero, ''), numero),
         estado = case when estado = 'rebotado' then 'pendiente' else estado end,
         alertado_hasta = null           -- la fecha nueva puede volver a avisarse
   where id = p_cheque_id;

  perform set_config('fin.reprog_tipo', '', true);
  perform set_config('fin.reprog_nota', '', true);

  return jsonb_build_object('resultado', 'reprogramado', 'fecha_anterior', v_fecha, 'fecha_nueva', p_nueva_fecha);
end
$$;


-- ============================================================
-- 11) Vistas (calculan; nada de esto se guarda).
--     Todas con security_invoker: respetan las reglas de admin.
-- ============================================================

-- 11.1) Deudas con saldos calculados
create or replace view v_deudas with (security_invoker = true) as
select
  d.id, d.created_at, d.proveedor, d.concepto, d.tipo_deuda, d.exigibilidad, d.fecha_estimada,
  d.ambito, d.categoria, d.monto, d.monto_original, d.cuota_mensual, d.saldo_al,
  d.es_saldo_inicial, d.anulada, d.documento_tipo, d.documento_numero,
  d.fecha_factura as fecha_documento, d.notas,
  coalesce(s.pagado, 0)    as total_pagado,
  coalesce(s.pendiente, 0) as total_pendiente,   -- programado y por pagar (va al calendario)
  coalesce(s.rebotado, 0)  as total_rebotado,    -- sección roja; NO va al calendario
  d.monto - coalesce(s.pagado, 0) as saldo,
  d.monto - coalesce(s.pagado, 0) - coalesce(s.pendiente, 0) - coalesce(s.rebotado, 0) as sin_programar, -- "Deudas sin fecha"
  coalesce(s.cuotas_pendientes, 0) as cuotas_pendientes,
  s.proxima_fecha,
  case
    when d.anulada then 'anulada'
    when d.monto - coalesce(s.pagado, 0) <= 0 then 'pagada'
    else 'pendiente'
  end as estado_calculado
from cuentas_por_pagar d
left join lateral (
  select
    sum(c.monto) filter (where c.estado in ('pagado', 'cobrado')) as pagado,
    sum(c.monto) filter (where c.estado = 'pendiente')            as pendiente,
    sum(c.monto) filter (where c.estado = 'rebotado')             as rebotado,
    count(*)     filter (where c.estado = 'pendiente')            as cuotas_pendientes,
    min(c.fecha_cobro) filter (where c.estado = 'pendiente')      as proxima_fecha
  from cheques c
  where c.cuenta_por_pagar_id = d.id
) s on true;

-- 11.2) Cheques/cuotas con su deuda, categoría y ámbito efectivos
create or replace view v_cheques with (security_invoker = true) as
select
  c.id, c.created_at, c.tipo, c.medio, c.monto, c.beneficiario, c.banco, c.numero,
  c.cuenta_origen_id, cd.nombre as cuenta_origen,
  c.fecha_emision, c.fecha_original, c.fecha_cobro, c.fecha_reprogramada,
  (c.fecha_reprogramada is not null) as reprogramado,
  c.tipo_reprogramacion, c.nota_reprogramacion,
  (select count(*) from cheques_reprogramaciones r where r.cheque_id = c.id) as veces_reprogramado,
  c.estado, c.fecha_pago, c.cuenta_por_pagar_id,
  d.proveedor as deuda_proveedor, d.concepto as deuda_concepto, d.exigibilidad as deuda_exigibilidad,
  coalesce(d.categoria, c.categoria, 'otros') as categoria_efectiva,
  coalesce(d.ambito, c.ambito, 'empresa')     as ambito_efectivo,
  c.fecha_cobro - fn_hoy_ecuador()            as dias_para_fecha,
  c.alertado_hasta, c.foto_path, c.notas
from cheques c
left join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
left join cuentas_dinero cd   on cd.id = c.cuenta_origen_id;

-- 11.3) Movimientos con la marca "cuenta para rentabilidad".
--   Cuenta solo si: es gasto, de ámbito empresa, y no viene de una deuda
--   anterior a octubre ni de una deuda de tipo préstamo, tarjeta,
--   familia o sueldo (esos pagos cancelan algo; no son gasto nuevo).
create or replace view v_movimientos with (security_invoker = true) as
select
  m.id, m.created_at, m.fecha, m.tipo, m.monto, m.concepto, m.categoria, m.ambito, m.origen,
  m.cheque_id, m.cuenta_por_pagar_id,
  d.tipo_deuda,
  coalesce(d.es_saldo_inicial, false) as de_deuda_anterior,
  (
    m.tipo = 'gasto'
    and m.ambito = 'empresa'
    and (d.id is null or (not d.es_saldo_inicial and d.tipo_deuda in ('proveedor', 'otra')))
  ) as cuenta_en_rentabilidad
from movimientos m
left join cuentas_por_pagar d on d.id = m.cuenta_por_pagar_id;

-- 11.4) Última foto de saldo por cuenta, con antigüedad y aviso
--   (7 días o más = ámbar, 15 o más = rojo)
create or replace view v_caja_actual with (security_invoker = true) as
select distinct on (s.cuenta_id)
  s.cuenta_id, cd.nombre as cuenta, cd.tipo, cd.banco, cd.ambito,
  s.fecha, s.monto, s.notas,
  fn_hoy_ecuador() - s.fecha as dias_antiguedad,
  case
    when fn_hoy_ecuador() - s.fecha >= 15 then 'rojo'
    when fn_hoy_ecuador() - s.fecha >= 7  then 'ambar'
    else 'ok'
  end as aviso
from saldos_caja s
join cuentas_dinero cd on cd.id = s.cuenta_id
where cd.activa
order by s.cuenta_id, s.fecha desc, s.created_at desc;


-- ============================================================
-- 12) Seguridad
-- ============================================================

-- 12.1) RLS en las tablas nuevas, con la misma regla de admin que las demás
alter table cuentas_dinero           enable row level security;
alter table saldos_caja              enable row level security;
alter table cheques_reprogramaciones enable row level security;

drop policy if exists "admin_all_cuentas_dinero" on cuentas_dinero;
create policy "admin_all_cuentas_dinero" on cuentas_dinero
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

drop policy if exists "admin_all_saldos_caja" on saldos_caja;
create policy "admin_all_saldos_caja" on saldos_caja
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- El historial solo se LEE desde la app; lo escribe la base sola.
drop policy if exists "admin_all_cheques_reprogramaciones" on cheques_reprogramaciones;
drop policy if exists "admin_lee_cheques_reprogramaciones" on cheques_reprogramaciones;
create policy "admin_lee_cheques_reprogramaciones" on cheques_reprogramaciones
  for select to authenticated using (fn_es_admin());

-- 12.2) Permisos de tablas y vistas nuevas: nada para anon
revoke all on table cuentas_dinero, saldos_caja, cheques_reprogramaciones from anon;
grant select, insert, update, delete on table cuentas_dinero, saldos_caja to authenticated;
revoke insert, update, delete on table cheques_reprogramaciones from authenticated;
grant select on table cheques_reprogramaciones to authenticated;
grant all on table cuentas_dinero, saldos_caja, cheques_reprogramaciones to service_role;

revoke all on table v_deudas, v_cheques, v_movimientos, v_caja_actual from anon;
grant select on table v_deudas, v_cheques, v_movimientos, v_caja_actual to authenticated, service_role;

-- 12.3) Funciones: sin permiso para anon ni para "todos" (public)
revoke all on function fn_hoy_ecuador() from public, anon;
grant execute on function fn_hoy_ecuador() to authenticated, service_role;

revoke all on function crear_deuda(jsonb, jsonb) from public, anon;
grant execute on function crear_deuda(jsonb, jsonb) to authenticated, service_role;

revoke all on function pagar_cuota(uuid, date, text) from public, anon;
grant execute on function pagar_cuota(uuid, date, text) to authenticated, service_role;

revoke all on function abonar_deuda(uuid, numeric, uuid, date, text, uuid, text, text) from public, anon;
grant execute on function abonar_deuda(uuid, numeric, uuid, date, text, uuid, text, text) to authenticated, service_role;

revoke all on function reprogramar_cheque(uuid, date, text, text, text) from public, anon;
grant execute on function reprogramar_cheque(uuid, date, text, text, text) to authenticated, service_role;

-- funciones internas (las usan solo los triggers): nadie las llama directo
revoke all on function fn_validar_cuotas_deuda(uuid) from public, anon, authenticated;
revoke all on function fn_trg_validar_cuotas()      from public, anon, authenticated;
revoke all on function fn_trg_cheques_fechas()      from public, anon, authenticated;

end
$ampliar$;


-- ============================================================
-- RESUMEN EN ESPAÑOL SIMPLE
-- ============================================================
--
-- QUÉ CREA
--  • Fecha de Ecuador: la función fn_hoy_ecuador() y las fechas por
--    defecto de movimientos, deudas y cuentas por cobrar pasan a hora de
--    Ecuador (antes, después de las 19:00 quedaba la fecha de mañana).
--  • cuentas_dinero: tus bancos y el efectivo (para saber de qué cuenta
--    sale cada cheque y para las fotos de saldo).
--  • saldos_caja: "foto" del saldo de cada cuenta con su fecha. La vista
--    v_caja_actual muestra la última y avisa: 7 días ámbar, 15 rojo.
--  • Deudas (cuentas_por_pagar), datos nuevos: tipo de deuda (proveedor,
--    préstamo, tarjeta, familia, sueldo, otra), firme o flexible, fecha
--    estimada (solo flexibles), "viene de antes de octubre", monto
--    original, cuota mensual, saldo al (fecha), tipo y número de
--    documento (opcionales) y "anulada". La fecha del documento ya no es
--    obligatoria.
--  • Categoría "sueldos" aceptada (convive con "personal" por ahora).
--  • Cheques = todos los pagos programados: medio (cheque, transferencia,
--    efectivo), estado "pagado", fecha de pago, cuenta de origen,
--    categoría/ámbito para pagos sueltos, fecha original, fecha
--    reprogramada, tipo y nota de reprogramación.
--  • cheques_reprogramaciones: historial de cada cambio de fecha o de
--    número. Lo llena la base sola; la app solo lo lee; la fecha
--    original nunca se pisa.
--  • Movimientos: ámbito (empresa/personal) y de qué pago y deuda salió
--    cada gasto. Un pago solo puede generar UN gasto.
--  • Regla en la base: los pagos de una deuda nunca pasan del total, y
--    en una deuda firme con pagos pendientes deben sumar exacto.
--  • No se puede borrar una deuda que tiene pagos, ni un pago que ya
--    generó un gasto o tiene historial: se anulan.
--  • Funciones "todo o nada": crear_deuda, pagar_cuota, abonar_deuda
--    (sirve para los retiros de sueldo de Mateo sin contarlos como gasto
--    nuevo) y reprogramar_cheque. Todas aguantan el doble clic.
--  • Vistas que calculan (no guardan): v_deudas (pagado, pendiente,
--    rebotado, saldo, sin programar), v_cheques, v_movimientos (marca
--    "cuenta para rentabilidad") y v_caja_actual.
--  • Seguridad: reglas de admin en las tablas nuevas, vistas con
--    security_invoker, y ni anon ni "todos" pueden usar las funciones
--    ni ver las vistas.
--
-- QUÉ NO CAMBIA
--  • No borra ni renombra ninguna tabla ni columna, ni toca datos (las
--    tablas de finanzas están vacías; solo copiaría la fecha original si
--    hubiera cheques).
--  • Las columnas viejas de deudas siguen ahí (fecha_vencimiento,
--    tipo_pago, estado, fecha_pago): el código publicado las sigue
--    usando. Se quitan en SQL-2, después de publicar el código nuevo.
--  • "personal" como categoría y "cobrado" en cheques por pagar se siguen
--    aceptando, para que el código publicado no falle.
--  • cuentas_por_cobrar: solo cambia su fecha por defecto. Nada de VATEX
--    ni de ingresos (eso es la fase 5).
--  • No toca tablas de otras áreas (ventas, producción, costos,
--    logística, roles) ni bot_pending_actions ni telegram_updates.
--  • No cambia las reglas de seguridad de las tablas que ya existían.
--  • No toca código de la app.
--
-- DOS COSAS QUE SÍ SE VUELVEN MÁS ESTRICTAS (compatibles con el código
-- publicado, que no vincula pagos a deudas ni borra deudas):
--  • Borrar una deuda con pagos ahora da error (antes desvinculaba).
--  • La regla de suma exacta queda activa desde ya (el plan la dejaba
--    para SQL-2; adelantarla no rompe nada y protege antes).
