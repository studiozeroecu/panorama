-- REPARACIÓN de la fase 8k. Correr si el smoke_test_fase8k.sql no dio 10/10.
-- NO forma parte de la cadena: es idempotente y se puede correr las veces que haga falta.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Qué arregla, y por qué pasó:
--
--  · Revivió la firma de 7 argumentos de fn_registrar_corte. Esa versión solo la
--    crea schema_fase8i_rol_cortadora.sql, así que o se volvió a correr ese
--    archivo, o la 8k se aplicó antes que él. Aquí se borran las CUATRO firmas
--    posibles (7, 8 y 9) antes de crear la buena, para que no sobreviva ninguna
--    sea cual sea el orden en que se corrieron las cosas.
--
--  · prod_cortes.capas seguía existiendo. Se vuelve a intentar la mudanza y el
--    drop, esta vez sin envolverlo en un `if exists` que pudiera saltárselo.
--
-- ⚠️ Mientras convivan dos versiones de la función, la app llama a la de 7 y las
--    capas se pierden SIN ERROR. Por eso esto es urgente y no cosmético.

-- ============================================================
-- 1) Mudar las capas que hubiera y quitar la columna del corte
--    Sin `if exists` alrededor: si la columna no está, los `if exists` de cada
--    sentencia ya lo resuelven, y así no hay forma de que el bloque entero se
--    salte en silencio.
-- ============================================================

do $REP1$
declare v_n int := 0;
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'prod_cortes' and column_name = 'capas') then
    update prod_corte_colores cc
       set capas = c.capas
      from prod_cortes c
     where c.id = cc.corte_id and c.capas is not null and cc.capas is null;
    get diagnostics v_n = row_count;
  end if;
  raise notice 'Capas mudadas a prod_corte_colores: % fila(s)', v_n;
end $REP1$;

alter table prod_cortes drop constraint if exists prod_cortes_capas_positivo;
alter table prod_cortes drop column if exists capas;

-- ============================================================
-- 2) Una sola versión de fn_registrar_corte: la de 8 parámetros
-- ============================================================

do $MIG8K$
begin
  execute 'drop function if exists fn_registrar_corte(uuid, date, uuid, text, numeric, jsonb, uuid)';
  execute 'drop function if exists fn_registrar_corte(uuid, date, uuid, text, numeric, jsonb, uuid, integer, jsonb)';
  execute 'drop function if exists fn_registrar_corte(uuid, date, uuid, text, numeric, jsonb, uuid, jsonb)';

  execute $FN8K$
create or replace function fn_registrar_corte(
  p_pedido_id uuid,
  p_fecha date,
  p_maquiladora_id uuid,
  p_observaciones text,
  p_costo_maquila numeric,
  p_colores jsonb,
  p_idem_id uuid default null,
  p_corrida_base jsonb default null
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
  -- Fase 8i: la cortadora tambien registra cortes. NADA MAS de esta funcion
  -- cambia respecto a schema_fase8b_idempotencia.sql: se copio de ahi tal
  -- cual y solo se sustituyo esta guarda.
  if not (fn_es_admin() or fn_es_cortadora()) then
    raise exception 'No tienes permiso para registrar cortes.';
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
      'metros_usados', v_metros,
      'capas', (v_col ->> 'capas')::int
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
                           idempotencia_id, corrida_base)
  values (p_pedido_id, p_fecha, p_maquiladora_id, v_colores_norm,
          v_total_unidades,
          case when v_con_metros then round(v_total_metros, 2) else null end,
          btrim(coalesce(p_observaciones, '')),
          p_idem_id, p_corrida_base)
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
    insert into prod_corte_colores (corte_id, pedido_color_id, color, unidades, metros_usados, orden, capas)
    values (v_corte_id,
            (select pc.id from prod_pedido_colores pc
              where pc.pedido_id = p_pedido_id
                and lower(btrim(pc.color)) = lower(btrim(v_col ->> 'color'))),
            btrim(v_col ->> 'color'),
            (v_col ->> 'unidades')::int,
            (v_col ->> 'metros_usados')::numeric,
            v_ord,
            (v_col ->> 'capas')::int)
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
  $FN8K$;
end $MIG8K$;

-- ============================================================
-- 3) Comprobación inmediata — si algo sigue mal, aborta aquí mismo
-- ============================================================

do $VER$
declare v_n int; v_txt text;
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'prod_cortes' and column_name = 'capas') then
    raise exception 'prod_cortes.capas SIGUE existiendo.';
  end if;

  select count(*), string_agg(pg_get_function_identity_arguments(oid), '  ||  ')
    into v_n, v_txt from pg_proc where proname = 'fn_registrar_corte';
  if v_n <> 1 then
    raise exception 'Hay % versiones de fn_registrar_corte: %', v_n, v_txt;
  end if;
  if v_txt like '%p_capas%' then
    raise exception 'La función todavía tiene p_capas: %', v_txt;
  end if;

  raise notice 'Reparado. Una sola función: %', v_txt;
end $VER$;
