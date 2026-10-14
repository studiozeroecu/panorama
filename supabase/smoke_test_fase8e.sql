-- SMOKE TEST de archivar catálogos (fase 8e).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8e_archivar_catalogos.sql YA esté aplicado.
--
-- ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte, y al
--    lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- Aporta menos que los de las fases anteriores, y conviene saberlo: la migración
-- añade columnas inertes, sin función ni trigger, y toda la lógica nueva vive en
-- TypeScript, que un bloque DO no puede ejecutar. Lo único demostrable desde SQL es
-- el CONTRASTE entre archivar y borrar — que es exactamente el bug 1.1 que se cierra.
--
-- La verificación de verdad es en pantalla: archivar una prenda que ya tenga
-- pedidos, comprobar que desaparece del desplegable de Pedidos, que el pedido viejo
-- sigue mostrando "Para: esa prenda", y que al desarchivar vuelve al desplegable.

do $SMOKE$
declare
  v_rep text := ''; v_r text; v_ok int := 0; v_bad int := 0;
  v_prenda uuid; v_pedido uuid; v_n int; v_pid uuid;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  -- ── 1. las cuatro columnas existen y una fila nueva nace activa ──
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and column_name = 'archivada_en'
    and table_name in ('prod_prendas', 'prod_proveedores', 'prod_maquiladoras', 'prod_talleres');

  insert into prod_prendas (nombre, consumo_metros, costo_maquila, precio_venta_local,
                            precio_venta_online, lleva_estampado, tallas)
  values ('ZZ_SMOKE prenda', 1, 1, 5, 8, false, array['S','M'])
  returning id into v_prenda;

  v_r := case when v_n = 4
                and (select archivada_en from prod_prendas where id = v_prenda) is null
              then 'OK — 4 columnas, y una fila nueva nace activa (null)'
              else 'FALLA — ' || v_n || '/4 columnas, o la fila nueva no nació en null' end;
  v_rep := v_rep || E'\n  1 · columnas y valor por defecto ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. ARCHIVAR no desvincula: el pedido sigue resolviendo su prenda ──
  insert into prod_pedidos_tela (nombre_tela, fecha_pedido, unidad, ancho_pedido, prenda_id,
                                 colores, total_metros, valor_metro, total_pagar, estado)
  values ('ZZ_SMOKE tela', fn_hoy_ecuador(), 'metros', 150, v_prenda,
          '[{"color":"Negro","metros":10}]'::jsonb, 10, 5, 50, 'pendiente')
  returning id into v_pedido;

  update prod_prendas set archivada_en = now() where id = v_prenda;

  select prenda_id into v_pid from prod_pedidos_tela where id = v_pedido;
  v_r := case when v_pid = v_prenda
              then 'OK — el pedido conserva su prenda_id tras archivarla'
              else 'FALLA — prenda_id quedó en ' || coalesce(v_pid::text, 'null') end;
  v_rep := v_rep || E'\n  2 · archivar conserva el vinculo ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. EL CONTRASTE: borrar SÍ desvincula. Este es el bug 1.1, ejecutable. ──
  delete from prod_prendas where id = v_prenda;
  select prenda_id into v_pid from prod_pedidos_tela where id = v_pedido;
  v_r := case when v_pid is null
              then 'OK — borrar deja prenda_id en null: esto es lo que archivar evita'
              else 'FALLA — se esperaba null, quedó ' || v_pid::text end;
  v_rep := v_rep || E'\n  3 · borrar si desvincula (contraste) ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST archivar catálogos (fase 8e) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
