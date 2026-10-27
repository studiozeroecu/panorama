-- SMOKE TEST de mercadería estancada y cierre de ferias (fase 8u).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8u_cierre_ferias.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).
--
-- La que justifica el archivo: la 5 — al cerrar, cada regreso va a su sitio
-- con el operativo REEMPLAZADO (feria $5 → locales $2,50, bodega $0), y lo
-- vendido sale de restar.

do $SMOKE$
declare
  v_rep    text := '';
  v_r      text;
  v_ok     int := 0;
  v_bad    int := 0;
  v_prenda uuid := gen_random_uuid();
  v_feria  uuid := gen_random_uuid();
  v_feria2 uuid := gen_random_uuid();
  v_bas    uuid := gen_random_uuid();
  v_est    uuid := gen_random_uuid();
  v_estan  uuid;
  v_res    jsonb;
  v_ret    jsonb;
  v_cuantos int;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_prendas (id, nombre, precio_venta_local) values (v_prenda, 'ZZ Camiseta 8u', 12);
  insert into prod_ferias (id, nombre) values (v_feria, 'ZZ Feria 8u');
  insert into prod_ferias (id, nombre, cerrada_en) values (v_feria2, 'ZZ Feria cerrada 8u', now());

  -- Dos líneas que llegaron desde Envío: una básica y una estampada.
  insert into prod_feria_ingresos (id, feria_id, origen, prenda_id, prenda_nombre, color, estampado, tallas,
                                   unidades, costo_produccion, costo_estampado, costo_operativo, costo_unitario)
  values (v_bas, v_feria, 'envio', v_prenda, 'ZZ Camiseta 8u', 'ZZNegro8u', '', '{"S":4,"M":2}'::jsonb,
          6, 6, 0, 5, 11),
         (v_est, v_feria, 'estampado', v_prenda, 'ZZ Camiseta 8u', 'ZZNegro8u', 'ZZLogo', '{"S":2}'::jsonb,
          2, 6, 2.5, 5, 13.5);

  -- ── 1. mercadería estancada, escrita a mano, con el operativo de feria ──
  begin
    v_res := fn_agregar_estancada(v_feria, ' ZZ Jean viejo ', 'Azul', '', '{"M":3,"L":0}'::jsonb, 7);
    v_estan := (v_res ->> 'id')::uuid;
    v_r := case
      when (select origen from prod_feria_ingresos where id = v_estan) = 'estancada'
       and (select prenda_nombre from prod_feria_ingresos where id = v_estan) = 'ZZ Jean viejo'
       and (select tallas from prod_feria_ingresos where id = v_estan) = '{"M":3}'::jsonb
       and (select costo_unitario from prod_feria_ingresos where id = v_estan) = 12
      then 'OK — 3 und. a $7 + $5 de feria = $12'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · estancada ...................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. a una feria cerrada no entra nada ──
  begin
    perform fn_agregar_estancada(v_feria2, 'ZZ X', '', '', '{"S":1}'::jsonb, 5);
    v_r := 'FALLA — aceptó una feria cerrada';
  exception when others then
    v_r := case when SQLERRM like '%cerrada%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · estancada a feria cerrada ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. estancada sin costo ──
  begin
    perform fn_agregar_estancada(v_feria, 'ZZ X', '', '', '{"S":1}'::jsonb, null);
    v_r := 'FALLA — aceptó una estancada sin costo';
  exception when others then
    v_r := case when SQLERRM like '%costo%' then 'OK — pide el costo'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · estancada sin costo ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. no puede regresar más de lo que fue, y la feria sigue abierta ──
  begin
    perform fn_cerrar_feria(v_feria,
      jsonb_build_array(jsonb_build_object('ingreso_id', v_bas, 'bodega', '{"S":3}'::jsonb, 'local', '{"S":2}'::jsonb)));
    v_r := 'FALLA — aceptó regresar 5 de 4';
  exception when others then
    v_r := case when SQLERRM like '%talla S: fueron 4 y no pueden regresar 5%'
                 and (select cerrada_en from prod_ferias where id = v_feria) is null
                then 'OK — "fueron 4 y no pueden regresar 5"'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  4 · regresa más de lo que fue ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. ⚠️ el cierre: cada regreso a su sitio, con su operativo ──
  --   básica:    bodega S1, locales M2       estampada: locales S1
  --   estancada: locales M3 (vuelve de donde salió)
  --   fueron 6 + 2 + 3 = 11 · regresan 7 · vendidas 4
  v_ret := jsonb_build_array(
    jsonb_build_object('ingreso_id', v_bas,   'bodega', '{"S":1}'::jsonb, 'local', '{"M":2}'::jsonb),
    jsonb_build_object('ingreso_id', v_est,   'local',  '{"S":1}'::jsonb),
    jsonb_build_object('ingreso_id', v_estan, 'local',  '{"M":3}'::jsonb));
  begin
    v_res := fn_cerrar_feria(v_feria, v_ret, fn_hoy_ecuador());
    v_r := case
      when (v_res ->> 'fueron')::int = 11 and (v_res ->> 'regresan')::int = 7 and (v_res ->> 'vendidas')::int = 4
       and (select cerrada_en from prod_ferias where id = v_feria) is not null
       and (select disponibles from prod_stock_online
             where prenda_nombre = 'ZZ Camiseta 8u' and estampado = '' and talla = 'S') = 1
       and (select costo_unitario from prod_bodega_ingresos where feria_id = v_feria) = 6
       and (select costo_unitario from prod_envios_locales where feria_id = v_feria and estampado = '') = 8.5
       and (select margen from prod_envios_locales where feria_id = v_feria and estampado = '') = 7
       and (select local_destino from prod_envios_locales where feria_id = v_feria and estampado = '') is null
       and (select costo_unitario from prod_envios_locales where feria_id = v_feria and estampado = 'ZZLogo') = 11
       and not exists (select 1 from prod_envios_locales where prenda_nombre = 'ZZ Jean viejo')
       and (select costo_unitario from prod_feria_retornos where ingreso_id = v_estan) = 9.5
       and (select count(*) from prod_feria_retornos where feria_id = v_feria) = 4
      then 'OK — bodega $6, locales $8,50 / $11, estancada vuelve a $9,50 · 4 vendidas'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · cierre ......................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. cerrar dos veces no duplica nada ──
  begin
    v_cuantos := (select count(*) from prod_feria_retornos where feria_id = v_feria);
    v_res := fn_cerrar_feria(v_feria, v_ret, fn_hoy_ecuador());
    v_r := case
      when (v_res ->> 'ya_cerrada')::boolean
       and (select count(*) from prod_feria_retornos where feria_id = v_feria) = v_cuantos
       and (select disponibles from prod_stock_online
             where prenda_nombre = 'ZZ Camiseta 8u' and estampado = '' and talla = 'S') = 1
      then 'OK — "ya_cerrada", nada duplicado'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  6 · reintento ...................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. una sola versión de cada función ──
  v_r := case when (select count(*) from pg_proc where proname = 'fn_cerrar_feria') = 1
               and (select count(*) from pg_proc where proname = 'fn_agregar_estancada') = 1
              then 'OK — sin sobrecargas'
              else 'FALLA — hay versiones de más' end;
  v_rep := v_rep || E'\n  7 · sin sobrecargas ................ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST cierre de ferias (fase 8u) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
