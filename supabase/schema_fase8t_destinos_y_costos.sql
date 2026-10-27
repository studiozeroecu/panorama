-- Panorama — Bear & Trend · Fase 8t: tres destinos, estampado dentro de cada
-- uno, y costo completo en cada salida
-- Ejecutar DESPUÉS de schema_fase8s_reparto_ferias.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- QUÉ CAMBIA (decisiones del dueño, 2026-10-27, sobre la 8s)
--
-- · Los destinos de Envío son TRES: BODEGA (el "stock online" de siempre; la
--   venta en línea sale de ahí), LOCALES y FERIA. Estampado deja de ser un
--   destino.
-- · Dentro de CADA destino se dice cuántas van con cada estampado, talla por
--   talla; lo que no lleva estampado va BÁSICO. Las básicas llegan ya a su
--   destino. Las estampadas se van al taller con el destino ANOTADO en el lote,
--   y fn_retornar_lote_estampado las entrega solas a esa bodega, local o feria.
-- · Cada salida guarda su costo COMPLETO, congelado el día que sale:
--     producción (tela + maquila + horas + insumos + fijos, por prenda)
--   + estampado (por defecto $2,50, solo a las estampadas)
--   + costo operativo: locales $2,50, feria $5, bodega $0 (se suma cuando sale
--     de la bodega a vender; la venta en línea lleva $5).
--   El costo de producción lo calcula la pantalla con la misma función que el
--   panel de costo del corte (costoDeCorte) y la base lo guarda.
--
-- fn_repartir_entrega_maquila conserva la firma (uuid, jsonb): cambia la forma
-- de p_reparto. La de la 8s no la llamaba ningún deploy todavía.
-- fn_retornar_lote_estampado conserva la firma (uuid, date): los lotes viejos
-- (sin destino ni tallas por diseño) vuelven a la bodega como siempre.
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- 1) Costo operativo por destino
--
--    Cambiar una tarifa = `create or replace` de esta función y la constante
--    COSTO_OPERATIVO de src/lib/produccion/reparto.ts (solo para mostrar).
-- ============================================================

create or replace function fn_costo_operativo(p_destino text)
returns numeric
language sql immutable as $$
  select case p_destino
    when 'local'  then 2.50
    when 'feria'  then 5.00
    when 'online' then 5.00
    else 0
  end::numeric
$$;

-- ============================================================
-- 2) Columnas de costo en cada salida
-- ============================================================

-- Lote de estampado: a dónde va al volver, y el costo congelado al salir.
alter table prod_lotes_estampado add column if not exists destino text;
alter table prod_lotes_estampado drop constraint if exists prod_lotes_estampado_destino_check;
alter table prod_lotes_estampado add constraint prod_lotes_estampado_destino_check
  check (destino is null or destino in ('bodega', 'local', 'feria'));
alter table prod_lotes_estampado add column if not exists feria_id uuid references prod_ferias (id) on delete restrict;
alter table prod_lotes_estampado add column if not exists local_destino text;
alter table prod_lotes_estampado add column if not exists producto_codigo text;
alter table prod_lotes_estampado add column if not exists precio_local numeric(10,2);
alter table prod_lotes_estampado add column if not exists costo_produccion numeric(10,2);
alter table prod_lotes_estampado add column if not exists costo_operativo numeric(10,2);

comment on column prod_lotes_estampado.destino is
  'Fase 8t: a dónde entra al volver del taller. null = lote anterior: vuelve a la bodega.';

-- Envío a locales: ahora puede ir estampado, y guarda el desglose del costo.
-- costo_unitario sigue siendo el TOTAL (el margen se calcula contra él).
alter table prod_envios_locales add column if not exists estampado text not null default '';
alter table prod_envios_locales add column if not exists costo_produccion numeric(10,2);
alter table prod_envios_locales add column if not exists costo_estampado numeric(10,2);
alter table prod_envios_locales add column if not exists costo_operativo numeric(10,2);
alter table prod_envios_locales add column if not exists lote_estampado_id uuid
  references prod_lotes_estampado (id) on delete set null;

alter table prod_feria_ingresos add column if not exists costo_produccion numeric(10,2);
alter table prod_feria_ingresos add column if not exists costo_estampado numeric(10,2);
alter table prod_feria_ingresos add column if not exists costo_operativo numeric(10,2);
alter table prod_feria_ingresos add column if not exists lote_estampado_id uuid
  references prod_lotes_estampado (id) on delete set null;

-- Bodega: prod_stock_online suma por prenda/color/estampado/talla y no puede
-- guardar el costo de cada lote. Esta tabla es el registro de cada ENTRADA,
-- con su costo, igual que prod_feria_ingresos.
create table if not exists prod_bodega_ingresos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default fn_hoy_ecuador(),
  origen text not null check (origen in ('envio', 'estampado')),
  entrega_id uuid references prod_maquila_entregas (id) on delete set null,
  lote_estampado_id uuid references prod_lotes_estampado (id) on delete set null,
  maquila_id uuid references prod_maquilas (id) on delete set null,
  prenda_id uuid references prod_prendas (id) on delete set null,
  prenda_nombre text not null default '',
  color text not null default '',
  estampado text not null default '',
  tallas jsonb not null default '{}'::jsonb,
  unidades integer not null check (unidades > 0),
  costo_produccion numeric(10,2),
  costo_estampado numeric(10,2),
  costo_operativo numeric(10,2),
  costo_unitario numeric(10,2) not null default 0 check (costo_unitario >= 0)
);

alter table prod_bodega_ingresos enable row level security;

drop policy if exists "admin_all_prod_bodega_ingresos" on prod_bodega_ingresos;
create policy "admin_all_prod_bodega_ingresos" on prod_bodega_ingresos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- ============================================================
-- 3) Ayudantes de tallas
-- ============================================================

create or replace function fn_sumar_tallas(a jsonb, b jsonb)
returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(t, n), '{}'::jsonb)
  from (select t, sum(n)::int as n
        from (select key as t, value::int as n from jsonb_each_text(coalesce(a, '{}'::jsonb))
              union all
              select key, value::int from jsonb_each_text(coalesce(b, '{}'::jsonb))) x
        group by t
        having sum(n) <> 0) y
$$;

create or replace function fn_total_tallas(a jsonb)
returns integer
language sql immutable as $$
  select coalesce(sum(value::int), 0)::int from jsonb_each_text(coalesce(a, '{}'::jsonb))
$$;

-- Diseños de la pantalla → [{nombre, unidades, tallas}] limpios. Un nombre sin
-- unidades o unidades sin nombre es un error, no se descarta en silencio.
create or replace function fn_disenos_reparto(p jsonb, p_que text)
returns jsonb
language plpgsql immutable as $$
declare
  v_d      record;
  v_nombre text;
  v_dt     jsonb;
  v_suma   integer;
  v_out    jsonb := '[]'::jsonb;
begin
  for v_d in
    select d.value as dis, d.ord
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) with ordinality as d(value, ord)
  loop
    v_nombre := btrim(coalesce(v_d.dis ->> 'nombre', ''));
    v_dt := fn_tallas_reparto(v_d.dis -> 'tallas',
              p_que || ', diseño ' || case when v_nombre = '' then '#' || v_d.ord else '"' || v_nombre || '"' end);
    v_suma := fn_total_tallas(v_dt);
    if v_nombre = '' and v_suma = 0 then
      continue;  -- fila vacía de la pantalla
    end if;
    if v_nombre = '' then
      raise exception '%: hay un diseño con unidades pero sin nombre.', p_que;
    end if;
    if v_suma = 0 then
      raise exception '%: el diseño "%" no tiene unidades.', p_que, v_nombre;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('nombre', v_nombre, 'unidades', v_suma, 'tallas', v_dt));
  end loop;
  return v_out;
end $$;

-- ============================================================
-- 4) fn_repartir_entrega_maquila — tres destinos, estampado dentro de cada uno
--
--    p_reparto:
--    {
--      "costo_produccion": 6.40,           -- por prenda, sin estampado ni operativo
--      "costo_estampado": 2.50,            -- por prenda estampada
--      "bodega": {"basicos": {"S":2}, "disenos": [{"nombre":"Logo","tallas":{"S":1}}]},
--      "local":  {"basicos": {...}, "disenos": [...], "local_destino":"PK",
--                 "producto_codigo":"MS01", "precio":12},
--      "feria":  {"basicos": {...}, "disenos": [...], "feria_id":"…"}
--    }
--    Un destino que no viene (o viene null) no se usa. Cada talla tiene que
--    cuadrar EXACTO con lo que llegó: suma de básicos + diseños de los tres.
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
  v_d             text;
  v_que           text;
  v_dest          jsonb;
  v_basicos       jsonb;
  v_disenos       jsonb;
  v_est           jsonb;
  v_plan          jsonb := '{}'::jsonb;
  v_asignado      jsonb := '{}'::jsonb;
  v_llego         integer;
  v_n_bas         integer;
  v_n_est         integer;
  v_cp            numeric;
  v_ce            numeric;
  v_op            numeric;
  v_precio        numeric;
  v_feria_id      uuid;
  v_resumen       jsonb := '{}'::jsonb;
  v_lotes         integer := 0;
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

  v_cp := coalesce((p_reparto ->> 'costo_produccion')::numeric, 0);
  v_ce := coalesce((p_reparto ->> 'costo_estampado')::numeric, 0);
  if v_cp < 0 or v_ce < 0 then
    raise exception 'Costo inválido.';
  end if;

  -- ── 1ª pasada: leer y validar cada destino ────────────────
  foreach v_d in array array['bodega', 'local', 'feria'] loop
    v_dest := p_reparto -> v_d;
    if v_dest is null or jsonb_typeof(v_dest) <> 'object' then
      continue;
    end if;
    v_que := case v_d when 'bodega' then 'Bodega' when 'local' then 'Locales' else 'Feria' end;
    v_basicos := fn_tallas_reparto(v_dest -> 'basicos', v_que || ', básicos');
    v_disenos := fn_disenos_reparto(v_dest -> 'disenos', v_que);
    v_est := '{}'::jsonb;
    for v_t in select value as dis from jsonb_array_elements(v_disenos) loop
      v_est := fn_sumar_tallas(v_est, v_t.dis -> 'tallas');
    end loop;
    if fn_total_tallas(v_basicos) + fn_total_tallas(v_est) = 0 then
      raise exception '% está marcado pero no tiene unidades.', v_que;
    end if;
    v_plan := v_plan || jsonb_build_object(v_d, jsonb_build_object(
                'basicos', v_basicos, 'disenos', v_disenos, 'est', v_est));
    v_asignado := fn_sumar_tallas(fn_sumar_tallas(v_asignado, v_basicos), v_est);
  end loop;

  if v_plan = '{}'::jsonb then
    raise exception 'Marca al menos un destino.';
  end if;

  -- ── cada talla tiene que cuadrar EXACTO con lo que llegó ──
  for v_t in
    select k as talla from (
      select jsonb_object_keys(v_tallas) as k
      union select jsonb_object_keys(v_asignado)) u
  loop
    v_llego := coalesce((v_tallas ->> v_t.talla)::int, 0);
    if coalesce((v_asignado ->> v_t.talla)::int, 0) <> v_llego then
      raise exception 'Talla %: llegaron % y repartiste %. Cada talla tiene que cuadrar exacto.',
        v_t.talla, v_llego, coalesce((v_asignado ->> v_t.talla)::int, 0);
    end if;
  end loop;

  -- La feria se valida una vez, antes de escribir nada.
  if v_plan ? 'feria' then
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
  end if;

  -- ── 2ª pasada: escribir ───────────────────────────────────
  foreach v_d in array array['bodega', 'local', 'feria'] loop
    if not (v_plan ? v_d) then
      continue;
    end if;
    v_basicos := v_plan #> array[v_d, 'basicos'];
    v_disenos := v_plan #> array[v_d, 'disenos'];
    v_est     := v_plan #> array[v_d, 'est'];
    v_n_bas := fn_total_tallas(v_basicos);
    v_n_est := fn_total_tallas(v_est);
    v_op := fn_costo_operativo(v_d);
    v_precio := coalesce((p_reparto #>> array[v_d, 'precio'])::numeric, 0);

    -- básicas: llegan ya a su destino
    if v_n_bas > 0 then
      if v_d = 'bodega' then
        for v_t in select key as talla, value::int as n from jsonb_each_text(v_basicos) loop
          perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_color, '', v_t.talla, v_t.n);
        end loop;
        insert into prod_bodega_ingresos (origen, entrega_id, maquila_id, prenda_id, prenda_nombre, color,
                                          estampado, tallas, unidades, costo_produccion, costo_estampado,
                                          costo_operativo, costo_unitario)
        values ('envio', p_entrega_id, v_maquila_id, v_prenda_id, v_prenda_nombre, v_color,
                '', v_basicos, v_n_bas, v_cp, 0, v_op, v_cp + v_op);
      elsif v_d = 'local' then
        insert into prod_envios_locales (fecha, maquila_id, prenda_id, prenda_nombre, color, estampado, tallas,
                                         unidades, precio_unitario, costo_unitario, ingreso, margen,
                                         producto_codigo, local_destino,
                                         costo_produccion, costo_estampado, costo_operativo)
        values (fn_hoy_ecuador(), v_maquila_id, v_prenda_id, v_prenda_nombre, v_color, '', v_basicos,
                v_n_bas, v_precio, v_cp + v_op,
                round(v_n_bas * v_precio, 2),
                round(v_n_bas * (v_precio - v_cp - v_op), 2),
                nullif(btrim(coalesce(p_reparto #>> '{local,producto_codigo}', '')), ''),
                nullif(btrim(coalesce(p_reparto #>> '{local,local_destino}', '')), ''),
                v_cp, 0, v_op);
      else
        insert into prod_feria_ingresos (feria_id, origen, entrega_id, maquila_id, prenda_id, prenda_nombre,
                                         color, estampado, tallas, unidades, costo_unitario,
                                         costo_produccion, costo_estampado, costo_operativo)
        values (v_feria_id, 'envio', p_entrega_id, v_maquila_id, v_prenda_id, v_prenda_nombre,
                v_color, '', v_basicos, v_n_bas, v_cp + v_op, v_cp, 0, v_op);
      end if;
    end if;

    -- estampadas: un lote al taller con su destino anotado
    if v_n_est > 0 then
      insert into prod_lotes_estampado (maquila_id, prenda_id, prenda_nombre, color, tallas,
                                        total_unidades, disenos, costo_unitario, costo_total, estado,
                                        destino, feria_id, local_destino, producto_codigo, precio_local,
                                        costo_produccion, costo_operativo)
      values (v_maquila_id, v_prenda_id, v_prenda_nombre, v_color, v_est,
              v_n_est, v_disenos, v_ce, round(v_n_est * v_ce, 2), 'pendiente',
              v_d,
              case when v_d = 'feria' then v_feria_id end,
              case when v_d = 'local' then nullif(btrim(coalesce(p_reparto #>> '{local,local_destino}', '')), '') end,
              case when v_d = 'local' then nullif(btrim(coalesce(p_reparto #>> '{local,producto_codigo}', '')), '') end,
              case when v_d = 'local' then v_precio end,
              v_cp, v_op);
      v_lotes := v_lotes + 1;
    end if;

    v_resumen := v_resumen || jsonb_build_object(v_d, jsonb_build_object('basicos', v_n_bas, 'estampadas', v_n_est));
  end loop;

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

  return v_resumen || jsonb_build_object('lotes_estampado', v_lotes);
end $$;

-- ============================================================
-- 5) fn_retornar_lote_estampado — cada diseño entra a SU destino
--
--    Misma firma y mismas guardas que la 8a (lock, reintento tranquilo,
--    'en_taller' estricto). Lo nuevo: si el lote trae tallas por diseño (8s en
--    adelante), cada diseño entra con su propio nombre de estampado al destino
--    anotado, con el costo congelado al salir + el estampado. Los lotes viejos
--    siguen el camino de siempre: a la bodega, con los diseños juntos.
-- ============================================================

create or replace function fn_retornar_lote_estampado(
  p_lote_id uuid,
  p_fecha date default null
) returns jsonb
language plpgsql as $$
declare
  v_fecha       date;
  v_estado      text;
  v_destino     text;
  v_prenda_id   uuid;
  v_prenda      text;
  v_color       text;
  v_tallas      jsonb;
  v_total_lote  integer;
  v_disenos     jsonb;
  v_maquila_id  uuid;
  v_cp          numeric;
  v_ce          numeric;
  v_op          numeric;
  v_precio      numeric;
  v_feria_id    uuid;
  v_etiqueta    text;
  v_repartidas  jsonb;
  v_suma_tallas integer;
  v_total       integer := 0;
  v_t           record;
  v_d           record;
  v_n           integer;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede registrar retornos de estampado.';
  end if;

  v_fecha := coalesce(p_fecha, fn_hoy_ecuador());

  -- Lock de la fila: dos llamadas simultáneas se serializan aquí.
  perform 1 from prod_lotes_estampado where id = p_lote_id for update;
  if not found then
    raise exception 'El lote de estampado no existe.';
  end if;

  v_estado     := (select estado         from prod_lotes_estampado where id = p_lote_id);
  v_total_lote := (select total_unidades from prod_lotes_estampado where id = p_lote_id);
  v_tallas     := (select tallas         from prod_lotes_estampado where id = p_lote_id);

  -- Un reintento NO es un error (8a, D4).
  if v_estado = 'retornado' then
    return jsonb_build_object(
      'ya_retornado',  true,
      'unidades',      v_total_lote,
      'fecha_retorno', (select fecha_retorno from prod_lotes_estampado where id = p_lote_id),
      'tallas',        v_tallas);
  end if;
  if v_estado <> 'en_taller' then
    raise exception 'El lote todavía no se ha enviado al taller.';
  end if;

  v_destino    := coalesce((select destino from prod_lotes_estampado where id = p_lote_id), 'bodega');
  v_prenda_id  := (select prenda_id        from prod_lotes_estampado where id = p_lote_id);
  v_prenda     := (select prenda_nombre    from prod_lotes_estampado where id = p_lote_id);
  v_color      := (select color            from prod_lotes_estampado where id = p_lote_id);
  v_disenos    := coalesce((select disenos from prod_lotes_estampado where id = p_lote_id), '[]'::jsonb);
  v_maquila_id := (select maquila_id       from prod_lotes_estampado where id = p_lote_id);
  v_cp         := (select costo_produccion from prod_lotes_estampado where id = p_lote_id);
  v_ce         := coalesce((select costo_unitario from prod_lotes_estampado where id = p_lote_id), 0);
  v_op         := coalesce((select costo_operativo from prod_lotes_estampado where id = p_lote_id), 0);
  v_precio     := coalesce((select precio_local from prod_lotes_estampado where id = p_lote_id), 0);
  v_feria_id   := (select feria_id         from prod_lotes_estampado where id = p_lote_id);

  if jsonb_array_length(v_disenos) > 0
     and not exists (select 1 from jsonb_array_elements(v_disenos) d where not (d.value ? 'tallas')) then
    -- ── lote con tallas por diseño: cada diseño a su destino ──
    for v_d in select d.value as dis from jsonb_array_elements(v_disenos) d loop
      v_etiqueta := btrim(v_d.dis ->> 'nombre');
      v_n := fn_total_tallas(v_d.dis -> 'tallas');
      continue when v_n <= 0;

      if v_destino = 'bodega' then
        for v_t in select key as talla, value::int as n from jsonb_each_text(v_d.dis -> 'tallas') loop
          perform fn_sumar_stock_online(v_prenda_id, v_prenda, v_color, v_etiqueta, v_t.talla, v_t.n);
        end loop;
        insert into prod_bodega_ingresos (fecha, origen, lote_estampado_id, maquila_id, prenda_id, prenda_nombre,
                                          color, estampado, tallas, unidades, costo_produccion, costo_estampado,
                                          costo_operativo, costo_unitario)
        values (v_fecha, 'estampado', p_lote_id, v_maquila_id, v_prenda_id, v_prenda,
                v_color, v_etiqueta, v_d.dis -> 'tallas', v_n, v_cp, v_ce, v_op,
                coalesce(v_cp, 0) + v_ce + v_op);
      elsif v_destino = 'local' then
        insert into prod_envios_locales (fecha, maquila_id, prenda_id, prenda_nombre, color, estampado, tallas,
                                         unidades, precio_unitario, costo_unitario, ingreso, margen,
                                         producto_codigo, local_destino, lote_estampado_id,
                                         costo_produccion, costo_estampado, costo_operativo)
        values (v_fecha, v_maquila_id, v_prenda_id, v_prenda, v_color, v_etiqueta, v_d.dis -> 'tallas',
                v_n, v_precio, coalesce(v_cp, 0) + v_ce + v_op,
                round(v_n * v_precio, 2),
                round(v_n * (v_precio - coalesce(v_cp, 0) - v_ce - v_op), 2),
                (select producto_codigo from prod_lotes_estampado where id = p_lote_id),
                (select local_destino from prod_lotes_estampado where id = p_lote_id),
                p_lote_id, v_cp, v_ce, v_op);
      else
        insert into prod_feria_ingresos (feria_id, fecha, origen, lote_estampado_id, maquila_id, prenda_id,
                                         prenda_nombre, color, estampado, tallas, unidades, costo_unitario,
                                         costo_produccion, costo_estampado, costo_operativo)
        values (v_feria_id, v_fecha, 'estampado', p_lote_id, v_maquila_id, v_prenda_id,
                v_prenda, v_color, v_etiqueta, v_d.dis -> 'tallas', v_n, coalesce(v_cp, 0) + v_ce + v_op,
                v_cp, v_ce, v_op);
      end if;
      v_total := v_total + v_n;
    end loop;

  else
    -- ── lote anterior a la 8s: a la bodega, como en la 8a ──
    v_etiqueta := (select coalesce(string_agg(btrim(d.value ->> 'nombre'), ', ' order by d.ord), '')
                   from jsonb_array_elements(v_disenos) with ordinality as d(value, ord)
                   where btrim(coalesce(d.value ->> 'nombre', '')) <> '');
    v_suma_tallas := fn_total_tallas(v_tallas);
    if v_suma_tallas < v_total_lote then
      raise exception
        'El lote dice % unidades pero sus tallas solo suman %. Corrige el desglose antes de registrar el retorno.',
        v_total_lote, v_suma_tallas;
    end if;
    v_repartidas := fn_repartir_por_talla(v_tallas, v_total_lote);
    for v_t in select key as talla, value::int as n from jsonb_each_text(v_repartidas) loop
      perform fn_sumar_stock_online(v_prenda_id, v_prenda, v_color, v_etiqueta, v_t.talla, v_t.n);
      v_total := v_total + v_t.n;
    end loop;
  end if;

  update prod_lotes_estampado
     set estado = 'retornado', fecha_retorno = v_fecha
   where id = p_lote_id;

  return jsonb_build_object(
    'ya_retornado', false,
    'unidades',     v_total,
    'destino',      v_destino,
    'fecha_retorno', v_fecha);
end $$;

revoke execute on function fn_repartir_entrega_maquila(uuid, jsonb) from anon, public;
grant execute on function fn_repartir_entrega_maquila(uuid, jsonb) to authenticated;

-- ============================================================
-- Verificación final — solo mira.
-- ============================================================

do $VERIF8T$
begin
  if (select count(*) from pg_proc where proname = 'fn_repartir_entrega_maquila') <> 1 then
    raise exception 'Fase 8t: tiene que haber exactamente UNA fn_repartir_entrega_maquila.';
  end if;
  if (select count(*) from pg_proc where proname = 'fn_retornar_lote_estampado') <> 1 then
    raise exception 'Fase 8t: tiene que haber exactamente UNA fn_retornar_lote_estampado.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_bodega_ingresos'
                 and policyname = 'admin_all_prod_bodega_ingresos') then
    raise exception 'Fase 8t: falta la política de prod_bodega_ingresos.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'prod_lotes_estampado' and column_name = 'destino') then
    raise exception 'Fase 8t: falta prod_lotes_estampado.destino.';
  end if;
  raise notice 'Fase 8t aplicada: tres destinos, estampado dentro de cada uno y costo completo.';
end $VERIF8T$;
