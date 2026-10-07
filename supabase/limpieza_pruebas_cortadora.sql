-- Borra TODAS las telas de prueba y todo lo que salió de ellas.
-- NO forma parte de la cadena de migraciones. Reemplaza a limpieza_prueba_tecnica.sql
-- (que asigna variables de una forma que el SQL Editor de Supabase ya no deja correr).
--
-- Qué cuenta como prueba (por el NOMBRE de la tela):
--   · contiene "PRUEBA"   → "Jersey algodón 30/1 — PRUEBA TECNICA", "ZZZ-PRUEBA recibir 2"…
--   · contiene "PRACTICA" → "Jersey algodón 30/1 — PRACTICA CORTADORA"
--   · empieza por "ZZ"
-- ⚠️ Si alguna tela REAL tuviera esas palabras en el nombre, saldría en la lista del
-- PASO 1. Míralo antes de seguir.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL (ver la cabecera de schema_fase8l): el SQL Editor las rompe.
--
-- ════════════════════════════════════════════════════════════
-- PASO 1 — solo MIRA. Córrelo solo (selecciona hasta el `;` del final).
-- Lista las telas que se borrarían y, para cada una, si algo pasó por Envío.
-- ════════════════════════════════════════════════════════════

select p.nombre_tela,
       p.estado,
       (select count(*) from prod_cortes c where c.pedido_id = p.id) as cortes,
       (select count(*) from prod_maquila_entregas e
          join prod_maquila_colores mc on mc.id = e.maquila_color_id
          join prod_maquilas m on m.id = mc.maquila_id
          join prod_cortes c on c.id = m.corte_id
        where c.pedido_id = p.id and e.tipo = 'entrega' and e.procesado) as procesadas_en_envio,
       (select count(*) from prod_envios_locales el
          join prod_maquilas m on m.id = el.maquila_id
          join prod_cortes c on c.id = m.corte_id
        where c.pedido_id = p.id) as envios_a_locales,
       (select count(*) from prod_lotes_estampado le
          join prod_maquilas m on m.id = le.maquila_id
          join prod_cortes c on c.id = m.corte_id
        where c.pedido_id = p.id) as lotes_estampado
from prod_pedidos_tela p
where p.nombre_tela ilike '%PRUEBA%'
   or p.nombre_tela ilike '%PRACTICA%'
   or p.nombre_tela like 'ZZ%'
order by p.nombre_tela;

-- ════════════════════════════════════════════════════════════
-- PASO 2 — BORRA. Un solo bloque DO = una sola transacción: o todo o nada.
--
-- Arranca en ENSAYO: recorre todo, dice cuántas filas quitaría y REVIERTE
-- (termina con un "error" que es el reporte). Cuando los números te cuadren,
-- cambia v_ensayo a false y córrelo otra vez.
--
-- Se NIEGA a borrar si alguna prueba pasó por Envío (stock online, envío a
-- local o lote de estampado): eso tocó stock compartido con lo real y no se
-- puede deshacer a ciegas. En ese caso, pásale el resultado del PASO 1 a quien
-- te ayuda con el sistema.
--
-- El orden es de la hoja a la raíz: prod_maquila_colores restringe el borrado
-- de los colores del corte, así que va antes que ellos.
-- ════════════════════════════════════════════════════════════

do $LIMPIEZA$
declare
  v_ensayo boolean := true;      -- ⚠️⚠️ CAMBIA A false PARA BORRAR DE VERDAD
  v_peds   uuid[];
  v_nombres text;
  v_cortes uuid[];
  v_maqs   uuid[];
  v_mcs    uuid[];
  v_cc     uuid[];
  v_jors   uuid[];
  v_del    int;
  v_tot    int := 0;
  v_rep    text := '';
begin
  -- Todos los ids ANTES de borrar: en cuanto cae la primera fila, los joins
  -- dejan de encontrar el resto.
  v_peds := (select coalesce(array_agg(id), '{}') from prod_pedidos_tela
             where nombre_tela ilike '%PRUEBA%' or nombre_tela ilike '%PRACTICA%'
                or nombre_tela like 'ZZ%');
  if coalesce(array_length(v_peds, 1), 0) = 0 then
    raise exception 'No hay telas de prueba. Nada que borrar.';
  end if;
  v_nombres := (select string_agg(nombre_tela, ' · ' order by nombre_tela)
                from prod_pedidos_tela where id = any(v_peds));

  v_cortes := (select coalesce(array_agg(id), '{}') from prod_cortes where pedido_id = any(v_peds));
  v_maqs   := (select coalesce(array_agg(id), '{}') from prod_maquilas where corte_id = any(v_cortes));
  v_mcs    := (select coalesce(array_agg(id), '{}') from prod_maquila_colores where maquila_id = any(v_maqs));
  v_cc     := (select coalesce(array_agg(id), '{}') from prod_corte_colores where corte_id = any(v_cortes));
  -- Las jornadas que SOLO eran de estos cortes (si una también cubre un corte
  -- real, se queda: sus horas siguen siendo verdad para ese otro corte).
  v_jors := (select coalesce(array_agg(distinct jc.jornada_id), '{}')
             from prod_jornada_cortes jc
             where jc.corte_id = any(v_cortes)
               and not exists (select 1 from prod_jornada_cortes otra
                               where otra.jornada_id = jc.jornada_id
                                 and not (otra.corte_id = any(v_cortes))));

  -- ── La guarda: nada que haya tocado stock compartido ──
  if exists (select 1 from prod_maquila_entregas
             where maquila_color_id = any(v_mcs) and tipo = 'entrega' and procesado)
     or exists (select 1 from prod_envios_locales where maquila_id = any(v_maqs))
     or exists (select 1 from prod_lotes_estampado where maquila_id = any(v_maqs)) then
    raise exception E'NO SE BORRÓ NADA.\nAlguna prueba pasó por Envío (stock online, envío a local o estampado).\nEso sumó stock compartido con lo real y hay que deshacerlo a mano.\nCorre el PASO 1 y pásale el resultado a quien te ayuda con el sistema.';
  end if;

  -- ── de la hoja a la raíz ──
  delete from prod_corte_retazos where corte_id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   retazos .................. ' || v_del;

  delete from prod_corte_insumos where corte_id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   insumos .................. ' || v_del;

  delete from prod_jornada_cortes where corte_id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   enlaces de horas ......... ' || v_del;

  delete from prod_jornadas where id = any(v_jors);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   jornadas (horas) ......... ' || v_del;

  delete from prod_maquila_entregas where maquila_color_id = any(v_mcs);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   entregas y bajas ......... ' || v_del;

  -- Antes que prod_corte_colores: es quien lo restringe.
  delete from prod_maquila_colores where id = any(v_mcs);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   colores de maquila ....... ' || v_del;

  delete from prod_corte_color_tallas where corte_color_id = any(v_cc);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   tallas de corte .......... ' || v_del;

  delete from prod_corte_colores where id = any(v_cc);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   colores de corte ......... ' || v_del;

  delete from prod_maquilas where id = any(v_maqs);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   maquilas ................. ' || v_del;

  delete from prod_cortes where id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   cortes ................... ' || v_del;

  delete from prod_pedido_colores where pedido_id = any(v_peds);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   colores de la tela ....... ' || v_del;

  delete from prod_pedidos_tela where id = any(v_peds);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   telas .................... ' || v_del;

  if v_ensayo then
    raise exception E'\n════ ENSAYO — NO SE BORRÓ NADA ════\n\n  Telas: %\n%\n\n  Total: % filas.\n\n  Si cuadra, cambia v_ensayo a false y córrelo otra vez.\n',
      v_nombres, v_rep, v_tot;
  end if;

  raise notice E'\n════ BORRADO ════\n\n  Telas: %\n%\n\n  Total: % filas.\n', v_nombres, v_rep, v_tot;
end $LIMPIEZA$;
