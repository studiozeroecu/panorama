-- SMOKE TEST de la columna consumo_m2 (fase 8h).
-- NO forma parte de la cadena de migraciones.
--
-- Requiere que schema_fase8h_consumo_m2.sql YA esté aplicado.
--
-- Es UN SOLO bloque DO — una sola sentencia, una sola transacción en una sola
-- conexión. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error" ES el reporte,
-- y al lanzarlo PostgreSQL revierte todo. No queda NADA en la base.
--
-- La comprobación 2 es la que de verdad importa: que las prendas que ya existen
-- queden en NULL y no en 0. Un 0 heredado se leería como un dato medido y
-- rompería la estimación en silencio.

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_err  text;
  v_n    int;
  v_txt  text;
  v_id   uuid;
begin
  -- ── 1. la columna existe, es nullable y con la escala esperada ──
  select data_type || ' · nullable=' || is_nullable || ' · escala=' || coalesce(numeric_scale::text,'—')
    into v_txt
  from information_schema.columns
  where table_name = 'prod_prendas' and column_name = 'consumo_m2';
  v_r := case when v_txt is null then 'FALLA — la columna no existe'
              when v_txt like 'numeric · nullable=YES · escala=3' then 'OK — ' || v_txt
              else 'FALLA — ' || v_txt end;
  v_rep := v_rep || E'\n  1 · la columna existe y es nullable ... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. las prendas que YA existían quedan en NULL, no en 0 ──
  select count(*) into v_n from prod_prendas where consumo_m2 is not null;
  v_r := case when v_n = 0 then 'OK — ninguna prenda heredó un valor'
              else 'FALLA — ' || v_n || ' prenda(s) con valor; un 0 heredado se leería como dato real' end;
  v_rep := v_rep || E'\n  2 · las prendas viejas quedan en NULL . ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. se puede dar de alta una prenda SIN medir los m² ──
  begin
    insert into prod_prendas (nombre, consumo_metros, costo_maquila,
                              precio_venta_local, precio_venta_online, tallas)
    values ('ZZ_SMOKE sin m2', 1, 1, 10, 12, '{"S","M"}')
    returning id into v_id;
    select consumo_m2 is null into v_r from prod_prendas where id = v_id;
    v_r := case when v_r::boolean then 'OK — queda en NULL' else 'FALLA — no quedó en NULL' end;
  exception when others then
    v_r := 'FALLA — no dejó insertar sin consumo_m2: ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  3 · alta sin medir los m² ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 4. se puede guardar un valor con sus tres decimales ──
  begin
    update prod_prendas set consumo_m2 = 1.125 where id = v_id;
    select consumo_m2::text into v_txt from prod_prendas where id = v_id;
    v_r := case when v_txt = '1.125' then 'OK — 1.125 se guarda sin redondear'
                else 'FALLA — quedó ' || coalesce(v_txt,'null') end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  4 · guarda tres decimales ............. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 5. el check rechaza el 0 ──
  --    Es la comprobación que protege la ambigüedad: NULL es "sin medir" y 0
  --    no puede existir, así que el código nunca tiene que adivinar cuál es cuál.
  begin
    update prod_prendas set consumo_m2 = 0 where id = v_id;
    v_r := 'FALLA — aceptó un 0, que se leería como un dato medido';
  exception when others then
    v_err := SQLERRM;
    v_r := case when v_err like '%consumo_m2_positivo%' then 'OK — rechazado por el check propio'
                else 'FALLA — error inesperado: ' || v_err end;
  end;
  v_rep := v_rep || E'\n  5 · el 0 se rechaza .................. ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 6. y los negativos también ──
  begin
    update prod_prendas set consumo_m2 = -1 where id = v_id;
    v_r := 'FALLA — aceptó un valor negativo';
  exception when others then
    v_r := case when SQLERRM like '%consumo_m2_positivo%' then 'OK — rechazado'
                else 'FALLA — error inesperado: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  6 · los negativos se rechazan ........ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 7. la política de prod_prendas sigue siendo de fila ──
  --    Si tuviera lista de columnas no cubriría a consumo_m2 y la app vería
  --    "no hay datos" en vez de un error.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'prod_prendas'
    and policyname = 'admin_all_prod_prendas';
  v_r := case when v_n = 1 then 'OK — admin_all_prod_prendas existe y es de fila'
              else 'FALLA — la política no está como se esperaba (' || v_n || ')' end;
  v_rep := v_rep || E'\n  7 · la política cubre la columna ..... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── reporte final. El raise revierte TODO lo anterior. ──
  raise exception E'\n════ SMOKE TEST consumo_m2 (fase 8h) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;
