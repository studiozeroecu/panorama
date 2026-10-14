-- Panorama — Bear & Trend · Fase 8o: entregas parciales de maquila, horas por
-- corte con tarifa congelada, e indicación de destino de la tela
-- Ejecutar DESPUÉS de schema_fase8n_cortadora_crea_maquiladora.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ⚠️ APLICAR Y DESPLEGAR JUNTOS. Esta fase BORRA fn_procesar_lote_maquila y la
-- sustituye por fn_procesar_entrega_maquila. Entre aplicar esto y desplegar el
-- código, Envío fallaría con "function does not exist" (sin dañar datos: no
-- procesa nada). Ver la lección de la fase 7 en CLAUDE.md.
--
-- ════════════════════════════════════════════════════════════
-- 1) ENTREGAS PARCIALES — el cambio de fondo
--
-- Hasta ahora un color en maquila estaba "pendiente", "enviado" o "entregado",
-- y Envío procesaba EL LOTE ENTERO del color de una vez. Pero la maquiladora no
-- siempre entrega todo junto, y lo que ya llegó se quiere poder mandar a
-- locales o a estampado sin esperar el resto.
--
-- Por eso la unidad que procesa Envío pasa a ser LA ENTREGA, no el lote:
--   · prod_maquila_entregas — una fila por entrega, con sus tallas.
--   · Un color pasa a 'entregado' cuando la suma de sus entregas cubre todas las
--     tallas del corte. Mientras tanto sigue 'enviado' (el estado "parcial" no
--     se guarda: se deduce de que tenga entregas y no esté completo).
--   · `procesado` del color pasa a true cuando está entregado Y todas sus
--     entregas se procesaron.
--
-- La regla que lo sostiene todo: la suma de las entregas de un color nunca
-- supera lo cortado de ese color, talla por talla. La valida
-- fn_registrar_entrega_maquila contra fn_tallas_pendientes_maquila.
--
-- MaquilaTab (Mateo) NO cambia: sigue marcando "entregado" directo. Un trigger
-- crea entonces la entrega por lo que faltaba. Así hay un solo camino hacia
-- Envío sin importar quién marque la entrega.
-- ════════════════════════════════════════════════════════════

create table if not exists prod_maquila_entregas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  maquila_color_id uuid not null references prod_maquila_colores (id) on delete cascade,
  fecha date not null default fn_hoy_ecuador(),
  -- {talla: unidades}, solo tallas con unidades > 0. Mapa plano que nada
  -- referencia y que no se edita: el mismo criterio que corrida_base (fase 8j).
  tallas jsonb not null,
  unidades integer not null check (unidades > 0),
  procesado boolean not null default false,
  procesada_en timestamptz,
  idempotencia_id uuid,
  registrado_por uuid references auth.users (id) on delete set null default auth.uid()
);
create index if not exists idx_maquila_entregas_color on prod_maquila_entregas (maquila_color_id);
create unique index if not exists uq_maquila_entregas_idempotencia
  on prod_maquila_entregas (idempotencia_id);

alter table prod_maquila_entregas enable row level security;

drop policy if exists "admin_all_prod_maquila_entregas" on prod_maquila_entregas;
create policy "admin_all_prod_maquila_entregas" on prod_maquila_entregas
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- La cortadora solo LEE. Escribe a través de fn_registrar_entrega_maquila.
drop policy if exists "cortadora_lee_prod_maquila_entregas" on prod_maquila_entregas;
create policy "cortadora_lee_prod_maquila_entregas" on prod_maquila_entregas
  for select to authenticated using (fn_es_cortadora());

-- ── Lo que falta por entregar de un color, por talla ──
-- Corte − Σ entregas. Solo devuelve tallas con algo pendiente; {} = completo.
create or replace function fn_tallas_pendientes_maquila(p_maquila_color_id uuid)
returns jsonb
language sql stable as $$
  select coalesce(
    jsonb_object_agg(t.talla, t.unidades - coalesce(e.entregadas, 0))
      filter (where t.unidades - coalesce(e.entregadas, 0) > 0),
    '{}'::jsonb)
  from prod_maquila_colores mc
  join prod_corte_color_tallas t on t.corte_color_id = mc.corte_color_id
  left join (
    select x.key as talla, sum(x.value::int) as entregadas
    from prod_maquila_entregas en
    cross join lateral jsonb_each_text(en.tallas) as x
    where en.maquila_color_id = p_maquila_color_id
    group by x.key
  ) e on e.talla = t.talla
  where mc.id = p_maquila_color_id
$$;

-- ── Backfill: los colores YA entregados reciben su entrega única ──
-- Sin esto, los lotes entregados y sin procesar desaparecerían de Envío, que
-- ahora lista entregas. Los ya procesados se crean con procesado = true, para
-- que la invariante "entregado ⇒ entregas cubren el corte" valga para todos.
insert into prod_maquila_entregas (maquila_color_id, fecha, tallas, unidades, procesado, procesada_en, registrado_por)
select mc.id,
       coalesce(mc.fecha_entrega, fn_hoy_ecuador()),
       x.tallas,
       x.unidades,
       mc.procesado,
       case when mc.procesado then now() end,
       null
from prod_maquila_colores mc
cross join lateral (
  select coalesce(jsonb_object_agg(t.talla, t.unidades) filter (where t.unidades > 0), '{}'::jsonb) as tallas,
         coalesce(sum(t.unidades) filter (where t.unidades > 0), 0)::int as unidades
  from prod_corte_color_tallas t
  where t.corte_color_id = mc.corte_color_id
) x
where mc.estado = 'entregado'
  and x.unidades > 0
  and not exists (select 1 from prod_maquila_entregas en where en.maquila_color_id = mc.id);

-- ── Trigger: marcar 'entregado' por cualquier camino crea la entrega que falta ──
create or replace function fn_entrega_por_resto() returns trigger
language plpgsql as $$
declare
  v_resto jsonb;
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    v_resto := fn_tallas_pendientes_maquila(new.id);
    if v_resto <> '{}'::jsonb then
      insert into prod_maquila_entregas (maquila_color_id, fecha, tallas, unidades)
      values (new.id, coalesce(new.fecha_entrega, fn_hoy_ecuador()), v_resto,
              (select sum(value::int) from jsonb_each_text(v_resto)));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_entrega_por_resto on prod_maquila_colores;
create trigger trg_entrega_por_resto
  after update of estado on prod_maquila_colores
  for each row execute function fn_entrega_por_resto();

-- ── fn_marcar_enviado_maquila: la cortadora (o Mateo) manda el lote ──
-- SECURITY DEFINER por el mismo motivo que fn_recibir_tela (8l): la cortadora
-- no tiene update sobre prod_maquila_colores, y una política de update le
-- dejaría tocar `procesado`. Aquí solo se escriben estado y fecha_envio.
create or replace function fn_marcar_enviado_maquila(
  p_maquila_color_id uuid,
  p_fecha date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_estado text;
begin
  if not (fn_es_admin() or fn_es_cortadora()) then
    raise exception 'No tienes permiso para mover lotes de maquila.';
  end if;

  perform 1 from prod_maquila_colores where id = p_maquila_color_id for update;
  if not found then
    raise exception 'El lote de maquila no existe.';
  end if;
  v_estado := (select estado from prod_maquila_colores where id = p_maquila_color_id);

  -- Idempotente por estado: ya enviado o entregado → aviso, no error.
  if v_estado <> 'pendiente' then
    return jsonb_build_object('ya_enviado', true, 'estado', v_estado);
  end if;

  if p_fecha is null then
    raise exception 'La fecha de envío es requerida.';
  end if;
  if p_fecha > fn_hoy_ecuador() then
    raise exception 'La fecha de envío no puede ser futura.';
  end if;

  update prod_maquila_colores
     set estado = 'enviado', fecha_envio = p_fecha
   where id = p_maquila_color_id;

  return jsonb_build_object('ya_enviado', false, 'estado', 'enviado');
end $BODY$;

-- ── fn_registrar_entrega_maquila: completa o parcial, por talla ──
create or replace function fn_registrar_entrega_maquila(
  p_maquila_color_id uuid,
  p_fecha date,
  p_tallas jsonb,
  p_idem_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_estado  text;
  v_pend    jsonb;
  v_resto   jsonb;
  v_limpias jsonb := '{}'::jsonb;
  v_total   integer := 0;
  v_n       integer;
  v_t       record;
begin
  if not (fn_es_admin() or fn_es_cortadora()) then
    raise exception 'No tienes permiso para registrar entregas de maquila.';
  end if;

  -- Lock del color: dos entregas simultáneas se serializan y la segunda valida
  -- contra lo que dejó la primera.
  perform 1 from prod_maquila_colores where id = p_maquila_color_id for update;
  if not found then
    raise exception 'El lote de maquila no existe.';
  end if;

  -- ⚠️ IDEMPOTENCIA ANTES DE VALIDAR (patrón de la 8b): un reintento no debe
  -- chocar con un "solo faltan N" que provocó su propia primera llamada.
  if p_idem_id is not null
     and exists (select 1 from prod_maquila_entregas where idempotencia_id = p_idem_id) then
    return jsonb_build_object('ya_registrada', true);
  end if;

  v_estado := (select estado from prod_maquila_colores where id = p_maquila_color_id);
  if v_estado = 'entregado' then
    raise exception 'Este lote ya se entregó completo.';
  end if;

  if p_fecha is null then
    raise exception 'La fecha de entrega es requerida.';
  end if;
  if p_fecha > fn_hoy_ecuador() then
    raise exception 'La fecha de entrega no puede ser futura.';
  end if;

  v_pend := fn_tallas_pendientes_maquila(p_maquila_color_id);

  for v_t in select key, value from jsonb_each_text(coalesce(p_tallas, '{}'::jsonb)) loop
    if v_t.value !~ '^\d+$' then
      raise exception 'Talla %: la cantidad tiene que ser un número entero.', v_t.key;
    end if;
    v_n := v_t.value::int;
    continue when v_n = 0;
    if v_n > coalesce((v_pend ->> v_t.key)::int, 0) then
      raise exception 'Talla %: solo faltan % por entregar.',
        v_t.key, coalesce((v_pend ->> v_t.key)::int, 0);
    end if;
    v_limpias := v_limpias || jsonb_build_object(v_t.key, v_n);
    v_total := v_total + v_n;
  end loop;

  if v_total <= 0 then
    raise exception 'Anota al menos una prenda entregada.';
  end if;

  insert into prod_maquila_entregas (maquila_color_id, fecha, tallas, unidades, idempotencia_id)
  values (p_maquila_color_id, p_fecha, v_limpias, v_total, p_idem_id)
  on conflict (idempotencia_id) do nothing;

  v_resto := fn_tallas_pendientes_maquila(p_maquila_color_id);

  if v_resto = '{}'::jsonb then
    -- Completo. El trigger trg_entrega_por_resto ve el resto vacío y no hace nada.
    update prod_maquila_colores
       set estado = 'entregado', fecha_entrega = p_fecha
     where id = p_maquila_color_id;
  elsif v_estado = 'pendiente' then
    -- Llegó algo sin haberse marcado como enviado: evidentemente se envió.
    update prod_maquila_colores set estado = 'enviado' where id = p_maquila_color_id;
  end if;

  return jsonb_build_object(
    'ya_registrada', false,
    'unidades',      v_total,
    'completo',      v_resto = '{}'::jsonb,
    'faltan',        v_resto
  );
end $BODY$;

-- ── fn_procesar_entrega_maquila: Envío procesa UNA entrega ──
-- Es fn_procesar_lote_maquila (fase 7) con un solo cambio de fondo: las tallas
-- y unidades salen de la ENTREGA, no del corte entero. Las reglas de los tres
-- destinos son las mismas. Reescrita sin asignaciones de destino (ver cabecera).
-- SECURITY INVOKER y solo admin, como la original.
create or replace function fn_procesar_entrega_maquila(
  p_entrega_id uuid,
  p_destino text,                        -- 'online' | 'estampado' | 'local'
  p_disenos jsonb default '[]'::jsonb,   -- estampado: [{"nombre":"Logo","unidades":20}]
  p_costo_estampado numeric default 0,
  p_tallas_local jsonb default '{}'::jsonb,  -- local: {"S":3,"M":2}
  p_local_destino text default null,
  p_producto_codigo text default null,
  p_precio_local numeric default 0,
  p_costo_unitario numeric default 0
) returns jsonb
language plpgsql as $$
declare
  v_mc_id         uuid;
  v_maquila_id    uuid;
  v_color         text;
  v_tallas        jsonb;
  v_unidades      integer;
  v_prenda_id     uuid;
  v_prenda_nombre text;
  v_total         integer := 0;
  v_repartidas    jsonb := '{}'::jsonb;
  v_disenos       jsonb;
  v_t             record;
  v_resto         integer;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede procesar lotes.';
  end if;
  if p_destino not in ('online', 'estampado', 'local') then
    raise exception 'Destino inválido: %', p_destino;
  end if;

  -- lock + guarda de idempotencia, ahora sobre la ENTREGA
  perform 1 from prod_maquila_entregas where id = p_entrega_id for update;
  if not found then
    raise exception 'La entrega no existe.';
  end if;
  if (select procesado from prod_maquila_entregas where id = p_entrega_id) then
    raise exception 'Esta entrega ya fue procesada.';
  end if;

  v_mc_id    := (select maquila_color_id from prod_maquila_entregas where id = p_entrega_id);
  v_tallas   := (select tallas           from prod_maquila_entregas where id = p_entrega_id);
  v_unidades := (select unidades         from prod_maquila_entregas where id = p_entrega_id);
  v_maquila_id := (select maquila_id from prod_maquila_colores where id = v_mc_id);
  v_color := (select cc.color
              from prod_maquila_colores mc
              join prod_corte_colores cc on cc.id = mc.corte_color_id
              where mc.id = v_mc_id);
  v_prenda_id := (select pt.prenda_id
                  from prod_maquilas m
                  join prod_cortes k on k.id = m.corte_id
                  join prod_pedidos_tela pt on pt.id = k.pedido_id
                  where m.id = v_maquila_id);
  v_prenda_nombre := coalesce((select nombre from prod_prendas where id = v_prenda_id), '');

  -- ── destino: todo al stock online ──────────────────────────
  if p_destino = 'online' then
    for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_tallas) loop
      perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_color, '', v_t.talla, v_t.unidades);
      v_total := v_total + v_t.unidades;
    end loop;

  -- ── destino: a estampado ───────────────────────────────────
  elsif p_destino = 'estampado' then
    v_disenos := (
      select coalesce(jsonb_agg(jsonb_build_object(
               'nombre',   btrim(d.value ->> 'nombre'),
               'unidades', (d.value ->> 'unidades')::int) order by d.ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_disenos, '[]'::jsonb)) with ordinality as d(value, ord)
      where btrim(coalesce(d.value ->> 'nombre', '')) <> ''
        and coalesce((d.value ->> 'unidades')::int, 0) > 0);
    v_total := (
      select coalesce(sum((d.value ->> 'unidades')::int), 0)
      from jsonb_array_elements(coalesce(p_disenos, '[]'::jsonb)) as d(value)
      where btrim(coalesce(d.value ->> 'nombre', '')) <> ''
        and coalesce((d.value ->> 'unidades')::int, 0) > 0);

    if v_total <= 0 then
      raise exception 'Agrega al menos un diseño con nombre y unidades.';
    end if;
    if v_total > v_unidades then
      raise exception 'Las unidades a estampar (%) superan las de la entrega (%).', v_total, v_unidades;
    end if;
    if coalesce(p_costo_estampado, 0) < 0 then
      raise exception 'Costo de estampado inválido.';
    end if;

    v_repartidas := fn_repartir_por_talla(v_tallas, v_total);

    insert into prod_lotes_estampado (maquila_id, prenda_id, prenda_nombre, color, tallas,
                                      total_unidades, disenos, costo_unitario, costo_total, estado)
    values (v_maquila_id, v_prenda_id, v_prenda_nombre, v_color, v_repartidas,
            v_total, v_disenos, coalesce(p_costo_estampado, 0),
            round(v_total * coalesce(p_costo_estampado, 0), 2), 'pendiente');

    -- lo que no se estampa entra al stock online sin etiqueta
    for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_tallas) loop
      v_resto := v_t.unidades - coalesce((v_repartidas ->> v_t.talla)::int, 0);
      perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_color, '', v_t.talla, v_resto);
    end loop;

  -- ── destino: a locales ─────────────────────────────────────
  else
    for v_t in select key as talla, value::int as unidades
               from jsonb_each_text(coalesce(p_tallas_local, '{}'::jsonb)) loop
      if v_t.unidades < 0 then
        raise exception 'Talla %: la cantidad no puede ser negativa.', v_t.talla;
      end if;
      if v_t.unidades > coalesce((v_tallas ->> v_t.talla)::int, 0) then
        raise exception 'Talla %: solo hay % unidades en la entrega.',
          v_t.talla, coalesce((v_tallas ->> v_t.talla)::int, 0);
      end if;
      v_total := v_total + v_t.unidades;
    end loop;

    if v_total <= 0 then
      raise exception 'Ingresa unidades a enviar.';
    end if;

    insert into prod_envios_locales (fecha, maquila_id, prenda_id, prenda_nombre, color, tallas,
                                     unidades, precio_unitario, costo_unitario, ingreso, margen,
                                     producto_codigo, local_destino)
    values (fn_hoy_ecuador(), v_maquila_id, v_prenda_id, v_prenda_nombre, v_color,
            (select coalesce(jsonb_object_agg(key, value::int), '{}'::jsonb)
             from jsonb_each_text(coalesce(p_tallas_local, '{}'::jsonb))
             where value::int > 0),
            v_total, coalesce(p_precio_local, 0), coalesce(p_costo_unitario, 0),
            round(v_total * coalesce(p_precio_local, 0), 2),
            round(v_total * (coalesce(p_precio_local, 0) - coalesce(p_costo_unitario, 0)), 2),
            nullif(btrim(coalesce(p_producto_codigo, '')), ''),
            nullif(btrim(coalesce(p_local_destino, '')), ''));

    -- el resto de la entrega entra al stock online
    for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_tallas) loop
      v_resto := v_t.unidades - coalesce((p_tallas_local ->> v_t.talla)::int, 0);
      perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_color, '', v_t.talla, v_resto);
    end loop;
  end if;

  update prod_maquila_entregas
     set procesado = true, procesada_en = now()
   where id = p_entrega_id;

  -- El COLOR queda procesado cuando está entregado completo y no le queda
  -- ninguna entrega sin procesar. trg_sync_maquila_colores (7b) espeja
  -- `procesado` al jsonb de respaldo.
  if (select estado from prod_maquila_colores where id = v_mc_id) = 'entregado'
     and not exists (select 1 from prod_maquila_entregas
                     where maquila_color_id = v_mc_id and not procesado) then
    update prod_maquila_colores set procesado = true where id = v_mc_id;
  end if;

  return jsonb_build_object(
    'destino',  p_destino,
    'unidades', v_total,
    'resto',    greatest(v_unidades - v_total, 0)
  );
end $$;

-- ⚠️ La vieja procesaba el LOTE ENTERO: si sobreviviera, Envío podría procesar
-- un color con entregas parciales ya enviadas y duplicar su stock.
drop function if exists fn_procesar_lote_maquila(uuid, text, jsonb, numeric, jsonb, text, text, numeric, numeric);

revoke all on function fn_marcar_enviado_maquila(uuid, date) from public, anon;
grant execute on function fn_marcar_enviado_maquila(uuid, date) to authenticated, service_role;
revoke all on function fn_registrar_entrega_maquila(uuid, date, jsonb, uuid) from public, anon;
grant execute on function fn_registrar_entrega_maquila(uuid, date, jsonb, uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- 2) HORAS POR CORTE — tarifa CONGELADA
--
-- Las horas siguen viviendo en prod_jornadas (fase 8j); ahora la cortadora las
-- anota al registrar cada corte, que crea una jornada enlazada a ese corte.
--
-- La tarifa se FOTOGRAFÍA en cada jornada (pieza 5 del plan): si se leyera viva,
-- subirla reescribiría el costo de todos los cortes anteriores — el mismo
-- defecto que el pendiente "costos fijos no se congelan por mes".
--
-- Y la cortadora NO puede ponerse la tarifa: RLS es de fila, así que con su
-- política de insert podría mandar cualquier valor. El trigger la sobreescribe
-- con fn_tarifa_hora_cortadora() para todo el que no sea admin, y en un update
-- conserva la que había.
--
-- Cambiar la tarifa: `create or replace` de fn_tarifa_hora_cortadora con el
-- valor nuevo. Afecta solo a las jornadas que se registren DESPUÉS.
-- ════════════════════════════════════════════════════════════

create or replace function fn_tarifa_hora_cortadora() returns numeric
language sql immutable as $$ select 4.00::numeric $$;

alter table prod_jornadas add column if not exists tarifa_hora numeric(8,2);

-- El trigger se quita ANTES del backfill: su rama de update conservaría el null
-- para quien no es admin, y quien corre esto en el SQL Editor no lo es.
drop trigger if exists trg_congelar_tarifa_jornada on prod_jornadas;

update prod_jornadas set tarifa_hora = fn_tarifa_hora_cortadora() where tarifa_hora is null;

alter table prod_jornadas alter column tarifa_hora set not null;
alter table prod_jornadas drop constraint if exists prod_jornadas_tarifa_hora_check;
alter table prod_jornadas add constraint prod_jornadas_tarifa_hora_check check (tarifa_hora >= 0);

create or replace function fn_congelar_tarifa_jornada() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not fn_es_admin() or new.tarifa_hora is null then
      new.tarifa_hora := fn_tarifa_hora_cortadora();
    end if;
  elsif not fn_es_admin() then
    new.tarifa_hora := old.tarifa_hora;
  end if;
  return new;
end $$;

create trigger trg_congelar_tarifa_jornada
  before insert or update on prod_jornadas
  for each row execute function fn_congelar_tarifa_jornada();

-- ════════════════════════════════════════════════════════════
-- 3) INDICACIÓN DE DESTINO — solo informativa
--
-- Mateo indica qué hacer con la tela cuando vuelva de maquila: directo a
-- locales o a la bodega de estampados. NO es vinculante y NO cambia nada en
-- Envío, que sigue decidiendo el destino real (la pregunta abierta de la pieza
-- 8 del plan, contestada así por el dueño el 2026-10-05). Es un aviso para la
-- cortadora. null = sin indicación.
-- ════════════════════════════════════════════════════════════

alter table prod_pedidos_tela add column if not exists destino_indicado text;
alter table prod_pedidos_tela drop constraint if exists prod_pedidos_tela_destino_indicado_check;
alter table prod_pedidos_tela add constraint prod_pedidos_tela_destino_indicado_check
  check (destino_indicado is null or destino_indicado in ('locales', 'estampado'));

-- ============================================================
-- Verificación final — solo mira, no cambia nada.
-- ============================================================

do $VERIF8O$
begin
  if exists (select 1 from pg_proc where proname = 'fn_procesar_lote_maquila') then
    raise exception 'Fase 8o: fn_procesar_lote_maquila sigue viva. Envío podría procesar lotes enteros.';
  end if;
  if (select count(*) from pg_proc where proname = 'fn_procesar_entrega_maquila') <> 1 then
    raise exception 'Fase 8o: tiene que haber exactamente una fn_procesar_entrega_maquila.';
  end if;
  if (select count(*) from pg_proc where proname = 'fn_registrar_entrega_maquila') <> 1 then
    raise exception 'Fase 8o: tiene que haber exactamente una fn_registrar_entrega_maquila.';
  end if;
  if exists (select 1 from pg_policies
             where tablename = 'prod_maquila_entregas'
               and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
               and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%fn_es_cortadora%') then
    raise exception 'Fase 8o: la cortadora no debe escribir directo en prod_maquila_entregas.';
  end if;
  if exists (select 1 from prod_jornadas where tarifa_hora is null) then
    raise exception 'Fase 8o: quedaron jornadas sin tarifa.';
  end if;

  raise notice 'Fase 8o aplicada. Colores entregados con entregas que no cubren el corte: % (debe ser 0, salvo cortes migrados sin tallas).',
    (select count(*) from prod_maquila_colores mc
     where mc.estado = 'entregado' and fn_tallas_pendientes_maquila(mc.id) <> '{}'::jsonb);
end $VERIF8O$;

-- ============================================================
-- DESHACER (con cuidado: la vieja procesaba lotes enteros):
--   drop function if exists fn_procesar_entrega_maquila(uuid, text, jsonb, numeric, jsonb, text, text, numeric, numeric);
--   drop function if exists fn_registrar_entrega_maquila(uuid, date, jsonb, uuid);
--   drop function if exists fn_marcar_enviado_maquila(uuid, date);
--   drop trigger if exists trg_entrega_por_resto on prod_maquila_colores;
--   drop trigger if exists trg_congelar_tarifa_jornada on prod_jornadas;
--   drop table if exists prod_maquila_entregas;
--   alter table prod_jornadas drop column if exists tarifa_hora;
--   alter table prod_pedidos_tela drop column if exists destino_indicado;
--   -- y volver a crear fn_procesar_lote_maquila desde schema_fase7_colores.sql
--   -- (solo esa función; NO reejecutar el archivo entero).
-- ============================================================
