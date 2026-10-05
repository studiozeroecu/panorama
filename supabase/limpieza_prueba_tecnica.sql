-- Borra el pedido "PRUEBA TECNICA" y TODO lo que salió de él.
-- NO forma parte de la cadena de migraciones.
--
-- ⚠️ SIN begin;/commit; — un solo bloque DO = una sola transacción.
--
-- Arranca en modo ENSAYO: recorre todo, te dice cuántas filas quitaría, y
-- revierte. Cambia v_ensayo a false solo cuando los números te cuadren.
--
-- NO toca "PRACTICA CORTADORA": ese se queda para que ella siga practicando.
--
-- ⚠️ El orden no es decorativo. prod_maquila_colores.corte_color_id es RESTRICT,
-- así que un `delete from prod_cortes` a secas puede fallar o funcionar según en
-- qué orden procese Postgres las cascadas hermanas. Se borra de la hoja a la raíz.
--
-- Los retazos, insumos y enlaces de jornada SÍ cascadean desde prod_cortes, pero
-- se borran explícitos igual: así el reporte dice cuántos había.

do $$
declare
  v_ensayo  boolean := true;      -- ⚠️⚠️ CAMBIA A false PARA BORRAR DE VERDAD
  v_ped     uuid;
  v_cortes  uuid[];
  v_maqs    uuid[];
  v_cc      uuid[];
  v_n       int;
  v_del     int;
  v_tot     int := 0;
  v_rep     text := '';
begin
  select count(*), (array_agg(id))[1] into v_n, v_ped
  from prod_pedidos_tela where nombre_tela like '%PRUEBA TECNICA%';

  if v_n = 0 then
    raise exception 'No hay ningún pedido "PRUEBA TECNICA". Nada que borrar.';
  elsif v_n > 1 then
    raise exception 'Hay % pedidos "PRUEBA TECNICA". Revísalos a mano antes de borrar.', v_n;
  end if;

  -- Todos los ids ANTES de borrar: en cuanto cae la primera fila los joins
  -- dejan de encontrar el resto.
  select coalesce(array_agg(id), '{}') into v_cortes
    from prod_cortes where pedido_id = v_ped;
  select coalesce(array_agg(id), '{}') into v_maqs
    from prod_maquilas where corte_id = any(v_cortes);
  select coalesce(array_agg(id), '{}') into v_cc
    from prod_corte_colores where corte_id = any(v_cortes);

  raise notice 'Pedido % · cortes: % · maquilas: %',
    v_ped, coalesce(array_length(v_cortes,1),0), coalesce(array_length(v_maqs,1),0);

  -- ── de la hoja a la raíz ──
  delete from prod_corte_retazos where corte_id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   1 · retazos ................. ' || v_del;

  delete from prod_corte_insumos where corte_id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   2 · insumos ................. ' || v_del;

  delete from prod_jornada_cortes where corte_id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   3 · enlaces de jornada ...... ' || v_del;

  -- Antes que prod_corte_colores: es quien lo restringe.
  delete from prod_maquila_colores where maquila_id = any(v_maqs);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   4 · colores de maquila ...... ' || v_del;

  delete from prod_corte_color_tallas where corte_color_id = any(v_cc);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   5 · tallas de corte ......... ' || v_del;

  delete from prod_corte_colores where id = any(v_cc);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   6 · colores de corte ........ ' || v_del;

  delete from prod_maquilas where id = any(v_maqs);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   7 · maquilas ................ ' || v_del;

  delete from prod_cortes where id = any(v_cortes);
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   8 · cortes .................. ' || v_del;

  delete from prod_pedido_colores where pedido_id = v_ped;
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n   9 · colores del pedido ...... ' || v_del;

  delete from prod_pedidos_tela where id = v_ped;
  get diagnostics v_del = row_count; v_tot := v_tot + v_del;
  v_rep := v_rep || E'\n  10 · el pedido ............... ' || v_del;

  -- Las jornadas NO se borran: las horas trabajadas son un dato real aunque el
  -- corte de prueba desaparezca. Si alguna queda sin ningún corte enlazado, aquí
  -- se avisa para que decidas tú.
  select count(*) into v_n
  from prod_jornadas j
  where not exists (select 1 from prod_jornada_cortes jc where jc.jornada_id = j.id);
  v_rep := v_rep || E'\n\n  Jornadas sin ningún corte enlazado: ' || v_n ||
           '  (NO se borran — revísalas tú)';

  if v_ensayo then
    raise exception
      E'\n════ ENSAYO — NO SE BORRÓ NADA ════%\n\n  TOTAL: % filas\n\n  Este error es el reporte: todo quedó revertido.\n  Si cuadra, cambia v_ensayo a false y vuelve a correrlo.\n',
      v_rep, v_tot;
  else
    raise notice E'\n════ BORRADO HECHO ════%\n\n  TOTAL: % filas eliminadas\n', v_rep, v_tot;
  end if;
end $$;
