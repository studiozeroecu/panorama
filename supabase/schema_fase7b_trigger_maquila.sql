-- Panorama — Bear & Trend · Fase 7b: espejo automático del estado de maquila al jsonb
-- Ejecutar en el SQL Editor DESPUÉS de schema_fase7_colores.sql. Idempotente.
--
-- ⚠️ SIN `begin;` / `commit;` — ver la nota en schema_fase7_colores.sql: el SQL Editor
-- de Supabase reparte las sentencias de un script con transacción explícita entre
-- varias conexiones del pool y el DDL deja de verse entre sentencias.
--
-- Por qué: al pasar MaquilaTab a escribir sobre prod_maquila_colores (una fila por
-- color, en vez de reescribir el array jsonb entero), el `colores` de prod_maquilas
-- se quedaría con el estado viejo. Y ese jsonb es la red de seguridad de la fase 7:
-- mientras siga al día, revertir el deploy es un rollback de verdad, porque el código
-- anterior lo lee. Este trigger mantiene esa garantía sin que el cliente haga nada.
--
-- Alcance: solo estado, fecha_envio, fecha_entrega y procesado. color/tallas/unidades
-- no se tocan nunca después de crearse (verificado en el código), así que no se espejan.

create or replace function fn_sync_maquila_colores() returns trigger
language plpgsql as $$
declare
  v_color text;
begin
  -- el color vive en el corte; prod_maquila_colores solo lo referencia
  select cc.color into v_color
  from prod_corte_colores cc
  where cc.id = new.corte_color_id;

  if v_color is null then
    return null;   -- sin color que emparejar, no hay nada que espejar
  end if;

  update prod_maquilas m
     set colores = (
       select coalesce(jsonb_agg(
                case when lower(btrim(c.value ->> 'color')) = lower(btrim(v_color))
                     then c.value || jsonb_build_object(
                            'estado',        new.estado,
                            'fecha_envio',   new.fecha_envio,
                            'fecha_entrega', new.fecha_entrega,
                            'procesado',     new.procesado)
                     else c.value
                end order by c.ord), '[]'::jsonb)
       from jsonb_array_elements(m.colores) with ordinality as c(value, ord))
   where m.id = new.maquila_id;

  return null;   -- AFTER trigger: el valor de retorno se ignora
end $$;

drop trigger if exists trg_sync_maquila_colores on prod_maquila_colores;
create trigger trg_sync_maquila_colores
  after insert or update of estado, fecha_envio, fecha_entrega, procesado
  on prod_maquila_colores
  for each row execute function fn_sync_maquila_colores();

-- Nota: fn_procesar_lote_maquila ya espejaba `procesado` al jsonb por su cuenta. Con
-- este trigger esa parte queda redundante — hace exactamente lo mismo y converge al
-- mismo valor. Se deja como está a propósito: reeditar la función entera aquí
-- duplicaría 150 líneas en dos archivos y eso sí se desincroniza con el tiempo.
-- Cuando se retiren las columnas jsonb, se van este trigger, el de pedidos y el
-- espejo interno de la RPC, todos juntos.

-- ============================================================
-- DESHACER:
--   drop trigger if exists trg_sync_maquila_colores on prod_maquila_colores;
--   drop function if exists fn_sync_maquila_colores;
-- ============================================================
