-- SMOKE TEST de mandar desde bodega (fase 8y).
-- NO forma parte de la cadena de migraciones. Requiere la 8y aplicada.
-- UN SOLO bloque DO que termina con un error a propósito: ese error ES el
-- reporte, y al lanzarlo PostgreSQL revierte todo.

do $SMOKE$
declare
  v_rep   text := '';
  v_r     text;
  v_ok    int := 0;
  v_bad   int := 0;
  v_feria uuid := gen_random_uuid();
  v_sal   uuid := gen_random_uuid();
  v_id    uuid := gen_random_uuid();
  v_rep2  jsonb;
  v_res   jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;
  insert into prod_ferias (id, nombre) values (v_feria, 'ZZ Feria 8y');

  -- Hoodie negro viejo: S9 M7 L1. Bodega: S2 básicas. Feria: S7 (3 con "ZZCajas") + M7 + L1.
  v_rep2 := ('{"costo_produccion":8,"costo_estampado":2.5,
     "bodega":{"basicos":{"S":2},"disenos":[]},
     "feria":{"basicos":{"S":4,"M":7,"L":1},"disenos":[{"nombre":"ZZCajas","tallas":{"S":3}}],
              "feria_id":"' || v_feria || '"}}')::jsonb;

  -- ── 1. reparte un color viejo; las estampadas quedan para la orden ──
  begin
    v_res := fn_repartir_desde_bodega(v_id, v_sal, null, 'ZZ Hoodie viejo', 'ZZNegro8y', 'oscuro',
                                      '{"S":9,"M":7,"L":1}'::jsonb, v_rep2);
    v_r := case
      when (select disponibles from prod_stock_online where prenda_nombre = 'ZZ Hoodie viejo' and talla = 'S') = 2
       and (select costo_unitario from prod_bodega_ingresos where prenda_nombre = 'ZZ Hoodie viejo') = 8
       and (select unidades from prod_feria_ingresos where feria_id = v_feria) = 12
       and (select costo_unitario from prod_feria_ingresos where feria_id = v_feria) = 13
       and (select tono from prod_lotes_estampado where salida_id = v_sal) = 'oscuro'
       and (select estado from prod_lotes_estampado where salida_id = v_sal) = 'pendiente'
       and (select feria_id from prod_lotes_estampado where salida_id = v_sal) = v_feria
      then 'OK — 2 a bodega, 12 básicas a feria, 3 al taller (oscuras)'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · repartir desde bodega .......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. reintento con el mismo id: no duplica ──
  begin
    v_res := fn_repartir_desde_bodega(v_id, v_sal, null, 'ZZ Hoodie viejo', 'ZZNegro8y', 'oscuro',
                                      '{"S":9,"M":7,"L":1}'::jsonb, v_rep2);
    v_r := case
      when (v_res ->> 'ya_hecho')::boolean
       and (select count(*) from prod_lotes_estampado where salida_id = v_sal) = 1
      then 'OK — "ya_hecho", nada duplicado'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  2 · reintento ...................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. una talla que no cuadra ──
  begin
    perform fn_repartir_desde_bodega(gen_random_uuid(), v_sal, null, 'ZZ Hoodie viejo', 'ZZBlanco8y', null,
      '{"S":3}'::jsonb, '{"costo_produccion":8,"bodega":{"basicos":{"S":2}}}'::jsonb);
    v_r := 'FALLA — aceptó un reparto que no cuadra';
  exception when others then
    v_r := case when SQLERRM like '%talla S: hay 3 y repartiste 2%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · talla que no cuadra ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST mandar desde bodega (fase 8y) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
