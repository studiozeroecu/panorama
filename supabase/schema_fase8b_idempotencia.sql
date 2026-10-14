-- Panorama — Bear & Trend · Fase 8b: idempotencia al crear cortes y pedidos
-- Ejecutar DESPUÉS de schema_fase8a_retorno_estampado.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — el SQL Editor de Supabase reparte las sentencias de un
-- script con transacción explícita entre conexiones del pool. Ver la nota en
-- schema_fase7_colores.sql.
--
-- Por qué: el guard contra doble clic de CorteTab y PedidosTab es solo de cliente
-- (setOcupado + disabled). Con la pantalla abierta en dos pestañas, o si un cliente
-- HTTP reintenta un POST que sí llegó, se crean dos cortes idénticos y el saldo de
-- tela se descuenta dos veces. fn_registrar_corte ya serializa las llamadas con
-- `for update`, pero serializar no es deduplicar: las dos se ejecutan igual, una
-- tras otra. Hace falta una clave que identifique el INTENTO, no el contenido.
--
-- A diferencia de fn_procesar_lote_maquila (guarda por `procesado`) y
-- fn_retornar_lote_estampado (guarda por `retornado`), aquí no existe un estado
-- previo que consultar: el registro todavía no existe. Por eso el id lo genera el
-- cliente al ABRIR el formulario — no al pulsar Guardar — y viaja con la petición.

-- ============================================================
-- 1) Columnas e índices únicos
--    Nullable a propósito: las filas existentes no tienen valor, y en Postgres un
--    índice único admite muchos NULL. Así el bot y cualquier insert manual siguen
--    funcionando sin id (sin deduplicación, pero sin romperse).
-- ============================================================

alter table prod_cortes       add column if not exists idempotencia_id uuid;
alter table prod_pedidos_tela add column if not exists idempotencia_id uuid;

create unique index if not exists uq_cortes_idempotencia
  on prod_cortes (idempotencia_id);
create unique index if not exists uq_pedidos_idempotencia
  on prod_pedidos_tela (idempotencia_id);

-- ============================================================
-- 2) fn_registrar_corte con el parámetro nuevo.
--
--    Hay que BORRAR y recrear, no basta `create or replace`, por dos razones que se
--    acumulan: añadir un parámetro crearía una SOBRECARGA (la función vieja de 6
--    argumentos seguiría existiendo y una llamada con 6 la elegiría a ella, es decir
--    seguiría duplicando en silencio), y cambiar el tipo de retorno de uuid a jsonb
--    exige drop de todos modos.
--
--    Las dos sentencias van dentro de un solo bloque DO para que no haya un instante
--    en que la función no exista.
-- ============================================================

do $MIG$
begin
  execute 'drop function if exists fn_registrar_corte(uuid, date, uuid, text, numeric, jsonb)';

  execute $FN$
create or replace function fn_registrar_corte(
  p_pedido_id uuid,
  p_fecha date,
  p_maquiladora_id uuid,
  p_observaciones text,
  p_costo_maquila numeric,
  p_colores jsonb,
  p_idem_id uuid default null
) returns jsonb
language plpgsql as $BODY$
declare
  v_estado text;
  v_corte_id uuid;
  v_maquila_id uuid;
  v_corte_color_id uuid;
  v_total_unidades integer := 0;
  v_total_metros numeric := 0;
  v_con_metros boolean := false;
  v_saldo numeric;
  v_colores_norm jsonb := '[]'::jsonb;
  v_col jsonb;
  v_ord integer;
  v_unidades integer;
  v_metros numeric;
  v_nombre text;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede registrar cortes.';
  end if;
  if p_fecha is null then
    raise exception 'La fecha de corte es requerida.';
  end if;

  -- Lock del pedido: serializa dos llamadas simultáneas sobre el mismo pedido.
  select estado into v_estado
  from prod_pedidos_tela
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido de tela no existe.';
  end if;

  -- ⚠️ IDEMPOTENCIA ANTES DE VALIDAR. El orden no es cosmético:
  -- si esto fuera después del chequeo de saldo, un reintento recalcularía la tela
  -- que la PRIMERA llamada ya consumió y levantaría un "supera el saldo" falso
  -- sobre un corte que sí se guardó. Con el lock tomado, una segunda llamada
  -- simultánea espera aquí y luego ve la fila que insertó la primera.
  if p_idem_id is not null then
    select id into v_corte_id from prod_cortes where idempotencia_id = p_idem_id;
    if found then
      return jsonb_build_object('ya_registrado', true, 'corte_id', v_corte_id);
    end if;
  end if;

  if v_estado <> 'entregado' then
    raise exception 'La tela todavía no está marcada como entregada.';
  end if;

  -- pasada 1: normaliza la entrada, valida y acumula totales
  for v_col in
    select value from jsonb_array_elements(coalesce(p_colores, '[]'::jsonb))
  loop
    v_nombre := btrim(coalesce(v_col ->> 'color', ''));
    v_unidades := coalesce((
      select sum(t.value::int)
      from jsonb_each_text(coalesce(v_col -> 'tallas', '{}'::jsonb)) as t(key, value)
    ), 0);
    v_metros := (v_col ->> 'metros_usados')::numeric;

    continue when v_unidades <= 0 and coalesce(v_metros, 0) <= 0;

    if v_nombre = '' then
      raise exception 'Hay un color sin nombre en el corte.';
    end if;

    v_total_unidades := v_total_unidades + v_unidades;
    if v_metros is not null then
      v_con_metros := true;
      v_total_metros := v_total_metros + v_metros;
    end if;

    v_colores_norm := v_colores_norm || jsonb_build_array(jsonb_build_object(
      'color', v_nombre,
      'tallas', coalesce(v_col -> 'tallas', '{}'::jsonb),
      'unidades', v_unidades,
      'metros_usados', v_metros
    ));
  end loop;

  if v_total_unidades <= 0 then
    raise exception 'Ingresa al menos una unidad cortada.';
  end if;

  -- saldo de tela: total del pedido menos lo ya consumido por cortes anteriores.
  -- Los cortes sin metros registrados cuentan como 0 (igual que la app hoy).
  if v_con_metros then
    select p.total_metros
           - coalesce((select sum(c.metros_consumidos) from prod_cortes c where c.pedido_id = p.id), 0)
      into v_saldo
    from prod_pedidos_tela p
    where p.id = p_pedido_id;

    if v_total_metros > v_saldo + 0.001 then
      raise exception 'Los metros usados (% m) superan el saldo de tela del pedido (% m).',
        round(v_total_metros, 1), round(v_saldo, 1);
    end if;
  end if;

  -- el corte (con su jsonb, que sigue siendo el respaldo vivo)
  insert into prod_cortes (pedido_id, fecha, maquiladora_id, colores,
                           total_unidades, metros_consumidos, observaciones,
                           idempotencia_id)
  values (p_pedido_id, p_fecha, p_maquiladora_id, v_colores_norm,
          v_total_unidades,
          case when v_con_metros then round(v_total_metros, 2) else null end,
          btrim(coalesce(p_observaciones, '')),
          p_idem_id)
  on conflict (idempotencia_id) do nothing
  returning id into v_corte_id;

  -- Segunda línea de defensa. Si otra transacción ganó la carrera entre el chequeo
  -- de arriba y este insert, el índice único la absorbe y devolvemos el corte que
  -- quedó, en vez de reventar con una violación de unicidad.
  -- (Con p_idem_id nulo nunca hay conflicto: NULL no colisiona en un índice único.)
  if v_corte_id is null then
    select id into v_corte_id from prod_cortes where idempotencia_id = p_idem_id;
    return jsonb_build_object('ya_registrado', true, 'corte_id', v_corte_id);
  end if;

  -- la maquila que arranca con él
  insert into prod_maquilas (corte_id, maquiladora_id, costo_unitario, colores, total_unidades)
  values (v_corte_id, p_maquiladora_id, coalesce(p_costo_maquila, 0),
          (select coalesce(jsonb_agg(jsonb_build_object(
                    'color',         c.value ->> 'color',
                    'tallas',        c.value -> 'tallas',
                    'unidades',      (c.value ->> 'unidades')::int,
                    'estado',        'pendiente',
                    'fecha_envio',   null,
                    'fecha_entrega', null,
                    'procesado',     false) order by c.ord), '[]'::jsonb)
           from jsonb_array_elements(v_colores_norm) with ordinality as c(value, ord)),
          v_total_unidades)
  returning id into v_maquila_id;

  -- pasada 2: las filas normalizadas
  for v_col, v_ord in
    select value, ord
    from jsonb_array_elements(v_colores_norm) with ordinality as c(value, ord)
  loop
    insert into prod_corte_colores (corte_id, pedido_color_id, color, unidades, metros_usados, orden)
    values (v_corte_id,
            (select pc.id from prod_pedido_colores pc
              where pc.pedido_id = p_pedido_id
                and lower(btrim(pc.color)) = lower(btrim(v_col ->> 'color'))),
            btrim(v_col ->> 'color'),
            (v_col ->> 'unidades')::int,
            (v_col ->> 'metros_usados')::numeric,
            v_ord)
    returning id into v_corte_color_id;

    insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
    select v_corte_color_id, t.key, t.value::int
    from jsonb_each_text(coalesce(v_col -> 'tallas', '{}'::jsonb)) as t(key, value)
    where t.value::int > 0;

    insert into prod_maquila_colores (maquila_id, corte_color_id, estado, procesado)
    values (v_maquila_id, v_corte_color_id, 'pendiente', false);
  end loop;

  return jsonb_build_object(
    'ya_registrado', false,
    'corte_id',      v_corte_id,
    'unidades',      v_total_unidades
  );
end $BODY$;
  $FN$;
end $MIG$;

-- ============================================================
-- DESHACER:
--   drop index if exists uq_cortes_idempotencia;
--   drop index if exists uq_pedidos_idempotencia;
--   alter table prod_cortes       drop column if exists idempotencia_id;
--   alter table prod_pedidos_tela drop column if exists idempotencia_id;
--   -- y recrear fn_registrar_corte desde schema_fase7_colores.sql (versión de 6
--   -- parámetros que devuelve uuid), tras hacerle drop a la de 7.
-- ============================================================
