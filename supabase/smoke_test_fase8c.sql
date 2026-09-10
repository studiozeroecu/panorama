-- SMOKE TEST de la validación de colores repetidos (fase 8c).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8c_colores_repetidos.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- La comprobación 1 no se conforma con que el insert falle: verifica que el mensaje
-- sea el NUESTRO y no el nativo de Postgres. Si alguien quitara la validación, el
-- insert seguiría fallando (por el ON CONFLICT) y un test menos exigente pasaría.

do $SMOKE$
declare
  v_rep text := '';
  v_r   text;
  v_ok  int := 0;
  v_bad int := 0;
  v_err text;
  v_id  uuid;
  v_n   int;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 1. duplicado por mayúsculas → mensaje PROPIO, no el nativo de ON CONFLICT ──
  begin
    insert into prod_pedidos_tela
      (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
       total_metros, valor_metro, total_pagar, estado)
    values ('ZZ_SMOKE dup', fn_hoy_ecuador(), 'metros', 150,
            '[{"color":"Negro","metros":10},{"color":"negro","metros":5}]'::jsonb,
            15, 5, 75, 'pendiente');
    v_r := 'FALLA — aceptó un pedido con "Negro" y "negro"';
  exception when others then
    v_err := SQLERRM;
    v_r := case when v_err like '%colores repetidos%' and v_err not like '%ON CONFLICT%'
                then 'OK — ' || v_err
                else 'FALLA — error nativo o inesperado: ' || v_err end;
  end;
  v_rep := v_rep || E'\n  1 · duplicado por mayusculas ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. el pedido rechazado NO quedó a medias (el trigger es AFTER INSERT) ──
  select count(*) into v_n from prod_pedidos_tela where nombre_tela = 'ZZ_SMOKE dup';
  v_r := case when v_n = 0 then 'OK — no quedó pedido a medias'
              else 'FALLA — quedaron '||v_n||' fila(s) del pedido rechazado' end;
  v_rep := v_rep || E'\n  2 · sin estado parcial ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. duplicado por espacios ("Rosa " vs "rosa") → también rechazado ──
  begin
    insert into prod_pedidos_tela
      (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
       total_metros, valor_metro, total_pagar, estado)
    values ('ZZ_SMOKE dup2', fn_hoy_ecuador(), 'metros', 150,
            '[{"color":"Rosa ","metros":10},{"color":"rosa","metros":5}]'::jsonb,
            15, 5, 75, 'pendiente');
    v_r := 'FALLA — aceptó "Rosa " y "rosa"';
  exception when others then
    v_r := case when SQLERRM like '%colores repetidos%'
                then 'OK — el btrim también cuenta'
                else 'FALLA — ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  3 · duplicado por espacios ......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. colores distintos → entra normal, con sus filas normalizadas ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE ok', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Negro","metros":10},{"color":"Blanco","metros":5}]'::jsonb,
          15, 5, 75, 'pendiente')
  returning id into v_id;
  select count(*) into v_n from prod_pedido_colores where pedido_id = v_id;
  v_r := case when v_n = 2 then 'OK — 2 colores normalizados'
              else 'FALLA — '||v_n||' color(es), se esperaban 2' end;
  v_rep := v_rep || E'\n  4 · colores distintos entran ....... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. tildes: "Café" y "Cafe" NO son duplicados (esperado, no es un bug) ──
  insert into prod_pedidos_tela
    (nombre_tela, fecha_pedido, unidad, ancho_pedido, colores,
     total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE tildes', fn_hoy_ecuador(), 'metros', 150,
          '[{"color":"Café","metros":10},{"color":"Cafe","metros":5}]'::jsonb,
          15, 5, 75, 'pendiente')
  returning id into v_id;
  select count(*) into v_n from prod_pedido_colores where pedido_id = v_id;
  v_r := case when v_n = 2 then 'OK — "Café" y "Cafe" conviven (no se normalizan tildes)'
              else 'FALLA — '||v_n||' color(es), se esperaban 2' end;
  v_rep := v_rep || E'\n  5 · tildes no se normalizan ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST colores repetidos (fase 8c) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
