-- Panorama — Bear & Trend · Fase 8v: tono del color y órdenes de estampado
-- Ejecutar DESPUÉS de schema_fase8u_cierre_ferias.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- QUÉ HACE (decisiones del dueño, 2026-10-27)
--
-- · TONO: cada color de un corte es CLARO u OSCURO. Decide con qué film se
--   imprime el estampado: el de prendas claras y el de oscuras nunca comparten
--   metro (la misma regla que dtf_lotes). Se marca con un interruptor junto a
--   cada color en Envío. Vive en prod_corte_colores porque es del color de la
--   tela, no del lote: el lote lo toma por su maquila y su color.
-- · ORDEN DE ESTAMPADO: el dueño junta lotes pendientes —de distintas
--   producciones y destinos— y los manda juntos al taller. Al taller le pasa un
--   resumen por estampado y tono en METROS: unidades de toda la orden ÷
--   estampados por metro (casi siempre 4), redondeado hacia arriba. Juntar
--   importa: 4 hoodies + 4 camisetas del mismo estampado son 2 metros, no 1+1
--   redondeados por separado. Los metros se CALCULAN, no se guardan.
-- ════════════════════════════════════════════════════════════

alter table prod_corte_colores add column if not exists tono text;
alter table prod_corte_colores drop constraint if exists prod_corte_colores_tono_check;
alter table prod_corte_colores add constraint prod_corte_colores_tono_check
  check (tono is null or tono in ('claro', 'oscuro'));

comment on column prod_corte_colores.tono is
  'Fase 8v: claro / oscuro, para el film de estampado. null = sin marcar.';

create table if not exists prod_ordenes_estampado (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default fn_hoy_ecuador(),
  taller_id uuid references prod_talleres (id) on delete set null,
  -- Cuántos estampados entran en un metro de film. Casi siempre 4.
  por_metro integer not null default 4 check (por_metro > 0),
  nota text
);

alter table prod_ordenes_estampado enable row level security;

drop policy if exists "admin_all_prod_ordenes_estampado" on prod_ordenes_estampado;
create policy "admin_all_prod_ordenes_estampado" on prod_ordenes_estampado
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

alter table prod_lotes_estampado add column if not exists orden_id uuid
  references prod_ordenes_estampado (id) on delete set null;

-- ============================================================
-- fn_crear_orden_estampado: junta lotes pendientes y los manda al taller
--
--    Todo o nada: si uno de los lotes ya no está pendiente (otra pestaña lo
--    mandó), no se crea la orden y no se toca ninguno.
-- ============================================================

create or replace function fn_crear_orden_estampado(
  p_lote_ids uuid[],
  p_taller_id uuid,
  p_fecha date,
  p_por_metro integer default 4,
  p_nota text default null
) returns jsonb
language plpgsql as $$
declare
  v_id   uuid := gen_random_uuid();
  v_n    integer;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede crear órdenes de estampado.';
  end if;
  if coalesce(array_length(p_lote_ids, 1), 0) = 0 then
    raise exception 'Elige al menos un lote.';
  end if;
  if coalesce(p_por_metro, 0) <= 0 then
    raise exception 'Los estampados por metro tienen que ser más de 0.';
  end if;
  if p_fecha is null then
    raise exception 'Falta la fecha de envío.';
  end if;

  perform 1 from prod_lotes_estampado where id = any(p_lote_ids) for update;
  v_n := (select count(*) from prod_lotes_estampado where id = any(p_lote_ids));
  if v_n <> (select count(distinct x) from unnest(p_lote_ids) x) then
    raise exception 'Uno de los lotes ya no existe.';
  end if;
  if exists (select 1 from prod_lotes_estampado where id = any(p_lote_ids) and estado <> 'pendiente') then
    raise exception 'Uno de los lotes ya se mandó al taller. Recarga la página.';
  end if;

  insert into prod_ordenes_estampado (id, fecha, taller_id, por_metro, nota)
  values (v_id, p_fecha, p_taller_id, p_por_metro, nullif(btrim(coalesce(p_nota, '')), ''));

  update prod_lotes_estampado
     set estado = 'en_taller', taller_id = p_taller_id, fecha_envio = p_fecha, orden_id = v_id
   where id = any(p_lote_ids);

  return jsonb_build_object('orden_id', v_id, 'lotes', v_n);
end $$;

revoke execute on function fn_crear_orden_estampado(uuid[], uuid, date, integer, text) from anon, public;
grant execute on function fn_crear_orden_estampado(uuid[], uuid, date, integer, text) to authenticated;

do $VERIF8V$
begin
  if (select count(*) from pg_proc where proname = 'fn_crear_orden_estampado') <> 1 then
    raise exception 'Fase 8v: tiene que haber exactamente UNA fn_crear_orden_estampado.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_ordenes_estampado'
                 and policyname = 'admin_all_prod_ordenes_estampado') then
    raise exception 'Fase 8v: falta la política de prod_ordenes_estampado.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'prod_corte_colores' and column_name = 'tono') then
    raise exception 'Fase 8v: falta prod_corte_colores.tono.';
  end if;
  raise notice 'Fase 8v aplicada: tono del color y órdenes de estampado.';
end $VERIF8V$;
