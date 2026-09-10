-- SMOKE TEST de fn_confirmar_venta_online (fase 8d).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8d_venta_atomica.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- Las dos comprobaciones que discriminan de verdad son la 8 y la 9:
--   8 — si alguien reintrodujera la aritmética absoluta, dos ventas de 2 sobre un
--       stock de 10 dejarían 8 en vez de 6.
--   9 — que un reintento no descuente dos veces ni levante un error falso.

do $SMOKE$
declare
  v_rep text := ''; v_r text; v_ok int := 0; v_bad int := 0;
  v_a uuid; v_b uuid;
  v_res jsonb; v_n int; v_m int; v_vend int;
  v_idem_w uuid := gen_random_uuid();
  v_venta record;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_stock_online (prenda_nombre, color, estampado, talla, disponibles, vendidas)
  values ('ZZ_SMOKE camiseta', 'Negro', 'ZZ logo', 'M', 10, 0) returning id into v_a;
  insert into prod_stock_online (prenda_nombre, color, estampado, talla, disponibles, vendidas)
  values ('ZZ_SMOKE camiseta', 'Blanco', 'ZZ logo', 'L', 10, 0) returning id into v_b;

  -- ── 1. venta de 3 → 7 disponibles, 3 vendidas, venta con su total ──
  v_res := fn_confirmar_venta_online(v_a, 3, 12.50, fn_hoy_ecuador(), gen_random_uuid());
  select disponibles, vendidas into v_n, v_vend from prod_stock_online where id = v_a;
  v_r := case when v_n=7 and v_vend=3 and (v_res->>'total')::numeric = 37.50
              then 'OK — 7 disponibles, 3 vendidas, total $37.50'
              else 'FALLA — disp '||v_n||', vend '||v_vend||', resp '||v_res::text end;
  v_rep := v_rep || E'\n  1 · venta normal ................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. los datos de la venta salen del STOCK, no del cliente ──
  select prenda_nombre, color, estampado, talla into v_venta
  from prod_ventas_online where stock_id = v_a limit 1;
  v_r := case when v_venta.prenda_nombre='ZZ_SMOKE camiseta' and v_venta.color='Negro'
                and v_venta.estampado='ZZ logo' and v_venta.talla='M'
              then 'OK — prenda/color/estampado/talla copiados de la fila de stock'
              else 'FALLA — ' || v_venta::text end;
  v_rep := v_rep || E'\n  2 · datos desde la base ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. venta de 999 → rechazada nombrando unidades y talla ──
  begin
    v_res := fn_confirmar_venta_online(v_a, 999, 12.50, fn_hoy_ecuador(), gen_random_uuid());
    v_r := 'FALLA — aceptó vender 999 de 7';
  exception when others then
    v_r := case when SQLERRM like '%Solo quedan 7%' and SQLERRM like '%talla M%'
                then 'OK — ' || SQLERRM
                else 'FALLA — mensaje inesperado: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · excede el stock ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. tras el rechazo: stock intacto y sin venta huérfana ──
  select disponibles into v_n from prod_stock_online where id = v_a;
  select count(*) into v_m from prod_ventas_online where stock_id = v_a;
  v_r := case when v_n=7 and v_m=1 then 'OK — sigue en 7, y solo la venta legítima'
              else 'FALLA — disp '||v_n||', '||v_m||' venta(s)' end;
  v_rep := v_rep || E'\n  4 · sin efecto tras rechazo ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. vender exactamente lo que queda (borde exacto) → permitido ──
  v_res := fn_confirmar_venta_online(v_a, 7, 12.50, fn_hoy_ecuador(), gen_random_uuid());
  select disponibles, vendidas into v_n, v_vend from prod_stock_online where id = v_a;
  v_r := case when v_n=0 and v_vend=10 then 'OK — 0 disponibles, 10 vendidas'
              else 'FALLA — disp '||v_n||', vend '||v_vend end;
  v_rep := v_rep || E'\n  5 · borde exacto ................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. vender 1 sobre stock 0 → rechazada ──
  begin
    v_res := fn_confirmar_venta_online(v_a, 1, 12.50, fn_hoy_ecuador(), gen_random_uuid());
    v_r := 'FALLA — vendió sobre stock 0';
  exception when others then
    v_r := 'OK — rechazado: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · stock agotado .................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. cantidad 0 → rechazada con mensaje propio ──
  begin
    v_res := fn_confirmar_venta_online(v_b, 0, 12.50, fn_hoy_ecuador(), gen_random_uuid());
    v_r := 'FALLA — aceptó cantidad 0';
  exception when others then
    v_r := case when SQLERRM like '%mayor a 0%' then 'OK — ' || SQLERRM
                else 'FALLA — ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  7 · cantidad invalida .............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 8. ⭐ EL DESCUENTO ES RELATIVO: dos ventas de 2 sobre 10 dejan 6, no 8 ──
  v_res := fn_confirmar_venta_online(v_b, 2, 10, fn_hoy_ecuador(), gen_random_uuid());
  v_res := fn_confirmar_venta_online(v_b, 2, 10, fn_hoy_ecuador(), gen_random_uuid());
  select disponibles, vendidas into v_n, v_vend from prod_stock_online where id = v_b;
  v_r := case when v_n=6 and v_vend=4 then 'OK — 6 disponibles, 4 vendidas (descuento acumulativo)'
              else 'FALLA — disp '||v_n||' (¿aritmética absoluta?), vend '||v_vend end;
  v_rep := v_rep || E'\n  8 · descuento relativo ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 9. reintento con el mismo idem_id → ya_registrada, sin doble descuento ──
  v_res := fn_confirmar_venta_online(v_b, 2, 10, fn_hoy_ecuador(), v_idem_w);
  begin
    v_res := fn_confirmar_venta_online(v_b, 2, 10, fn_hoy_ecuador(), v_idem_w);
    select disponibles into v_n from prod_stock_online where id = v_b;
    v_r := case when coalesce((v_res->>'ya_registrada')::boolean,false) and v_n=4
                then 'OK — ya_registrada=true y el stock sigue en 4'
                else 'FALLA — disp '||v_n||', resp '||v_res::text end;
  exception when others then
    v_r := 'FALLA — lanzó excepción en vez de avisar: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  9 · reintento sin doble descuento .. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST venta online (fase 8d) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
