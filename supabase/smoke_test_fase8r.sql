-- SMOKE TEST de conjuntos de dos partes (fase 8r).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8r_conjuntos.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA — ni las
-- prendas de prueba ni el stock online que suma.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- Las que justifican el archivo:
--   · la 1: UN corte con las dos partes del mismo color, cada una con su precio
--     de maquila — lo que antes obligaba a registrar dos cortes;
--   · la 7: en Envío, la parte superior y la inferior entran al stock por
--     separado, cada una con su nombre.

do $SMOKE$
declare
  v_rep   text := '';
  v_r     text;
  v_ok    int := 0;
  v_bad   int := 0;
  v_conj  uuid := gen_random_uuid();
  v_sola  uuid := gen_random_uuid();
  v_ped   uuid := gen_random_uuid();
  v_ped2  uuid := gen_random_uuid();
  v_res   jsonb;
  v_cor   uuid;
  v_sup   uuid;
  v_inf   uuid;
  v_ent   uuid;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- Un conjunto con sus dos partes, y una prenda sola.
  insert into prod_prendas (id, nombre, es_conjunto, precio_venta_online)
  values (v_conj, 'ZZ Conjunto 8r', true, 30);
  insert into prod_prenda_partes (prenda_id, parte, nombre, consumo_metros, costo_maquila, precio_venta_online)
  values (v_conj, 'superior', 'ZZBlusa', 0.8, 1.20, 18),
         (v_conj, 'inferior', 'ZZPantalon', 1.1, 1.50, 20);
  insert into prod_prendas (id, nombre) values (v_sola, 'ZZ Camiseta 8r');

  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores, total_metros,
     valor_metro, total_pagar, estado, fecha_entrega_real, prenda_id)
  values (v_ped, 'ZZ_SMOKE 8r conjunto', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8r","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador(), v_conj),
         (v_ped2, 'ZZ_SMOKE 8r sola', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8r","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador(), v_sola);

  -- ── 1. ⚠️ un solo corte con las dos partes del mismo color ──
  begin
    v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 0,
      '[{"color":"ZZNegro8r","parte":"superior","capas":4,"tallas":{"S":4,"M":6},"costo_maquila":1.20},
        {"color":"ZZNegro8r","parte":"inferior","capas":3,"tallas":{"S":3,"M":5},"costo_maquila":1.50}]'::jsonb,
      gen_random_uuid(), null);
    v_cor := (v_res ->> 'corte_id')::uuid;
    v_sup := (select id from prod_corte_colores where corte_id = v_cor and parte = 'superior');
    v_inf := (select id from prod_corte_colores where corte_id = v_cor and parte = 'inferior');
    v_r := case
      when (select total_unidades from prod_cortes where id = v_cor) = 18
       and (select unidades from prod_corte_colores where id = v_sup) = 10
       and (select unidades from prod_corte_colores where id = v_inf) = 8
       and (select costo_unitario from prod_maquila_colores where corte_color_id = v_sup) = 1.20
       and (select costo_unitario from prod_maquila_colores where corte_color_id = v_inf) = 1.50
      then 'OK — 10 superiores + 8 inferiores, cada una con su precio'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · un corte, dos partes ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. en un conjunto, cada fila tiene que decir su parte ──
  begin
    perform fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 0,
      '[{"color":"ZZNegro8r","tallas":{"S":1}}]'::jsonb, gen_random_uuid(), null);
    v_r := 'FALLA — aceptó un corte de conjunto sin partes';
  exception when others then
    v_r := case when SQLERRM like '%conjunto%' then 'OK — pide la parte'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · conjunto sin parte ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. una prenda sola no lleva partes ──
  begin
    perform fn_registrar_corte(v_ped2, fn_hoy_ecuador(), null, '', 0,
      '[{"color":"ZZNegro8r","parte":"superior","tallas":{"S":1}}]'::jsonb, gen_random_uuid(), null);
    v_r := 'FALLA — aceptó partes en una prenda sola';
  exception when others then
    v_r := case when SQLERRM like '%no está marcada como conjunto%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · prenda sola sin partes ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. la misma parte dos veces en un color se rechaza con un mensaje claro ──
  begin
    perform fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 0,
      '[{"color":"ZZNegro8r","parte":"superior","tallas":{"S":1}},
        {"color":"zznegro8r","parte":"superior","tallas":{"M":1}}]'::jsonb, gen_random_uuid(), null);
    v_r := 'FALLA — aceptó la misma parte repetida';
  exception when others then
    v_r := case when SQLERRM like '%repetido%' then 'OK — "color repetido"'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  4 · parte repetida ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. una prenda sola se sigue cortando como siempre ──
  begin
    v_res := fn_registrar_corte(v_ped2, fn_hoy_ecuador(), null, '', 1.5,
      '[{"color":"ZZNegro8r","tallas":{"S":2,"M":2}}]'::jsonb, gen_random_uuid(), null);
    v_r := case when (v_res ->> 'unidades')::int = 4
                 and (select parte from prod_corte_colores where corte_id = (v_res ->> 'corte_id')::uuid) is null
                then 'OK — 4 unidades, sin parte'
                else 'FALLA — ' || v_res::text end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · prenda sola sin cambios ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. el espejo del jsonb distingue la parte ──
  begin
    update prod_maquila_colores set estado = 'enviado', fecha_envio = fn_hoy_ecuador()
     where corte_color_id = v_sup;
    v_r := case
      when (select e.value ->> 'estado' from prod_maquilas m,
                   jsonb_array_elements(m.colores) e
             where m.corte_id = v_cor and e.value ->> 'parte' = 'superior') = 'enviado'
       and (select e.value ->> 'estado' from prod_maquilas m,
                   jsonb_array_elements(m.colores) e
             where m.corte_id = v_cor and e.value ->> 'parte' = 'inferior') = 'pendiente'
      then 'OK — solo la superior quedó "enviado"'
      else 'FALLA — el espejo pisó la otra parte' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · espejo por parte ............... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. ⚠️ en Envío cada parte entra al stock con su nombre ──
  begin
    perform fn_registrar_entrega_maquila(
      (select id from prod_maquila_colores where corte_color_id = v_sup),
      fn_hoy_ecuador(), '{"S":4}'::jsonb);
    perform fn_registrar_entrega_maquila(
      (select id from prod_maquila_colores where corte_color_id = v_inf),
      fn_hoy_ecuador(), '{"S":3}'::jsonb);
    for v_ent in select e.id from prod_maquila_entregas e
                 join prod_maquila_colores mc on mc.id = e.maquila_color_id
                 where mc.corte_color_id in (v_sup, v_inf) loop
      perform fn_procesar_entrega_maquila(v_ent, 'online');
    end loop;
    v_r := case
      when (select disponibles from prod_stock_online
             where prenda_nombre = 'ZZ Conjunto 8r — ZZBlusa' and color = 'ZZNegro8r' and talla = 'S') = 4
       and (select disponibles from prod_stock_online
             where prenda_nombre = 'ZZ Conjunto 8r — ZZPantalon' and color = 'ZZNegro8r' and talla = 'S') = 3
      then 'OK — Blusa S:4 y Pantalón S:3, por separado'
      else 'FALLA — el stock no separó las partes' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  7 · stock por parte ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. una sola versión de cada función ──
  v_r := case when (select count(*) from pg_proc where proname = 'fn_registrar_corte') = 1
               and (select count(*) from pg_proc where proname = 'fn_procesar_entrega_maquila') = 1
              then 'OK — sin sobrecargas'
              else 'FALLA — hay versiones de más' end;
  v_rep := v_rep || E'\n  8 · sin sobrecargas ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST conjuntos (fase 8r) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
