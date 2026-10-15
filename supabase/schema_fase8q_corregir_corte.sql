-- Panorama — Bear & Trend · Fase 8q: el admin corrige las cantidades de un corte
-- Ejecutar DESPUÉS de schema_fase8p_bajas_y_costos.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ni tras la lista de columnas ni tras `returning`) — ver la cabecera
-- de schema_fase8l: el SQL Editor de Supabase las confunde con crear una tabla.
--
-- ════════════════════════════════════════════════════════════
-- QUÉ Y POR QUÉ
--
-- Un corte registrado con las cantidades mal no tenía arreglo: no hay pantalla
-- para editarlo, y las cantidades viven en CINCO sitios que tienen que cuadrar:
--
--   prod_corte_color_tallas  — por talla (la fuente)
--   prod_corte_colores.unidades, prod_cortes.total_unidades,
--   prod_maquilas.total_unidades — los totales (almacenados, ver fase 7)
--   prod_cortes.colores, prod_maquilas.colores — los jsonb de respaldo
--
-- Tocar uno a mano dejaría los otros descuadrados en silencio. Esta función los
-- corrige todos en UNA transacción, y además reajusta el estado del lote en
-- maquila, que depende de las cantidades:
--   · si sube una talla de un color ya 'entregado', ese color vuelve a 'enviado'
--     (ahora falta algo por entregar) y deja de estar procesado;
--   · si baja hasta lo ya entregado, el color queda 'entregado'.
--
-- LA REGLA QUE NO SE PUEDE ROMPER: ninguna talla puede quedar por debajo de lo
-- que la maquila ya entregó o se justificó (fase 8o/8p). Esas prendas existen;
-- bajar el corte por debajo de ellas dejaría entregas "de más". La función lo
-- rechaza con un mensaje que dice color, talla y cuánto ya se entregó.
--
-- Solo admin. SECURITY INVOKER, como las RPC de la fase 7: el admin ya puede
-- escribir en todas estas tablas; la guarda de dentro da un mensaje claro.
--
-- Fuera de alcance, a propósito: agregar o quitar COLORES (cambia la relación con
-- el pedido y la maquila), y tocar metros o capas. Solo tallas de colores que ya
-- están en el corte — incluida una talla nueva dentro de un color existente.
-- ════════════════════════════════════════════════════════════

create or replace function fn_corregir_corte(
  p_corte_id uuid,
  p_colores jsonb   -- [{"corte_color_id": "…", "tallas": {"S": 6, "M": 10}}]
) returns jsonb
language plpgsql as $BODY$
declare
  v_c      record;
  v_t      record;
  v_m      record;
  v_cc     uuid;
  v_mc     uuid;
  v_color  text;
  v_tallas jsonb;
  v_n      integer;
  v_total  integer;
  v_maq    uuid;
  v_pend   jsonb;
  v_estado text;
  v_colores integer := 0;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede corregir un corte.';
  end if;
  if p_colores is null or jsonb_typeof(p_colores) <> 'array' or jsonb_array_length(p_colores) = 0 then
    raise exception 'No hay cantidades que corregir.';
  end if;

  -- Lock del corte: dos correcciones a la vez se serializan.
  perform 1 from prod_cortes where id = p_corte_id for update;
  if not found then
    raise exception 'El corte no existe.';
  end if;
  v_maq := (select id from prod_maquilas where corte_id = p_corte_id);

  for v_c in select value from jsonb_array_elements(p_colores) loop
    v_cc := nullif(v_c.value ->> 'corte_color_id', '')::uuid;
    v_color := (select color from prod_corte_colores where id = v_cc and corte_id = p_corte_id);
    if v_color is null then
      raise exception 'Uno de los colores no pertenece a este corte.';
    end if;

    v_mc := (select id from prod_maquila_colores where corte_color_id = v_cc);
    if v_mc is not null then
      -- Con el color de maquila bloqueado, nadie registra una entrega a mitad.
      perform 1 from prod_maquila_colores where id = v_mc for update;
    end if;

    v_tallas := coalesce(v_c.value -> 'tallas', '{}'::jsonb);
    for v_t in select key, value from jsonb_each_text(v_tallas) loop
      if v_t.value !~ '^\d+$' then
        raise exception '%, talla %: la cantidad tiene que ser un número entero.', v_color, v_t.key;
      end if;
    end loop;

    -- ⚠️ La regla: nunca por debajo de lo entregado o justificado.
    if v_mc is not null then
      for v_t in
        select x.key as talla, sum(x.value::int) as entregadas
        from prod_maquila_entregas e
        cross join lateral jsonb_each_text(e.tallas) as x
        where e.maquila_color_id = v_mc
        group by x.key
      loop
        v_n := coalesce((v_tallas ->> v_t.talla)::int, 0);
        if v_n < v_t.entregadas then
          raise exception '%, talla %: no puede quedar en % porque la maquila ya entregó o se justificaron %.',
            v_color, v_t.talla, v_n, v_t.entregadas;
        end if;
      end loop;
    end if;

    -- Las tallas se reescriben enteras; las que quedan en 0 no se guardan
    -- (misma regla que fn_registrar_corte).
    delete from prod_corte_color_tallas where corte_color_id = v_cc;
    insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
    select v_cc, key, value::int from jsonb_each_text(v_tallas) where value::int > 0;

    update prod_corte_colores
       set unidades = coalesce((select sum(value::int) from jsonb_each_text(v_tallas)), 0)
     where id = v_cc;
    v_colores := v_colores + 1;
  end loop;

  v_total := (select coalesce(sum(unidades), 0) from prod_corte_colores where corte_id = p_corte_id);
  if v_total <= 0 then
    raise exception 'El corte no puede quedar sin unidades.';
  end if;

  -- Totales y jsonb de respaldo del corte, reconstruidos desde las filas.
  update prod_cortes
     set total_unidades = v_total,
         colores = (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'color',         cc.color,
                    'tallas',        (select coalesce(jsonb_object_agg(t.talla, t.unidades), '{}'::jsonb)
                                      from prod_corte_color_tallas t where t.corte_color_id = cc.id),
                    'unidades',      cc.unidades,
                    'metros_usados', cc.metros_usados,
                    'capas',         cc.capas) order by cc.orden), '[]'::jsonb)
           from prod_corte_colores cc where cc.corte_id = p_corte_id)
   where id = p_corte_id;

  if v_maq is not null then
    -- El estado de cada color depende de lo que falta por entregar.
    for v_m in select id from prod_maquila_colores where maquila_id = v_maq loop
      v_pend := fn_tallas_pendientes_maquila(v_m.id);
      v_estado := (select estado from prod_maquila_colores where id = v_m.id);

      if v_pend <> '{}'::jsonb and v_estado = 'entregado' then
        -- Subió una talla: vuelve a faltar algo. Ya no está procesado: lo nuevo
        -- todavía tiene que llegar y pasar por Envío.
        update prod_maquila_colores
           set estado = 'enviado', fecha_entrega = null, procesado = false
         where id = v_m.id;
      elsif v_pend = '{}'::jsonb and v_estado <> 'entregado'
            and exists (select 1 from prod_maquila_entregas where maquila_color_id = v_m.id) then
        -- Bajó hasta lo entregado: el color queda completo.
        update prod_maquila_colores
           set estado = 'entregado',
               fecha_entrega = (select max(fecha) from prod_maquila_entregas where maquila_color_id = v_m.id)
         where id = v_m.id;
        if not exists (select 1 from prod_maquila_entregas
                       where maquila_color_id = v_m.id and not procesado) then
          update prod_maquila_colores set procesado = true where id = v_m.id;
        end if;
      end if;
    end loop;

    update prod_maquilas
       set total_unidades = v_total,
           colores = (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'color',         cc.color,
                      'tallas',        (select coalesce(jsonb_object_agg(t.talla, t.unidades), '{}'::jsonb)
                                        from prod_corte_color_tallas t where t.corte_color_id = cc.id),
                      'unidades',      cc.unidades,
                      'estado',        mc.estado,
                      'fecha_envio',   mc.fecha_envio,
                      'fecha_entrega', mc.fecha_entrega,
                      'procesado',     mc.procesado) order by cc.orden), '[]'::jsonb)
             from prod_maquila_colores mc
             join prod_corte_colores cc on cc.id = mc.corte_color_id
             where mc.maquila_id = v_maq)
     where id = v_maq;
  end if;

  return jsonb_build_object('total', v_total, 'colores', v_colores);
end $BODY$;

-- ============================================================
-- Verificación final — solo mira.
-- ============================================================

do $VERIF8Q$
begin
  if (select count(*) from pg_proc where proname = 'fn_corregir_corte') <> 1 then
    raise exception 'Fase 8q: tiene que haber exactamente una fn_corregir_corte.';
  end if;
  raise notice 'Fase 8q aplicada: el admin puede corregir las cantidades de un corte.';
end $VERIF8Q$;

-- ============================================================
-- DESHACER:
--   drop function if exists fn_corregir_corte(uuid, jsonb);
-- ============================================================
