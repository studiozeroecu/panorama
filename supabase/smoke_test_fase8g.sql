-- SMOKE TEST de la protección al editar un pedido con cortes (fase 8g).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8g_editar_pedido.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- Las comprobaciones 2 y 3 no se conforman con que el update falle: verifican que
-- el mensaje sea el NUESTRO. Sin eso, un fallo por cualquier otra causa (una FK,
-- un check) pasaría por bueno y daría una falsa sensación de estar protegido.
--
-- La 5 es la que más fácil se rompe al tocar la lista de columnas del trigger: si
-- alguien le añade columnas de más, LlegadaTab dejaría de poder confirmar entregas
-- en cuanto el pedido tenga un corte.

do $SMOKE$
declare
  v_rep text := '';
  v_r   text;
  v_ok  int := 0;
  v_bad int := 0;
  v_err text;
  v_ped uuid;
  v_lim uuid;
  v_prov uuid;
  v_txt text;
  v_num numeric;
  v_n   int;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── montaje: un proveedor, un pedido de 100 m entregado, y un corte de 80 m ──
  insert into prod_proveedores (empresa, dias_entrega)
  values ('ZZ_SMOKE proveedor viejo', 5) returning id into v_prov;

  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, proveedor_id, colores,
     total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE tela', fn_hoy_ecuador(), 'metros', 150, v_prov,
          '[{"color":"Negro","metros":60},{"color":"Blanco","metros":40}]'::jsonb,
          100, 5, 500, 'entregado')
  returning id into v_ped;

  insert into prod_cortes (pedido_id, fecha, colores, total_unidades, metros_consumidos)
  values (v_ped, fn_hoy_ecuador(),
          '[{"color":"Negro","tallas":{"M":40},"unidades":40,"metros_usados":80}]'::jsonb,
          40, 80);

  -- ── 1. CON cortes: corregir el proveedor (y el resto de campos libres) PASA ──
  --    Es el caso que motivó toda la fase: un proveedor mal puesto.
  begin
    insert into prod_proveedores (empresa, dias_entrega)
    values ('ZZ_SMOKE proveedor bueno', 12) returning id into v_lim;

    update prod_pedidos_tela
       set proveedor_id = v_lim,
           nombre_tela  = 'ZZ_SMOKE tela corregida',
           fecha_pedido = fn_hoy_ecuador() - 3,
           ancho_pedido = 180,
           valor_metro  = 6,
           total_pagar  = 600
     where id = v_ped;

    select nombre_tela into v_txt from prod_pedidos_tela where id = v_ped;
    v_r := case when v_txt = 'ZZ_SMOKE tela corregida'
                then 'OK — proveedor y datos libres corregidos con 1 corte'
                else 'FALLA — el update no se aplicó' end;
  exception when others then
    v_r := 'FALLA — bloqueó un campo que debe ser libre: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · editar proveedor con cortes .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. CON cortes: cambiar los colores FALLA, con mensaje propio ──
  --    Se renombra "Negro" a "Negro azulado" dejando los metros iguales: el total
  --    no se mueve, así que solo la guarda A puede atraparlo.
  begin
    update prod_pedidos_tela
       set colores = '[{"color":"Negro azulado","metros":60},{"color":"Blanco","metros":40}]'::jsonb
     where id = v_ped;
    v_r := 'FALLA — dejó renombrar un color con cortes registrados';
  exception when others then
    v_err := SQLERRM;
    v_r := case when v_err like '%no saber de qué color%' or v_err like '%No se pueden cambiar los colores%'
                then 'OK — ' || left(v_err, 60) || '…'
                else 'FALLA — error inesperado: ' || v_err end;
  end;
  v_rep := v_rep || E'\n  2 · renombrar color con cortes ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. CON cortes: bajar el total por debajo de lo consumido FALLA ──
  --    80 m consumidos; se intenta dejar el pedido en 50 m.
  begin
    update prod_pedidos_tela set total_metros = 50 where id = v_ped;
    v_r := 'FALLA — dejó el saldo en negativo (50 m con 80 m consumidos)';
  exception when others then
    v_err := SQLERRM;
    v_r := case when v_err like '%consumieron%'
                then 'OK — ' || left(v_err, 60) || '…'
                else 'FALLA — error inesperado: ' || v_err end;
  end;
  v_rep := v_rep || E'\n  3 · bajar el total por debajo ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3b. el límite exacto NO se bloquea: dejar el total en 80 m es válido ──
  --    Un `<=` mal puesto en la guarda B rompería esto y nadie lo notaría.
  begin
    update prod_pedidos_tela set total_metros = 80 where id = v_ped;
    select total_metros into v_num from prod_pedidos_tela where id = v_ped;
    v_r := case when v_num = 80 then 'OK — 80 m con 80 m consumidos es válido'
                else 'FALLA — quedó en '||v_num||' m' end;
  exception when others then
    v_r := 'FALLA — bloqueó el límite exacto: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  3b· el límite exacto se permite .... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;
  update prod_pedidos_tela set total_metros = 100 where id = v_ped;

  -- ── 4. SIN cortes: editar los colores PASA y se resincroniza ──
  begin
    insert into prod_pedidos_tela
      (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
       total_metros, valor_metro, total_pagar, estado)
    values ('ZZ_SMOKE sin cortes', fn_hoy_ecuador(), 'metros', 150,
            '[{"color":"Negro","metros":60},{"color":"Blanco","metros":40}]'::jsonb,
            100, 5, 500, 'entregado')
    returning id into v_lim;

    update prod_pedidos_tela
       set colores = '[{"color":"Verde","metros":30}]'::jsonb,
           total_metros = 30
     where id = v_lim;

    select count(*) into v_n from prod_pedido_colores where pedido_id = v_lim;
    select color into v_txt from prod_pedido_colores where pedido_id = v_lim;
    v_r := case when v_n = 1 and v_txt = 'Verde'
                then 'OK — colores editados y resincronizados (1 = Verde)'
                else 'FALLA — quedaron '||v_n||' color(es): '||coalesce(v_txt,'—') end;
  exception when others then
    v_r := 'FALLA — bloqueó un pedido SIN cortes: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  4 · editar colores sin cortes ...... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. el update de LlegadaTab NO dispara el trigger, ni con cortes ──
  --    Manda estado + fecha_entrega_real + ancho_real: ninguna está en la lista
  --    de columnas del trigger. Igual para marcarEnCamino, que manda solo estado.
  begin
    update prod_pedidos_tela
       set estado = 'entregado', fecha_entrega_real = fn_hoy_ecuador(), ancho_real = 178
     where id = v_ped;
    update prod_pedidos_tela set estado = 'en_camino' where id = v_ped;

    select ancho_real into v_num from prod_pedidos_tela where id = v_ped;
    v_r := case when v_num = 178 then 'OK — LlegadaTab y marcarEnCamino no se bloquean'
                else 'FALLA — el ancho real no se guardó' end;
  exception when others then
    v_r := 'FALLA — el trigger bloqueó a LlegadaTab: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  5 · LlegadaTab sigue funcionando ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST editar pedido con cortes (fase 8g) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
