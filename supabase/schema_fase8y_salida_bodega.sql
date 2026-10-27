-- Panorama — Bear & Trend · Fase 8y: mandar desde bodega mercadería vieja
-- Ejecutar DESPUÉS de schema_fase8x_convertir_a_conjunto.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- EL PROBLEMA (dueño, 2026-10-27)
--
-- En la bodega física hay hoodies y camisetas de antes de la app que van a
-- ferias y locales, unas básicas y otras estampadas. No vienen de maquila, así
-- que Envío no las ve, y las estampadas tienen que contar en la orden de
-- estampado (metros) como cualquier otro lote.
--
-- LA SOLUCIÓN
--
-- "Mandar desde bodega": se escribe la prenda, el costo por prenda y el cuadro
-- colores × tallas, y se reparte igual que en Envío (bodega / locales / feria,
-- con los estampados dentro de cada destino). fn_repartir_desde_bodega es la
-- hermana de fn_repartir_entrega_maquila (8t) sin maquila ni entrega:
--   · lo que se queda en BODEGA entra al stock (antes no estaba en el sistema);
--   · las básicas a locales o feria salen directo (en feria, como 'estancada');
--   · las estampadas son lotes pendientes con su destino y su TONO guardados en
--     el lote (no tienen corte de donde sacarlo) y su `salida_id`, para que
--     Estampados los agrupe y entren en la orden de impresión.
-- Cada color es una llamada con su id (`prod_salidas_bodega`): un reintento
-- devuelve {"ya_hecho": true} y no duplica.
-- ════════════════════════════════════════════════════════════

alter table prod_lotes_estampado add column if not exists tono text;
alter table prod_lotes_estampado drop constraint if exists prod_lotes_estampado_tono_check;
alter table prod_lotes_estampado add constraint prod_lotes_estampado_tono_check
  check (tono is null or tono in ('claro', 'oscuro'));
alter table prod_lotes_estampado add column if not exists salida_id uuid;

comment on column prod_lotes_estampado.tono is
  'Fase 8y: claro / oscuro de un lote SIN producción (salida desde bodega). Los de producción lo toman del corte.';

alter table prod_bodega_ingresos drop constraint if exists prod_bodega_ingresos_origen_check;
alter table prod_bodega_ingresos add constraint prod_bodega_ingresos_origen_check
  check (origen in ('envio', 'estampado', 'feria', 'manual'));

-- Registro de cada color mandado desde bodega. Su id lo genera la pantalla:
-- es la clave que evita repartir dos veces el mismo color.
create table if not exists prod_salidas_bodega (
  id uuid primary key,
  created_at timestamptz not null default now(),
  salida_id uuid not null,
  prenda_id uuid references prod_prendas (id) on delete set null,
  prenda_nombre text not null,
  color text not null,
  tono text check (tono is null or tono in ('claro', 'oscuro')),
  tallas jsonb not null,
  unidades integer not null check (unidades > 0),
  costo_produccion numeric(10,2) not null check (costo_produccion >= 0)
);

alter table prod_salidas_bodega enable row level security;

drop policy if exists "admin_all_prod_salidas_bodega" on prod_salidas_bodega;
create policy "admin_all_prod_salidas_bodega" on prod_salidas_bodega
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- ============================================================
-- fn_repartir_desde_bodega: un color, repartido como en Envío
--
--    p_reparto: la misma forma que fn_repartir_entrega_maquila (8t):
--    {"costo_produccion", "costo_estampado", "bodega": {basicos, disenos},
--     "local": {..., local_destino, producto_codigo, precio}, "feria": {..., feria_id}}
-- ============================================================

create or replace function fn_repartir_desde_bodega(
  p_id uuid,
  p_salida_id uuid,
  p_prenda_id uuid,
  p_prenda_nombre text,
  p_color text,
  p_tono text,
  p_tallas jsonb,
  p_reparto jsonb
) returns jsonb
language plpgsql as $$
declare
  v_tallas   jsonb;
  v_prenda   text := btrim(coalesce(p_prenda_nombre, ''));
  v_color    text := btrim(coalesce(p_color, ''));
  v_t        record;
  v_d        text;
  v_que      text;
  v_dest     jsonb;
  v_basicos  jsonb;
  v_disenos  jsonb;
  v_est      jsonb;
  v_plan     jsonb := '{}'::jsonb;
  v_asignado jsonb := '{}'::jsonb;
  v_llego    integer;
  v_n_bas    integer;
  v_n_est    integer;
  v_cp       numeric;
  v_ce       numeric;
  v_op       numeric;
  v_precio   numeric;
  v_feria_id uuid;
  v_resumen  jsonb := '{}'::jsonb;
  v_lotes    integer := 0;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede mandar mercadería desde la bodega.';
  end if;
  if p_id is null or p_salida_id is null then
    raise exception 'Falta el identificador de la salida.';
  end if;
  -- Reintento: este color ya se repartió.
  if exists (select 1 from prod_salidas_bodega where id = p_id) then
    return jsonb_build_object('ya_hecho', true);
  end if;
  if v_prenda = '' then
    raise exception 'Escribe qué prenda es.';
  end if;
  if v_color = '' then
    raise exception 'Cada fila necesita su color.';
  end if;
  if p_tono is not null and p_tono not in ('claro', 'oscuro') then
    raise exception 'Tono inválido.';
  end if;

  v_tallas := fn_tallas_reparto(p_tallas, v_color);
  if fn_total_tallas(v_tallas) = 0 then
    raise exception '%: escribe cuántas hay de cada talla.', v_color;
  end if;

  v_cp := (p_reparto ->> 'costo_produccion')::numeric;
  v_ce := coalesce((p_reparto ->> 'costo_estampado')::numeric, 0);
  if v_cp is null or v_cp < 0 or v_ce < 0 then
    raise exception 'Escribe el costo por prenda.';
  end if;

  -- ── leer y validar cada destino (igual que la 8t) ──
  foreach v_d in array array['bodega', 'local', 'feria'] loop
    v_dest := p_reparto -> v_d;
    if v_dest is null or jsonb_typeof(v_dest) <> 'object' then
      continue;
    end if;
    v_que := v_color || ' — ' || case v_d when 'bodega' then 'Bodega' when 'local' then 'Locales' else 'Feria' end;
    v_basicos := fn_tallas_reparto(v_dest -> 'basicos', v_que || ', básicos');
    v_disenos := fn_disenos_reparto(v_dest -> 'disenos', v_que);
    v_est := '{}'::jsonb;
    for v_t in select value as dis from jsonb_array_elements(v_disenos) loop
      v_est := fn_sumar_tallas(v_est, v_t.dis -> 'tallas');
    end loop;
    if fn_total_tallas(v_basicos) + fn_total_tallas(v_est) = 0 then
      continue;  -- este color no va a ese destino
    end if;
    v_plan := v_plan || jsonb_build_object(v_d, jsonb_build_object(
                'basicos', v_basicos, 'disenos', v_disenos, 'est', v_est));
    v_asignado := fn_sumar_tallas(fn_sumar_tallas(v_asignado, v_basicos), v_est);
  end loop;

  if v_plan = '{}'::jsonb then
    raise exception '%: no va a ningún destino.', v_color;
  end if;

  for v_t in
    select k as talla from (
      select jsonb_object_keys(v_tallas) as k
      union select jsonb_object_keys(v_asignado)) u
  loop
    v_llego := coalesce((v_tallas ->> v_t.talla)::int, 0);
    if coalesce((v_asignado ->> v_t.talla)::int, 0) <> v_llego then
      raise exception '%, talla %: hay % y repartiste %. Cada talla tiene que cuadrar exacto.',
        v_color, v_t.talla, v_llego, coalesce((v_asignado ->> v_t.talla)::int, 0);
    end if;
  end loop;

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

  insert into prod_salidas_bodega (id, salida_id, prenda_id, prenda_nombre, color, tono, tallas, unidades, costo_produccion)
  values (p_id, p_salida_id, p_prenda_id, v_prenda, v_color, p_tono, v_tallas, fn_total_tallas(v_tallas), v_cp);

  -- ── escribir ──
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

    if v_n_bas > 0 then
      if v_d = 'bodega' then
        for v_t in select key as talla, value::int as n from jsonb_each_text(v_basicos) loop
          perform fn_sumar_stock_online(p_prenda_id, v_prenda, v_color, '', v_t.talla, v_t.n);
        end loop;
        insert into prod_bodega_ingresos (origen, prenda_id, prenda_nombre, color, estampado, tallas, unidades,
                                          costo_produccion, costo_estampado, costo_operativo, costo_unitario)
        values ('manual', p_prenda_id, v_prenda, v_color, '', v_basicos, v_n_bas, v_cp, 0, v_op, v_cp + v_op);
      elsif v_d = 'local' then
        insert into prod_envios_locales (fecha, prenda_id, prenda_nombre, color, estampado, tallas,
                                         unidades, precio_unitario, costo_unitario, ingreso, margen,
                                         producto_codigo, local_destino,
                                         costo_produccion, costo_estampado, costo_operativo)
        values (fn_hoy_ecuador(), p_prenda_id, v_prenda, v_color, '', v_basicos,
                v_n_bas, v_precio, v_cp + v_op,
                round(v_n_bas * v_precio, 2),
                round(v_n_bas * (v_precio - v_cp - v_op), 2),
                nullif(btrim(coalesce(p_reparto #>> '{local,producto_codigo}', '')), ''),
                nullif(btrim(coalesce(p_reparto #>> '{local,local_destino}', '')), ''),
                v_cp, 0, v_op);
      else
        insert into prod_feria_ingresos (feria_id, origen, prenda_id, prenda_nombre, color, estampado, tallas,
                                         unidades, costo_unitario, costo_produccion, costo_estampado, costo_operativo)
        values (v_feria_id, 'estancada', p_prenda_id, v_prenda, v_color, '', v_basicos,
                v_n_bas, v_cp + v_op, v_cp, 0, v_op);
      end if;
    end if;

    if v_n_est > 0 then
      insert into prod_lotes_estampado (prenda_id, prenda_nombre, color, tallas, total_unidades, disenos,
                                        costo_unitario, costo_total, estado, destino, feria_id, local_destino,
                                        producto_codigo, precio_local, costo_produccion, costo_operativo,
                                        tono, salida_id)
      values (p_prenda_id, v_prenda, v_color, v_est, v_n_est, v_disenos,
              v_ce, round(v_n_est * v_ce, 2), 'pendiente', v_d,
              case when v_d = 'feria' then v_feria_id end,
              case when v_d = 'local' then nullif(btrim(coalesce(p_reparto #>> '{local,local_destino}', '')), '') end,
              case when v_d = 'local' then nullif(btrim(coalesce(p_reparto #>> '{local,producto_codigo}', '')), '') end,
              case when v_d = 'local' then v_precio end,
              v_cp, v_op, p_tono, p_salida_id);
      v_lotes := v_lotes + 1;
    end if;

    v_resumen := v_resumen || jsonb_build_object(v_d, jsonb_build_object('basicos', v_n_bas, 'estampadas', v_n_est));
  end loop;

  return v_resumen || jsonb_build_object('lotes_estampado', v_lotes, 'ya_hecho', false);
end $$;

revoke execute on function fn_repartir_desde_bodega(uuid, uuid, uuid, text, text, text, jsonb, jsonb) from anon, public;
grant execute on function fn_repartir_desde_bodega(uuid, uuid, uuid, text, text, text, jsonb, jsonb) to authenticated;

do $VERIF8Y$
begin
  if (select count(*) from pg_proc where proname = 'fn_repartir_desde_bodega') <> 1 then
    raise exception 'Fase 8y: tiene que haber exactamente UNA fn_repartir_desde_bodega.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_salidas_bodega'
                 and policyname = 'admin_all_prod_salidas_bodega') then
    raise exception 'Fase 8y: falta la política de prod_salidas_bodega.';
  end if;
  raise notice 'Fase 8y aplicada: mandar desde bodega.';
end $VERIF8Y$;
