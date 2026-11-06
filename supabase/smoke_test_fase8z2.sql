-- SMOKE TEST del ancho al juntar telas (fase 8z2).
-- NO forma parte de la cadena de migraciones. Requiere la 8z2 aplicada.
-- UN SOLO bloque DO que termina con un error a propósito: ese error ES el
-- reporte, y al lanzarlo PostgreSQL revierte todo.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_a    uuid := gen_random_uuid();
  v_b    uuid := gen_random_uuid();
  v_c    uuid := gen_random_uuid();
  v_d    uuid := gen_random_uuid();
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- El más antiguo es el de 150; el más pequeño, el de 145. Y c tiene un ancho
  -- migrado en metros, que no debe contar como "el más pequeño".
  insert into prod_pedidos_tela
    (id, nombre_tela, fecha_pedido, unidad, ancho_real, colores, total_metros,
     valor_metro, total_pagar, estado, fecha_entrega_real)
  values
    (v_a, 'ZZ 8z2 A', fn_hoy_ecuador() - 9, 'metros', 150, '[{"color":"ZZ1","metros":10}]'::jsonb, 10, 5, 50, 'entregado', fn_hoy_ecuador()),
    (v_b, 'ZZ 8z2 B', fn_hoy_ecuador() - 8, 'metros', 145, '[{"color":"ZZ1","metros":10}]'::jsonb, 10, 5, 50, 'entregado', fn_hoy_ecuador()),
    (v_c, 'ZZ 8z2 C', fn_hoy_ecuador() - 7, 'metros', 1.45, '[{"color":"ZZ1","metros":10}]'::jsonb, 10, 5, 50, 'entregado', fn_hoy_ecuador()),
    (v_d, 'ZZ 8z2 D', fn_hoy_ecuador() - 6, 'metros', 160, '[{"color":"ZZ1","metros":10}]'::jsonb, 10, 5, 50, 'entregado', fn_hoy_ecuador());

  -- ── 1. un ancho fuera de rango: no junta ──
  begin
    perform fn_unir_pedidos(array[v_a, v_b], null, null, 1.5);
    v_r := 'FALLA — aceptó un ancho en metros';
  exception when others then
    v_r := case when SQLERRM like '%va en centímetros%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  1 · ancho fuera de rango ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. sin elegir: el más pequeño, ignorando el que está en metros ──
  begin
    perform fn_unir_pedidos(array[v_a, v_b, v_c], null, null);
    v_r := case when (select ancho_real from prod_pedidos_tela where id = v_a) = 145
                then 'OK — 145 cm'
                else 'FALLA — quedó ' || (select ancho_real from prod_pedidos_tela where id = v_a) end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  2 · sin elegir, el más pequeño ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. un ancho nuevo, que no era de ninguno ──
  begin
    perform fn_unir_pedidos(array[v_a, v_d], null, null, 148);
    v_r := case when (select ancho_real from prod_pedidos_tela where id = v_a) = 148
                then 'OK — 148 cm'
                else 'FALLA — quedó ' || (select ancho_real from prod_pedidos_tela where id = v_a) end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  3 · ancho escrito a mano .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST ancho al juntar (fase 8z2) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
