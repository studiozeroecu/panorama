-- SMOKE TEST de órdenes de estampado (fase 8v).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8v_ordenes_estampado.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_a    uuid := gen_random_uuid();
  v_b    uuid := gen_random_uuid();
  v_c    uuid := gen_random_uuid();
  v_res  jsonb;
  v_orden uuid;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_lotes_estampado (id, prenda_nombre, color, tallas, total_unidades, disenos,
                                    costo_unitario, costo_total, estado)
  values (v_a, 'ZZ Hoodie 8v', 'Negro', '{"S":4}'::jsonb, 4, '[{"nombre":"cajas","unidades":4,"tallas":{"S":4}}]'::jsonb, 2.5, 10, 'pendiente'),
         (v_b, 'ZZ Camiseta 8v', 'Negro', '{"M":4}'::jsonb, 4, '[{"nombre":"cajas","unidades":4,"tallas":{"M":4}}]'::jsonb, 2.5, 10, 'pendiente'),
         (v_c, 'ZZ Camiseta 8v', 'Blanco', '{"M":2}'::jsonb, 2, '[{"nombre":"cajas","unidades":2,"tallas":{"M":2}}]'::jsonb, 2.5, 5, 'en_taller');

  -- ── 1. dos lotes de producciones distintas, en una orden ──
  begin
    v_res := fn_crear_orden_estampado(array[v_a, v_b], null, fn_hoy_ecuador(), 4, ' prueba ');
    v_orden := (v_res ->> 'orden_id')::uuid;
    v_r := case
      when (v_res ->> 'lotes')::int = 2
       and (select count(*) from prod_lotes_estampado where orden_id = v_orden and estado = 'en_taller') = 2
       and (select por_metro from prod_ordenes_estampado where id = v_orden) = 4
       and (select nota from prod_ordenes_estampado where id = v_orden) = 'prueba'
      then 'OK — 2 lotes al taller en una orden'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · orden con dos lotes ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. un lote que ya está en el taller: no se toca ninguno ──
  -- El update va FUERA del bloque: al fallar a propósito, el bloque deshace
  -- todo lo suyo, y el lote volvería a 'en_taller'.
  update prod_lotes_estampado set estado = 'pendiente', orden_id = null where id = v_a;
  begin
    perform fn_crear_orden_estampado(array[v_a, v_c], null, fn_hoy_ecuador(), 4, null);
    v_r := 'FALLA — aceptó un lote que ya estaba en el taller';
  exception when others then
    v_r := case when SQLERRM like '%ya se mandó%'
                 and (select estado from prod_lotes_estampado where id = v_a) = 'pendiente'
                then 'OK — rechazado, el otro sigue pendiente'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · todo o nada .................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. el tono solo admite claro / oscuro ──
  begin
    perform 1 from prod_corte_colores limit 1;
    update prod_corte_colores set tono = 'gris' where id = (select id from prod_corte_colores limit 1);
    v_r := case when not found then 'OK — sin colores para probar' else 'FALLA — aceptó "gris"' end;
  exception when others then
    v_r := case when SQLERRM like '%tono%' then 'OK — solo claro / oscuro'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · tono válido .................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST órdenes de estampado (fase 8v) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
