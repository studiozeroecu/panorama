-- Panorama — Bear & Trend · Fase 8x: convertir en conjunto un corte viejo
-- Ejecutar DESPUÉS de schema_fase8w_lista_estampados.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- EL PROBLEMA (dueño, 2026-10-27)
--
-- Un corte de un CONJUNTO registrado antes de la fase 8r quedó con una sola
-- fila por color (sin parte): "negro 7" en vez de "negro · blusa 7" y
-- "negro · pantalón 7". No había forma de partirlo sin rehacerlo.
--
-- fn_convertir_a_conjunto parte cada color en sus dos filas (superior e
-- inferior) con las tallas que escribe el dueño, y deja maquila y entregas
-- coherentes:
--   · la fila vieja pasa a ser la SUPERIOR; la inferior es una fila nueva con
--     el mismo color, pedido_color, orden y capas;
--   · en maquila, cada parte con su precio (prod_prenda_partes.costo_maquila) y
--     el MISMO estado y fechas que tenía el color;
--   · si el color ya había vuelto de maquila (entregado), sus entregas se
--     rehacen: una por parte, completa. Solo se permite si NINGUNA entrega del
--     corte pasó por Envío y no hay bajas: con algo ya en stock, partirlo
--     dejaría el stock contando lo viejo.
--   · totales y jsonb de respaldo se reconstruyen desde las filas (como la 8q).
-- ════════════════════════════════════════════════════════════

create or replace function fn_convertir_a_conjunto(
  p_corte_id uuid,
  p_colores jsonb
) returns jsonb
language plpgsql as $BODY$
declare
  v_prenda   uuid;
  v_maq      uuid;
  v_c        record;
  v_cc       uuid;
  v_cc2      uuid;
  v_mc       uuid;
  v_mc2      uuid;
  v_sup      jsonb;
  v_inf      jsonb;
  v_estado   text;
  v_fenv     date;
  v_fent     date;
  v_costo_s  numeric;
  v_costo_i  numeric;
  v_total    integer;
  v_n        integer := 0;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede convertir un corte.';
  end if;
  perform 1 from prod_cortes where id = p_corte_id for update;
  if not found then
    raise exception 'El corte no existe.';
  end if;

  v_prenda := (select pt.prenda_id from prod_cortes k
               join prod_pedidos_tela pt on pt.id = k.pedido_id where k.id = p_corte_id);
  if not coalesce((select es_conjunto from prod_prendas where id = v_prenda), false) then
    raise exception 'La prenda de este corte no está marcada como conjunto (Prendas → editar).';
  end if;
  if exists (select 1 from prod_corte_colores where corte_id = p_corte_id and parte is not null) then
    raise exception 'Este corte ya está separado por partes.';
  end if;

  v_maq := (select id from prod_maquilas where corte_id = p_corte_id);
  if v_maq is not null and exists (
       select 1 from prod_maquila_entregas e
       join prod_maquila_colores mc on mc.id = e.maquila_color_id
       where mc.maquila_id = v_maq and e.procesado) then
    raise exception 'Parte de este corte ya pasó por Envío o tiene bajas; no se puede separar.';
  end if;

  if p_colores is null or jsonb_typeof(p_colores) <> 'array'
     or (select count(*) from jsonb_array_elements(p_colores)) <>
        (select count(*) from prod_corte_colores where corte_id = p_corte_id)
     or (select count(distinct value ->> 'corte_color_id') from jsonb_array_elements(p_colores)) <>
        (select count(*) from prod_corte_colores where corte_id = p_corte_id) then
    raise exception 'Hay que separar todos los colores del corte, una vez cada uno.';
  end if;

  v_costo_s := coalesce((select costo_maquila from prod_prenda_partes where prenda_id = v_prenda and parte = 'superior'), 0);
  v_costo_i := coalesce((select costo_maquila from prod_prenda_partes where prenda_id = v_prenda and parte = 'inferior'), 0);

  for v_c in select value as x from jsonb_array_elements(p_colores) loop
    v_cc := nullif(v_c.x ->> 'corte_color_id', '')::uuid;
    if v_cc is null or not exists (select 1 from prod_corte_colores where id = v_cc and corte_id = p_corte_id) then
      raise exception 'Un color no es de este corte.';
    end if;
    v_sup := fn_tallas_reparto(v_c.x -> 'superior', 'Parte superior');
    v_inf := fn_tallas_reparto(v_c.x -> 'inferior', 'Parte inferior');
    if fn_total_tallas(v_sup) = 0 or fn_total_tallas(v_inf) = 0 then
      raise exception 'Cada color necesita unidades en las dos partes.';
    end if;

    -- ── corte: la fila vieja es la superior, la inferior es nueva ──
    update prod_corte_colores set parte = 'superior', unidades = fn_total_tallas(v_sup) where id = v_cc;
    delete from prod_corte_color_tallas where corte_color_id = v_cc;
    insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
    select v_cc, key, value::int from jsonb_each_text(v_sup);

    v_cc2 := gen_random_uuid();
    insert into prod_corte_colores (id, corte_id, pedido_color_id, color, unidades, metros_usados, orden, parte, capas, tono)
    select v_cc2, corte_id, pedido_color_id, color, fn_total_tallas(v_inf), null, orden, 'inferior', capas, tono
    from prod_corte_colores where id = v_cc;
    insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
    select v_cc2, key, value::int from jsonb_each_text(v_inf);

    -- ── maquila: cada parte con su precio, mismo estado y fechas ──
    if v_maq is not null then
      v_mc := (select id from prod_maquila_colores where maquila_id = v_maq and corte_color_id = v_cc);
      if v_mc is not null then
        v_estado := (select estado        from prod_maquila_colores where id = v_mc);
        v_fenv   := (select fecha_envio   from prod_maquila_colores where id = v_mc);
        v_fent   := (select fecha_entrega from prod_maquila_colores where id = v_mc);

        delete from prod_maquila_entregas where maquila_color_id = v_mc;
        update prod_maquila_colores set costo_unitario = v_costo_s, procesado = false where id = v_mc;

        v_mc2 := gen_random_uuid();
        insert into prod_maquila_colores (id, maquila_id, corte_color_id, estado, fecha_envio, fecha_entrega,
                                          procesado, costo_unitario)
        values (v_mc2, v_maq, v_cc2, v_estado, v_fenv, v_fent, false, v_costo_i);

        -- Lo que ya había vuelto vuelve a estar completo, ahora por parte.
        if v_estado = 'entregado' then
          insert into prod_maquila_entregas (maquila_color_id, fecha, tallas, unidades)
          values (v_mc,  coalesce(v_fent, fn_hoy_ecuador()), v_sup, fn_total_tallas(v_sup)),
                 (v_mc2, coalesce(v_fent, fn_hoy_ecuador()), v_inf, fn_total_tallas(v_inf));
        end if;
      end if;
    end if;
    v_n := v_n + 1;
  end loop;

  -- ── totales y jsonb de respaldo, desde las filas ──
  v_total := (select coalesce(sum(unidades), 0) from prod_corte_colores where corte_id = p_corte_id);
  update prod_cortes
     set total_unidades = v_total,
         colores = (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'color',         cc.color,
                    'parte',         cc.parte,
                    'tallas',        (select coalesce(jsonb_object_agg(t.talla, t.unidades), '{}'::jsonb)
                                      from prod_corte_color_tallas t where t.corte_color_id = cc.id),
                    'unidades',      cc.unidades,
                    'metros_usados', cc.metros_usados,
                    'capas',         cc.capas) order by cc.orden, cc.parte), '[]'::jsonb)
           from prod_corte_colores cc where cc.corte_id = p_corte_id)
   where id = p_corte_id;

  if v_maq is not null then
    update prod_maquilas
       set total_unidades = v_total,
           colores = (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'color',         cc.color,
                      'parte',         cc.parte,
                      'tallas',        (select coalesce(jsonb_object_agg(t.talla, t.unidades), '{}'::jsonb)
                                        from prod_corte_color_tallas t where t.corte_color_id = cc.id),
                      'unidades',      cc.unidades,
                      'estado',        mc.estado,
                      'fecha_envio',   mc.fecha_envio,
                      'fecha_entrega', mc.fecha_entrega,
                      'procesado',     mc.procesado) order by cc.orden, cc.parte), '[]'::jsonb)
             from prod_maquila_colores mc
             join prod_corte_colores cc on cc.id = mc.corte_color_id
             where mc.maquila_id = v_maq)
     where id = v_maq;
  end if;

  return jsonb_build_object('colores', v_n, 'total', v_total);
end $BODY$;

revoke execute on function fn_convertir_a_conjunto(uuid, jsonb) from anon, public;
grant execute on function fn_convertir_a_conjunto(uuid, jsonb) to authenticated;

do $VERIF8X$
begin
  if (select count(*) from pg_proc where proname = 'fn_convertir_a_conjunto') <> 1 then
    raise exception 'Fase 8x: tiene que haber exactamente UNA fn_convertir_a_conjunto.';
  end if;
  raise notice 'Fase 8x aplicada: convertir en conjunto un corte viejo.';
end $VERIF8X$;
