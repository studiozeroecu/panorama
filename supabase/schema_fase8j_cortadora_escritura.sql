-- Panorama — Bear & Trend · Fase 8j: la cortadora escribe
-- Ejecutar DESPUÉS de schema_fase8i_rol_cortadora.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Cierra las piezas 4 y 7 de docs/plan_cortadora.md: capas, retazos, horas e
-- insumos. El DESTINO (pieza 8) queda deliberadamente fuera — toca
-- fn_procesar_lote_maquila, que está hardeneada con locks, y va en su propia fase.
-- El COSTO por hora (pieza 5) tampoco: aquí solo se capturan las horas.
--
-- ════════════════════════════════════════════════════════════
-- DÓNDE VIVE LA CORRIDA BASE, Y POR QUÉ EN DOS SITIOS
--
-- La corrida es "una por tela" y aplica igual a todos sus colores. La tentación
-- es guardarla solo en el pedido. Pero un pedido admite VARIOS cortes (CorteTab
-- dice "+ Nuevo corte", y el saldo de tela existe justamente por eso).
--
-- Si viviera solo en el pedido y Mateo la editara para un segundo corte, el
-- primero cambiaría de significado retroactivamente: el descuadre que se calculó
-- aquel día ya no se podría reconstruir. Es exactamente el defecto que CLAUDE.md
-- marca dos veces — los costos fijos que no se congelan por mes, y el
-- `consumo_metros` que tampoco. El patrón correcto ya existe en el proyecto:
-- `prod_maquilas.costo_unitario` es una FOTO del momento del corte.
--
-- Por eso son dos columnas con dos papeles distintos:
--
--   prod_pedidos_tela.corrida_base  → el PLAN. Mutable. Lo edita Mateo donde ya
--                                     genera el documento de la fase 1. Ella solo
--                                     lo lee. Es "lo que hay que cortar".
--   prod_cortes.corrida_base        → la FOTO. Se copia al registrar el corte y
--   prod_cortes.capas                 no se vuelve a tocar. Es "con qué se cortó".
--
-- POR QUÉ jsonb Y NO UNA TABLA NORMALIZADA
--
-- La fase 7 sacó los `colores` del jsonb a tablas propias, así que la pregunta es
-- legítima. Pero lo que hacía daño allí no está aquí: los colores tienen
-- IDENTIDAD y OTRAS FILAS LOS REFERENCIAN (`prod_corte_colores.pedido_color_id`),
-- se editaban parcialmente, y se identificaban por posición en el array.
--
-- La corrida es un mapa plano talla→unidades: nada la referencia, no se edita por
-- partes —se reescribe entera— y nunca se consulta una talla suelta. Una tabla
-- serían seis filas, su RLS y sus políticas para un valor que siempre se lee de
-- golpe. El propio proyecto ya usa jsonb para esto mismo en
-- `prod_lotes_estampado.tallas`.
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- 1) La corrida base: plan en el pedido, foto en el corte
-- ============================================================

alter table prod_pedidos_tela add column if not exists corrida_base jsonb;
alter table prod_cortes       add column if not exists corrida_base jsonb;
alter table prod_cortes       add column if not exists capas integer;

-- Nullable a propósito: los pedidos y cortes que ya existen no tienen corrida, y
-- un `{}` sería indistinguible de "una corrida con todas las tallas en cero".
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'prod_cortes'::regclass
                   and conname = 'prod_cortes_capas_positivo') then
    alter table prod_cortes add constraint prod_cortes_capas_positivo
      check (capas is null or capas > 0);
  end if;
end $$;

comment on column prod_pedidos_tela.corrida_base is
  'PLAN: unidades por talla de UNA capa, {"S":1,"M":2}. Lo define el admin. Mutable.';
comment on column prod_cortes.corrida_base is
  'FOTO de la corrida con la que se cortó. Copiada al registrar; no se vuelve a tocar.';

-- ⚠️ Los dos triggers de prod_pedidos_tela (trg_sync_pedido_colores y
--    trg_proteger_pedido_con_cortes) son POR COLUMNA, sobre `colores` y
--    `total_metros`. `corrida_base` no los dispara, así que se puede editar el
--    plan de un pedido que ya tiene cortes — que es justo lo que se quiere: el
--    corte viejo conserva su foto.

-- ============================================================
-- 2) Retazos — por corte, con la talla puesta a mano
--
--    SIN unique sobre (corte_id, talla): cada fila es un EVENTO de registro, no
--    un acumulado. Puede anotar dos retazos de talla M en momentos distintos, y
--    quién/cuándo de cada uno importa.
--
--    No suman al total del corte: son tela sobrante que PODRÍA dar una unidad, y
--    eso lo decide la persona, no una fórmula.
-- ============================================================

create table if not exists prod_corte_retazos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  corte_id uuid not null references prod_cortes (id) on delete cascade,
  talla text not null,
  unidades integer not null check (unidades > 0),
  nota text not null default '',
  registrado_por uuid references auth.users (id) on delete set null default auth.uid()
);
create index if not exists idx_corte_retazos_corte on prod_corte_retazos (corte_id);

-- ============================================================
-- 3) Jornadas — tabla intermedia, NO una FK directa
--
--    La pregunta era si basta `jornada.corte_id`. No basta, y no por el caso
--    frecuente sino por el raro: un corte grande puede ocupar DOS días. Con una
--    FK directa ese corte tendría que partirse en dos jornadas que fingen ser de
--    cortes distintos, o perderse una.
--
--    Es muchos-a-muchos de verdad: una jornada cubre varios cortes, y un corte
--    puede abarcar varias jornadas. La tabla intermedia lo dice sin mentir, y
--    cuesta una tabla de dos columnas.
--
--    Las horas viven en la JORNADA, no en el cruce: son horas del día, y
--    repartirlas entre cortes sería inventar un dato que nadie midió.
-- ============================================================

create table if not exists prod_jornadas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default fn_hoy_ecuador(),
  horas numeric(5,2) not null check (horas > 0),
  nota text not null default '',
  registrado_por uuid references auth.users (id) on delete set null default auth.uid()
);
create index if not exists idx_jornadas_fecha on prod_jornadas (fecha);

create table if not exists prod_jornada_cortes (
  jornada_id uuid not null references prod_jornadas (id) on delete cascade,
  corte_id   uuid not null references prod_cortes   (id) on delete cascade,
  primary key (jornada_id, corte_id)
);
create index if not exists idx_jornada_cortes_corte on prod_jornada_cortes (corte_id);

-- ============================================================
-- 4) Insumos — texto libre, sin catálogo
--
--    `descripcion` es texto a secas y `cantidad` numérica: "botones" 200,
--    "cierres" 50. Sin catálogo, como se pidió. Si algún día se quiere agrupar
--    por insumo, se normaliza entonces y con los datos reales delante.
-- ============================================================

create table if not exists prod_corte_insumos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  corte_id uuid not null references prod_cortes (id) on delete cascade,
  descripcion text not null check (btrim(descripcion) <> ''),
  cantidad numeric(10,2) not null check (cantidad > 0),
  fecha date not null default fn_hoy_ecuador(),
  registrado_por uuid references auth.users (id) on delete set null default auth.uid()
);
create index if not exists idx_corte_insumos_corte on prod_corte_insumos (corte_id);

-- ============================================================
-- 5) RLS de las tablas nuevas
--
--    CLAUDE.md: tabla nueva ⇒ RLS + política admin_all_<tabla>. Sin eso la tabla
--    queda inaccesible desde la web, y el bug se ve como "no hay datos".
--    Cada tabla lleva su admin_all_* Y su política de cortadora.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'prod_corte_retazos', 'prod_jornadas', 'prod_jornada_cortes', 'prod_corte_insumos'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "admin_all_%s" on %I', t, t);
    execute format(
      'create policy "admin_all_%s" on %I for all to authenticated '
      'using (fn_es_admin()) with check (fn_es_admin())', t, t);

    -- La cortadora: lee y escribe lo suyo. Sin delete — corregir es editar, y
    -- borrar un registro de trabajo ya hecho no es algo que deba poder hacer.
    execute format('drop policy if exists "cortadora_lee_%s" on %I', t, t);
    execute format(
      'create policy "cortadora_lee_%s" on %I for select to authenticated '
      'using (fn_es_cortadora())', t, t);
    execute format('drop policy if exists "cortadora_inserta_%s" on %I', t, t);
    execute format(
      'create policy "cortadora_inserta_%s" on %I for insert to authenticated '
      'with check (fn_es_cortadora())', t, t);
    execute format('drop policy if exists "cortadora_edita_%s" on %I', t, t);
    execute format(
      'create policy "cortadora_edita_%s" on %I for update to authenticated '
      'using (fn_es_cortadora()) with check (fn_es_cortadora())', t, t);
  end loop;
end $$;

-- ============================================================
-- 6) Escritura de la cortadora sobre las tablas que YA existían
--
--    fn_registrar_corte es SECURITY INVOKER: las RLS aplican con quien llama.
--    La fase 8i le quitó la guarda de admin, pero sin estas políticas el INSERT
--    seguiría fallando. Son las cinco tablas que la función toca.
--
--    Solo INSERT. No puede modificar ni borrar un corte ya registrado; para eso
--    está Mateo. Y no se le da nada sobre prod_pedidos_tela: la corrida base la
--    LEE (fase 8i) y no la edita.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'prod_cortes', 'prod_corte_colores', 'prod_corte_color_tallas',
    'prod_maquilas', 'prod_maquila_colores'
  ] loop
    execute format('drop policy if exists "cortadora_inserta_%s" on %I', t, t);
    execute format(
      'create policy "cortadora_inserta_%s" on %I for insert to authenticated '
      'with check (fn_es_cortadora())', t, t);
  end loop;
end $$;

-- ============================================================
-- 7) fn_registrar_corte acepta capas y corrida base
--
--    Van DENTRO de la función, y no en un update posterior, porque son parte de
--    la identidad del corte: si el update fallara, quedaría un corte sin saber
--    con qué corrida se hizo y el descuadre sería irreconstruible.
--
--    Los retazos, las jornadas y los insumos NO van aquí: son eventos que se
--    añaden y corrigen después, no necesitan ser atómicos con el corte, y
--    meterlos complicaría una función ya hardeneada sin ganar nada.
--
--    ⚠️ DROP + CREATE, no `create or replace`: añadir parámetros crearía una
--    SOBRECARGA, y una llamada con 7 argumentos seguiría yendo a la versión
--    vieja — que ignoraría capas y corrida en silencio. Es la misma trampa que
--    documentó la fase 8b. Las dos sentencias van en un bloque DO para que no
--    haya un instante sin función.
-- ============================================================

do $MIG8J$
begin
  execute 'drop function if exists fn_registrar_corte(uuid, date, uuid, text, numeric, jsonb, uuid)';

  execute $FN8J$
create or replace function fn_registrar_corte(
  p_pedido_id uuid,
  p_fecha date,
  p_maquiladora_id uuid,
  p_observaciones text,
  p_costo_maquila numeric,
  p_colores jsonb,
  p_idem_id uuid default null,
  p_capas integer default null,
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
                           idempotencia_id, capas, corrida_base)
  values (p_pedido_id, p_fecha, p_maquiladora_id, v_colores_norm,
          v_total_unidades,
          case when v_con_metros then round(v_total_metros, 2) else null end,
          btrim(coalesce(p_observaciones, '')),
          p_idem_id, p_capas, p_corrida_base)
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
  $FN8J$;
end $MIG8J$;


-- ============================================================
-- DESHACER:
--   drop table if exists prod_jornada_cortes, prod_jornadas,
--                        prod_corte_retazos, prod_corte_insumos;
--   do $$ declare t text; begin
--     foreach t in array array['prod_cortes','prod_corte_colores',
--       'prod_corte_color_tallas','prod_maquilas','prod_maquila_colores'] loop
--       execute format('drop policy if exists "cortadora_inserta_%s" on %I', t, t);
--     end loop; end $$;
--   alter table prod_cortes       drop constraint if exists prod_cortes_capas_positivo;
--   alter table prod_cortes       drop column if exists capas, drop column if exists corrida_base;
--   alter table prod_pedidos_tela drop column if exists corrida_base;
--   -- y volver a aplicar fn_registrar_corte desde schema_fase8i_rol_cortadora.sql
--   -- (la de 7 parámetros), tras hacerle drop a la de 9.
-- ============================================================
