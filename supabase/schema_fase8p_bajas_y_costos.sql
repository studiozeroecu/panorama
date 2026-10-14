-- Panorama — Bear & Trend · Fase 8p: justificar faltantes de maquila, y costo
-- de los insumos (para el costo de producción por corte)
-- Ejecutar DESPUÉS de schema_fase8o_maquila_entregas.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- 1) BAJAS: "con fallas" y "no entregadas"
--
-- Cuando la maquiladora devuelve menos de lo que se le mandó, o devuelve
-- prendas con fallas, el lote no se puede cerrar: siempre "falta algo". Ahora
-- esas unidades se JUSTIFICAN, por talla y con un motivo obligatorio, y cuentan
-- para cerrar el lote — pero (decisiones del dueño, 2026-10-05):
--   · NO van a Envío ni al stock: se dan de baja;
--   · NO se le pagan a la maquila: solo se pagan las entregadas bien.
--
-- Viven en la misma tabla que las entregas (prod_maquila_entregas) con un
-- `tipo`, porque juegan el mismo papel en la cuenta de "qué falta": corte −
-- (entregas + bajas). Separarlas obligaría a sumar dos tablas en cada sitio que
-- calcula lo pendiente, y olvidarse de una dejaría lotes que nunca cierran.
--
-- Una baja nace con procesado = true: no hay nada que procesar en Envío. Así
-- Envío (que lista las no procesadas) nunca la ve, y fn_procesar_entrega_maquila
-- la rechaza sola ("ya fue procesada") sin tocar esa función.
-- ════════════════════════════════════════════════════════════

alter table prod_maquila_entregas add column if not exists tipo text not null default 'entrega';
alter table prod_maquila_entregas add column if not exists motivo text not null default '';

alter table prod_maquila_entregas drop constraint if exists prod_maquila_entregas_tipo_check;
alter table prod_maquila_entregas add constraint prod_maquila_entregas_tipo_check
  check (tipo in ('entrega', 'falla', 'faltante'));

-- Justificar es el punto: una baja sin motivo no explica nada.
alter table prod_maquila_entregas drop constraint if exists prod_maquila_entregas_motivo_check;
alter table prod_maquila_entregas add constraint prod_maquila_entregas_motivo_check
  check (tipo = 'entrega' or btrim(motivo) <> '');

-- Una baja nunca queda "por procesar" (ver arriba).
alter table prod_maquila_entregas drop constraint if exists prod_maquila_entregas_baja_procesada_check;
alter table prod_maquila_entregas add constraint prod_maquila_entregas_baja_procesada_check
  check (tipo = 'entrega' or procesado);

comment on column prod_maquila_entregas.tipo is
  'entrega = llegó bien (va a Envío, se paga) · falla = llegó con fallas · faltante = no se entregó. Las dos últimas se dan de baja y no se pagan.';

-- ── fn_registrar_entrega_maquila gana p_tipo y p_motivo ──
-- ⚠️ DROP + CREATE dentro de un bloque DO, no `create or replace`: añadir
-- parámetros crearía una SOBRECARGA, y la llamada vieja de 4 argumentos seguiría
-- yendo a la versión sin bajas — la trampa de las fases 8b y 8k. Los dos nuevos
-- van al final y con default, así la pantalla actual sigue funcionando igual.
do $MIG8P$
begin
  execute 'drop function if exists fn_registrar_entrega_maquila(uuid, date, jsonb, uuid)';
  execute 'drop function if exists fn_registrar_entrega_maquila(uuid, date, jsonb, uuid, text, text)';

  execute $FN8P$
create function fn_registrar_entrega_maquila(
  p_maquila_color_id uuid,
  p_fecha date,
  p_tallas jsonb,
  p_idem_id uuid default null,
  p_tipo text default 'entrega',
  p_motivo text default null
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
  v_tipo    text := coalesce(p_tipo, 'entrega');
  v_motivo  text := btrim(coalesce(p_motivo, ''));
begin
  if not (fn_es_admin() or fn_es_cortadora()) then
    raise exception 'No tienes permiso para registrar entregas de maquila.';
  end if;
  if v_tipo not in ('entrega', 'falla', 'faltante') then
    raise exception 'Tipo de registro inválido: %', v_tipo;
  end if;

  perform 1 from prod_maquila_colores where id = p_maquila_color_id for update;
  if not found then
    raise exception 'El lote de maquila no existe.';
  end if;

  -- ⚠️ IDEMPOTENCIA ANTES DE VALIDAR (patrón de la 8b).
  if p_idem_id is not null
     and exists (select 1 from prod_maquila_entregas where idempotencia_id = p_idem_id) then
    return jsonb_build_object('ya_registrada', true);
  end if;

  v_estado := (select estado from prod_maquila_colores where id = p_maquila_color_id);
  if v_estado = 'entregado' then
    raise exception 'Este lote ya está cerrado: se entregó o justificó todo.';
  end if;

  if v_tipo <> 'entrega' and v_motivo = '' then
    raise exception 'Escribe el motivo: es lo que justifica las unidades que faltan.';
  end if;
  if p_fecha is null then
    raise exception 'La fecha es requerida.';
  end if;
  if p_fecha > fn_hoy_ecuador() then
    raise exception 'La fecha no puede ser futura.';
  end if;

  v_pend := fn_tallas_pendientes_maquila(p_maquila_color_id);

  for v_t in select key, value from jsonb_each_text(coalesce(p_tallas, '{}'::jsonb)) loop
    if v_t.value !~ '^\d+$' then
      raise exception 'Talla %: la cantidad tiene que ser un número entero.', v_t.key;
    end if;
    v_n := v_t.value::int;
    continue when v_n = 0;
    if v_n > coalesce((v_pend ->> v_t.key)::int, 0) then
      raise exception 'Talla %: solo faltan % por entregar o justificar.',
        v_t.key, coalesce((v_pend ->> v_t.key)::int, 0);
    end if;
    v_limpias := v_limpias || jsonb_build_object(v_t.key, v_n);
    v_total := v_total + v_n;
  end loop;

  if v_total <= 0 then
    raise exception 'Anota al menos una prenda.';
  end if;

  -- Una baja nace procesada: no hay nada que mandar desde Envío.
  insert into prod_maquila_entregas
    (maquila_color_id, fecha, tallas, unidades, idempotencia_id, tipo, motivo, procesado, procesada_en)
  values
    (p_maquila_color_id, p_fecha, v_limpias, v_total, p_idem_id, v_tipo, v_motivo,
     v_tipo <> 'entrega', case when v_tipo <> 'entrega' then now() end)
  on conflict (idempotencia_id) do nothing;

  v_resto := fn_tallas_pendientes_maquila(p_maquila_color_id);

  if v_resto = '{}'::jsonb then
    update prod_maquila_colores
       set estado = 'entregado', fecha_entrega = p_fecha
     where id = p_maquila_color_id;
    -- Si lo que cerró el lote fue una BAJA y las entregas buenas ya salieron por
    -- Envío, nadie más va a marcar el color como procesado: se marca aquí.
    if not exists (select 1 from prod_maquila_entregas
                   where maquila_color_id = p_maquila_color_id and not procesado) then
      update prod_maquila_colores set procesado = true where id = p_maquila_color_id;
    end if;
  elsif v_estado = 'pendiente' then
    update prod_maquila_colores set estado = 'enviado' where id = p_maquila_color_id;
  end if;

  return jsonb_build_object(
    'ya_registrada', false,
    'tipo',          v_tipo,
    'unidades',      v_total,
    'completo',      v_resto = '{}'::jsonb,
    'faltan',        v_resto
  );
end $BODY$;
  $FN8P$;
end $MIG8P$;

revoke all on function fn_registrar_entrega_maquila(uuid, date, jsonb, uuid, text, text) from public, anon;
grant execute on function fn_registrar_entrega_maquila(uuid, date, jsonb, uuid, text, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- 2) COSTO DE LOS INSUMOS
--
-- La cortadora anota qué insumo se usó y cuánto (fase 8j). El COSTO lo pone
-- Mateo desde su pantalla de Corte (decisión del dueño). Es el costo TOTAL de esa
-- línea de insumo, no por unidad: así no hay que adivinar en qué unidad está la
-- cantidad ("200 botones" vs "3.5 metros de elástico").
--
-- null = sin costo todavía. El costo de producción lo avisa en vez de sumar 0.
--
-- La cortadora tiene política de update sobre esta tabla (para corregir lo que
-- anotó); RLS es de fila, así que podría tocar el costo por la API. El trigger
-- conserva el costo para quien no es admin — mismo patrón que la tarifa (8o).
-- ════════════════════════════════════════════════════════════

alter table prod_corte_insumos add column if not exists costo numeric(10,2);
alter table prod_corte_insumos drop constraint if exists prod_corte_insumos_costo_check;
alter table prod_corte_insumos add constraint prod_corte_insumos_costo_check
  check (costo is null or costo >= 0);

comment on column prod_corte_insumos.costo is
  'Costo TOTAL de esta línea de insumo, en $. Lo pone el admin. null = sin costo todavía.';

create or replace function fn_costo_insumo_solo_admin() returns trigger
language plpgsql as $$
begin
  if not fn_es_admin() then
    if tg_op = 'INSERT' then
      new.costo := null;
    else
      new.costo := old.costo;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_costo_insumo_solo_admin on prod_corte_insumos;
create trigger trg_costo_insumo_solo_admin
  before insert or update on prod_corte_insumos
  for each row execute function fn_costo_insumo_solo_admin();

-- ============================================================
-- Verificación final — solo mira, no cambia nada.
-- ============================================================

do $VERIF8P$
begin
  if (select count(*) from pg_proc where proname = 'fn_registrar_entrega_maquila') <> 1 then
    raise exception 'Fase 8p: tiene que haber exactamente UNA fn_registrar_entrega_maquila (sobrevivió la de 4 argumentos).';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'prod_maquila_entregas' and column_name = 'tipo') then
    raise exception 'Fase 8p: falta prod_maquila_entregas.tipo.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'prod_corte_insumos' and column_name = 'costo') then
    raise exception 'Fase 8p: falta prod_corte_insumos.costo.';
  end if;
  raise notice 'Fase 8p aplicada: bajas justificadas y costo de insumos.';
end $VERIF8P$;

-- ============================================================
-- DESHACER:
--   (las bajas registradas se perderían: revisar antes)
--   delete from prod_maquila_entregas where tipo <> 'entrega';
--   alter table prod_maquila_entregas drop column if exists tipo, drop column if exists motivo;
--   drop trigger if exists trg_costo_insumo_solo_admin on prod_corte_insumos;
--   alter table prod_corte_insumos drop column if exists costo;
--   -- y recrear fn_registrar_entrega_maquila de 4 parámetros desde la fase 8o
--   -- (solo esa función; NO reejecutar el archivo entero), tras dropear la de 6.
-- ============================================================
