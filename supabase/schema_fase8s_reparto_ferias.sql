-- Panorama — Bear & Trend · Fase 8s: Envío reparte por talla, y ferias
-- Ejecutar DESPUÉS de schema_fase8r_conjuntos.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- EL PROBLEMA
--
-- En Envío cada entrega de maquila iba a UN solo destino, y lo que no se
-- asignaba caía solo al stock online. A estampado ni siquiera se elegían las
-- tallas: se ponían unidades por diseño y fn_repartir_por_talla adivinaba de
-- qué tallas salían. Y no había forma de mandar mercadería a una feria.
--
-- LA SOLUCIÓN (decisiones del dueño, 2026-10-27)
--
-- · Una entrega se reparte entre VARIOS destinos a la vez — stock online,
--   estampado, locales y feria — talla por talla, y cada talla tiene que
--   cuadrar EXACTO con lo que llegó. Ya no hay "resto que cae al online": si va
--   al online, se escribe en esa columna.
-- · Estampado se escribe por DISEÑO × TALLA. Cada diseño del lote guarda sus
--   tallas (prod_lotes_estampado.disenos gana la clave `tallas`), así que por
--   fin se sabe qué talla lleva qué diseño. lote.tallas = la suma.
-- · FERIA: mercadería que sale a vender en una feria. Aquí solo se registra qué
--   salió, cuántas y a qué costo de producción; lo que se gana se anota a mano
--   en Finanzas (Ventas directas), no desde aquí.
--
-- Esta fase registra las SALIDAS a feria. El cierre (lo que regresa, al stock
-- online o a un local) y la mercadería estancada que se saca de los locales son
-- la fase siguiente; por eso `origen` ya admite 'estancada' y 'estampado'.
--
-- fn_procesar_entrega_maquila (8o / 8r) NO se borra: la app deja de llamarla,
-- pero si se revierte el deploy el código viejo la sigue necesitando. Tiene
-- otro nombre, así que no hay riesgo de sobrecarga.
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- 1) Ferias
-- ============================================================

create table if not exists prod_ferias (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null check (btrim(nombre) <> ''),
  fecha date not null default fn_hoy_ecuador(),
  observaciones text,
  -- null = abierta. Cerrar llega en la fase siguiente (con los retornos).
  cerrada_en timestamptz
);

alter table prod_ferias enable row level security;

drop policy if exists "admin_all_prod_ferias" on prod_ferias;
create policy "admin_all_prod_ferias" on prod_ferias
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- Cada salida de mercadería HACIA una feria. Lo que hay en la feria y lo que se
-- vendió no se guardan: salen de restar los retornos (fase siguiente).
create table if not exists prod_feria_ingresos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- restrict: una feria con mercadería registrada no se borra.
  feria_id uuid not null references prod_ferias (id) on delete restrict,
  fecha date not null default fn_hoy_ecuador(),
  origen text not null check (origen in ('envio', 'estampado', 'estancada')),
  entrega_id uuid references prod_maquila_entregas (id) on delete set null,
  maquila_id uuid references prod_maquilas (id) on delete set null,
  prenda_id uuid references prod_prendas (id) on delete set null,
  prenda_nombre text not null default '',
  color text not null default '',
  estampado text not null default '',
  tallas jsonb not null default '{}'::jsonb,
  unidades integer not null check (unidades > 0),
  -- Costo de producción por unidad al momento de salir (maquila + fijos), como
  -- prod_envios_locales.costo_unitario: se fotografía, no se recalcula.
  costo_unitario numeric(10,2) not null default 0 check (costo_unitario >= 0)
);

create index if not exists ix_feria_ingresos_feria on prod_feria_ingresos (feria_id);

alter table prod_feria_ingresos enable row level security;

drop policy if exists "admin_all_prod_feria_ingresos" on prod_feria_ingresos;
create policy "admin_all_prod_feria_ingresos" on prod_feria_ingresos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- ============================================================
-- 2) fn_tallas_reparto: limpia y valida un mapa talla → unidades
--
--    Devuelve el mapa sin ceros. Rechaza negativos y decimales con un mensaje
--    que dice QUÉ columna está mal; un `::int` a secas daría un error crudo.
-- ============================================================

create or replace function fn_tallas_reparto(p_tallas jsonb, p_que text)
returns jsonb
language plpgsql immutable as $$
declare
  v_t record;
  v_n numeric;
  v_out jsonb := '{}'::jsonb;
begin
  if p_tallas is null or jsonb_typeof(p_tallas) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_tallas) <> 'object' then
    raise exception '%: el desglose por talla no es válido.', p_que;
  end if;
  for v_t in select key as talla, value as valor from jsonb_each(p_tallas) loop
    if jsonb_typeof(v_t.valor) = 'null' then
      continue;
    end if;
    begin
      v_n := (v_t.valor #>> '{}')::numeric;
    exception when others then
      raise exception '%, talla %: "%" no es un número.', p_que, v_t.talla, v_t.valor #>> '{}';
    end;
    if v_n < 0 or v_n <> trunc(v_n) then
      raise exception '%, talla %: la cantidad tiene que ser un entero positivo.', p_que, v_t.talla;
    end if;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object(v_t.talla, v_n::int);
    end if;
  end loop;
  return v_out;
end $$;

-- ============================================================
-- 3) fn_repartir_entrega_maquila: Envío reparte UNA entrega
--
--    p_reparto:
--    {
--      "online":    {"S":2,"M":5},
--      "estampado": {"costo":2, "disenos":[{"nombre":"Logo","tallas":{"S":2}}]},
--      "local":     {"tallas":{"M":3}, "local_destino":"PK", "producto_codigo":"MS01",
--                    "precio":12, "costo_unitario":5},
--      "feria":     {"feria_id":"…", "tallas":{"L":4}, "costo_unitario":5}
--    }
--    Las claves que no vienen (o vienen null) son destinos no usados.
--
--    Misma guarda que fn_procesar_entrega_maquila: lock de la entrega y
--    rechazo si ya está procesada — dos clics no reparten dos veces.
-- ============================================================

create or replace function fn_repartir_entrega_maquila(
  p_entrega_id uuid,
  p_reparto jsonb
) returns jsonb
language plpgsql as $$
declare
  v_mc_id         uuid;
  v_maquila_id    uuid;
  v_color         text;
  v_tallas        jsonb;
  v_prenda_id     uuid;
  v_prenda_nombre text;
  v_parte         text;
  v_t             record;
  v_d             record;
  v_online        jsonb;
  v_local         jsonb;
  v_feria         jsonb;
  v_disenos       jsonb := '[]'::jsonb;
  v_est_tallas    jsonb := '{}'::jsonb;
  v_dt            jsonb;
  v_nombre        text;
  v_suma          integer;
  v_llego         integer;
  v_n_online      integer := 0;
  v_n_est         integer := 0;
  v_n_local       integer := 0;
  v_n_feria       integer := 0;
  v_costo_est     numeric;
  v_precio_local  numeric;
  v_costo_local   numeric;
  v_costo_feria   numeric;
  v_feria_id      uuid;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede procesar lotes.';
  end if;
  if p_reparto is null or jsonb_typeof(p_reparto) <> 'object' then
    raise exception 'Falta el reparto de la entrega.';
  end if;

  -- lock + guarda de idempotencia sobre la ENTREGA
  perform 1 from prod_maquila_entregas where id = p_entrega_id for update;
  if not found then
    raise exception 'La entrega no existe.';
  end if;
  if (select procesado from prod_maquila_entregas where id = p_entrega_id) then
    raise exception 'Esta entrega ya fue procesada.';
  end if;

  v_mc_id  := (select maquila_color_id from prod_maquila_entregas where id = p_entrega_id);
  v_tallas := fn_tallas_reparto((select tallas from prod_maquila_entregas where id = p_entrega_id), 'Entrega');
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

  -- Fase 8r: una parte de un conjunto sale con SU nombre ("Conjunto — Blusa").
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

  -- ── leer y validar cada destino ────────────────────────────
  v_online := fn_tallas_reparto(p_reparto -> 'online', 'Stock online');
  v_local  := fn_tallas_reparto(p_reparto #> '{local,tallas}', 'Locales');
  v_feria  := fn_tallas_reparto(p_reparto #> '{feria,tallas}', 'Feria');

  -- Estampado: cada diseño con nombre y sus tallas. Un nombre sin unidades o
  -- unidades sin nombre es un error de la pantalla, no se descarta en silencio.
  for v_d in
    select d.value as dis, d.ord
    from jsonb_array_elements(coalesce(p_reparto #> '{estampado,disenos}', '[]'::jsonb))
         with ordinality as d(value, ord)
  loop
    v_nombre := btrim(coalesce(v_d.dis ->> 'nombre', ''));
    v_dt := fn_tallas_reparto(v_d.dis -> 'tallas',
              'Diseño ' || case when v_nombre = '' then '#' || v_d.ord else '"' || v_nombre || '"' end);
    v_suma := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_dt));
    if v_nombre = '' and v_suma = 0 then
      continue;  -- fila vacía de la pantalla
    end if;
    if v_nombre = '' then
      raise exception 'Hay un diseño con unidades pero sin nombre.';
    end if;
    if v_suma = 0 then
      raise exception 'El diseño "%" no tiene unidades.', v_nombre;
    end if;
    v_disenos := v_disenos || jsonb_build_array(jsonb_build_object(
                   'nombre', v_nombre, 'unidades', v_suma, 'tallas', v_dt));
    -- suma por talla de todos los diseños
    v_est_tallas := (
      select coalesce(jsonb_object_agg(t, n), '{}'::jsonb)
      from (select t, sum(n)::int as n
            from (select key as t, value::int as n from jsonb_each_text(v_est_tallas)
                  union all
                  select key, value::int from jsonb_each_text(v_dt)) x
            group by t) y);
  end loop;

  -- ── cada talla tiene que cuadrar EXACTO con lo que llegó ──
  for v_t in
    select k as talla from (
      select jsonb_object_keys(v_tallas) as k
      union select jsonb_object_keys(v_online)
      union select jsonb_object_keys(v_local)
      union select jsonb_object_keys(v_feria)
      union select jsonb_object_keys(v_est_tallas)) u
  loop
    v_llego := coalesce((v_tallas ->> v_t.talla)::int, 0);
    v_suma := coalesce((v_online ->> v_t.talla)::int, 0)
            + coalesce((v_local ->> v_t.talla)::int, 0)
            + coalesce((v_feria ->> v_t.talla)::int, 0)
            + coalesce((v_est_tallas ->> v_t.talla)::int, 0);
    if v_suma <> v_llego then
      raise exception 'Talla %: llegaron % y repartiste %. Cada talla tiene que cuadrar exacto.',
        v_t.talla, v_llego, v_suma;
    end if;
  end loop;

  v_n_online := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_online));
  v_n_local  := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_local));
  v_n_feria  := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_feria));
  v_n_est    := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_est_tallas));

  if v_n_online + v_n_local + v_n_feria + v_n_est = 0 then
    raise exception 'La entrega no tiene unidades para repartir.';
  end if;

  -- ── stock online ───────────────────────────────────────────
  for v_t in select key as talla, value::int as n from jsonb_each_text(v_online) loop
    perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_color, '', v_t.talla, v_t.n);
  end loop;

  -- ── estampado: un lote con sus diseños, cada uno con sus tallas ──
  if v_n_est > 0 then
    v_costo_est := coalesce((p_reparto #>> '{estampado,costo}')::numeric, 0);
    if v_costo_est < 0 then
      raise exception 'Costo de estampado inválido.';
    end if;
    insert into prod_lotes_estampado (maquila_id, prenda_id, prenda_nombre, color, tallas,
                                      total_unidades, disenos, costo_unitario, costo_total, estado)
    values (v_maquila_id, v_prenda_id, v_prenda_nombre, v_color, v_est_tallas,
            v_n_est, v_disenos, v_costo_est, round(v_n_est * v_costo_est, 2), 'pendiente');
  end if;

  -- ── locales ────────────────────────────────────────────────
  if v_n_local > 0 then
    v_precio_local := coalesce((p_reparto #>> '{local,precio}')::numeric, 0);
    v_costo_local  := coalesce((p_reparto #>> '{local,costo_unitario}')::numeric, 0);
    insert into prod_envios_locales (fecha, maquila_id, prenda_id, prenda_nombre, color, tallas,
                                     unidades, precio_unitario, costo_unitario, ingreso, margen,
                                     producto_codigo, local_destino)
    values (fn_hoy_ecuador(), v_maquila_id, v_prenda_id, v_prenda_nombre, v_color, v_local,
            v_n_local, v_precio_local, v_costo_local,
            round(v_n_local * v_precio_local, 2),
            round(v_n_local * (v_precio_local - v_costo_local), 2),
            nullif(btrim(coalesce(p_reparto #>> '{local,producto_codigo}', '')), ''),
            nullif(btrim(coalesce(p_reparto #>> '{local,local_destino}', '')), ''));
  end if;

  -- ── feria ──────────────────────────────────────────────────
  if v_n_feria > 0 then
    v_feria_id := nullif(p_reparto #>> '{feria,feria_id}', '')::uuid;
    if v_feria_id is null then
      raise exception 'Elige a qué feria va la mercadería.';
    end if;
    perform 1 from prod_ferias where id = v_feria_id;
    if not found then
      raise exception 'La feria elegida no existe.';
    end if;
    if (select cerrada_en from prod_ferias where id = v_feria_id) is not null then
      raise exception 'Esa feria ya está cerrada.';
    end if;
    v_costo_feria := coalesce((p_reparto #>> '{feria,costo_unitario}')::numeric, 0);
    if v_costo_feria < 0 then
      raise exception 'Costo por unidad inválido.';
    end if;
    insert into prod_feria_ingresos (feria_id, fecha, origen, entrega_id, maquila_id, prenda_id,
                                     prenda_nombre, color, estampado, tallas, unidades, costo_unitario)
    values (v_feria_id, fn_hoy_ecuador(), 'envio', p_entrega_id, v_maquila_id, v_prenda_id,
            v_prenda_nombre, v_color, '', v_feria, v_n_feria, v_costo_feria);
  end if;

  update prod_maquila_entregas
     set procesado = true, procesada_en = now()
   where id = p_entrega_id;

  -- El COLOR queda procesado cuando está entregado completo y no le queda
  -- ninguna entrega sin procesar (misma regla que la 8o).
  if (select estado from prod_maquila_colores where id = v_mc_id) = 'entregado'
     and not exists (select 1 from prod_maquila_entregas
                     where maquila_color_id = v_mc_id and not procesado) then
    update prod_maquila_colores set procesado = true where id = v_mc_id;
  end if;

  return jsonb_build_object(
    'online',    v_n_online,
    'estampado', v_n_est,
    'local',     v_n_local,
    'feria',     v_n_feria
  );
end $$;

revoke execute on function fn_repartir_entrega_maquila(uuid, jsonb) from anon, public;
grant execute on function fn_repartir_entrega_maquila(uuid, jsonb) to authenticated;

-- ============================================================
-- Verificación final — solo mira.
-- ============================================================

do $VERIF8S$
begin
  if (select count(*) from pg_proc where proname = 'fn_repartir_entrega_maquila') <> 1 then
    raise exception 'Fase 8s: tiene que haber exactamente UNA fn_repartir_entrega_maquila.';
  end if;
  if (select count(*) from pg_proc where proname = 'fn_procesar_entrega_maquila') <> 1 then
    raise exception 'Fase 8s: fn_procesar_entrega_maquila tiene que seguir viva (y una sola).';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_ferias'
                 and policyname = 'admin_all_prod_ferias') then
    raise exception 'Fase 8s: falta la política de prod_ferias.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_feria_ingresos'
                 and policyname = 'admin_all_prod_feria_ingresos') then
    raise exception 'Fase 8s: falta la política de prod_feria_ingresos.';
  end if;
  raise notice 'Fase 8s aplicada: reparto por talla y ferias.';
end $VERIF8S$;
