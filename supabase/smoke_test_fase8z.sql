-- SMOKE TEST de juntar pedidos de tela (fase 8z).
-- NO forma parte de la cadena de migraciones. Requiere la 8z aplicada.
-- UN SOLO bloque DO que termina con un error a propósito: ese error ES el
-- reporte, y al lanzarlo PostgreSQL revierte todo.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_pr1  uuid := gen_random_uuid();
  v_pr2  uuid := gen_random_uuid();
  v_a    uuid := gen_random_uuid();
  v_b    uuid := gen_random_uuid();
  v_c    uuid := gen_random_uuid();
  v_d    uuid := gen_random_uuid();
  v_res  jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_prendas (id, nombre) values (v_pr1, 'ZZ Hoodie 8z'), (v_pr2, 'ZZ Hoodie mujer 8z');
  -- A: 100 m a $5 = $500. B: 50 m a $8 = $400, con un color repetido escrito distinto.
  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores, total_metros,
     valor_metro, total_pagar, estado, fecha_entrega_real, prenda_id)
  values
    (v_a, 'ZZ Tela 8z', fn_hoy_ecuador() - 10, 'metros', 150,
     '[{"color":"Negro","metros":60},{"color":"Crudo","metros":40}]'::jsonb, 100, 5, 500,
     'entregado', fn_hoy_ecuador() - 1, v_pr1),
    (v_b, 'ZZ Tela 8z', fn_hoy_ecuador() - 3, 'metros', 150,
     '[{"color":" negro ","metros":30},{"color":"Vino","metros":20}]'::jsonb, 50, 8, 400,
     'entregado', fn_hoy_ecuador(), v_pr2),
    (v_c, 'ZZ Tela 8z C', fn_hoy_ecuador(), 'metros', 150,
     '[{"color":"Negro","metros":10}]'::jsonb, 10, 5, 50, 'pendiente', null, v_pr1);

  -- ── 1. prendas distintas sin elegir: no junta ──
  begin
    perform fn_unir_pedidos(array[v_a, v_b], null, null);
    v_r := 'FALLA — juntó sin saber para qué prenda';
  exception when others then
    v_r := case when SQLERRM like '%elige para cuál%' then 'OK — pide elegir'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  1 · prendas distintas ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. una tela que no ha llegado: no junta ──
  begin
    perform fn_unir_pedidos(array[v_a, v_c], null, v_pr1);
    v_r := 'FALLA — juntó una tela que no llegó';
  exception when others then
    v_r := case when SQLERRM like '%ya llegaron%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · tela que no llegó ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. ⚠️ junta: metros por color, dinero exacto, prenda elegida, foto ──
  begin
    v_res := fn_unir_pedidos(array[v_a, v_b], 'ZZ Tela junta', v_pr2);
    v_r := case
      when (select total_metros from prod_pedidos_tela where id = v_a) = 150
       and (select total_pagar from prod_pedidos_tela where id = v_a) = 900
       and (select valor_metro from prod_pedidos_tela where id = v_a) = 6
       and (select prenda_id from prod_pedidos_tela where id = v_a) = v_pr2
       and (select nombre_tela from prod_pedidos_tela where id = v_a) = 'ZZ Tela junta'
       and (select fecha_pedido from prod_pedidos_tela where id = v_a) = fn_hoy_ecuador() - 10
       and (select fecha_entrega_real from prod_pedidos_tela where id = v_a) = fn_hoy_ecuador()
       and (select count(*) from prod_pedido_colores where pedido_id = v_a) = 3
       and (select metros from prod_pedido_colores where pedido_id = v_a and color = 'Negro') = 90
       and (select jsonb_array_length(pedidos_unidos) from prod_pedidos_tela where id = v_a) = 2
       and not exists (select 1 from prod_pedidos_tela where id = v_b)
       and not exists (select 1 from prod_pedido_colores where pedido_id = v_b)
      then 'OK — 150 m, $900, 3 colores, Negro 90 m'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  3 · juntar ........................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. reintento: no suma dos veces ──
  begin
    v_res := fn_unir_pedidos(array[v_a, v_b], 'ZZ Tela junta', v_pr2);
    v_r := case
      when (v_res ->> 'ya_unido')::boolean
       and (select total_metros from prod_pedidos_tela where id = v_a) = 150
      then 'OK — "ya_unido", nada duplicado'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  4 · reintento ........................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. un pedido con cortes: no junta ──
  begin
    insert into prod_pedidos_tela
      (id, nombre_tela, fecha_pedido, unidad, ancho_pedido, colores, total_metros,
       valor_metro, total_pagar, estado, fecha_entrega_real, prenda_id)
    values (v_d, 'ZZ Tela 8z D', fn_hoy_ecuador(), 'metros', 150,
            '[{"color":"ZZAzul8z","metros":30}]'::jsonb, 30, 5, 150, 'entregado', fn_hoy_ecuador(), v_pr2);
    perform fn_registrar_corte(v_d, fn_hoy_ecuador(), null, '', 3,
      '[{"color":"ZZAzul8z","tallas":{"S":2}}]'::jsonb, gen_random_uuid(), null);
    perform fn_unir_pedidos(array[v_a, v_d], null, v_pr2);
    v_r := 'FALLA — juntó una tela ya cortada';
  exception when others then
    v_r := case when SQLERRM like '%ya tiene cortes%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  5 · tela con cortes .................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST juntar pedidos (fase 8z) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
