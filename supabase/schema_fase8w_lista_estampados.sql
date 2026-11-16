-- Panorama — Bear & Trend · Fase 8w: lista de estampados y renombrar
-- Ejecutar DESPUÉS de schema_fase8v_ordenes_estampado.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- POR QUÉ (dueño, 2026-10-27)
--
-- La orden de estampado suma metros juntando los estampados por NOMBRE. Con el
-- nombre escrito a mano en cada envío, "Cajas", "cajas " y "Caja" serían tres
-- estampados distintos y los metros saldrían mal. Ahora hay una LISTA de
-- estampados y en Envío se elige de ella. Los lotes ya creados se pueden
-- renombrar al nombre correcto de la lista.
--
-- Los lotes siguen guardando el NOMBRE en su jsonb `disenos` (no un id): el
-- retorno, la ficha visual y el stock lo usan como texto. La lista es la que
-- garantiza que el texto sea siempre el mismo.
-- ════════════════════════════════════════════════════════════

create table if not exists prod_estampados (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null check (btrim(nombre) <> ''),
  archivada_en timestamptz
);

-- Mayúsculas y espacios no hacen un estampado distinto.
create unique index if not exists uq_estampados_nombre on prod_estampados (lower(btrim(nombre)));

alter table prod_estampados enable row level security;

drop policy if exists "admin_all_prod_estampados" on prod_estampados;
create policy "admin_all_prod_estampados" on prod_estampados
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- La lista arranca con los nombres que ya se usaron (el primero que aparece de
-- cada uno, tal como se escribió).
insert into prod_estampados (nombre)
select distinct on (lower(btrim(d.value ->> 'nombre'))) btrim(d.value ->> 'nombre')
from prod_lotes_estampado l, jsonb_array_elements(coalesce(l.disenos, '[]'::jsonb)) d
where btrim(coalesce(d.value ->> 'nombre', '')) <> ''
order by lower(btrim(d.value ->> 'nombre')), l.created_at
on conflict do nothing;

-- ============================================================
-- fn_renombrar_estampado
--
--    Cambia `p_viejo` por `p_nuevo` en los lotes que todavía no volvieron del
--    taller: los de `p_lote_ids`, o TODOS si es null (renombrar en la lista).
--    Los retornados no se tocan: su nombre ya entró al stock y a las salidas.
--    El nombre nuevo queda en la lista; si se renombra en la lista y el nuevo
--    ya existía, los dos se funden en uno.
-- ============================================================

create or replace function fn_renombrar_estampado(
  p_viejo text,
  p_nuevo text,
  p_lote_ids uuid[] default null
) returns jsonb
language plpgsql as $$
declare
  v_viejo text := lower(btrim(coalesce(p_viejo, '')));
  v_nuevo text := btrim(coalesce(p_nuevo, ''));
  v_n     integer;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede renombrar estampados.';
  end if;
  if v_viejo = '' or v_nuevo = '' then
    raise exception 'Falta el nombre del estampado.';
  end if;

  perform 1 from prod_lotes_estampado
   where estado <> 'retornado' and (p_lote_ids is null or id = any(p_lote_ids))
   for update;

  -- Un lote no puede quedar con dos estampados del mismo nombre.
  if lower(v_nuevo) <> v_viejo and exists (
       select 1 from prod_lotes_estampado l
       where l.estado <> 'retornado' and (p_lote_ids is null or l.id = any(p_lote_ids))
         and exists (select 1 from jsonb_array_elements(l.disenos) d where lower(btrim(d.value ->> 'nombre')) = v_viejo)
         and exists (select 1 from jsonb_array_elements(l.disenos) d where lower(btrim(d.value ->> 'nombre')) = lower(v_nuevo))) then
    raise exception 'Un lote ya tiene los dos estampados ("%" y "%"); no se pueden juntar con un cambio de nombre.', btrim(p_viejo), v_nuevo;
  end if;

  v_n := (select count(*) from prod_lotes_estampado l
          where l.estado <> 'retornado' and (p_lote_ids is null or l.id = any(p_lote_ids))
            and exists (select 1 from jsonb_array_elements(l.disenos) d where lower(btrim(d.value ->> 'nombre')) = v_viejo));

  update prod_lotes_estampado l
     set disenos = (select jsonb_agg(case when lower(btrim(d.value ->> 'nombre')) = v_viejo
                                          then jsonb_set(d.value, '{nombre}', to_jsonb(v_nuevo))
                                          else d.value end order by d.ord)
                    from jsonb_array_elements(l.disenos) with ordinality as d(value, ord))
   where l.estado <> 'retornado' and (p_lote_ids is null or l.id = any(p_lote_ids))
     and exists (select 1 from jsonb_array_elements(l.disenos) d where lower(btrim(d.value ->> 'nombre')) = v_viejo);

  -- La lista: renombrar en la lista cambia (o funde) la entrada vieja; desde
  -- un lote solo asegura que el nuevo exista.
  if p_lote_ids is null and exists (select 1 from prod_estampados where lower(btrim(nombre)) = v_viejo) then
    if exists (select 1 from prod_estampados where lower(btrim(nombre)) = lower(v_nuevo))
       and lower(v_nuevo) <> v_viejo then
      delete from prod_estampados where lower(btrim(nombre)) = v_viejo;
    else
      update prod_estampados set nombre = v_nuevo where lower(btrim(nombre)) = v_viejo;
    end if;
  end if;
  insert into prod_estampados (nombre) values (v_nuevo) on conflict do nothing;

  return jsonb_build_object('lotes', v_n);
end $$;

revoke execute on function fn_renombrar_estampado(text, text, uuid[]) from anon, public;
grant execute on function fn_renombrar_estampado(text, text, uuid[]) to authenticated;

do $VERIF8W$
begin
  if (select count(*) from pg_proc where proname = 'fn_renombrar_estampado') <> 1 then
    raise exception 'Fase 8w: tiene que haber exactamente UNA fn_renombrar_estampado.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_estampados'
                 and policyname = 'admin_all_prod_estampados') then
    raise exception 'Fase 8w: falta la política de prod_estampados.';
  end if;
  raise notice 'Fase 8w aplicada: lista de estampados.';
end $VERIF8W$;
