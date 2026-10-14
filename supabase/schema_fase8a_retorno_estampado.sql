-- Panorama — Bear & Trend · Fase 8a: retorno de estampado atómico
-- Ejecutar DESPUÉS de schema_fase7b_trigger_maquila.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — el SQL Editor de Supabase reparte las sentencias de un
-- script con transacción explícita entre conexiones del pool y el DDL deja de verse
-- entre sentencias. Ver la nota en schema_fase7_colores.sql.
--
-- Por qué: EstampadosTab.retornar() hacía N sumas de stock desde el navegador y
-- DESPUÉS marcaba el lote, sin transacción. Si fallaba a mitad, el lote seguía
-- "en_taller", el usuario reintentaba y el stock recibía el doble de unidades.
-- Es la misma cadena que fn_procesar_lote_maquila volvió atómica en Envío.
--
-- De paso usa fn_repartir_por_talla, con lo que desaparece la segunda copia de la
-- heurística de reparto (la de EstampadosTab, que iba en orden de inserción del
-- objeto y coincidía con la del servidor solo por casualidad).

create or replace function fn_retornar_lote_estampado(
  p_lote_id uuid,
  p_fecha date default null
) returns jsonb
language plpgsql as $$
declare
  v_lote record;
  v_fecha date;
  v_etiqueta text;
  v_repartidas jsonb;
  v_suma_tallas integer;
  v_total integer := 0;
  v_t record;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede registrar retornos de estampado.';
  end if;

  v_fecha := coalesce(p_fecha, fn_hoy_ecuador());

  -- Lock de la fila. Dos llamadas simultáneas se serializan aquí: la segunda espera,
  -- vuelve a leer y ve 'retornado', así que sale por la salida tranquila de abajo.
  select l.id, l.prenda_id, l.prenda_nombre, l.color, l.tallas,
         l.total_unidades, l.disenos, l.estado, l.fecha_retorno
    into v_lote
  from prod_lotes_estampado l
  where l.id = p_lote_id
  for update;

  if not found then
    raise exception 'El lote de estampado no existe.';
  end if;

  -- D4: un reintento NO es un error. Nada se rompió, ya estaba hecho.
  -- Se devuelve como resultado normal para que la interfaz lo muestre en tono neutro.
  if v_lote.estado = 'retornado' then
    return jsonb_build_object(
      'ya_retornado',  true,
      'unidades',      v_lote.total_unidades,
      'fecha_retorno', v_lote.fecha_retorno,
      'tallas',        v_lote.tallas
    );
  end if;

  -- D1: estricto, igual que fn_procesar_lote_maquila exige 'entregado'.
  if v_lote.estado <> 'en_taller' then
    raise exception 'El lote todavía no se ha enviado al taller.';
  end if;

  -- Etiqueta con la que entra al stock: los nombres de los diseños, en su orden.
  select coalesce(string_agg(btrim(d.value ->> 'nombre'), ', ' order by d.ord), '')
    into v_etiqueta
  from jsonb_array_elements(coalesce(v_lote.disenos, '[]'::jsonb)) with ordinality as d(value, ord)
  where btrim(coalesce(d.value ->> 'nombre', '')) <> '';

  select coalesce(sum(t.value::int), 0) into v_suma_tallas
  from jsonb_each_text(coalesce(v_lote.tallas, '{}'::jsonb)) as t(key, value);

  -- D2: un lote cuyas tallas no alcanzan para sus unidades está corrupto. El código
  -- viejo sumaba "lo que hubiera" y perdía unidades en silencio; aquí se para.
  if v_suma_tallas < v_lote.total_unidades then
    raise exception
      'El lote dice % unidades pero sus tallas solo suman %. Corrige el desglose antes de registrar el retorno.',
      v_lote.total_unidades, v_suma_tallas;
  end if;

  -- Reparto único y determinista (XS→XXL). Para los lotes creados por
  -- fn_procesar_lote_maquila es la identidad, porque sum(tallas) = total_unidades.
  v_repartidas := fn_repartir_por_talla(v_lote.tallas, v_lote.total_unidades);

  for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_repartidas) loop
    perform fn_sumar_stock_online(
      v_lote.prenda_id, v_lote.prenda_nombre, v_lote.color,
      v_etiqueta, v_t.talla, v_t.unidades);
    v_total := v_total + v_t.unidades;
  end loop;

  update prod_lotes_estampado
     set estado = 'retornado', fecha_retorno = v_fecha
   where id = p_lote_id;

  return jsonb_build_object(
    'ya_retornado', false,
    'unidades',     v_total,
    'etiqueta',     v_etiqueta,
    'tallas',       v_repartidas
  );
end $$;

-- ============================================================
-- DESHACER:
--   drop function if exists fn_retornar_lote_estampado(uuid, date);
-- (El TypeScript volvería a necesitar EstampadosTab.retornar() con su bucle
--  y src/lib/produccion/stock.ts, ambos eliminados en el mismo commit.)
-- ============================================================
