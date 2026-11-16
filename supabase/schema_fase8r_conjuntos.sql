-- Panorama — Bear & Trend · Fase 8r: conjuntos (sets) de dos partes
-- Ejecutar DESPUÉS de schema_fase8q_corregir_corte.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- EL PROBLEMA
--
-- Un conjunto (blusa + pantalón) sale de UNA tela y UN tendido: el rollo se
-- parte por la mitad y de cada mitad sale una parte. Pero no salen las mismas:
-- 18 partes superiores y 14 inferiores, por ejemplo. Como el sistema solo sabía
-- que una tela da UNA prenda, había que registrar dos cortes separados de la
-- misma tela, y los costos y precios de cada parte no se podían ver.
--
-- LA SOLUCIÓN (decisiones del dueño, 2026-10-26)
--
-- · La prenda se MARCA como conjunto al crearla o editarla (no se deduce del
--   nombre). Un conjunto tiene siempre dos partes: SUPERIOR e INFERIOR, cada una
--   con su nombre, su consumo de tela, su costo de maquila y su precio suelto.
--   El precio de venta de la prenda conjunto es el precio del SET.
-- · El corte de una tela de conjunto es UNO SOLO, y cada color lleva dos filas:
--   la parte superior y la inferior, cada una con sus tallas y sus capas.
--   Técnicamente cada (color, parte) es una fila de prod_corte_colores, así que
--   maquila, entregas parciales, bajas y Envío funcionan por parte SIN cambios.
-- · Cada parte se paga en maquila a su propio precio: costo_unitario en
--   prod_maquila_colores (null = el de la maquila, como siempre).
-- · Un set siempre es de la misma talla en las dos partes, así que los sets
--   posibles se CALCULAN (mínimo de las dos partes por color y talla). No se
--   guardan.
--
-- Fuera de alcance (fases siguientes): venta de sets y stock armado de sets.
-- Por ahora cada parte entra al stock online por separado, con su nombre.
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- 1) La prenda: conjunto o sola, y sus dos partes
-- ============================================================

alter table prod_prendas add column if not exists es_conjunto boolean not null default false;

comment on column prod_prendas.es_conjunto is
  'Fase 8r: true = conjunto de dos partes (prod_prenda_partes). Sus precios de venta son los del SET.';

create table if not exists prod_prenda_partes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  prenda_id uuid not null references prod_prendas (id) on delete cascade,
  parte text not null check (parte in ('superior', 'inferior')),
  nombre text not null check (btrim(nombre) <> ''),
  -- Metros lineales por unidad de ESTA parte. null = sin medir (no un 0 falso:
  -- es divisor y reparte el costo de la tela, ver fase 8h).
  consumo_metros numeric(8,3) check (consumo_metros is null or consumo_metros > 0),
  costo_maquila numeric(10,2) not null default 0 check (costo_maquila >= 0),
  precio_venta_local numeric(10,2) not null default 0 check (precio_venta_local >= 0),
  precio_venta_online numeric(10,2) not null default 0 check (precio_venta_online >= 0),
  unique (prenda_id, parte)
);

alter table prod_prenda_partes enable row level security;

drop policy if exists "admin_all_prod_prenda_partes" on prod_prenda_partes;
create policy "admin_all_prod_prenda_partes" on prod_prenda_partes
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- La cortadora necesita saber si la tela es de un conjunto y cómo se llaman sus
-- partes, para pedirle dos filas por color. Solo lee, como con prod_prendas.
drop policy if exists "cortadora_lee_prod_prenda_partes" on prod_prenda_partes;
create policy "cortadora_lee_prod_prenda_partes" on prod_prenda_partes
  for select to authenticated using (fn_es_cortadora());

-- ============================================================
-- 2) El corte: cada color puede llevar dos filas (superior / inferior)
-- ============================================================

alter table prod_corte_colores add column if not exists parte text;
alter table prod_corte_colores drop constraint if exists prod_corte_colores_parte_check;
alter table prod_corte_colores add constraint prod_corte_colores_parte_check
  check (parte is null or parte in ('superior', 'inferior'));

-- El índice único era (corte, color). Con conjuntos el mismo color aparece dos
-- veces en un corte — una por parte —, así que pasa a ser (corte, color, parte).
-- Para las prendas solas parte es null y coalesce la vuelve '', así que la regla
-- de siempre (un color una vez por corte) se mantiene igual para ellas.
drop index if exists uq_corte_colores_nombre;
create unique index if not exists uq_corte_colores_nombre_parte
  on prod_corte_colores (corte_id, lower(btrim(color)), coalesce(parte, ''));

-- ============================================================
-- 3) La maquila: precio por parte
-- ============================================================

alter table prod_maquila_colores add column if not exists costo_unitario numeric(10,2);
alter table prod_maquila_colores drop constraint if exists prod_maquila_colores_costo_unitario_check;
alter table prod_maquila_colores add constraint prod_maquila_colores_costo_unitario_check
  check (costo_unitario is null or costo_unitario >= 0);

comment on column prod_maquila_colores.costo_unitario is
  'Fase 8r: precio de maquila de ESTA fila (una parte de un conjunto). null = prod_maquilas.costo_unitario.';

-- ============================================================
-- 4) fn_registrar_corte: acepta "parte" y "costo_maquila" en cada fila
--
--    MISMA FIRMA (8 parámetros) que la fase 8k: `create or replace`, sin
--    sobrecargas. Lo nuevo viaja DENTRO de cada elemento de p_colores:
--
--      [{"color":"Negro","parte":"superior","capas":4,"tallas":{"S":4,"M":6},
--        "costo_maquila":1.20},
--       {"color":"Negro","parte":"inferior","capas":3,"tallas":{"S":3,"M":5},
--        "costo_maquila":1.50}]
--
--    Reescrita sin asignaciones de destino (ver cabecera); la lógica es la de la
--    8k más tres reglas: si la prenda de la tela es un conjunto, cada fila TIENE
--    que decir su parte; si no lo es, ninguna puede; y no se repite (color, parte).
-- ============================================================

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
  v_estado         text;
  v_corte_id       uuid;
  v_maquila_id     uuid := gen_random_uuid();
  v_corte_color_id uuid;
  v_total_unidades integer := 0;
  v_total_metros   numeric := 0;
  v_con_metros     boolean := false;
  v_saldo          numeric;
  v_colores_norm   jsonb := '[]'::jsonb;
  v_col            jsonb;
  v_ord            integer;
  v_unidades       integer;
  v_metros         numeric;
  v_nombre         text;
  v_parte          text;
  v_es_conjunto    boolean;
begin
  if not (fn_es_admin() or fn_es_cortadora()) then
    raise exception 'No tienes permiso para registrar cortes.';
  end if;
  if p_fecha is null then
    raise exception 'La fecha de corte es requerida.';
  end if;

  -- Lock del pedido: serializa dos llamadas simultáneas sobre el mismo pedido.
  perform 1 from prod_pedidos_tela where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido de tela no existe.';
  end if;
  v_estado := (select estado from prod_pedidos_tela where id = p_pedido_id);

  -- ⚠️ IDEMPOTENCIA ANTES DE VALIDAR (fase 8b): un reintento no debe toparse con
  -- el saldo que consumió su propia primera llamada.
  if p_idem_id is not null then
    v_corte_id := (select id from prod_cortes where idempotencia_id = p_idem_id);
    if v_corte_id is not null then
      return jsonb_build_object('ya_registrado', true, 'corte_id', v_corte_id);
    end if;
  end if;

  if v_estado <> 'entregado' then
    raise exception 'La tela todavía no está marcada como entregada.';
  end if;

  v_es_conjunto := coalesce((
    select pr.es_conjunto
    from prod_pedidos_tela pt join prod_prendas pr on pr.id = pt.prenda_id
    where pt.id = p_pedido_id), false);

  -- pasada 1: normaliza la entrada, valida y acumula totales
  for v_col in
    select value from jsonb_array_elements(coalesce(p_colores, '[]'::jsonb))
  loop
    v_nombre := btrim(coalesce(v_col ->> 'color', ''));
    v_parte := nullif(btrim(coalesce(v_col ->> 'parte', '')), '');
    v_unidades := coalesce((
      select sum(t.value::int)
      from jsonb_each_text(coalesce(v_col -> 'tallas', '{}'::jsonb)) as t(key, value)
    ), 0);
    v_metros := (v_col ->> 'metros_usados')::numeric;

    continue when v_unidades <= 0 and coalesce(v_metros, 0) <= 0;

    if v_nombre = '' then
      raise exception 'Hay un color sin nombre en el corte.';
    end if;
    if v_parte is not null and v_parte not in ('superior', 'inferior') then
      raise exception 'Parte inválida: % (solo superior o inferior).', v_parte;
    end if;
    if v_es_conjunto and v_parte is null then
      raise exception 'Esta tela es de un conjunto: cada fila tiene que decir si es la parte superior o la inferior.';
    end if;
    if not v_es_conjunto and v_parte is not null then
      raise exception 'La prenda de esta tela no está marcada como conjunto: el corte no lleva partes.';
    end if;

    v_total_unidades := v_total_unidades + v_unidades;
    if v_metros is not null then
      v_con_metros := true;
      v_total_metros := v_total_metros + v_metros;
    end if;

    v_colores_norm := v_colores_norm || jsonb_build_array(jsonb_build_object(
      'color', v_nombre,
      'parte', v_parte,
      'tallas', coalesce(v_col -> 'tallas', '{}'::jsonb),
      'unidades', v_unidades,
      'metros_usados', v_metros,
      'capas', (v_col ->> 'capas')::int,
      'costo_maquila', (v_col ->> 'costo_maquila')::numeric
    ));
  end loop;

  if v_total_unidades <= 0 then
    raise exception 'Ingresa al menos una unidad cortada.';
  end if;

  -- El mismo color dos veces en la misma parte chocaría con el índice único con
  -- un error ilegible; se avisa antes, en palabras.
  if (select count(*) from jsonb_array_elements(v_colores_norm))
     <> (select count(distinct lower(btrim(e.value ->> 'color')) || '|' || coalesce(e.value ->> 'parte', ''))
         from jsonb_array_elements(v_colores_norm) e) then
    raise exception 'Hay un color repetido en el corte (en la misma parte).';
  end if;

  -- saldo de tela: total del pedido menos lo ya consumido por cortes anteriores.
  if v_con_metros then
    v_saldo := (select p.total_metros
                       - coalesce((select sum(c.metros_consumidos) from prod_cortes c where c.pedido_id = p.id), 0)
                from prod_pedidos_tela p where p.id = p_pedido_id);
    if v_total_metros > v_saldo + 0.001 then
      raise exception 'Los metros usados (% m) superan el saldo de tela del pedido (% m).',
        round(v_total_metros, 1), round(v_saldo, 1);
    end if;
  end if;

  -- el corte (con su jsonb, que sigue siendo el respaldo vivo)
  v_corte_id := gen_random_uuid();
  insert into prod_cortes (id, pedido_id, fecha, maquiladora_id, colores,
                           total_unidades, metros_consumidos, observaciones,
                           idempotencia_id, corrida_base)
  values (v_corte_id, p_pedido_id, p_fecha, p_maquiladora_id, v_colores_norm,
          v_total_unidades,
          case when v_con_metros then round(v_total_metros, 2) else null end,
          btrim(coalesce(p_observaciones, '')),
          p_idem_id, p_corrida_base)
  on conflict (idempotencia_id) do nothing;

  -- Segunda línea de defensa: otra transacción ganó la carrera con el mismo id.
  if not found then
    return jsonb_build_object('ya_registrado', true,
      'corte_id', (select id from prod_cortes where idempotencia_id = p_idem_id));
  end if;

  -- la maquila que arranca con él
  insert into prod_maquilas (id, corte_id, maquiladora_id, costo_unitario, colores, total_unidades)
  values (v_maquila_id, v_corte_id, p_maquiladora_id, coalesce(p_costo_maquila, 0),
          (select coalesce(jsonb_agg(jsonb_build_object(
                    'color',         c.value ->> 'color',
                    'parte',         c.value ->> 'parte',
                    'tallas',        c.value -> 'tallas',
                    'unidades',      (c.value ->> 'unidades')::int,
                    'estado',        'pendiente',
                    'fecha_envio',   null,
                    'fecha_entrega', null,
                    'procesado',     false) order by c.ord), '[]'::jsonb)
           from jsonb_array_elements(v_colores_norm) with ordinality as c(value, ord)),
          v_total_unidades);

  -- pasada 2: las filas normalizadas
  for v_col, v_ord in
    select value, ord
    from jsonb_array_elements(v_colores_norm) with ordinality as c(value, ord)
  loop
    v_corte_color_id := gen_random_uuid();
    insert into prod_corte_colores (id, corte_id, pedido_color_id, color, unidades,
                                    metros_usados, orden, capas, parte)
    values (v_corte_color_id, v_corte_id,
            (select pc.id from prod_pedido_colores pc
              where pc.pedido_id = p_pedido_id
                and lower(btrim(pc.color)) = lower(btrim(v_col ->> 'color'))),
            btrim(v_col ->> 'color'),
            (v_col ->> 'unidades')::int,
            (v_col ->> 'metros_usados')::numeric,
            v_ord,
            (v_col ->> 'capas')::int,
            v_col ->> 'parte');

    insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
    select v_corte_color_id, t.key, t.value::int
    from jsonb_each_text(coalesce(v_col -> 'tallas', '{}'::jsonb)) as t(key, value)
    where t.value::int > 0;

    insert into prod_maquila_colores (maquila_id, corte_color_id, estado, procesado, costo_unitario)
    values (v_maquila_id, v_corte_color_id, 'pendiente', false,
            (v_col ->> 'costo_maquila')::numeric);
  end loop;

  return jsonb_build_object(
    'ya_registrado', false,
    'corte_id',      v_corte_id,
    'unidades',      v_total_unidades
  );
end $BODY$;

-- ============================================================
-- 5) El espejo al jsonb de la maquila distingue la parte
--
--    trg_sync_maquila_colores (7b) buscaba el elemento del jsonb solo por el
--    COLOR. Con dos partes del mismo color actualizaba las dos a la vez. Ahora
--    compara color Y parte. Misma firma: `create or replace`.
-- ============================================================

create or replace function fn_sync_maquila_colores() returns trigger
language plpgsql as $$
declare
  v_color text;
  v_parte text;
begin
  v_color := (select cc.color from prod_corte_colores cc where cc.id = new.corte_color_id);
  v_parte := (select cc.parte from prod_corte_colores cc where cc.id = new.corte_color_id);

  if v_color is null then
    return null;
  end if;

  update prod_maquilas m
     set colores = (
       select coalesce(jsonb_agg(
                case when lower(btrim(c.value ->> 'color')) = lower(btrim(v_color))
                      and coalesce(c.value ->> 'parte', '') = coalesce(v_parte, '')
                     then c.value || jsonb_build_object(
                            'estado',        new.estado,
                            'fecha_envio',   new.fecha_envio,
                            'fecha_entrega', new.fecha_entrega,
                            'procesado',     new.procesado)
                     else c.value
                end order by c.ord), '[]'::jsonb)
       from jsonb_array_elements(m.colores) with ordinality as c(value, ord))
   where m.id = new.maquila_id;

  return null;
end $$;

-- ============================================================
-- 6) Envío: cada parte entra al stock con su propio nombre
--
--    fn_procesar_entrega_maquila (fase 8o), copiada LITERAL por script con un
--    solo cambio: si la fila es una parte de un conjunto, el nombre con el que
--    entra al stock online / estampado / locales es "Conjunto — Blusa", no el
--    del conjunto a secas. Sin esto, la parte superior y la inferior del mismo
--    color y talla se sumarían en la MISMA fila de stock. Misma firma.
-- ============================================================

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
  v_parte         text;
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

  -- Fase 8r: una parte de un conjunto entra con SU nombre ("Conjunto Emilia —
  -- Blusa"), para que la superior y la inferior no se sumen en la misma fila.
  v_parte := (select cc.parte
              from prod_maquila_colores mc
              join prod_corte_colores cc on cc.id = mc.corte_color_id
              where mc.id = v_mc_id);
  if v_parte is not null then
    v_prenda_nombre := v_prenda_nombre || ' — ' || coalesce(
      (select pp.nombre from prod_prenda_partes pp
        where pp.prenda_id = v_prenda_id and pp.parte = v_parte),
      case v_parte when 'superior' then 'Parte superior' else 'Parte inferior' end);
  end if;

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

-- ============================================================
-- Verificación final — solo mira.
-- ============================================================

do $VERIF8R$
begin
  if (select count(*) from pg_proc where proname = 'fn_registrar_corte') <> 1 then
    raise exception 'Fase 8r: tiene que haber exactamente UNA fn_registrar_corte.';
  end if;
  if (select count(*) from pg_proc where proname = 'fn_procesar_entrega_maquila') <> 1 then
    raise exception 'Fase 8r: tiene que haber exactamente UNA fn_procesar_entrega_maquila.';
  end if;
  if exists (select 1 from pg_indexes where indexname = 'uq_corte_colores_nombre') then
    raise exception 'Fase 8r: sigue el índice viejo uq_corte_colores_nombre (no dejaría cortar las dos partes).';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'prod_corte_colores' and column_name = 'parte') then
    raise exception 'Fase 8r: falta prod_corte_colores.parte.';
  end if;
  raise notice 'Fase 8r aplicada: conjuntos de dos partes.';
end $VERIF8R$;

-- ============================================================
-- DESHACER (solo si no se registró ningún corte de conjunto):
--   drop table if exists prod_prenda_partes;
--   alter table prod_prendas drop column if exists es_conjunto;
--   drop index if exists uq_corte_colores_nombre_parte;
--   create unique index uq_corte_colores_nombre on prod_corte_colores (corte_id, lower(btrim(color)));
--   alter table prod_corte_colores drop column if exists parte;
--   alter table prod_maquila_colores drop column if exists costo_unitario;
--   -- y restaurar fn_registrar_corte (8k / reparar_fase8k), fn_sync_maquila_colores (7b)
--   -- y fn_procesar_entrega_maquila (8o) — SOLO esas funciones, no los archivos enteros.
-- ============================================================
