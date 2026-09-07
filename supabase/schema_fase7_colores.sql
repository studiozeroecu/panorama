-- Panorama — Bear & Trend · Fase 7: colores normalizados (pedido → corte → maquila)
-- Ejecutar en el SQL Editor DESPUÉS de actualizacion_alertas.sql. Una sola vez;
-- es idempotente (se puede volver a correr sin duplicar).
--
-- Qué resuelve: hoy `colores` es un array jsonb en prod_pedidos_tela, prod_cortes y
-- prod_maquilas. Eso obliga a leer-modificar-escribir el array entero para cambiar un
-- color (se pisan escrituras concurrentes), identifica cada color por su POSICIÓN en el
-- array (frágil), no da integridad entre el color de un pedido y el del corte, duplica
-- los datos del corte dentro de la maquila, y hace imposible consultar por color en SQL.
-- Además, las dos cadenas de escritura más peligrosas de la app (registrar un corte y
-- procesar un lote en Envío) pasan a ser funciones atómicas: hoy son varias escrituras
-- sueltas desde el navegador y, si una falla a mitad, reintentar DUPLICA datos.
--
-- Qué NO hace, a propósito:
--   · NO borra las columnas jsonb. Quedan congeladas como respaldo y las funciones
--     nuevas las siguen manteniendo al día (dual-write), así que el código VIEJO sigue
--     funcionando igual. Por eso la migración puede correrse ANTES del deploy sin
--     ventana de riesgo, y el rollback es simplemente revertir el deploy.
--   · NO toca la estructura de prod_lotes_estampado ni prod_envios_locales. Esos siguen
--     ligados a la maquila por `maquila_id` + un `color` de texto suelto. Vincularlos a
--     la fila de color concreta (maquila_color_id) queda para la fase 8, junto con el
--     reparto por talla del retorno de estampado y el cruce guía↔envío.
--   · NO convierte total_unidades en derivado. Sigue almacenado en prod_cortes y
--     prod_maquilas; queda como paso aparte para no mezclar cambios.

-- ⚠️ SIN `begin;` / `commit;` — a propósito, igual que el resto de migraciones del
-- proyecto. El SQL Editor de Supabase reparte las sentencias de un script con
-- transacción explícita entre varias conexiones del pool, y entonces una tabla creada
-- en una sentencia no existe para la siguiente ("relation ... does not exist").
-- Sin transacción explícita cada sentencia autocommitea y el script corre bien.
--
-- A cambio no hay atomicidad, así que TODO aquí es idempotente (`if not exists`,
-- `not exists`, `or replace`): si algo falla a mitad, se corrige y se vuelve a correr
-- sin duplicar nada. El paso 6 verifica al final. Para deshacer, ver el bloque del
-- final del archivo.

set search_path = public, extensions;

-- ============================================================
-- 1) Respaldo de los jsonb tal como están hoy
--    (las columnas quedan igual; esto protege por si alguien las borra después)
--
--    Crear la tabla y asegurarla ocurre en UN solo bloque PL/pgSQL con EXECUTE:
--    cada sentencia dinámica se planifica justo al ejecutarse, así que no depende
--    de que el cliente SQL haga visible entre sentencias una tabla recién creada.
--    Cuando esto vivía en dos pasos separados, el ALTER del paso 3 podía fallar con
--    "relation respaldo_fase7_pedidos does not exist".
-- ============================================================

do $$
declare r record;
begin
  for r in
    select * from (values
      ('respaldo_fase7_pedidos',  'select id, colores, total_metros from prod_pedidos_tela'),
      ('respaldo_fase7_cortes',   'select id, pedido_id, colores, total_unidades from prod_cortes'),
      ('respaldo_fase7_maquilas', 'select id, corte_id, colores, total_unidades from prod_maquilas')
    ) as v(tabla, consulta)
  loop
    if to_regclass('public.' || r.tabla) is null then
      execute format('create table public.%I as %s', r.tabla, r.consulta);
    end if;
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('drop policy if exists "admin_all_%s" on public.%I', r.tabla, r.tabla);
    execute format(
      'create policy "admin_all_%s" on public.%I for all to authenticated using (fn_es_admin()) with check (fn_es_admin())',
      r.tabla, r.tabla);
  end loop;
end $$;

-- ============================================================
-- 2) Tablas nuevas
-- ============================================================

-- Un color de un pedido de tela. `metros` es siempre metros (ya convertidos desde
-- kilos si el pedido se compró por peso); `kilos` guarda el dato original o null.
-- 4 decimales, no 2: los datos migrados traen valores como 15.0804 m y numeric(10,2)
-- los redondearía en silencio durante el backfill.
create table if not exists prod_pedido_colores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pedido_id uuid not null references prod_pedidos_tela (id) on delete cascade,
  color text not null,
  metros numeric(12,4) not null default 0,
  kilos numeric(12,4),
  orden integer not null default 0
);
create index if not exists idx_pedido_colores_pedido on prod_pedido_colores (pedido_id);
-- Ojo: un UNIQUE de tabla no admite expresiones — tiene que ser un índice único.
-- Normalizamos para que "Negro" y " negro " no convivan en el mismo pedido.
create unique index if not exists uq_pedido_colores_nombre
  on prod_pedido_colores (pedido_id, lower(btrim(color)));

-- Un color dentro de un corte. `pedido_color_id` es el vínculo al color de la tela;
-- queda null si el corte usó un color que no está en el pedido (no bloquea nada).
-- `color` se conserva como texto porque el corte puede nombrarlo distinto.
create table if not exists prod_corte_colores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  corte_id uuid not null references prod_cortes (id) on delete cascade,
  pedido_color_id uuid references prod_pedido_colores (id) on delete set null,
  color text not null,
  unidades integer not null default 0 check (unidades >= 0),
  metros_usados numeric(12,4),          -- null = no registrado (dato migrado)
  orden integer not null default 0
);
create index if not exists idx_corte_colores_corte on prod_corte_colores (corte_id);
create index if not exists idx_corte_colores_pedido_color on prod_corte_colores (pedido_color_id);
-- La UI indexa la matriz de corte por nombre de color, así que dos colores con el
-- mismo nombre en un corte hoy se pisan en silencio. Esto lo vuelve un error visible.
create unique index if not exists uq_corte_colores_nombre
  on prod_corte_colores (corte_id, lower(btrim(color)));

-- Desglose por talla de cada color cortado. Las tallas en cero no se guardan.
create table if not exists prod_corte_color_tallas (
  id uuid primary key default gen_random_uuid(),
  corte_color_id uuid not null references prod_corte_colores (id) on delete cascade,
  talla text not null,
  unidades integer not null default 0 check (unidades >= 0),
  unique (corte_color_id, talla)
);
create index if not exists idx_corte_color_tallas_color on prod_corte_color_tallas (corte_color_id);

-- Estado de maquila por color. NO repite color/tallas/unidades: los toma por join de
-- prod_corte_colores. Verificado en el código actual — CorteTab los copia literales del
-- corte y ni MaquilaTab ni EnvioTab los vuelven a tocar (solo estado, fechas y procesado).
-- `restrict` sobre corte_color_id: no se borra un color que ya está en maquila.
create table if not exists prod_maquila_colores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  maquila_id uuid not null references prod_maquilas (id) on delete cascade,
  corte_color_id uuid not null references prod_corte_colores (id) on delete restrict,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'entregado')),
  fecha_envio date,
  fecha_entrega date,
  procesado boolean not null default false,   -- ya salió por Envío (estampado/online/locales)
  unique (maquila_id, corte_color_id)
);
create index if not exists idx_maquila_colores_maquila on prod_maquila_colores (maquila_id);
-- Índice parcial para la consulta más caliente: los lotes que esperan en Envío
-- (es el contador de la pestaña y la lista de LoteCard).
create index if not exists idx_maquila_colores_por_procesar
  on prod_maquila_colores (maquila_id)
  where estado = 'entregado' and not procesado;

-- ============================================================
-- 3) Seguridad — admin-only, igual que el resto de tablas de negocio (fase 6).
--    Sin esto la pestaña se ve VACÍA sin dar error.
--    (Las tablas de respaldo ya quedaron aseguradas en el paso 1.)
--
--    Ojo: `drop policy if exists` levanta 42P01 si la TABLA no existe — el IF EXISTS
--    aplica a la política, no a la tabla. Por eso comprobamos antes y damos un
--    mensaje que diga qué pasó de verdad.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'prod_pedido_colores', 'prod_corte_colores', 'prod_corte_color_tallas',
    'prod_maquila_colores'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception
        'Fase 7: la tabla % no existe al llegar al paso 3. ¿Se ejecutó el archivo COMPLETO, desde la primera línea? El editor SQL de Supabase corre solo el texto SELECCIONADO si hay una selección activa.', t;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin_all_%s" on public.%I', t, t);
    execute format(
      'create policy "admin_all_%s" on public.%I for all to authenticated using (fn_es_admin()) with check (fn_es_admin())',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- 4) Backfill desde los jsonb. `with ordinality` conserva el orden original
--    del array, que es el que ve el usuario en pantalla.
--    El `not exists` de cada insert lo hace re-ejecutable sin duplicar.
-- ============================================================

-- 4a) colores de pedidos
insert into prod_pedido_colores (pedido_id, color, metros, kilos, orden)
select p.id,
       btrim(c.value ->> 'color'),
       coalesce((c.value ->> 'metros')::numeric, 0),
       (c.value ->> 'kilos')::numeric,
       c.ord
from prod_pedidos_tela p
cross join lateral jsonb_array_elements(p.colores) with ordinality as c(value, ord)
where not exists (
  select 1 from prod_pedido_colores pc where pc.pedido_id = p.id
);

-- 4b) colores de cortes, enlazados al color del pedido por nombre normalizado.
--     El left join deja pedido_color_id en null si no hay match; el paso 6 lo verifica.
insert into prod_corte_colores (corte_id, pedido_color_id, color, unidades, metros_usados, orden)
select k.id,
       pc.id,
       btrim(c.value ->> 'color'),
       coalesce((c.value ->> 'unidades')::int, 0),
       (c.value ->> 'metros_usados')::numeric,
       c.ord
from prod_cortes k
cross join lateral jsonb_array_elements(k.colores) with ordinality as c(value, ord)
left join prod_pedido_colores pc
       on pc.pedido_id = k.pedido_id
      and lower(btrim(pc.color)) = lower(btrim(c.value ->> 'color'))
where not exists (
  select 1 from prod_corte_colores cc where cc.corte_id = k.id
);

-- 4c) tallas por color de corte (se omiten las tallas en cero)
insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
select cc.id, t.talla, t.unidades::int
from prod_cortes k
cross join lateral jsonb_array_elements(k.colores) with ordinality as c(value, ord)
join prod_corte_colores cc
     on cc.corte_id = k.id and cc.orden = c.ord
cross join lateral jsonb_each_text(c.value -> 'tallas') as t(talla, unidades)
where t.unidades::int > 0
  and not exists (
    select 1 from prod_corte_color_tallas x
     where x.corte_color_id = cc.id and x.talla = t.talla
  );

-- 4d) estado de maquila por color. El join va por NOMBRE (no por posición): el índice
--     único de prod_corte_colores garantiza que empareje con un solo color del corte.
--     Si algún color de maquila no encuentra su corte, el join lo descarta en silencio
--     — por eso el paso 6 compara los conteos.
insert into prod_maquila_colores (maquila_id, corte_color_id, estado, fecha_envio, fecha_entrega, procesado)
select m.id,
       cc.id,
       coalesce(c.value ->> 'estado', 'pendiente'),
       (c.value ->> 'fecha_envio')::date,
       (c.value ->> 'fecha_entrega')::date,
       coalesce((c.value ->> 'procesado')::boolean, false)
from prod_maquilas m
cross join lateral jsonb_array_elements(m.colores) with ordinality as c(value, ord)
join prod_corte_colores cc
     on cc.corte_id = m.corte_id
    and lower(btrim(cc.color)) = lower(btrim(c.value ->> 'color'))
where not exists (
  select 1 from prod_maquila_colores mc where mc.maquila_id = m.id
);

-- ============================================================
-- 5) Funciones. Las tres primeras son auxiliares; las dos últimas son las que
--    llama la app y reemplazan cadenas de escrituras sueltas desde el navegador.
--
--    Todas son SECURITY INVOKER (lo normal): las políticas RLS siguen aplicando
--    con el usuario que llama. El chequeo fn_es_admin() explícito es solo para dar
--    un mensaje entendible en vez de un error opaco de RLS.
-- ============================================================

-- Fecha "de hoy" en Ecuador. current_date usaría la zona del servidor (UTC) y
-- entre las 19:00 y medianoche registraría el día siguiente.
create or replace function fn_hoy_ecuador() returns date
language sql stable as $$
  select (now() at time zone 'America/Guayaquil')::date
$$;

-- Suma unidades al stock online en UNA sola sentencia. Reemplaza el select→update
-- de src/lib/produccion/stock.ts, donde dos escrituras a la vez se pisaban.
create or replace function fn_sumar_stock_online(
  p_prenda_id uuid,
  p_prenda_nombre text,
  p_color text,
  p_estampado text,
  p_talla text,
  p_unidades integer
) returns void
language plpgsql as $$
begin
  if coalesce(p_unidades, 0) <= 0 then
    return;
  end if;
  insert into prod_stock_online (prenda_id, prenda_nombre, color, estampado, talla, disponibles, vendidas)
  values (p_prenda_id, coalesce(p_prenda_nombre, ''), coalesce(p_color, ''),
          coalesce(p_estampado, ''), p_talla, p_unidades, 0)
  on conflict (prenda_nombre, color, estampado, talla)
  do update set disponibles = prod_stock_online.disponibles + excluded.disponibles;
end $$;

-- Reparte N unidades sobre un mapa de tallas {"S":6,"M":4}, tomando de cada talla
-- en orden XS→XXL hasta agotar N. Única implementación de esta regla: hoy vive
-- duplicada en EnvioTab (orden explícito) y EstampadosTab (orden de inserción del
-- objeto), y que coincidan es casualidad.
create or replace function fn_repartir_por_talla(p_tallas jsonb, p_total integer)
returns jsonb
language plpgsql immutable as $$
declare
  v_resto integer := greatest(coalesce(p_total, 0), 0);
  v_out jsonb := '{}'::jsonb;
  v_talla text;
  v_disp integer;
  v_usa integer;
begin
  for v_talla, v_disp in
    select t.key, t.value::int
    from jsonb_each_text(coalesce(p_tallas, '{}'::jsonb)) as t(key, value)
    order by coalesce(array_position(array['XS','S','M','L','XL','XXL'], t.key), 99), t.key
  loop
    exit when v_resto <= 0;
    v_usa := least(v_disp, v_resto);
    if v_usa > 0 then
      v_out := v_out || jsonb_build_object(v_talla, v_usa);
      v_resto := v_resto - v_usa;
    end if;
  end loop;
  return v_out;
end $$;

-- Mantiene prod_pedido_colores en sincronía con el jsonb del pedido.
--
-- Hace falta porque PedidosTab inserta el pedido DIRECTO (no por RPC): sin esto, todo
-- pedido creado después de la migración se quedaría sin filas de color, y entonces
-- cada corte suyo tendría pedido_color_id = null — justo lo que la verificación (d)
-- considera un error. Mientras el jsonb siga siendo el respaldo vivo, él manda y esta
-- función normaliza detrás. Cuando se retire el jsonb, este trigger se va y PedidosTab
-- pasa a escribir las filas directamente.
create or replace function fn_sync_pedido_colores() returns trigger
language plpgsql as $$
begin
  -- colores que ya no están en el jsonb (los cortes que los usaran quedan en null)
  delete from prod_pedido_colores pc
   where pc.pedido_id = new.id
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(new.colores, '[]'::jsonb)) as c(value)
       where lower(btrim(c.value ->> 'color')) = lower(btrim(pc.color)));

  insert into prod_pedido_colores (pedido_id, color, metros, kilos, orden)
  select new.id,
         btrim(c.value ->> 'color'),
         coalesce((c.value ->> 'metros')::numeric, 0),
         (c.value ->> 'kilos')::numeric,
         c.ord
  from jsonb_array_elements(coalesce(new.colores, '[]'::jsonb)) with ordinality as c(value, ord)
  where btrim(coalesce(c.value ->> 'color', '')) <> ''
  on conflict (pedido_id, lower(btrim(color)))
  do update set metros = excluded.metros,
                kilos  = excluded.kilos,
                orden  = excluded.orden;

  return new;
end $$;

drop trigger if exists trg_sync_pedido_colores on prod_pedidos_tela;
create trigger trg_sync_pedido_colores
  after insert or update of colores on prod_pedidos_tela
  for each row execute function fn_sync_pedido_colores();

-- ────────────────────────────────────────────────────────────
-- RPC 1 — Registrar un corte.
-- Hoy CorteTab hace: insert corte → insert maquila. Si la segunda falla, el corte
-- queda huérfano y reintentar crea un corte DUPLICADO que consume saldo dos veces.
-- Aquí todo ocurre en una transacción: o entra completo o no entra nada.
-- Además bloquea el pedido mientras valida el saldo de tela, para que dos cortes
-- simultáneos no se pasen del saldo entre los dos.
--
-- p_colores: [{ "color": "Negro", "tallas": {"S":6,"M":4}, "metros_usados": 12.5 }]
--            metros_usados puede ser null (no registrado).
-- Devuelve el id del corte creado.
-- ────────────────────────────────────────────────────────────
create or replace function fn_registrar_corte(
  p_pedido_id uuid,
  p_fecha date,
  p_maquiladora_id uuid,
  p_observaciones text,
  p_costo_maquila numeric,
  p_colores jsonb
) returns uuid
language plpgsql as $$
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

  select estado into v_estado
  from prod_pedidos_tela
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido de tela no existe.';
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
                           total_unidades, metros_consumidos, observaciones)
  values (p_pedido_id, p_fecha, p_maquiladora_id, v_colores_norm,
          v_total_unidades,
          case when v_con_metros then round(v_total_metros, 2) else null end,
          btrim(coalesce(p_observaciones, '')))
  returning id into v_corte_id;

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

  return v_corte_id;
end $$;

-- ────────────────────────────────────────────────────────────
-- RPC 2 — Procesar un lote entregado por maquila (pestaña Envío).
-- Hoy EnvioTab.procesar() hace, desde el navegador y sin transacción:
--   insert lote/envío → N sumas de stock → marcar procesado.
-- Si algo falla después del primer insert, el color NO queda marcado como procesado,
-- así que sigue en la lista y volver a pulsar "Procesar lote" crea un SEGUNDO lote y
-- vuelve a sumar el stock. Aquí es una sola transacción, y el `for update` sobre la
-- fila del color con la guarda de `procesado` hace imposible procesarlo dos veces.
--
-- Devuelve {"destino": ..., "unidades": ..., "resto": ...} para el mensaje al usuario.
-- ────────────────────────────────────────────────────────────
create or replace function fn_procesar_lote_maquila(
  p_maquila_color_id uuid,
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
  v_mc record;
  v_tallas jsonb;
  v_prenda_id uuid;
  v_prenda_nombre text;
  v_total integer := 0;
  v_repartidas jsonb := '{}'::jsonb;
  v_disenos jsonb;
  v_t record;
  v_resto integer;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede procesar lotes.';
  end if;
  if p_destino not in ('online', 'estampado', 'local') then
    raise exception 'Destino inválido: %', p_destino;
  end if;

  -- lock + guarda de idempotencia
  select mc.id, mc.maquila_id, mc.corte_color_id, mc.estado, mc.procesado,
         cc.color, cc.unidades
    into v_mc
  from prod_maquila_colores mc
  join prod_corte_colores cc on cc.id = mc.corte_color_id
  where mc.id = p_maquila_color_id
  for update of mc;

  if not found then
    raise exception 'El lote no existe.';
  end if;
  if v_mc.estado <> 'entregado' then
    raise exception 'El lote todavía no está entregado por maquila.';
  end if;
  if v_mc.procesado then
    raise exception 'Este lote ya fue procesado.';
  end if;

  select coalesce(jsonb_object_agg(t.talla, t.unidades), '{}'::jsonb)
    into v_tallas
  from prod_corte_color_tallas t
  where t.corte_color_id = v_mc.corte_color_id;

  select p.id, p.nombre into v_prenda_id, v_prenda_nombre
  from prod_maquilas m
  join prod_cortes k on k.id = m.corte_id
  join prod_pedidos_tela pt on pt.id = k.pedido_id
  left join prod_prendas p on p.id = pt.prenda_id
  where m.id = v_mc.maquila_id;

  v_prenda_nombre := coalesce(v_prenda_nombre, '');

  -- ── destino: todo al stock online ──────────────────────────
  if p_destino = 'online' then
    for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_tallas) loop
      perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_mc.color, '', v_t.talla, v_t.unidades);
      v_total := v_total + v_t.unidades;
    end loop;

  -- ── destino: a estampado ───────────────────────────────────
  elsif p_destino = 'estampado' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'nombre',   btrim(d.value ->> 'nombre'),
             'unidades', (d.value ->> 'unidades')::int) order by d.ord), '[]'::jsonb),
           coalesce(sum((d.value ->> 'unidades')::int), 0)
      into v_disenos, v_total
    from jsonb_array_elements(coalesce(p_disenos, '[]'::jsonb)) with ordinality as d(value, ord)
    where btrim(coalesce(d.value ->> 'nombre', '')) <> ''
      and coalesce((d.value ->> 'unidades')::int, 0) > 0;

    if v_total <= 0 then
      raise exception 'Agrega al menos un diseño con nombre y unidades.';
    end if;
    if v_total > v_mc.unidades then
      raise exception 'Las unidades a estampar (%) superan las del lote (%).', v_total, v_mc.unidades;
    end if;
    if coalesce(p_costo_estampado, 0) < 0 then
      raise exception 'Costo de estampado inválido.';
    end if;

    -- Se guardan SOLO las tallas que realmente van al taller, no el desglose completo
    -- del lote: así sum(tallas) = total_unidades y el retorno en Estampados reparte
    -- sobre el mapa correcto. (Hoy se guarda el desglose entero con un total parcial.)
    v_repartidas := fn_repartir_por_talla(v_tallas, v_total);

    insert into prod_lotes_estampado (maquila_id, prenda_id, prenda_nombre, color, tallas,
                                      total_unidades, disenos, costo_unitario, costo_total, estado)
    values (v_mc.maquila_id, v_prenda_id, v_prenda_nombre, v_mc.color, v_repartidas,
            v_total, v_disenos, coalesce(p_costo_estampado, 0),
            round(v_total * coalesce(p_costo_estampado, 0), 2), 'pendiente');

    -- lo que no se estampa entra al stock online sin etiqueta
    for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_tallas) loop
      v_resto := v_t.unidades - coalesce((v_repartidas ->> v_t.talla)::int, 0);
      perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_mc.color, '', v_t.talla, v_resto);
    end loop;

  -- ── destino: a locales ─────────────────────────────────────
  else
    for v_t in select key as talla, value::int as unidades
               from jsonb_each_text(coalesce(p_tallas_local, '{}'::jsonb)) loop
      if v_t.unidades < 0 then
        raise exception 'Talla %: la cantidad no puede ser negativa.', v_t.talla;
      end if;
      if v_t.unidades > coalesce((v_tallas ->> v_t.talla)::int, 0) then
        raise exception 'Talla %: solo hay % unidades en el lote.',
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
    values (fn_hoy_ecuador(), v_mc.maquila_id, v_prenda_id, v_prenda_nombre, v_mc.color,
            (select coalesce(jsonb_object_agg(key, value::int), '{}'::jsonb)
             from jsonb_each_text(coalesce(p_tallas_local, '{}'::jsonb))
             where value::int > 0),
            v_total, coalesce(p_precio_local, 0), coalesce(p_costo_unitario, 0),
            round(v_total * coalesce(p_precio_local, 0), 2),
            round(v_total * (coalesce(p_precio_local, 0) - coalesce(p_costo_unitario, 0)), 2),
            nullif(btrim(coalesce(p_producto_codigo, '')), ''),
            nullif(btrim(coalesce(p_local_destino, '')), ''));

    -- el resto del lote entra al stock online
    for v_t in select key as talla, value::int as unidades from jsonb_each_text(v_tallas) loop
      v_resto := v_t.unidades - coalesce((p_tallas_local ->> v_t.talla)::int, 0);
      perform fn_sumar_stock_online(v_prenda_id, v_prenda_nombre, v_mc.color, '', v_t.talla, v_resto);
    end loop;
  end if;

  update prod_maquila_colores set procesado = true where id = p_maquila_color_id;

  -- espejo en el jsonb de la maquila (respaldo vivo durante la transición)
  update prod_maquilas m
     set colores = (
       select coalesce(jsonb_agg(
                case when lower(btrim(c.value ->> 'color')) = lower(btrim(v_mc.color))
                     then c.value || '{"procesado": true}'::jsonb
                     else c.value end order by c.ord), '[]'::jsonb)
       from jsonb_array_elements(m.colores) with ordinality as c(value, ord))
   where m.id = v_mc.maquila_id;

  return jsonb_build_object(
    'destino',  p_destino,
    'unidades', v_total,
    'resto',    greatest(v_mc.unidades - v_total, 0)
  );
end $$;

-- ============================================================
-- 6) Verificación ANTES del commit. Cualquier fallo aborta toda la migración
--    y deja la base exactamente como estaba.
--
--    NO se verifica que la suma de metros por color dé total_metros: ya no cuadra hoy
--    y no es culpa de esta migración. PedidosTab redondea los metros de cada color a
--    2 decimales por separado pero calcula total_metros sobre la suma sin redondear
--    (ej. pedido "Fless": colores suman 87.4203, total_metros guarda 87.42). Ponerlo
--    como check abortaría por un defecto preexistente. Queda pendiente aparte.
-- ============================================================

do $$
declare
  v_n integer;
  v_detalle text;
begin
  -- a) cada color del jsonb tiene su fila (pedidos)
  select count(*), string_agg(p.nombre_tela, ', ')
    into v_n, v_detalle
  from prod_pedidos_tela p
  where jsonb_array_length(p.colores) <>
        (select count(*) from prod_pedido_colores pc where pc.pedido_id = p.id);
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % pedido(s) con distinta cantidad de colores entre el jsonb y la tabla nueva (%)', v_n, v_detalle;
  end if;

  -- b) idem cortes
  select count(*) into v_n
  from prod_cortes k
  where jsonb_array_length(k.colores) <>
        (select count(*) from prod_corte_colores cc where cc.corte_id = k.id);
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % corte(s) con distinta cantidad de colores entre el jsonb y la tabla nueva', v_n;
  end if;

  -- c) idem maquilas — aquí se detecta un color de maquila que no emparejó con su corte
  select count(*) into v_n
  from prod_maquilas m
  where jsonb_array_length(m.colores) <>
        (select count(*) from prod_maquila_colores mc where mc.maquila_id = m.id);
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % maquila(s) cuyos colores no emparejaron con los del corte (revisa mayúsculas/tildes en los nombres)', v_n;
  end if;

  -- d) ningún color de corte quedó huérfano de su color de pedido
  select count(*), string_agg(distinct cc.color, ', ')
    into v_n, v_detalle
  from prod_corte_colores cc
  where cc.pedido_color_id is null;
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % color(es) de corte sin color de pedido equivalente (%). Corrige los nombres y vuelve a correr.', v_n, v_detalle;
  end if;

  -- e) las unidades por color suman el total guardado del corte
  select count(*) into v_n
  from prod_cortes k
  where k.total_unidades <>
        coalesce((select sum(cc.unidades) from prod_corte_colores cc where cc.corte_id = k.id), 0);
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % corte(s) donde la suma de unidades por color no da total_unidades', v_n;
  end if;

  -- f) las tallas de cada color suman las unidades de ese color
  select count(*) into v_n
  from prod_corte_colores cc
  where cc.unidades <>
        coalesce((select sum(t.unidades) from prod_corte_color_tallas t where t.corte_color_id = cc.id), 0);
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % color(es) de corte donde las tallas no suman sus unidades', v_n;
  end if;

  -- g) las unidades de la maquila coinciden con las de su corte
  select count(*) into v_n
  from prod_maquilas m
  where m.total_unidades <> coalesce((
          select sum(cc.unidades)
          from prod_maquila_colores mc
          join prod_corte_colores cc on cc.id = mc.corte_color_id
          where mc.maquila_id = m.id), 0);
  if v_n > 0 then
    raise exception 'Fase 7 abortada: % maquila(s) donde las unidades por color no dan total_unidades', v_n;
  end if;

  raise notice 'Fase 7 OK — % colores de pedido, % de corte, % tallas, % de maquila.',
    (select count(*) from prod_pedido_colores),
    (select count(*) from prod_corte_colores),
    (select count(*) from prod_corte_color_tallas),
    (select count(*) from prod_maquila_colores);
end $$;

-- ============================================================
-- DESHACER (si algo sale mal). Esta migración es ADITIVA: no toca ninguna columna
-- ni fila existente — los jsonb quedan intactos y el código actual sigue leyéndolos.
-- Por eso revertirla es solo borrar lo que creó:
--
--   drop trigger if exists trg_sync_pedido_colores on prod_pedidos_tela;
--   drop function if exists fn_sync_pedido_colores, fn_registrar_corte,
--                           fn_procesar_lote_maquila, fn_repartir_por_talla,
--                           fn_sumar_stock_online, fn_hoy_ecuador;
--   drop table if exists prod_maquila_colores, prod_corte_color_tallas,
--                        prod_corte_colores, prod_pedido_colores;
--   drop table if exists respaldo_fase7_pedidos, respaldo_fase7_cortes,
--                        respaldo_fase7_maquilas;
--
-- (Correr esas líneas de a una, sin envolverlas en begin/commit.)
-- ============================================================

-- ============================================================
-- Después del deploy del código nuevo, y solo cuando lleve unos días estable,
-- las columnas jsonb y los respaldos se pueden retirar (fase aparte). Ojo: hay que
-- quitar antes el dual-write de fn_registrar_corte y fn_procesar_lote_maquila.
--   alter table prod_pedidos_tela drop column colores;
--   alter table prod_cortes       drop column colores;
--   alter table prod_maquilas     drop column colores;
--   drop table respaldo_fase7_pedidos, respaldo_fase7_cortes, respaldo_fase7_maquilas;
-- ============================================================
