-- SMOKE TEST del reparto por talla y las ferias (fase 8s).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8s_reparto_ferias.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA — ni la
-- feria de prueba ni el stock online que suma.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- Las que justifican el archivo:
--   · la 1: UNA entrega repartida entre los cuatro destinos, talla por talla;
--   · la 2: si una talla no cuadra, no se guarda nada;
--   · la 7: el lote de estampado que nace del reparto vuelve del taller con
--     las tallas EXACTAS que se escribieron, no adivinadas.

do $SMOKE$
declare
  v_rep    text := '';
  v_r      text;
  v_ok     int := 0;
  v_bad    int := 0;
  v_prenda uuid := gen_random_uuid();
  v_ped    uuid := gen_random_uuid();
  v_feria  uuid := gen_random_uuid();
  v_feria2 uuid := gen_random_uuid();
  v_res    jsonb;
  v_cor    uuid;
  v_mc     uuid;
  v_ent    uuid;
  v_ent2   uuid;
  v_lote   uuid;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_prendas (id, nombre) values (v_prenda, 'ZZ Camiseta 8s');
  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores, total_metros,
     valor_metro, total_pagar, estado, fecha_entrega_real, prenda_id)
  values (v_ped, 'ZZ_SMOKE 8s', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"ZZNegro8s","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador(), v_prenda);
  insert into prod_ferias (id, nombre) values (v_feria, 'ZZ Feria 8s');
  insert into prod_ferias (id, nombre, cerrada_en) values (v_feria2, 'ZZ Feria cerrada 8s', now());

  v_res := fn_registrar_corte(v_ped, fn_hoy_ecuador(), null, '', 1,
    '[{"color":"ZZNegro8s","tallas":{"S":20,"M":30}}]'::jsonb, gen_random_uuid(), null);
  v_cor := (v_res ->> 'corte_id')::uuid;
  v_mc := (select mc.id from prod_maquila_colores mc
           join prod_corte_colores cc on cc.id = mc.corte_color_id
           where cc.corte_id = v_cor);
  update prod_maquila_colores set estado = 'enviado', fecha_envio = fn_hoy_ecuador() where id = v_mc;

  -- Dos entregas: la primera (S:10 M:15) es la que se reparte en las pruebas.
  perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":10,"M":15}'::jsonb);
  v_ent := (select id from prod_maquila_entregas where maquila_color_id = v_mc
            order by created_at, id limit 1);

  -- ── 2. ⚠️ si una talla no cuadra, no se guarda NADA ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      '{"online":{"S":10,"M":14}}'::jsonb);
    v_r := 'FALLA — aceptó un reparto que no cuadra';
  exception when others then
    v_r := case when SQLERRM like '%Talla M%llegaron 15%repartiste 14%'
                 and not (select procesado from prod_maquila_entregas where id = v_ent)
                then 'OK — "Talla M: llegaron 15 y repartiste 14"'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · talla que no cuadra ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. diseño con unidades y sin nombre ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      '{"online":{"S":8,"M":15},"estampado":{"costo":2,"disenos":[{"nombre":" ","tallas":{"S":2}}]}}'::jsonb);
    v_r := 'FALLA — aceptó un diseño sin nombre';
  exception when others then
    v_r := case when SQLERRM like '%sin nombre%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · diseño sin nombre .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. cantidades negativas ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      ('{"online":{"S":12,"M":15},"feria":{"feria_id":"' || v_feria || '","tallas":{"S":-2}}}')::jsonb);
    v_r := 'FALLA — aceptó un negativo';
  exception when others then
    v_r := case when SQLERRM like '%entero positivo%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  4 · cantidad negativa .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. a una feria cerrada no se manda nada ──
  begin
    perform fn_repartir_entrega_maquila(v_ent,
      ('{"online":{"S":6,"M":15},"feria":{"feria_id":"' || v_feria2 || '","tallas":{"S":4}}}')::jsonb);
    v_r := 'FALLA — aceptó una feria cerrada';
  exception when others then
    v_r := case when SQLERRM like '%cerrada%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  5 · feria cerrada .................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 1. ⚠️ una entrega, cuatro destinos, talla por talla ──
  --   S: 2 online + 4 estampado + 0 local + 4 feria = 10
  --   M: 5 online + 8 estampado + 2 local + 0 feria = 15
  begin
    v_res := fn_repartir_entrega_maquila(v_ent, (
      '{"online":{"S":2,"M":5},
        "estampado":{"costo":2,"disenos":[
            {"nombre":"ZZLogo","tallas":{"S":4,"M":4}},
            {"nombre":"ZZOso","tallas":{"M":4}},
            {"nombre":"","tallas":{}}]},
        "local":{"tallas":{"M":2},"local_destino":"PK","precio":12,"costo_unitario":5},
        "feria":{"feria_id":"' || v_feria || '","tallas":{"S":4},"costo_unitario":5}}')::jsonb);
    v_lote := (select id from prod_lotes_estampado where prenda_id = v_prenda);
    v_r := case
      when (v_res ->> 'online')::int = 7 and (v_res ->> 'estampado')::int = 12
       and (v_res ->> 'local')::int = 2 and (v_res ->> 'feria')::int = 4
       and (select disponibles from prod_stock_online
             where prenda_id = v_prenda and estampado = '' and talla = 'S') = 2
       and (select disponibles from prod_stock_online
             where prenda_id = v_prenda and estampado = '' and talla = 'M') = 5
       and (select tallas from prod_lotes_estampado where id = v_lote) = '{"S":4,"M":8}'::jsonb
       and (select total_unidades from prod_lotes_estampado where id = v_lote) = 12
       and (select jsonb_array_length(disenos) from prod_lotes_estampado where id = v_lote) = 2
       and (select disenos -> 1 -> 'tallas' from prod_lotes_estampado where id = v_lote) = '{"M":4}'::jsonb
       and (select tallas from prod_envios_locales where prenda_id = v_prenda) = '{"M":2}'::jsonb
       and (select unidades from prod_feria_ingresos where feria_id = v_feria) = 4
       and (select costo_unitario from prod_feria_ingresos where feria_id = v_feria) = 5
       and (select procesado from prod_maquila_entregas where id = v_ent)
      then 'OK — online 7 · estampado 12 (por diseño) · local 2 · feria 4'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · cuatro destinos ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. un segundo clic no reparte dos veces ──
  begin
    perform fn_repartir_entrega_maquila(v_ent, '{"online":{"S":10,"M":15}}'::jsonb);
    v_r := 'FALLA — procesó la misma entrega dos veces';
  exception when others then
    v_r := case when SQLERRM like '%ya fue procesada%'
                 and (select disponibles from prod_stock_online
                       where prenda_id = v_prenda and estampado = '' and talla = 'S') = 2
                then 'OK — "ya fue procesada", stock intacto'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  6 · reintento ...................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. ⚠️ el lote vuelve del taller con las tallas que se escribieron ──
  begin
    update prod_lotes_estampado set estado = 'en_taller', fecha_envio = fn_hoy_ecuador() where id = v_lote;
    perform fn_retornar_lote_estampado(v_lote, fn_hoy_ecuador());
    v_r := case
      when (select disponibles from prod_stock_online
             where prenda_id = v_prenda and estampado <> '' and talla = 'S') = 4
       and (select disponibles from prod_stock_online
             where prenda_id = v_prenda and estampado <> '' and talla = 'M') = 8
      then 'OK — S:4 y M:8 estampadas al stock'
      else 'FALLA — el retorno no respetó las tallas' end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  7 · retorno de estampado ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. el color queda procesado solo cuando TODO llegó y se repartió ──
  begin
    v_r := case when not (select procesado from prod_maquila_colores where id = v_mc)
                then 'pendiente' else 'FALLA — procesado con entregas por llegar' end;
    perform fn_registrar_entrega_maquila(v_mc, fn_hoy_ecuador(), '{"S":10,"M":15}'::jsonb);
    v_ent2 := (select id from prod_maquila_entregas where maquila_color_id = v_mc and not procesado);
    perform fn_repartir_entrega_maquila(v_ent2, '{"online":{"S":10,"M":15}}'::jsonb);
    v_r := case
      when v_r = 'pendiente' and (select procesado from prod_maquila_colores where id = v_mc)
      then 'OK — procesado al repartir la última entrega'
      when v_r = 'pendiente' then 'FALLA — no se marcó procesado al final'
      else v_r end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  8 · color procesado al final ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. una sola versión de cada función ──
  v_r := case when (select count(*) from pg_proc where proname = 'fn_repartir_entrega_maquila') = 1
               and (select count(*) from pg_proc where proname = 'fn_procesar_entrega_maquila') = 1
              then 'OK — sin sobrecargas'
              else 'FALLA — hay versiones de más' end;
  v_rep := v_rep || E'\n  9 · sin sobrecargas ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST reparto y ferias (fase 8s) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
