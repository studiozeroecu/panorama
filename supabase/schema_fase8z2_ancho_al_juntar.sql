-- Panorama — Bear & Trend · Fase 8z2: el ancho al juntar telas
-- Ejecutar DESPUÉS de schema_fase8z_unir_pedidos.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- Pedido del dueño (2026-11-06): al juntar, que quede el ancho más pequeño, o
-- elegir uno de los dos, o escribir uno nuevo. Antes quedaba el del más antiguo.
-- fn_unir_pedidos gana p_ancho_real; sin él toma el más pequeño.
--
-- ⚠️ Cambia de firma: DROP + CREATE, porque con `create or replace` quedarían dos
-- versiones vivas (la trampa de las fases 8b y 8k). Lleva default, así que el
-- código ya desplegado, que llama con tres argumentos, sigue funcionando.
-- La verificación final aborta si no queda exactamente una.

drop function if exists fn_unir_pedidos(uuid[], text, uuid);
drop function if exists fn_unir_pedidos(uuid[], text, uuid, numeric);

create function fn_unir_pedidos(
  p_pedido_ids uuid[],
  p_nombre text,
  p_prenda_id uuid,
  p_ancho_real numeric default null
) returns jsonb
language plpgsql as $BODY$
declare
  v_ids       uuid[];
  v_principal uuid := p_pedido_ids[1];
  v_otros     uuid[];
  v_prendas   uuid[];
  v_prenda    uuid;
  v_colores   jsonb;
  v_fotos     jsonb;
  v_todo_kg   boolean;
  v_kilos     numeric;
  v_metros    numeric;
  v_pagar     numeric;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede juntar pedidos.';
  end if;

  if p_ancho_real is not null and (p_ancho_real < 10 or p_ancho_real > 400) then
    raise exception 'El ancho va en centímetros, entre 10 y 400.';
  end if;

  v_ids := (select array_agg(distinct x) from unnest(p_pedido_ids) as x);
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'Elige al menos dos pedidos para juntar.';
  end if;
  v_otros := (select array_agg(x) from unnest(v_ids) as x where x <> v_principal);

  -- En orden fijo, para que dos uniones a la vez no se bloqueen entre sí. Y
  -- fn_registrar_corte bloquea esta misma fila: un corte simultáneo se serializa.
  perform 1 from prod_pedidos_tela where id = any (v_ids) order by id for update;

  if (select count(*) from prod_pedidos_tela where id = any (v_ids)) <> array_length(v_ids, 1) then
    -- Un reintento encuentra los otros ya borrados y anotados: no es un error.
    if exists (
      select 1 from prod_pedidos_tela p
       where p.id = v_principal
         and not exists (
           select 1 from unnest(v_otros) as o
            where not p.pedidos_unidos @> jsonb_build_array(jsonb_build_object('id', o))))
    then
      return jsonb_build_object('ya_unido', true, 'pedido_id', v_principal);
    end if;
    raise exception 'Uno de los pedidos ya no existe. Recarga la página.';
  end if;

  if exists (select 1 from prod_pedidos_tela where id = any (v_ids) and estado <> 'entregado') then
    raise exception 'Solo se pueden juntar telas que ya llegaron.';
  end if;
  if exists (select 1 from prod_cortes where pedido_id = any (v_ids)) then
    raise exception 'Uno de los pedidos ya tiene cortes: solo se juntan telas sin cortar.';
  end if;

  v_prendas := (select array_agg(distinct prenda_id) from prod_pedidos_tela
                 where id = any (v_ids) and prenda_id is not null);
  if coalesce(array_length(v_prendas, 1), 0) > 1 and p_prenda_id is null then
    raise exception 'Estos pedidos eran para prendas distintas: elige para cuál es la tela.';
  end if;
  if p_prenda_id is not null and not p_prenda_id = any (coalesce(v_prendas, '{}')) then
    raise exception 'La prenda elegida no es de ninguno de estos pedidos.';
  end if;
  v_prenda := coalesce(p_prenda_id, v_prendas[1]);

  -- Mismo criterio de color que el índice único: lower(btrim(color)). De un
  -- color repetido queda la forma de escribirlo del pedido principal.
  v_colores := (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'color', g.color, 'metros', g.metros, 'kilos', g.kilos)) order by g.orden)
    from (
      select (array_agg(btrim(pc.color) order by (pc.pedido_id <> v_principal), pc.orden))[1] as color,
             sum(pc.metros) as metros,
             sum(pc.kilos) as kilos,
             min(pc.orden + case when pc.pedido_id = v_principal then 0 else 1000 end) as orden
      from prod_pedido_colores pc
      where pc.pedido_id = any (v_ids)
      group by lower(btrim(pc.color))
    ) as g
  );

  -- Un pedido que ya venía de una unión aporta sus fotos, no una foto de la mezcla.
  v_fotos := (
    select coalesce(jsonb_agg(f.foto order by f.foto ->> 'fecha_pedido'), '[]'::jsonb)
    from (
      select e.value as foto
      from prod_pedidos_tela p, jsonb_array_elements(p.pedidos_unidos) as e(value)
      where p.id = any (v_ids)
      union all
      select jsonb_build_object(
               'id', p.id,
               'nombre_tela', p.nombre_tela,
               'proveedor', pr.empresa,
               'fecha_pedido', p.fecha_pedido,
               'fecha_entrega_real', p.fecha_entrega_real,
               'total_metros', p.total_metros,
               'valor_metro', p.valor_metro,
               'total_pagar', p.total_pagar,
               'ancho_real', p.ancho_real)
      from prod_pedidos_tela p
      left join prod_proveedores pr on pr.id = p.proveedor_id
      where p.id = any (v_ids) and p.pedidos_unidos = '[]'::jsonb
    ) as f
  );

  v_colores := coalesce(v_colores, '[]'::jsonb);
  v_metros  := (select sum(total_metros) from prod_pedidos_tela where id = any (v_ids));
  v_pagar   := (select sum(total_pagar) from prod_pedidos_tela where id = any (v_ids));
  v_todo_kg := not exists (select 1 from prod_pedidos_tela where id = any (v_ids) and unidad <> 'kilos');
  -- Mezcla de metros y kilos: todo color ya tiene sus metros, así que queda en metros.
  v_kilos   := case when v_todo_kg then
                 (select sum(pc.kilos) from prod_pedido_colores pc where pc.pedido_id = any (v_ids)) end;
  if not v_todo_kg then
    v_colores := (select jsonb_agg(c.value - 'kilos' order by c.ord)
                  from jsonb_array_elements(v_colores) with ordinality as c(value, ord));
  end if;

  update prod_pedidos_tela p set
    nombre_tela        = coalesce(nullif(btrim(p_nombre), ''), p.nombre_tela),
    prenda_id          = v_prenda,
    colores            = v_colores,
    total_metros       = v_metros,
    total_pagar        = v_pagar,
    valor_metro        = case when v_metros > 0 then round(v_pagar / v_metros, 4) else p.valor_metro end,
    unidad             = case when v_todo_kg then 'kilos' else 'metros' end,
    rendimiento        = case when v_kilos > 0 then round(v_metros / v_kilos, 3) end,
    fecha_pedido       = (select min(fecha_pedido) from prod_pedidos_tela where id = any (v_ids)),
    fecha_entrega_real = (select max(fecha_entrega_real) from prod_pedidos_tela where id = any (v_ids)),
    -- Por defecto el más pequeño: es el que manda en la mesa. Debajo de 10 son
    -- anchos migrados en metros, y no valen para comparar con los de centímetros.
    ancho_real         = coalesce(p_ancho_real,
                                  (select min(ancho_real) from prod_pedidos_tela where id = any (v_ids) and ancho_real >= 10),
                                  p.ancho_real),
    corrida_base       = coalesce(p.corrida_base, (select o.corrida_base from prod_pedidos_tela o
                                                    where o.id = any (v_otros) and o.corrida_base is not null limit 1)),
    pedidos_unidos     = v_fotos
  where p.id = v_principal;

  delete from prod_pedidos_tela where id = any (v_otros);

  return jsonb_build_object('pedido_id', v_principal, 'unidos', array_length(v_ids, 1), 'total_metros', v_metros);
end $BODY$;

revoke execute on function fn_unir_pedidos(uuid[], text, uuid, numeric) from anon, public;
grant execute on function fn_unir_pedidos(uuid[], text, uuid, numeric) to authenticated;

do $VERIF8Z2$
begin
  if (select count(*) from pg_proc where proname = 'fn_unir_pedidos') <> 1 then
    raise exception 'Fase 8z2: tiene que haber exactamente UNA fn_unir_pedidos.';
  end if;
  raise notice 'Fase 8z2 aplicada: el ancho al juntar telas.';
end $VERIF8Z2$;
