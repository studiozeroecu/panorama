-- Panorama — Bear & Trend · Fase 8u: ferias — mercadería estancada y cierre
-- Ejecutar DESPUÉS de schema_fase8t_destinos_y_costos.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- QUÉ HACE (decisiones del dueño, 2026-10-27)
--
-- · MERCADERÍA ESTANCADA: prendas que se sacan de los locales para venderlas
--   con descuento en una feria. Muchas son de antes de la app, así que se
--   ESCRIBEN a mano: prenda, color, estampado, tallas y costo por prenda. Al
--   entrar a la feria se les suma el operativo de feria ($5).
-- · CIERRE: una sola vez, al terminar. Por cada línea de la feria y por talla
--   se dice cuántas regresan a la BODEGA y cuántas a LOCALES (sin decir a cuál:
--   solo que volvieron a los locales). Lo vendido NO se guarda: es lo que fue
--   menos lo que regresó.
-- · El costo operativo SE REEMPLAZA, no se acumula: lo que regresa a locales
--   queda con el de locales ($2,50) en vez del de feria ($5), y lo que regresa a
--   la bodega con $0.
-- · Lo que regresa a locales y vino de producción queda también como un envío
--   a locales (local sin especificar), igual que los de Envío. La estancada que
--   vuelve a los locales no: ya estaba contada allá.
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- 1) Regresos de una feria
-- ============================================================

create table if not exists prod_feria_retornos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  feria_id uuid not null references prod_ferias (id) on delete restrict,
  -- La línea de la feria de la que regresa: así el costo es el exacto de esa salida.
  ingreso_id uuid not null references prod_feria_ingresos (id) on delete restrict,
  fecha date not null default fn_hoy_ecuador(),
  destino text not null check (destino in ('bodega', 'local')),
  tallas jsonb not null default '{}'::jsonb,
  unidades integer not null check (unidades > 0),
  costo_produccion numeric(10,2),
  costo_estampado numeric(10,2),
  costo_operativo numeric(10,2),
  costo_unitario numeric(10,2) not null default 0 check (costo_unitario >= 0)
);

create index if not exists ix_feria_retornos_feria on prod_feria_retornos (feria_id);

alter table prod_feria_retornos enable row level security;

drop policy if exists "admin_all_prod_feria_retornos" on prod_feria_retornos;
create policy "admin_all_prod_feria_retornos" on prod_feria_retornos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

-- La bodega y los locales reciben de una feria.
alter table prod_bodega_ingresos drop constraint if exists prod_bodega_ingresos_origen_check;
alter table prod_bodega_ingresos add constraint prod_bodega_ingresos_origen_check
  check (origen in ('envio', 'estampado', 'feria'));
alter table prod_bodega_ingresos add column if not exists feria_id uuid
  references prod_ferias (id) on delete set null;
alter table prod_envios_locales add column if not exists feria_id uuid
  references prod_ferias (id) on delete set null;

-- ============================================================
-- 2) fn_agregar_estancada: mercadería de los locales a una feria
-- ============================================================

create or replace function fn_agregar_estancada(
  p_feria_id uuid,
  p_prenda text,
  p_color text,
  p_estampado text,
  p_tallas jsonb,
  p_costo numeric
) returns jsonb
language plpgsql as $$
declare
  v_tallas jsonb;
  v_n      integer;
  v_op     numeric := fn_costo_operativo('feria');
  v_id     uuid := gen_random_uuid();
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede agregar mercadería a una feria.';
  end if;
  perform 1 from prod_ferias where id = p_feria_id for update;
  if not found then
    raise exception 'La feria no existe.';
  end if;
  if (select cerrada_en from prod_ferias where id = p_feria_id) is not null then
    raise exception 'Esa feria ya está cerrada.';
  end if;
  if btrim(coalesce(p_prenda, '')) = '' then
    raise exception 'Escribe qué prenda es.';
  end if;
  if coalesce(p_costo, -1) < 0 then
    raise exception 'Escribe el costo por prenda.';
  end if;
  v_tallas := fn_tallas_reparto(p_tallas, 'Estancada');
  v_n := fn_total_tallas(v_tallas);
  if v_n = 0 then
    raise exception 'Escribe cuántas van de cada talla.';
  end if;

  insert into prod_feria_ingresos (id, feria_id, origen, prenda_nombre, color, estampado, tallas, unidades,
                                   costo_produccion, costo_estampado, costo_operativo, costo_unitario)
  values (v_id, p_feria_id, 'estancada', btrim(p_prenda), btrim(coalesce(p_color, '')),
          btrim(coalesce(p_estampado, '')), v_tallas, v_n,
          p_costo, 0, v_op, p_costo + v_op);

  return jsonb_build_object('id', v_id, 'unidades', v_n);
end $$;

-- ============================================================
-- 3) fn_cerrar_feria: lo que regresa, y la feria queda cerrada
--
--    p_retornos: [{"ingreso_id":"…", "bodega":{"S":1}, "local":{"M":2}}, …]
--    Las líneas que no vienen se vendieron enteras. Por línea y talla, lo que
--    regresa nunca supera lo que fue.
-- ============================================================

create or replace function fn_cerrar_feria(
  p_feria_id uuid,
  p_retornos jsonb,
  p_fecha date default null
) returns jsonb
language plpgsql as $$
declare
  v_fecha     date := coalesce(p_fecha, fn_hoy_ecuador());
  v_r         record;
  v_t         record;
  v_ing       uuid;
  v_fue       jsonb;
  v_bod       jsonb;
  v_loc       jsonb;
  v_n_bod     integer;
  v_n_loc     integer;
  v_cp        numeric;
  v_ce        numeric;
  v_origen    text;
  v_prenda_id uuid;
  v_prenda    text;
  v_color     text;
  v_estampado text;
  v_maquila   uuid;
  v_op_local  numeric := fn_costo_operativo('local');
  v_precio    numeric;
  v_vistos    uuid[] := '{}';
  v_regresan  integer := 0;
  v_fueron    integer;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede cerrar una feria.';
  end if;
  perform 1 from prod_ferias where id = p_feria_id for update;
  if not found then
    raise exception 'La feria no existe.';
  end if;
  -- Un reintento (doble clic) no es un error: ya estaba cerrada.
  if (select cerrada_en from prod_ferias where id = p_feria_id) is not null then
    return jsonb_build_object('ya_cerrada', true);
  end if;
  if p_retornos is not null and jsonb_typeof(p_retornos) <> 'array' then
    raise exception 'Los regresos no son válidos.';
  end if;

  for v_r in select value as ret from jsonb_array_elements(coalesce(p_retornos, '[]'::jsonb)) loop
    v_ing := nullif(v_r.ret ->> 'ingreso_id', '')::uuid;
    if v_ing is null or not exists (select 1 from prod_feria_ingresos where id = v_ing and feria_id = p_feria_id) then
      raise exception 'Hay un regreso de algo que no está en esta feria.';
    end if;
    if v_ing = any(v_vistos) then
      raise exception 'Una línea de la feria viene repetida en los regresos.';
    end if;
    v_vistos := v_vistos || v_ing;

    v_prenda    := (select prenda_nombre from prod_feria_ingresos where id = v_ing);
    v_color     := (select color         from prod_feria_ingresos where id = v_ing);
    v_estampado := (select estampado     from prod_feria_ingresos where id = v_ing);
    v_fue := (select tallas from prod_feria_ingresos where id = v_ing);
    v_bod := fn_tallas_reparto(v_r.ret -> 'bodega', v_prenda || ' ' || v_color || ', a bodega');
    v_loc := fn_tallas_reparto(v_r.ret -> 'local',  v_prenda || ' ' || v_color || ', a locales');

    for v_t in select k as talla from (select jsonb_object_keys(fn_sumar_tallas(v_bod, v_loc)) as k) u loop
      if coalesce((v_bod ->> v_t.talla)::int, 0) + coalesce((v_loc ->> v_t.talla)::int, 0)
         > coalesce((v_fue ->> v_t.talla)::int, 0) then
        raise exception '% %, talla %: fueron % y no pueden regresar %.',
          v_prenda, v_color, v_t.talla, coalesce((v_fue ->> v_t.talla)::int, 0),
          coalesce((v_bod ->> v_t.talla)::int, 0) + coalesce((v_loc ->> v_t.talla)::int, 0);
      end if;
    end loop;

    v_n_bod := fn_total_tallas(v_bod);
    v_n_loc := fn_total_tallas(v_loc);
    continue when v_n_bod + v_n_loc = 0;

    v_cp        := coalesce((select costo_produccion from prod_feria_ingresos where id = v_ing), 0);
    v_ce        := coalesce((select costo_estampado  from prod_feria_ingresos where id = v_ing), 0);
    v_origen    := (select origen     from prod_feria_ingresos where id = v_ing);
    v_prenda_id := (select prenda_id  from prod_feria_ingresos where id = v_ing);
    v_maquila   := (select maquila_id from prod_feria_ingresos where id = v_ing);

    -- ── a la bodega: operativo $0 ──
    if v_n_bod > 0 then
      for v_t in select key as talla, value::int as n from jsonb_each_text(v_bod) loop
        perform fn_sumar_stock_online(v_prenda_id, v_prenda, v_color, v_estampado, v_t.talla, v_t.n);
      end loop;
      insert into prod_bodega_ingresos (fecha, origen, feria_id, maquila_id, prenda_id, prenda_nombre, color,
                                        estampado, tallas, unidades, costo_produccion, costo_estampado,
                                        costo_operativo, costo_unitario)
      values (v_fecha, 'feria', p_feria_id, v_maquila, v_prenda_id, v_prenda, v_color,
              v_estampado, v_bod, v_n_bod, v_cp, v_ce, 0, v_cp + v_ce);
      insert into prod_feria_retornos (feria_id, ingreso_id, fecha, destino, tallas, unidades,
                                       costo_produccion, costo_estampado, costo_operativo, costo_unitario)
      values (p_feria_id, v_ing, v_fecha, 'bodega', v_bod, v_n_bod, v_cp, v_ce, 0, v_cp + v_ce);
      v_regresan := v_regresan + v_n_bod;
    end if;

    -- ── a locales: el operativo pasa a ser el de locales ──
    if v_n_loc > 0 then
      insert into prod_feria_retornos (feria_id, ingreso_id, fecha, destino, tallas, unidades,
                                       costo_produccion, costo_estampado, costo_operativo, costo_unitario)
      values (p_feria_id, v_ing, v_fecha, 'local', v_loc, v_n_loc, v_cp, v_ce, v_op_local, v_cp + v_ce + v_op_local);
      -- Lo de producción queda también como envío a locales; la estancada ya
      -- estaba contada en los locales.
      if v_origen <> 'estancada' then
        v_precio := coalesce((select precio_venta_local from prod_prendas where id = v_prenda_id), 0);
        insert into prod_envios_locales (fecha, maquila_id, prenda_id, prenda_nombre, color, estampado, tallas,
                                         unidades, precio_unitario, costo_unitario, ingreso, margen,
                                         local_destino, feria_id,
                                         costo_produccion, costo_estampado, costo_operativo)
        values (v_fecha, v_maquila, v_prenda_id, v_prenda, v_color, v_estampado, v_loc,
                v_n_loc, v_precio, v_cp + v_ce + v_op_local,
                round(v_n_loc * v_precio, 2),
                round(v_n_loc * (v_precio - v_cp - v_ce - v_op_local), 2),
                null, p_feria_id, v_cp, v_ce, v_op_local);
      end if;
      v_regresan := v_regresan + v_n_loc;
    end if;
  end loop;

  update prod_ferias set cerrada_en = now() where id = p_feria_id;

  v_fueron := (select coalesce(sum(unidades), 0) from prod_feria_ingresos where feria_id = p_feria_id);
  return jsonb_build_object(
    'ya_cerrada', false,
    'fueron',     v_fueron,
    'regresan',   v_regresan,
    'vendidas',   v_fueron - v_regresan);
end $$;

revoke execute on function fn_agregar_estancada(uuid, text, text, text, jsonb, numeric) from anon, public;
grant execute on function fn_agregar_estancada(uuid, text, text, text, jsonb, numeric) to authenticated;
revoke execute on function fn_cerrar_feria(uuid, jsonb, date) from anon, public;
grant execute on function fn_cerrar_feria(uuid, jsonb, date) to authenticated;

-- ============================================================
-- Verificación final — solo mira.
-- ============================================================

do $VERIF8U$
begin
  if (select count(*) from pg_proc where proname = 'fn_cerrar_feria') <> 1 then
    raise exception 'Fase 8u: tiene que haber exactamente UNA fn_cerrar_feria.';
  end if;
  if (select count(*) from pg_proc where proname = 'fn_agregar_estancada') <> 1 then
    raise exception 'Fase 8u: tiene que haber exactamente UNA fn_agregar_estancada.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prod_feria_retornos'
                 and policyname = 'admin_all_prod_feria_retornos') then
    raise exception 'Fase 8u: falta la política de prod_feria_retornos.';
  end if;
  raise notice 'Fase 8u aplicada: mercadería estancada y cierre de ferias.';
end $VERIF8U$;
