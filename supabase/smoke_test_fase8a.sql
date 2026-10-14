-- SMOKE TEST de fn_retornar_lote_estampado (fase 8a).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8a_retorno_estampado.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia. Eso importa: el SQL Editor de Supabase
-- reparte las sentencias de un script con `begin;` explícito entre varias conexiones
-- del pool. Un bloque DO corre entero en una conexión y en una sola transacción.
--
-- ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO. Ese "error" ES el reporte: al lanzarlo,
--    PostgreSQL revierte todo lo que el bloque creó. No queda NADA en la base — ni los
--    lotes de mentira, ni el stock que generaron, ni la sustitución de fn_es_admin().
--    Verlo en rojo es lo esperado. Lee el texto del mensaje.
--
-- Los lotes de prueba no necesitan prenda ni maquila (prenda_id y maquila_id son
-- nulables), así que la prueba no crea nada fuera de prod_lotes_estampado.

do $SMOKE$
declare
  v_rep text := '';
  v_r   text;
  v_ok  int := 0;
  v_bad int := 0;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_res jsonb; v_n int; v_m int; v_antes int;
begin
  -- fn_es_admin() consulta auth.uid(), que en el SQL Editor es NULL, así que la RPC
  -- rechazaría la llamada. La sustituimos aquí; el rollback final la restaura.
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── lotes de mentira ──────────────────────────────────────
  -- A: coherente — sum(tallas) = total_unidades = 6
  insert into prod_lotes_estampado
    (prenda_nombre, color, tallas, total_unidades, disenos, costo_unitario, costo_total, estado, fecha_envio)
  values ('ZZ_SMOKE camiseta', 'Negro', '{"S":2,"M":3,"L":1}'::jsonb, 6,
          '[{"nombre":"ZZ logo","unidades":6}]'::jsonb, 2, 12, 'en_taller', fn_hoy_ecuador())
  returning id into v_a;

  -- B: forma vieja — tallas suman 6 pero el total es parcial (4)
  insert into prod_lotes_estampado
    (prenda_nombre, color, tallas, total_unidades, disenos, costo_unitario, costo_total, estado, fecha_envio)
  values ('ZZ_SMOKE camiseta', 'Blanco', '{"S":2,"M":3,"L":1}'::jsonb, 4,
          '[{"nombre":"ZZ parche","unidades":4}]'::jsonb, 2, 8, 'en_taller', fn_hoy_ecuador())
  returning id into v_b;

  -- C: corrupto — las tallas (2) no alcanzan para las unidades (5)
  insert into prod_lotes_estampado
    (prenda_nombre, color, tallas, total_unidades, disenos, costo_unitario, costo_total, estado, fecha_envio)
  values ('ZZ_SMOKE camiseta', 'Verde', '{"S":2}'::jsonb, 5,
          '[{"nombre":"ZZ roto","unidades":5}]'::jsonb, 2, 10, 'en_taller', fn_hoy_ecuador())
  returning id into v_c;

  -- D: nunca fue al taller
  insert into prod_lotes_estampado
    (prenda_nombre, color, tallas, total_unidades, disenos, costo_unitario, costo_total, estado)
  values ('ZZ_SMOKE camiseta', 'Azul', '{"S":1}'::jsonb, 1,
          '[{"nombre":"ZZ nuevo","unidades":1}]'::jsonb, 2, 2, 'pendiente')
  returning id into v_d;

  -- ── 1. lote coherente: 6 unidades, repartidas S=2 M=3 L=1 ──
  v_res := fn_retornar_lote_estampado(v_a, fn_hoy_ecuador());
  select coalesce(sum(disponibles),0) into v_n from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta' and color='Negro' and estampado='ZZ logo';
  select count(*) into v_m from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta' and color='Negro' and estampado='ZZ logo'
     and ((talla='S' and disponibles=2) or (talla='M' and disponibles=3) or (talla='L' and disponibles=1));
  v_r := case when v_n=6 and v_m=3 and (v_res->>'unidades')::int=6
              then 'OK — 6 und., S=2 M=3 L=1'
              else 'FALLA — stock '||v_n||', tallas exactas '||v_m||'/3' end;
  v_rep := v_rep || E'\n  1 · lote coherente ................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. nada cayó en el bucket sin estampar ──
  select coalesce(sum(disponibles),0) into v_n from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta' and estampado='';
  v_r := case when v_n=0 then 'OK — todo entró etiquetado con el diseño'
              else 'FALLA — '||v_n||' und. sin etiqueta de estampado' end;
  v_rep := v_rep || E'\n  2 · etiqueta de estampado .......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. el lote queda retornado con su fecha ──
  select count(*) into v_n from prod_lotes_estampado
   where id=v_a and estado='retornado' and fecha_retorno=fn_hoy_ecuador();
  v_r := case when v_n=1 then 'OK — estado retornado con fecha'
              else 'FALLA — el lote no quedó marcado' end;
  v_rep := v_rep || E'\n  3 · lote marcado ................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. REINTENTO: devuelve ya_retornado SIN excepción (D4) ──
  begin
    v_res := fn_retornar_lote_estampado(v_a, fn_hoy_ecuador());
    v_r := case when coalesce((v_res->>'ya_retornado')::boolean,false)
                then 'OK — ya_retornado=true, sin excepción'
                else 'FALLA — no devolvió ya_retornado' end;
  exception when others then
    v_r := 'FALLA — lanzó excepción en vez de avisar: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  4 · reintento tranquilo ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. EL BUG: el stock NO se duplicó ──
  select coalesce(sum(disponibles),0) into v_n from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta' and color='Negro' and estampado='ZZ logo';
  v_r := case when v_n=6 then 'OK — sigue en 6, no se duplicó'
              else 'FALLA — stock = '||v_n||', debía seguir en 6' end;
  v_rep := v_rep || E'\n  5 · stock intacto tras reintento ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. lote con forma vieja (tallas 6, total 4) → entran 4: S=2 M=2 ──
  v_res := fn_retornar_lote_estampado(v_b, fn_hoy_ecuador());
  select coalesce(sum(disponibles),0) into v_n from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta' and color='Blanco' and estampado='ZZ parche';
  select count(*) into v_m from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta' and color='Blanco' and estampado='ZZ parche'
     and ((talla='S' and disponibles=2) or (talla='M' and disponibles=2));
  v_r := case when v_n=4 and v_m=2 then 'OK — 4 und., S=2 M=2 (reparto XS→XXL)'
              else 'FALLA — stock '||v_n||', tallas exactas '||v_m||'/2' end;
  v_rep := v_rep || E'\n  6 · lote parcial (forma vieja) ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. lote corrupto (tallas 2 < total 5) → error y stock intacto (D2) ──
  select coalesce(sum(disponibles),0) into v_antes from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta';
  begin
    v_res := fn_retornar_lote_estampado(v_c, fn_hoy_ecuador());
    v_r := 'FALLA — aceptó un lote con tallas insuficientes';
  exception when others then
    select coalesce(sum(disponibles),0) into v_n from prod_stock_online
     where prenda_nombre='ZZ_SMOKE camiseta';
    v_r := case when v_n=v_antes then 'OK — rechazado: ' || SQLERRM
                else 'FALLA — rechazó pero tocó el stock ('||v_antes||'→'||v_n||')' end;
  end;
  v_rep := v_rep || E'\n  7 · tallas insuficientes ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. lote en pendiente → error (D1) ──
  begin
    v_res := fn_retornar_lote_estampado(v_d, fn_hoy_ecuador());
    v_r := 'FALLA — retornó un lote que nunca fue al taller';
  exception when others then
    v_r := 'OK — rechazado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  8 · estado en_taller estricto ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. invariante: el stock total es lo que declararon los lotes retornados ──
  select coalesce(sum(disponibles),0) into v_n from prod_stock_online
   where prenda_nombre='ZZ_SMOKE camiseta';
  select coalesce(sum(total_unidades),0) into v_m from prod_lotes_estampado
   where prenda_nombre='ZZ_SMOKE camiseta' and estado='retornado';
  v_r := case when v_n=v_m and v_n=10 then 'OK — 10 und. en stock = 10 declaradas'
              else 'FALLA — stock '||v_n||' vs declarado '||v_m end;
  v_rep := v_rep || E'\n  9 · invariante stock=declarado ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST fn_retornar_lote_estampado ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
