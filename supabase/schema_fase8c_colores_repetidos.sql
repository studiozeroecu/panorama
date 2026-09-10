-- Panorama — Bear & Trend · Fase 8c: mensaje propio para colores repetidos
-- Ejecutar DESPUÉS de schema_fase8b_idempotencia.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- ⚠️ REDEFINE fn_sync_pedido_colores. La versión que aparece en
--    schema_fase7_colores.sql queda OBSOLETA: esta es la vigente.
--    (Basta `create or replace`: misma firma, no hace falta drop.)
--
-- Por qué: el INSERT ... ON CONFLICT de abajo no puede tocar la misma fila dos veces.
-- Con "Negro" y "negro" en el mismo pedido, Postgres levanta
--   "ON CONFLICT DO UPDATE command cannot affect row a second time"
-- que PedidosTab mostraba tal cual, sin decir qué colores chocaban ni por qué.
-- El cliente ya valida esto antes de enviar, pero esta defensa cubre al bot, al SQL
-- manual y a cualquier migración futura que no pase por esa pantalla.
--
-- Como el trigger es AFTER INSERT, la excepción aborta la sentencia entera: el
-- pedido tampoco queda insertado a medias.

create or replace function fn_sync_pedido_colores() returns trigger
language plpgsql as $$
declare
  v_repetidos text;
begin
  -- Detecta nombres que colisionan al normalizar, con el MISMO criterio que el
  -- índice único de prod_pedido_colores: lower(btrim(color)).
  select string_agg(x.muestra, ' · ' order by x.muestra) into v_repetidos
  from (
    select string_agg(distinct btrim(c.value ->> 'color'), ' y '
                      order by btrim(c.value ->> 'color')) as muestra
    from jsonb_array_elements(coalesce(new.colores, '[]'::jsonb)) as c(value)
    where btrim(coalesce(c.value ->> 'color', '')) <> ''
    group by lower(btrim(c.value ->> 'color'))
    having count(*) > 1
  ) as x;

  if v_repetidos is not null then
    raise exception
      'El pedido tiene colores repetidos: %. Para el sistema son el mismo color — no distingue mayúsculas ni espacios.',
      v_repetidos;
  end if;

  -- colores que ya no están en el jsonb (los cortes que los usaran quedan en null)
  delete from prod_pedido_colores pc
   where pc.pedido_id = new.id
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(new.colores, '[]'::jsonb)) as c(value)
       where lower(btrim(c.value ->> 'color')) = lower(btrim(pc.color)));

  insert into prod_pedido_colores (pedido_id, color, metros, kilos, orden)
  select new.id,
         btrim(c.value ->> 'color'),
         coalesce((c.value ->> 'metros')::numeric, 0),
         (c.value ->> 'kilos')::numeric,
         c.ord
  from jsonb_array_elements(coalesce(new.colores, '[]'::jsonb)) with ordinality as c(value, ord)
  where btrim(coalesce(c.value ->> 'color', '')) <> ''
  on conflict (pedido_id, lower(btrim(color)))
  do update set metros = excluded.metros,
                kilos  = excluded.kilos,
                orden  = excluded.orden;

  return new;
end $$;

-- ============================================================
-- DESHACER: volver a aplicar la definición de fn_sync_pedido_colores que está en
-- schema_fase7_colores.sql (la misma, sin el bloque de validación de repetidos).
-- ============================================================
