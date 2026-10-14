-- Panorama — Finanzas · PRUEBA EN SECO de la limpieza ZZZ-PRUEBA (NO GUARDA NADA)
-- ============================================================
-- Un solo bloque DO. Siempre termina con un error a propósito para que
-- Postgres deshaga todo:
--   • "PRUEBA OK - se deshace todo ..." → la limpieza funciona y no se guardó nada.
--   • "PRUEBA FALLÓ ..." → dice qué falló; tampoco se guardó nada.
--
-- Qué hace:
--   1. Crea datos "reales" (nombres PRUEBA-SECA ...) que NO deben tocarse:
--      deuda con pagos, un pago hecho y uno reprogramado, pago suelto, gasto
--      suelto, cuenta por cobrar, cuenta de dinero con foto de saldo.
--   2. Crea datos ZZZ-PRUEBA de todo tipo: deuda firme con 4 cheques (uno
--      pagado, uno reprogramado, uno rebotado y luego cambiado), deuda con
--      solo el CONCEPTO ZZZ-PRUEBA y un abono, pago suelto pagado, gasto
--      suelto, cuenta por cobrar, cuenta de dinero con 2 fotos.
--   3. Ejecuta la limpieza (copia exacta de limpieza_zzz_prueba.sql).
--   4. Revisa: no queda nada ZZZ-PRUEBA, lo "real" quedó idéntico y la regla
--      de suma de la base se cumple.
--   5. Revisa las 3 protecciones: si hay algo de prueba mezclado con datos
--      reales, la limpieza no borra nada.
--
-- Pega TODO el archivo en Supabase → SQL Editor → Run. Que salga en rojo es
-- lo esperado: lee el mensaje.
-- Se ARMA a partir de limpieza_zzz_prueba.sql; si esa cambia, se vuelve a armar.
-- ============================================================

do $prueba$
declare
  n1 bigint[];
  n3 bigint[];
  v_real uuid;
  v_flex uuid;
  v_zzz uuid;
  v_chq uuid;
  v_cta uuid;
  v_ctz uuid;
  v_res jsonb;
  v_saldo_real numeric;
  v_txt text;
  v_ctx text;
  v_fallas text := '';
begin
  -- ##########################################################
  -- 1) Datos "reales" (no deben tocarse)
  -- ##########################################################
  insert into cuentas_dinero (nombre, tipo, banco) values ('PRUEBA-SECA Banco real', 'banco', 'Pichincha')
  returning id into v_cta;
  insert into saldos_caja (fecha, cuenta_id, monto) values (fn_hoy_ecuador(), v_cta, 1000);

  v_real := crear_deuda(
    jsonb_build_object('proveedor', 'PRUEBA-SECA REAL PROVEEDOR', 'monto', 300, 'categoria', 'maquila'),
    jsonb_build_array(
      jsonb_build_object('monto', 100, 'fecha', '2026-11-01', 'numero', '1', 'cuenta_origen_id', v_cta),
      jsonb_build_object('monto', 100, 'fecha', '2026-12-01', 'numero', '2'),
      jsonb_build_object('monto', 100, 'fecha', '2027-01-01', 'numero', '3')));
  perform pagar_cuota((select id from cheques where cuenta_por_pagar_id = v_real and numero = '1'), '2026-10-06');
  perform reprogramar_cheque((select id from cheques where cuenta_por_pagar_id = v_real and numero = '2'),
                             '2026-12-10', 'acordada', 'real');

  insert into cheques (tipo, monto, beneficiario, fecha_cobro) values ('por_pagar', 50, 'PRUEBA-SECA REAL SUELTO', '2026-11-15');
  insert into movimientos (tipo, monto, concepto, categoria) values ('gasto', 20, 'PRUEBA-SECA gasto real', 'otros');
  insert into cuentas_por_cobrar (cliente, monto) values ('PRUEBA-SECA REAL CLIENTE', 70);

  select saldo into v_saldo_real from v_deudas where id = v_real;
  n1 := array[
    (select count(*) from cuentas_por_pagar), (select count(*) from cheques), (select count(*) from movimientos),
    (select count(*) from cheques_reprogramaciones), (select count(*) from cuentas_por_cobrar),
    (select count(*) from cuentas_dinero), (select count(*) from saldos_caja)];

  -- ##########################################################
  -- 2) Datos ZZZ-PRUEBA de todo tipo
  -- ##########################################################
  insert into cuentas_dinero (nombre, tipo, banco) values ('ZZZ-PRUEBA Banco', 'banco', 'Guayaquil')
  returning id into v_ctz;
  insert into saldos_caja (fecha, cuenta_id, monto) values
    (fn_hoy_ecuador() - 3, v_ctz, 500), (fn_hoy_ecuador(), v_ctz, 450);

  v_zzz := crear_deuda(
    jsonb_build_object('proveedor', 'ZZZ-PRUEBA Pat Primo', 'monto', 1000, 'categoria', 'maquila'),
    jsonb_build_array(
      jsonb_build_object('monto', 250, 'fecha', '2026-10-31', 'numero', '901', 'cuenta_origen_id', v_ctz),
      jsonb_build_object('monto', 250, 'fecha', '2026-11-30', 'numero', '902'),
      jsonb_build_object('monto', 250, 'fecha', '2026-12-30', 'numero', '903'),
      jsonb_build_object('monto', 250, 'fecha', '2027-01-29', 'numero', '904')));
  perform pagar_cuota((select id from cheques where cuenta_por_pagar_id = v_zzz and numero = '901'), '2026-10-06');
  perform reprogramar_cheque((select id from cheques where cuenta_por_pagar_id = v_zzz and numero = '902'),
                             '2026-12-15', 'acordada', 'prueba');
  update cheques set estado = 'rebotado' where cuenta_por_pagar_id = v_zzz and numero = '904';
  perform reprogramar_cheque((select id from cheques where cuenta_por_pagar_id = v_zzz and numero = '904'),
                             '2027-02-15', 'cambiado_devuelto', 'prueba', '905');

  -- deuda con proveedor normal pero CONCEPTO de prueba, con un abono
  v_flex := crear_deuda(
    jsonb_build_object('proveedor', 'Tía Rosa', 'concepto', 'ZZZ-PRUEBA préstamo', 'monto', 500,
                       'tipo_deuda', 'familia', 'exigibilidad', 'flexible', 'ambito', 'personal'),
    '[]'::jsonb);
  perform abonar_deuda(v_flex, 100, gen_random_uuid(), '2026-10-05');

  -- pago suelto de prueba, pagado
  insert into cheques (tipo, monto, beneficiario, fecha_cobro, categoria, ambito)
  values ('por_pagar', 40, 'ZZZ-PRUEBA suelto', '2026-10-20', 'otros', 'empresa')
  returning id into v_chq;
  perform pagar_cuota(v_chq, '2026-10-06');

  insert into movimientos (tipo, monto, concepto, categoria) values ('gasto', 10, 'ZZZ-PRUEBA gasto suelto', 'otros');
  insert into cuentas_por_cobrar (cliente, concepto, monto) values ('ZZZ-PRUEBA cliente', '', 80);

  -- ##########################################################
  -- 3) Ejecutar la limpieza real
  -- ##########################################################
  begin
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS
--     sus pagos (cheques/cuotas/abonos), su historial de cambios de fecha y
--     los gastos que se registraron al pagarlos;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas por cobrar cuyo cliente o concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--
-- Cómo respeta las reglas de la base: borra en el orden que ellas exigen
-- (gastos → historial → pagos → deudas). Así nada queda huérfano y la regla
-- de suma no se rompe.
--
-- Seguridad: ANTES de borrar revisa que no vaya a tocar nada real. Si
-- encuentra algo mezclado (por ejemplo un pago ZZZ-PRUEBA dentro de una deuda
-- real), NO BORRA NADA y dice qué corregir.
--
-- Es UN solo bloque: borra todo o nada. Se puede ejecutar varias veces
-- (si no hay nada de prueba, no hace nada). Al final, una consulta de
-- verificación muestra cuánto queda de prueba (todo debe salir en 0).
-- ============================================================

do $limpieza$
declare
  v_deudas  uuid[];
  v_cheques uuid[];
  v_movs    uuid[];
  v_cuentas uuid[];
  v_txt     text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_cxc int; n_sal int; n_cue int;
begin
  -- 1) Deudas de prueba
  select coalesce(array_agg(id), '{}') into v_deudas
    from cuentas_por_pagar
   where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';

  -- 2) Pagos: todos los de esas deudas + pagos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_cheques
    from cheques
   where cuenta_por_pagar_id = any (v_deudas)
      or (cuenta_por_pagar_id is null
          and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'));

  -- Seguridad A: un pago de prueba metido en una deuda REAL
  select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
    into v_txt
    from cheques c
    join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
   where not (c.cuenta_por_pagar_id = any (v_deudas))
     and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%');
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 3) Gastos: los que salieron de esos pagos o deudas + gastos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_movs
    from movimientos
   where cheque_id = any (v_cheques)
      or cuenta_por_pagar_id = any (v_deudas)
      or (cheque_id is null and cuenta_por_pagar_id is null and concepto ilike 'zzz-prueba%');

  -- Seguridad B: un gasto ZZZ-PRUEBA ligado a un pago o deuda REAL
  select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
    into v_txt
    from movimientos m
   where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 4) Cuentas de dinero de prueba
  select coalesce(array_agg(id), '{}') into v_cuentas
    from cuentas_dinero
   where nombre ilike 'zzz-prueba%';

  -- Seguridad C: pagos REALES que salen de una cuenta de prueba
  select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
    into v_txt
    from cheques c
   where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- 5) Borrar, en el orden que exigen las reglas de la base
  delete from movimientos              where id = any (v_movs);             get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);   get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);          get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);           get diagnostics n_deu  = row_count;
  delete from cuentas_por_cobrar
   where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';       get diagnostics n_cxc  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';          get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);          get diagnostics n_cue  = row_count;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos, % cambios de fecha, % por cobrar, % fotos de caja, % cuentas de dinero.',
    n_deu, n_chq, n_mov, n_hist, n_cxc, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                 as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                 as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                   as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                    as por_cobrar_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                  as cuentas_prueba;

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'PRUEBA FALLÓ - se deshace todo. La limpieza dio error: % | dónde: %', sqlerrm, v_ctx;
  end;

  -- ##########################################################
  -- 4) Revisiones
  -- ##########################################################

  -- la regla de suma de la base sigue cumpliéndose después de borrar
  begin
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    v_fallas := v_fallas || E'\n• la regla de suma falló después de limpiar → ' || sqlerrm;
  end;
  set constraints all deferred;

  -- no queda nada de prueba
  select concat_ws(', ',
    nullif((select count(*) from cuentas_por_pagar where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), 0) || ' deudas',
    nullif((select count(*) from cheques where cuenta_por_pagar_id in (v_zzz, v_flex) or id = v_chq), 0) || ' pagos',
    nullif((select count(*) from movimientos where concepto ilike 'zzz-prueba%' or cuenta_por_pagar_id in (v_zzz, v_flex)), 0) || ' gastos',
    nullif((select count(*) from cuentas_por_cobrar where cliente ilike 'zzz-prueba%'), 0) || ' por cobrar',
    nullif((select count(*) from cuentas_dinero where id = v_ctz), 0) || ' cuentas',
    nullif((select count(*) from saldos_caja where cuenta_id = v_ctz), 0) || ' fotos de caja')
    into v_txt;
  if v_txt <> '' then
    v_fallas := v_fallas || E'\n• quedó algo de prueba sin borrar: ' || v_txt;
  end if;

  -- lo "real" quedó idéntico
  n3 := array[
    (select count(*) from cuentas_por_pagar), (select count(*) from cheques), (select count(*) from movimientos),
    (select count(*) from cheques_reprogramaciones), (select count(*) from cuentas_por_cobrar),
    (select count(*) from cuentas_dinero), (select count(*) from saldos_caja)];
  if n3 is distinct from n1 then
    v_fallas := v_fallas || format(E'\n• cambió la cantidad de datos reales: antes %s, después %s '
      '(deudas, pagos, gastos, historial, por cobrar, cuentas, fotos)', n1, n3);
  end if;
  if (select saldo from v_deudas where id = v_real) is distinct from v_saldo_real then
    v_fallas := v_fallas || E'\n• cambió el saldo de la deuda real';
  end if;
  if (select count(*) from cheques_reprogramaciones r join cheques c on c.id = r.cheque_id
       where c.cuenta_por_pagar_id = v_real) <> 1 then
    v_fallas := v_fallas || E'\n• se tocó el historial de la deuda real';
  end if;

  -- ##########################################################
  -- 5) Protecciones: si algo de prueba está mezclado con datos reales,
  --    la limpieza NO borra nada
  -- ##########################################################

  -- A) pago ZZZ-PRUEBA dentro de una deuda real
  begin
    v_flex := crear_deuda(
      jsonb_build_object('proveedor', 'PRUEBA-SECA REAL FLEXIBLE', 'monto', 1000, 'exigibilidad', 'flexible'),
      jsonb_build_array(jsonb_build_object('monto', 100, 'fecha', '2026-11-01', 'beneficiario', 'ZZZ-PRUEBA intruso')));
    insert into movimientos (tipo, monto, concepto, categoria) values ('gasto', 5, 'ZZZ-PRUEBA otro gasto', 'otros');
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS
--     sus pagos (cheques/cuotas/abonos), su historial de cambios de fecha y
--     los gastos que se registraron al pagarlos;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas por cobrar cuyo cliente o concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--
-- Cómo respeta las reglas de la base: borra en el orden que ellas exigen
-- (gastos → historial → pagos → deudas). Así nada queda huérfano y la regla
-- de suma no se rompe.
--
-- Seguridad: ANTES de borrar revisa que no vaya a tocar nada real. Si
-- encuentra algo mezclado (por ejemplo un pago ZZZ-PRUEBA dentro de una deuda
-- real), NO BORRA NADA y dice qué corregir.
--
-- Es UN solo bloque: borra todo o nada. Se puede ejecutar varias veces
-- (si no hay nada de prueba, no hace nada). Al final, una consulta de
-- verificación muestra cuánto queda de prueba (todo debe salir en 0).
-- ============================================================

do $limpieza$
declare
  v_deudas  uuid[];
  v_cheques uuid[];
  v_movs    uuid[];
  v_cuentas uuid[];
  v_txt     text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_cxc int; n_sal int; n_cue int;
begin
  -- 1) Deudas de prueba
  select coalesce(array_agg(id), '{}') into v_deudas
    from cuentas_por_pagar
   where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';

  -- 2) Pagos: todos los de esas deudas + pagos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_cheques
    from cheques
   where cuenta_por_pagar_id = any (v_deudas)
      or (cuenta_por_pagar_id is null
          and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'));

  -- Seguridad A: un pago de prueba metido en una deuda REAL
  select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
    into v_txt
    from cheques c
    join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
   where not (c.cuenta_por_pagar_id = any (v_deudas))
     and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%');
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 3) Gastos: los que salieron de esos pagos o deudas + gastos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_movs
    from movimientos
   where cheque_id = any (v_cheques)
      or cuenta_por_pagar_id = any (v_deudas)
      or (cheque_id is null and cuenta_por_pagar_id is null and concepto ilike 'zzz-prueba%');

  -- Seguridad B: un gasto ZZZ-PRUEBA ligado a un pago o deuda REAL
  select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
    into v_txt
    from movimientos m
   where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 4) Cuentas de dinero de prueba
  select coalesce(array_agg(id), '{}') into v_cuentas
    from cuentas_dinero
   where nombre ilike 'zzz-prueba%';

  -- Seguridad C: pagos REALES que salen de una cuenta de prueba
  select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
    into v_txt
    from cheques c
   where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- 5) Borrar, en el orden que exigen las reglas de la base
  delete from movimientos              where id = any (v_movs);             get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);   get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);          get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);           get diagnostics n_deu  = row_count;
  delete from cuentas_por_cobrar
   where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';       get diagnostics n_cxc  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';          get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);          get diagnostics n_cue  = row_count;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos, % cambios de fecha, % por cobrar, % fotos de caja, % cuentas de dinero.',
    n_deu, n_chq, n_mov, n_hist, n_cxc, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                 as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                 as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                   as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                    as por_cobrar_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                  as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección A: borró aunque había un pago ZZZ-PRUEBA dentro de una deuda real';
  exception when others then
    if sqlerrm not ilike '%No borré nada%deudas REALES%' then
      v_fallas := v_fallas || E'\n• protección A: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- B) gasto ZZZ-PRUEBA ligado a una deuda real
  begin
    insert into movimientos (tipo, monto, concepto, categoria, cuenta_por_pagar_id)
    values ('gasto', 5, 'ZZZ-PRUEBA mal ligado', 'otros', v_real);
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS
--     sus pagos (cheques/cuotas/abonos), su historial de cambios de fecha y
--     los gastos que se registraron al pagarlos;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas por cobrar cuyo cliente o concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--
-- Cómo respeta las reglas de la base: borra en el orden que ellas exigen
-- (gastos → historial → pagos → deudas). Así nada queda huérfano y la regla
-- de suma no se rompe.
--
-- Seguridad: ANTES de borrar revisa que no vaya a tocar nada real. Si
-- encuentra algo mezclado (por ejemplo un pago ZZZ-PRUEBA dentro de una deuda
-- real), NO BORRA NADA y dice qué corregir.
--
-- Es UN solo bloque: borra todo o nada. Se puede ejecutar varias veces
-- (si no hay nada de prueba, no hace nada). Al final, una consulta de
-- verificación muestra cuánto queda de prueba (todo debe salir en 0).
-- ============================================================

do $limpieza$
declare
  v_deudas  uuid[];
  v_cheques uuid[];
  v_movs    uuid[];
  v_cuentas uuid[];
  v_txt     text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_cxc int; n_sal int; n_cue int;
begin
  -- 1) Deudas de prueba
  select coalesce(array_agg(id), '{}') into v_deudas
    from cuentas_por_pagar
   where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';

  -- 2) Pagos: todos los de esas deudas + pagos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_cheques
    from cheques
   where cuenta_por_pagar_id = any (v_deudas)
      or (cuenta_por_pagar_id is null
          and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'));

  -- Seguridad A: un pago de prueba metido en una deuda REAL
  select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
    into v_txt
    from cheques c
    join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
   where not (c.cuenta_por_pagar_id = any (v_deudas))
     and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%');
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 3) Gastos: los que salieron de esos pagos o deudas + gastos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_movs
    from movimientos
   where cheque_id = any (v_cheques)
      or cuenta_por_pagar_id = any (v_deudas)
      or (cheque_id is null and cuenta_por_pagar_id is null and concepto ilike 'zzz-prueba%');

  -- Seguridad B: un gasto ZZZ-PRUEBA ligado a un pago o deuda REAL
  select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
    into v_txt
    from movimientos m
   where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 4) Cuentas de dinero de prueba
  select coalesce(array_agg(id), '{}') into v_cuentas
    from cuentas_dinero
   where nombre ilike 'zzz-prueba%';

  -- Seguridad C: pagos REALES que salen de una cuenta de prueba
  select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
    into v_txt
    from cheques c
   where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- 5) Borrar, en el orden que exigen las reglas de la base
  delete from movimientos              where id = any (v_movs);             get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);   get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);          get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);           get diagnostics n_deu  = row_count;
  delete from cuentas_por_cobrar
   where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';       get diagnostics n_cxc  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';          get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);          get diagnostics n_cue  = row_count;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos, % cambios de fecha, % por cobrar, % fotos de caja, % cuentas de dinero.',
    n_deu, n_chq, n_mov, n_hist, n_cxc, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                 as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                 as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                   as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                    as por_cobrar_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                  as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección B: borró aunque había un gasto ZZZ-PRUEBA ligado a una deuda real';
  exception when others then
    if sqlerrm not ilike '%No borré nada%gastos ZZZ-PRUEBA ligados%' then
      v_fallas := v_fallas || E'\n• protección B: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- C) pago real que sale de una cuenta de dinero ZZZ-PRUEBA
  begin
    insert into cuentas_dinero (nombre) values ('ZZZ-PRUEBA Banco 2') returning id into v_ctz;
    update cheques set cuenta_origen_id = v_ctz where cuenta_por_pagar_id = v_real and numero = '3';
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS
--     sus pagos (cheques/cuotas/abonos), su historial de cambios de fecha y
--     los gastos que se registraron al pagarlos;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas por cobrar cuyo cliente o concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--
-- Cómo respeta las reglas de la base: borra en el orden que ellas exigen
-- (gastos → historial → pagos → deudas). Así nada queda huérfano y la regla
-- de suma no se rompe.
--
-- Seguridad: ANTES de borrar revisa que no vaya a tocar nada real. Si
-- encuentra algo mezclado (por ejemplo un pago ZZZ-PRUEBA dentro de una deuda
-- real), NO BORRA NADA y dice qué corregir.
--
-- Es UN solo bloque: borra todo o nada. Se puede ejecutar varias veces
-- (si no hay nada de prueba, no hace nada). Al final, una consulta de
-- verificación muestra cuánto queda de prueba (todo debe salir en 0).
-- ============================================================

do $limpieza$
declare
  v_deudas  uuid[];
  v_cheques uuid[];
  v_movs    uuid[];
  v_cuentas uuid[];
  v_txt     text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_cxc int; n_sal int; n_cue int;
begin
  -- 1) Deudas de prueba
  select coalesce(array_agg(id), '{}') into v_deudas
    from cuentas_por_pagar
   where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';

  -- 2) Pagos: todos los de esas deudas + pagos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_cheques
    from cheques
   where cuenta_por_pagar_id = any (v_deudas)
      or (cuenta_por_pagar_id is null
          and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'));

  -- Seguridad A: un pago de prueba metido en una deuda REAL
  select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
    into v_txt
    from cheques c
    join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
   where not (c.cuenta_por_pagar_id = any (v_deudas))
     and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%');
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 3) Gastos: los que salieron de esos pagos o deudas + gastos sueltos de prueba
  select coalesce(array_agg(id), '{}') into v_movs
    from movimientos
   where cheque_id = any (v_cheques)
      or cuenta_por_pagar_id = any (v_deudas)
      or (cheque_id is null and cuenta_por_pagar_id is null and concepto ilike 'zzz-prueba%');

  -- Seguridad B: un gasto ZZZ-PRUEBA ligado a un pago o deuda REAL
  select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
    into v_txt
    from movimientos m
   where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- 4) Cuentas de dinero de prueba
  select coalesce(array_agg(id), '{}') into v_cuentas
    from cuentas_dinero
   where nombre ilike 'zzz-prueba%';

  -- Seguridad C: pagos REALES que salen de una cuenta de prueba
  select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
    into v_txt
    from cheques c
   where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- 5) Borrar, en el orden que exigen las reglas de la base
  delete from movimientos              where id = any (v_movs);             get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);   get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);          get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);           get diagnostics n_deu  = row_count;
  delete from cuentas_por_cobrar
   where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%';       get diagnostics n_cxc  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';          get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);          get diagnostics n_cue  = row_count;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos, % cambios de fecha, % por cobrar, % fotos de caja, % cuentas de dinero.',
    n_deu, n_chq, n_mov, n_hist, n_cxc, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                 as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                 as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                   as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                    as por_cobrar_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                  as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección C: borró una cuenta de prueba de la que salen pagos reales';
  exception when others then
    if sqlerrm not ilike '%No borré nada%salen de una cuenta ZZZ-PRUEBA%' then
      v_fallas := v_fallas || E'\n• protección C: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- ##########################################################
  -- 6) Resultado: siempre termina con error para que NADA se guarde
  -- ##########################################################
  if v_fallas <> '' then
    raise exception E'PRUEBA FALLÓ - se deshace todo. Fallaron:%', v_fallas;
  end if;
  raise exception 'PRUEBA OK - se deshace todo (borró todo lo ZZZ-PRUEBA, no tocó lo real, y las 3 protecciones frenaron la limpieza cuando había mezcla)';
end
$prueba$;
