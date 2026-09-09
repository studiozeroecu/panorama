-- SMOKE TEST de la idempotencia (fase 8b).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8b_idempotencia.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- Los números están elegidos para que la comprobación 2 DISCRIMINE:
-- el pedido tiene 50 m, el primer corte consume 45 y deja 5 de saldo. El reintento
-- vuelve a pedir 45. Si la idempotencia estuviera después de la validación de saldo,
-- la función calcularía 45 > 5 y levantaría un "supera el saldo" FALSO sobre un
-- corte que sí se guardó. Con el orden correcto devuelve ya_registrado y no valida.

do $SMOKE$
declare
  v_rep text := '';
  v_r   text;
  v_ok  int := 0;
  v_bad int := 0;
  v_pedido uuid;
  v_corte1 uuid;
  v_res jsonb;
  v_idem_x uuid := gen_random_uuid();
  v_idem_y uuid := gen_random_uuid();
  v_idem_z uuid := gen_random_uuid();
  v_idem_w uuid := gen_random_uuid();
  v_payload45 jsonb := '[{"color":"Negro","tallas":{"S":45},"metros_usados":45}]'::jsonb;
  v_n int; v_m int; v_saldo numeric;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── montaje: un pedido entregado con 50 m ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, ancho_real,
     colores, total_metros, valor_metro, total_pagar, estado, fecha_entrega_real)
  values ('ZZ_SMOKE tela idem', fn_hoy_ecuador(), 'metros', 150, 150,
          '[{"color":"Negro","metros":50}]'::jsonb, 50, 5, 250, 'entregado', fn_hoy_ecuador())
  returning id into v_pedido;

  -- ══════════ CORTES ══════════

  -- ── 1. primer corte con idem X: 45 de los 50 m ──
  v_res := fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'primero', 1.50,
                              v_payload45, v_idem_x);
  v_corte1 := (v_res ->> 'corte_id')::uuid;
  v_r := case when coalesce((v_res->>'ya_registrado')::boolean, true) = false
                and v_corte1 is not null
              then 'OK — creado, ya_registrado=false'
              else 'FALLA — devolvió ' || v_res::text end;
  v_rep := v_rep || E'\n  1 · primer corte ................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. ⭐ EL CHEQUEO DEL ORDEN: reintento con el MISMO id y el MISMO payload ──
  --    Quedan 5 m de saldo y el payload pide 45. Si la idempotencia fuera después
  --    de validar, aquí saldría "Los metros usados (45.0 m) superan el saldo (5.0 m)".
  begin
    v_res := fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'reintento', 1.50,
                                v_payload45, v_idem_x);
    v_r := case when coalesce((v_res->>'ya_registrado')::boolean, false)
                  and (v_res->>'corte_id')::uuid = v_corte1
                then 'OK — ya_registrado=true, mismo corte, sin pasar por el saldo'
                else 'FALLA — devolvió ' || v_res::text end;
  exception when others then
    v_r := 'FALLA — lanzó excepción (¿la idempotencia quedó DESPUÉS de validar?): ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  2 · reintento no revalida saldo .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. no se duplicó: 1 corte, 1 maquila ──
  select count(*) into v_n from prod_cortes where pedido_id = v_pedido;
  select count(*) into v_m from prod_maquilas m
    join prod_cortes k on k.id = m.corte_id where k.pedido_id = v_pedido;
  v_r := case when v_n=1 and v_m=1 then 'OK — 1 corte, 1 maquila'
              else 'FALLA — '||v_n||' corte(s) y '||v_m||' maquila(s)' end;
  v_rep := v_rep || E'\n  3 · sin duplicados ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. la tela no se descontó dos veces: saldo = 5, no -40 ──
  select p.total_metros - coalesce((select sum(c.metros_consumidos)
                                    from prod_cortes c where c.pedido_id = p.id), 0)
    into v_saldo from prod_pedidos_tela p where p.id = v_pedido;
  v_r := case when v_saldo = 5 then 'OK — saldo 5 m (50 − 45), no se descontó dos veces'
              else 'FALLA — saldo = ' || v_saldo || ' m, se esperaban 5' end;
  v_rep := v_rep || E'\n  4 · tela descontada una vez ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. las filas normalizadas tampoco se duplicaron ──
  select count(*) into v_n from prod_corte_colores where corte_id = v_corte1;
  select count(*) into v_m from prod_maquila_colores mc
    join prod_corte_colores cc on cc.id = mc.corte_color_id where cc.corte_id = v_corte1;
  v_r := case when v_n=1 and v_m=1 then 'OK — 1 color de corte, 1 de maquila'
              else 'FALLA — '||v_n||' color(es) de corte y '||v_m||' de maquila' end;
  v_rep := v_rep || E'\n  5 · normalizadas sin duplicar ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. un corte NUEVO con otro id sí entra (no bloqueamos cortes legítimos) ──
  v_res := fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'segundo', 1.50,
             '[{"color":"Negro","tallas":{"M":3},"metros_usados":3}]'::jsonb, v_idem_y);
  select count(*) into v_n from prod_cortes where pedido_id = v_pedido;
  v_r := case when coalesce((v_res->>'ya_registrado')::boolean, true) = false and v_n = 2
              then 'OK — segundo corte legítimo entró'
              else 'FALLA — '||v_n||' corte(s), respuesta ' || v_res::text end;
  v_rep := v_rep || E'\n  6 · corte nuevo con otro id ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. p_idem_id nulo sigue funcionando (bot / SQL manual, sin deduplicar) ──
  v_res := fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'sin id', 1.50,
             '[{"color":"Negro","tallas":{"L":2},"metros_usados":2}]'::jsonb, null);
  select count(*) into v_n from prod_cortes where pedido_id = v_pedido;
  v_r := case when coalesce((v_res->>'ya_registrado')::boolean, true) = false and v_n = 3
              then 'OK — sin id entra normal (compatibilidad)'
              else 'FALLA — '||v_n||' corte(s), respuesta ' || v_res::text end;
  v_rep := v_rep || E'\n  7 · sin idem_id (compatibilidad) ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. la validación de saldo SIGUE VIVA para un id nuevo ──
  --    (que arreglar la idempotencia no haya desactivado el control de tela)
  begin
    v_res := fn_registrar_corte(v_pedido, fn_hoy_ecuador(), null, 'exceso', 1.50,
               '[{"color":"Negro","tallas":{"S":1},"metros_usados":999}]'::jsonb, v_idem_w);
    v_r := 'FALLA — aceptó un corte que supera el saldo';
  exception when others then
    v_r := 'OK — rechazado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  8 · validación de saldo viva ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. el índice único muerde (última línea de defensa) ──
  begin
    insert into prod_cortes (pedido_id, fecha, colores, total_unidades, idempotencia_id)
    values (v_pedido, fn_hoy_ecuador(), '[]'::jsonb, 0, v_idem_x);
    v_r := 'FALLA — el índice único no bloqueó un idempotencia_id repetido';
  exception
    when unique_violation then v_r := 'OK — el índice único bloqueó el duplicado';
    when others then v_r := 'FALLA — error inesperado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  9 · índice único muerde ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ══════════ PEDIDOS (equivalente SQL del upsert de PostgREST) ══════════

  -- ── 10. pedido con idem Z entra, y el trigger le crea sus colores ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, idempotencia_id)
  values ('ZZ_SMOKE pedido idem', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Rojo","metros":10}]'::jsonb, 10, 5, 50, 'pendiente', v_idem_z)
  on conflict (idempotencia_id) do nothing;

  select count(*) into v_n from prod_pedidos_tela where idempotencia_id = v_idem_z;
  select count(*) into v_m from prod_pedido_colores pc
    join prod_pedidos_tela p on p.id = pc.pedido_id where p.idempotencia_id = v_idem_z;
  v_r := case when v_n=1 and v_m=1 then 'OK — 1 pedido con su color normalizado'
              else 'FALLA — '||v_n||' pedido(s) y '||v_m||' color(es)' end;
  v_rep := v_rep || E'\n 10 · pedido con idem_id ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 11. reintento con el MISMO id: ni pedido ni colores duplicados ──
  --    Si el `do nothing` fallara, el trigger se dispararía otra vez y los colores
  --    se duplicarían también: por eso se comprueban las dos cosas.
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, idempotencia_id)
  values ('ZZ_SMOKE pedido idem', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Rojo","metros":10}]'::jsonb, 10, 5, 50, 'pendiente', v_idem_z)
  on conflict (idempotencia_id) do nothing;

  select count(*) into v_n from prod_pedidos_tela where idempotencia_id = v_idem_z;
  select count(*) into v_m from prod_pedido_colores pc
    join prod_pedidos_tela p on p.id = pc.pedido_id where p.idempotencia_id = v_idem_z;
  v_r := case when v_n=1 and v_m=1 then 'OK — sigue 1 pedido y 1 color, sin duplicar'
              else 'FALLA — '||v_n||' pedido(s) y '||v_m||' color(es)' end;
  v_rep := v_rep || E'\n 11 · reintento de pedido .......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 12. pedido con otro id entra normal ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado, idempotencia_id)
  values ('ZZ_SMOKE pedido idem 2', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Azul","metros":8}]'::jsonb, 8, 5, 40, 'pendiente', gen_random_uuid())
  on conflict (idempotencia_id) do nothing;

  select count(*) into v_n from prod_pedidos_tela where nombre_tela like 'ZZ_SMOKE pedido idem%';
  v_r := case when v_n=2 then 'OK — pedido nuevo con otro id entró'
              else 'FALLA — '||v_n||' pedido(s), se esperaban 2' end;
  v_rep := v_rep || E'\n 12 · pedido nuevo con otro id ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST idempotencia (fase 8b) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
