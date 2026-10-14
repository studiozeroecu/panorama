-- Panorama — Bear & Trend · Fase 8i: rol "cortadora" (andamiaje de solo lectura)
-- Ejecutar DESPUÉS de schema_fase8h_consumo_m2.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Esto es SOLO el andamiaje: el rol, su función y lo que puede LEER. Las
-- políticas de ESCRITURA (capas, retazos, horas, insumos, destino) esperan a que
-- existan las tablas donde escribir — ver docs/plan_cortadora.md, piezas 4, 7 y 8.
--
-- ⚠️ RLS ES DE FILA, NO DE COLUMNA. La cortadora verá TODAS las columnas de las
-- filas que pueda leer, y eso incluye `prod_pedidos_tela.valor_metro` y
-- `total_pagar`, y los precios de `prod_prendas`. La pantalla no los muestra,
-- pero quien consulte la API directamente con su sesión los vería. Si eso
-- importa, el paso siguiente son vistas `security_invoker` que expongan solo las
-- columnas necesarias — no es algo que una política pueda resolver.
--
-- Lo que NO se toca, y por tanto le queda prohibido sin hacer nada: Finanzas,
-- Costos, ventas, snapshots, guías y el resto conservan su `admin_all_*`.

-- ============================================================
-- 1) El rol nuevo en el check de user_roles
--
--    El check anterior se busca en el catálogo en vez de borrarlo por su nombre:
--    si el nombre no coincidiera, un `drop ... if exists` no borraría nada, el
--    `add` crearía un SEGUNDO check y 'cortadora' seguiría rechazada por el
--    viejo. Sería un fallo silencioso y confuso.
-- ============================================================

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'user_roles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%rol%'
  loop
    execute format('alter table user_roles drop constraint %I', r.conname);
  end loop;

  alter table user_roles add constraint user_roles_rol_check
    check (rol in ('admin', 'logistica', 'cortadora'));
end $$;

-- ⚠️ El middleware tiene su PROPIO mapa de roles (`ZONA_DEL_ROL` en
--    src/middleware.ts). Si se añade un rol aquí y no allí, ese rol entra a TODA
--    la app sin ninguna restricción. Los dos se mueven juntos, siempre.

-- ============================================================
-- 2) fn_es_cortadora — mismo molde que fn_es_logistica
--
--    `security definer` no es opcional: la función se usa DENTRO de políticas
--    RLS y sin eso no podría leer user_roles.
-- ============================================================

create or replace function fn_es_cortadora() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from user_roles where user_id = auth.uid() and rol = 'cortadora') $$;

-- ============================================================
-- 3) Lo que puede LEER
--
--    Las políticas son permisivas: se SUMAN a las `admin_all_*`, que no se
--    tocan. El admin sigue viendo exactamente lo mismo que antes.
--
--    Los pedidos se acotan a `estado = 'entregado'` — la tela que ya llegó es la
--    única que se puede cortar, así que no ve lo que todavía está pedido o en
--    camino. Todo lo que cuelga de un pedido hereda ese filtro por EXISTS.
-- ============================================================

-- Catálogos: lectura completa. Los necesita para poner nombre a lo que ve.
drop policy if exists "cortadora_lee_prendas" on prod_prendas;
create policy "cortadora_lee_prendas" on prod_prendas
  for select to authenticated using (fn_es_cortadora());

drop policy if exists "cortadora_lee_maquiladoras" on prod_maquiladoras;
create policy "cortadora_lee_maquiladoras" on prod_maquiladoras
  for select to authenticated using (fn_es_cortadora());

-- La tela entregada, y sus colores.
drop policy if exists "cortadora_lee_pedidos" on prod_pedidos_tela;
create policy "cortadora_lee_pedidos" on prod_pedidos_tela
  for select to authenticated
  using (fn_es_cortadora() and estado = 'entregado');

drop policy if exists "cortadora_lee_pedido_colores" on prod_pedido_colores;
create policy "cortadora_lee_pedido_colores" on prod_pedido_colores
  for select to authenticated
  using (fn_es_cortadora() and exists (
    select 1 from prod_pedidos_tela p
    where p.id = prod_pedido_colores.pedido_id and p.estado = 'entregado'));

-- Los cortes de esa tela, con sus colores y tallas.
drop policy if exists "cortadora_lee_cortes" on prod_cortes;
create policy "cortadora_lee_cortes" on prod_cortes
  for select to authenticated
  using (fn_es_cortadora() and exists (
    select 1 from prod_pedidos_tela p
    where p.id = prod_cortes.pedido_id and p.estado = 'entregado'));

drop policy if exists "cortadora_lee_corte_colores" on prod_corte_colores;
create policy "cortadora_lee_corte_colores" on prod_corte_colores
  for select to authenticated
  using (fn_es_cortadora() and exists (
    select 1 from prod_cortes c
    join prod_pedidos_tela p on p.id = c.pedido_id
    where c.id = prod_corte_colores.corte_id and p.estado = 'entregado'));

drop policy if exists "cortadora_lee_corte_tallas" on prod_corte_color_tallas;
create policy "cortadora_lee_corte_tallas" on prod_corte_color_tallas
  for select to authenticated
  using (fn_es_cortadora() and exists (
    select 1 from prod_corte_colores cc
    join prod_cortes c on c.id = cc.corte_id
    join prod_pedidos_tela p on p.id = c.pedido_id
    where cc.id = prod_corte_color_tallas.corte_color_id and p.estado = 'entregado'));

-- Las maquilas de esos cortes: ahí confirmará la llegada cuando toque.
drop policy if exists "cortadora_lee_maquilas" on prod_maquilas;
create policy "cortadora_lee_maquilas" on prod_maquilas
  for select to authenticated
  using (fn_es_cortadora() and exists (
    select 1 from prod_cortes c
    join prod_pedidos_tela p on p.id = c.pedido_id
    where c.id = prod_maquilas.corte_id and p.estado = 'entregado'));

drop policy if exists "cortadora_lee_maquila_colores" on prod_maquila_colores;
create policy "cortadora_lee_maquila_colores" on prod_maquila_colores
  for select to authenticated
  using (fn_es_cortadora() and exists (
    select 1 from prod_maquilas m
    join prod_cortes c on c.id = m.corte_id
    join prod_pedidos_tela p on p.id = c.pedido_id
    where m.id = prod_maquila_colores.maquila_id and p.estado = 'entregado'));

-- ============================================================
-- 4) fn_registrar_corte: la guarda admite también a la cortadora
--
--    Sin esto, ninguna política de escritura serviría de nada: la función es
--    SECURITY INVOKER (las RLS siguen aplicando con quien llama), pero esta
--    guarda explícita la rechazaría antes de llegar a ellas.
--
--    Con esta fase TODAVÍA NO puede registrar cortes: le faltan las políticas de
--    INSERT, que van en la fase de escritura. Esto solo quita el primer cerrojo.
--
--    `create or replace` basta: la firma no cambia (7 parámetros, devuelve jsonb).
--    El cuerpo se copió literal de schema_fase8b_idempotencia.sql y lo único que
--    cambia es la guarda — ver el comentario dentro.
-- ============================================================

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

-- ============================================================
-- DESHACER:
--   drop policy if exists "cortadora_lee_prendas"         on prod_prendas;
--   drop policy if exists "cortadora_lee_maquiladoras"    on prod_maquiladoras;
--   drop policy if exists "cortadora_lee_pedidos"         on prod_pedidos_tela;
--   drop policy if exists "cortadora_lee_pedido_colores"  on prod_pedido_colores;
--   drop policy if exists "cortadora_lee_cortes"          on prod_cortes;
--   drop policy if exists "cortadora_lee_corte_colores"   on prod_corte_colores;
--   drop policy if exists "cortadora_lee_corte_tallas"    on prod_corte_color_tallas;
--   drop policy if exists "cortadora_lee_maquilas"        on prod_maquilas;
--   drop policy if exists "cortadora_lee_maquila_colores" on prod_maquila_colores;
--   drop function if exists fn_es_cortadora();
--   -- volver a aplicar fn_registrar_corte desde schema_fase8b_idempotencia.sql
--   -- y, ANTES de tocar el check, quitar el rol a cualquier usuario que lo tenga:
--   --   delete from user_roles where rol = 'cortadora';
--   alter table user_roles drop constraint user_roles_rol_check;
--   alter table user_roles add constraint user_roles_rol_check
--     check (rol in ('admin', 'logistica'));
-- ============================================================

-- ============================================================
-- Cuenta de la cortadora (DESPUÉS de crearla en Authentication → Users),
-- igual que se hizo con la de logística en schema_fase6.sql:
--   insert into user_roles (user_id, rol)
--   values ('<uuid-de-la-usuaria>', 'cortadora')
--   on conflict (user_id) do update set rol = 'cortadora';
-- ============================================================
