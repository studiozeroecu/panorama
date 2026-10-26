-- Panorama — Finanzas · PRUEBA EN SECO de la limpieza ZZZ-PRUEBA (NO GUARDA NADA)
-- ============================================================
-- Un solo bloque DO. Siempre termina con un error a propósito para que
-- Postgres deshaga todo:
--   • "PRUEBA OK - se deshace todo ..." → la limpieza funciona y no se guardó nada.
--   • "PRUEBA FALLÓ ..." → dice qué falló; tampoco se guardó nada.
--
-- Qué hace:
--   1. Crea datos "reales" (nombres PRUEBA-SECA ...) que NO deben tocarse:
--      deudas y pagos, facturas de VATEX y de un cliente con abonos, una
--      feria, y un pago de sueldo.
--   2. Crea datos ZZZ-PRUEBA de todo tipo (deudas, cheques reprogramados y
--      rebotados, abonos, facturas de VATEX y de clientes, abonos, ferias de
--      2 días, pagos de sueldo, cuentas de dinero).
--   3. Ejecuta la limpieza (copia exacta de limpieza_zzz_prueba.sql).
--   4. Revisa: no queda nada ZZZ-PRUEBA, lo "real" quedó idéntico (cantidades,
--      saldos, lo que te debe VATEX y tu sueldo) y la regla de suma se cumple.
--   5. Revisa las 5 protecciones: si algo de prueba está mezclado con datos
--      reales, la limpieza no borra nada.
--
-- Córrela ANTES de crear tus datos de prueba (si ya hay ZZZ-PRUEBA en la base,
-- la prueba los cuenta como "reales" y avisa una falsa alarma).
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
  v_zfam uuid;
  v_chq uuid := gen_random_uuid();
  v_cta uuid := gen_random_uuid();
  v_ctz uuid := gen_random_uuid();
  v_ctz2 uuid := gen_random_uuid();
  v_saldo_real numeric;
  v_sueldo1 numeric;
  v_vatex1 numeric;
  v_cliente1 numeric;
  v_x numeric;
  v_txt text;
  v_ctx text;
  v_fallas text := '';
begin
  -- ##########################################################
  -- 1) Datos "reales" (no deben tocarse)
  -- ##########################################################
  insert into cuentas_dinero (id, nombre, tipo, banco) values (v_cta, 'PRUEBA-SECA Banco real', 'banco', 'Pichincha');
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

  -- ingresos reales: VATEX, otro cliente, una feria y un pago de sueldo
  insert into cuentas_por_cobrar (cliente, es_vatex, concepto, monto, fecha_factura, prendas)
  values ('VATEX', true, 'PRUEBA-SECA liquidación', 500, '2020-02-01', 10);
  perform registrar_cobro(gen_random_uuid(), null, true, 100, '2026-10-10', 'transferencia', 'PRUEBA-SECA abono');
  insert into cuentas_por_cobrar (cliente, concepto, monto, fecha_factura, prendas)
  values ('PRUEBA-SECA CLIENTE', 'real', 70, '2020-02-02', 1);
  perform registrar_cobro(gen_random_uuid(), 'PRUEBA-SECA CLIENTE', false, 20, '2026-10-10');
  perform registrar_venta_directa(gen_random_uuid(), 'feria', 90, 3, '2020-02-03', 'PRUEBA-SECA FERIA');
  perform pagar_mi_sueldo(gen_random_uuid(), 10, '2026-10-10', 'efectivo', 'PRUEBA-SECA pago');

  v_saldo_real := (select saldo from v_deudas where id = v_real);
  v_sueldo1 := (select saldo from v_sueldo_dueno);
  v_vatex1 := (select saldo from v_cxc_cuentas where cuenta = 'vatex');
  v_cliente1 := (select saldo from v_cxc_cuentas where cuenta = 'prueba-seca cliente');
  n1 := array[
    (select count(*) from cuentas_por_pagar), (select count(*) from cheques), (select count(*) from movimientos),
    (select count(*) from cheques_reprogramaciones), (select count(*) from cuentas_por_cobrar),
    (select count(*) from cuentas_dinero), (select count(*) from saldos_caja), (select count(*) from cobros),
    (select count(*) from ventas_directas), (select count(*) from sueldo_dueno_pagos)];

  -- ##########################################################
  -- 2) Datos ZZZ-PRUEBA de todo tipo
  -- ##########################################################
  insert into cuentas_dinero (id, nombre, tipo, banco) values (v_ctz, 'ZZZ-PRUEBA Banco', 'banco', 'Guayaquil');
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

  v_zfam := crear_deuda(
    jsonb_build_object('proveedor', 'Tía Rosa', 'concepto', 'ZZZ-PRUEBA préstamo', 'monto', 500,
                       'tipo_deuda', 'familia', 'exigibilidad', 'flexible', 'ambito', 'personal'),
    '[]'::jsonb);
  perform abonar_deuda(v_zfam, 100, gen_random_uuid(), '2026-10-05');

  insert into cheques (id, tipo, monto, beneficiario, fecha_cobro, categoria, ambito)
  values (v_chq, 'por_pagar', 40, 'ZZZ-PRUEBA suelto', '2026-10-20', 'otros', 'empresa');
  perform pagar_cuota(v_chq, '2026-10-06');
  insert into movimientos (tipo, monto, concepto, categoria) values ('gasto', 10, 'ZZZ-PRUEBA gasto suelto', 'otros');

  -- ingresos de prueba
  insert into cuentas_por_cobrar (cliente, es_vatex, concepto, monto, fecha_factura, prendas)
  values ('VATEX', true, 'ZZZ-PRUEBA liquidación', 1000, '2020-01-01', 100);
  perform registrar_cobro(gen_random_uuid(), null, true, 300, '2026-10-11', 'transferencia', 'ZZZ-PRUEBA abono');
  insert into cuentas_por_cobrar (cliente, concepto, monto, fecha_factura, prendas)
  values ('ZZZ-PRUEBA Cliente', 'prueba', 100, '2020-01-05', 2);
  perform registrar_cobro(gen_random_uuid(), 'ZZZ-PRUEBA Cliente', false, 50, '2026-10-11');
  perform registrar_venta_directa(gen_random_uuid(), 'feria', 300, 10, '2020-01-12', 'ZZZ-PRUEBA Feria');
  perform registrar_venta_directa(gen_random_uuid(), 'feria', 200, 6, '2020-01-13', 'ZZZ-PRUEBA Feria');
  perform pagar_mi_sueldo(gen_random_uuid(), 100, '2026-10-11', 'efectivo', 'ZZZ-PRUEBA pago');

  -- ##########################################################
  -- 3) Ejecutar la limpieza real
  -- ##########################################################
  begin
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   DEUDAS Y PAGOS
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS sus
--     pagos (cheques, cuotas, abonos), su historial de cambios de fecha y los
--     gastos que generaron;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--   INGRESOS (fase 5)
--   • facturas por cobrar cuyo cliente, concepto, número o notas empieza con
--     ZZZ-PRUEBA (para VATEX: pon ZZZ-PRUEBA en el CONCEPTO);
--   • abonos recibidos cuyo cliente o notas empieza con ZZZ-PRUEBA (para abonos
--     de VATEX: pon ZZZ-PRUEBA en las NOTAS);
--   • ventas directas cuya feria o notas empieza con ZZZ-PRUEBA;
--   • pagos de "Mi sueldo" cuyas notas empiezan con ZZZ-PRUEBA;
--   • y el ingreso o gasto que generó cada uno.
--
-- Borra en el orden que exigen las reglas de la base (gastos e ingresos →
-- historial → pagos → deudas), así nada queda huérfano.
--
-- Seguridad: si algo de prueba está mezclado con datos reales, NO BORRA NADA
-- y dice qué corregir. Y al final revisa que nada real quede descuadrado
-- (que tu sueldo o lo que te debe un cliente no quede negativo); si pasaría,
-- tampoco borra nada.
--
-- Un solo bloque: todo o nada. Repetible. Al final, una verificación que
-- debe salir toda en 0.
-- Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- ============================================================

do $limpieza$
declare
  v_deudas   uuid[];
  v_cheques  uuid[];
  v_movs     uuid[];
  v_cuentas  uuid[];
  v_facturas uuid[];
  v_cobros   uuid[];
  v_ventas   uuid[];
  v_pagos_s  uuid[];
  v_txt      text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_sal int; n_cue int;
  n_fac int; n_cob int; n_ven int; n_pag int;
begin
  -- ---------------- qué es de prueba ----------------
  v_deudas := coalesce((select array_agg(id) from cuentas_por_pagar
                         where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), '{}');

  v_cheques := coalesce((select array_agg(id) from cheques
                          where cuenta_por_pagar_id = any (v_deudas)
                             or (cuenta_por_pagar_id is null
                                 and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'))), '{}');

  v_facturas := coalesce((select array_agg(id) from cuentas_por_cobrar
                           where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
                              or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_cobros := coalesce((select array_agg(id) from cobros
                         where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_ventas := coalesce((select array_agg(id) from ventas_directas
                         where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_pagos_s := coalesce((select array_agg(id) from sueldo_dueno_pagos
                          where notas ilike 'zzz-prueba%'), '{}');

  v_movs := coalesce((select array_agg(id) from movimientos
                       where cheque_id = any (v_cheques)
                          or cuenta_por_pagar_id = any (v_deudas)
                          or cobro_id = any (v_cobros)
                          or venta_directa_id = any (v_ventas)
                          or sueldo_pago_id = any (v_pagos_s)
                          or (cheque_id is null and cuenta_por_pagar_id is null and cobro_id is null
                              and venta_directa_id is null and sueldo_pago_id is null
                              and concepto ilike 'zzz-prueba%')), '{}');

  v_cuentas := coalesce((select array_agg(id) from cuentas_dinero where nombre ilike 'zzz-prueba%'), '{}');

  -- ---------------- protecciones (antes de borrar) ----------------

  -- A) un pago de prueba metido en una deuda REAL
  v_txt := (select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
              from cheques c join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
             where not (c.cuenta_por_pagar_id = any (v_deudas))
               and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%'));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- B) un gasto o ingreso ZZZ-PRUEBA ligado a algo REAL
  v_txt := (select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
              from movimientos m
             where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs)));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- C) pagos REALES que salen de una cuenta de dinero de prueba
  v_txt := (select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
              from cheques c
             where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques)));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- ---------------- borrar, en el orden que exigen las reglas ----------------
  delete from movimientos              where id = any (v_movs);            get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);  get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);         get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);          get diagnostics n_deu  = row_count;
  delete from cobros                   where id = any (v_cobros);          get diagnostics n_cob  = row_count;
  delete from cuentas_por_cobrar       where id = any (v_facturas);        get diagnostics n_fac  = row_count;
  delete from ventas_directas          where id = any (v_ventas);          get diagnostics n_ven  = row_count;
  delete from sueldo_dueno_pagos       where id = any (v_pagos_s);         get diagnostics n_pag  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';         get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);         get diagnostics n_cue  = row_count;

  -- ---------------- protecciones (después de borrar: nada real descuadrado) ----------------

  -- D) un pago de sueldo REAL (sin ZZZ-PRUEBA en las notas) que solo cubría ganancias de prueba
  if (select saldo from v_sueldo_dueno) < 0 then
    raise exception 'No borré nada: tu sueldo quedaría en negativo (%). Hay un pago de sueldo de prueba sin "ZZZ-PRUEBA" en las notas.',
      (select saldo from v_sueldo_dueno);
  end if;

  -- E) un abono REAL que quedaría sin facturas (el cliente "debería" negativo)
  v_txt := (select string_agg(k.cuenta, ', ')
              from (select cuenta, sum(monto) as cobrado from cobros where not anulado group by cuenta) k
              left join (select cuenta, sum(monto) as facturado from cuentas_por_cobrar
                          where not anulada and estado <> 'cobrado' group by cuenta) f on f.cuenta = k.cuenta
             where k.cobrado > coalesce(f.facturado, 0));
  if v_txt is not null then
    raise exception 'No borré nada: quedarían abonos sin facturas en: %. Hay un abono de prueba sin "ZZZ-PRUEBA" en las notas.', v_txt;
  end if;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos/ingresos, % cambios de fecha, % facturas por cobrar, % abonos, % ventas, % pagos de sueldo, % fotos de caja, % cuentas.',
    n_deu, n_chq, n_mov, n_hist, n_fac, n_cob, n_ven, n_pag, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                        as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                        as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                          as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
       or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                       as facturas_prueba,
  (select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')   as abonos_prueba,
  (select count(*) from ventas_directas where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%') as ventas_prueba,
  (select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%')                      as sueldo_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                         as cuentas_prueba;

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'PRUEBA FALLÓ - se deshace todo. La limpieza dio error: % | dónde: %', sqlerrm, v_ctx;
  end;

  -- ##########################################################
  -- 4) Revisiones
  -- ##########################################################

  begin
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    v_fallas := v_fallas || E'\n• la regla de suma falló después de limpiar → ' || sqlerrm;
  end;
  set constraints all deferred;

  v_txt := concat_ws(', ',
    nullif((select count(*) from cuentas_por_pagar where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), 0) || ' deudas',
    nullif((select count(*) from cheques where cuenta_por_pagar_id in (v_zzz, v_zfam) or id = v_chq), 0) || ' pagos',
    nullif((select count(*) from movimientos where concepto ilike 'zzz-prueba%' or cuenta_por_pagar_id in (v_zzz, v_zfam)), 0) || ' gastos',
    nullif((select count(*) from cuentas_por_cobrar where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), 0) || ' facturas',
    nullif((select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), 0) || ' abonos',
    nullif((select count(*) from ventas_directas where evento ilike 'zzz-prueba%'), 0) || ' ventas',
    nullif((select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%'), 0) || ' pagos de sueldo',
    nullif((select count(*) from cuentas_dinero where id = v_ctz), 0) || ' cuentas',
    nullif((select count(*) from saldos_caja where cuenta_id = v_ctz), 0) || ' fotos de caja');
  if v_txt <> '' then
    v_fallas := v_fallas || E'\n• quedó algo de prueba sin borrar: ' || v_txt;
  end if;

  n3 := array[
    (select count(*) from cuentas_por_pagar), (select count(*) from cheques), (select count(*) from movimientos),
    (select count(*) from cheques_reprogramaciones), (select count(*) from cuentas_por_cobrar),
    (select count(*) from cuentas_dinero), (select count(*) from saldos_caja), (select count(*) from cobros),
    (select count(*) from ventas_directas), (select count(*) from sueldo_dueno_pagos)];
  if n3 is distinct from n1 then
    v_fallas := v_fallas || format(E'\n• cambió la cantidad de datos reales: antes %s, después %s '
      '(deudas, pagos, gastos, historial, facturas, cuentas, fotos, abonos, ventas, pagos de sueldo)', n1, n3);
  end if;
  if (select saldo from v_deudas where id = v_real) is distinct from v_saldo_real then
    v_fallas := v_fallas || E'\n• cambió el saldo de la deuda real';
  end if;
  if (select saldo from v_sueldo_dueno) is distinct from v_sueldo1 then
    v_fallas := v_fallas || format(E'\n• cambió tu sueldo real: antes %s, después %s', v_sueldo1, (select saldo from v_sueldo_dueno));
  end if;
  if (select saldo from v_cxc_cuentas where cuenta = 'vatex') is distinct from v_vatex1 then
    v_fallas := v_fallas || format(E'\n• cambió lo que te debe VATEX: antes %s, después %s', v_vatex1,
      (select saldo from v_cxc_cuentas where cuenta = 'vatex'));
  end if;
  if (select saldo from v_cxc_cuentas where cuenta = 'prueba-seca cliente') is distinct from v_cliente1 then
    v_fallas := v_fallas || E'\n• cambió lo que te debe el cliente real';
  end if;
  if (select count(*) from cheques_reprogramaciones r join cheques c on c.id = r.cheque_id
       where c.cuenta_por_pagar_id = v_real) <> 1 then
    v_fallas := v_fallas || E'\n• se tocó el historial de la deuda real';
  end if;

  -- ##########################################################
  -- 5) Protecciones: si algo de prueba está mezclado con lo real, NO borra nada
  -- ##########################################################

  -- A) pago ZZZ-PRUEBA dentro de una deuda real
  begin
    v_flex := crear_deuda(
      jsonb_build_object('proveedor', 'PRUEBA-SECA REAL FLEXIBLE', 'monto', 1000, 'exigibilidad', 'flexible'),
      jsonb_build_array(jsonb_build_object('monto', 100, 'fecha', '2026-11-01', 'beneficiario', 'ZZZ-PRUEBA intruso')));
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   DEUDAS Y PAGOS
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS sus
--     pagos (cheques, cuotas, abonos), su historial de cambios de fecha y los
--     gastos que generaron;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--   INGRESOS (fase 5)
--   • facturas por cobrar cuyo cliente, concepto, número o notas empieza con
--     ZZZ-PRUEBA (para VATEX: pon ZZZ-PRUEBA en el CONCEPTO);
--   • abonos recibidos cuyo cliente o notas empieza con ZZZ-PRUEBA (para abonos
--     de VATEX: pon ZZZ-PRUEBA en las NOTAS);
--   • ventas directas cuya feria o notas empieza con ZZZ-PRUEBA;
--   • pagos de "Mi sueldo" cuyas notas empiezan con ZZZ-PRUEBA;
--   • y el ingreso o gasto que generó cada uno.
--
-- Borra en el orden que exigen las reglas de la base (gastos e ingresos →
-- historial → pagos → deudas), así nada queda huérfano.
--
-- Seguridad: si algo de prueba está mezclado con datos reales, NO BORRA NADA
-- y dice qué corregir. Y al final revisa que nada real quede descuadrado
-- (que tu sueldo o lo que te debe un cliente no quede negativo); si pasaría,
-- tampoco borra nada.
--
-- Un solo bloque: todo o nada. Repetible. Al final, una verificación que
-- debe salir toda en 0.
-- Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- ============================================================

do $limpieza$
declare
  v_deudas   uuid[];
  v_cheques  uuid[];
  v_movs     uuid[];
  v_cuentas  uuid[];
  v_facturas uuid[];
  v_cobros   uuid[];
  v_ventas   uuid[];
  v_pagos_s  uuid[];
  v_txt      text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_sal int; n_cue int;
  n_fac int; n_cob int; n_ven int; n_pag int;
begin
  -- ---------------- qué es de prueba ----------------
  v_deudas := coalesce((select array_agg(id) from cuentas_por_pagar
                         where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), '{}');

  v_cheques := coalesce((select array_agg(id) from cheques
                          where cuenta_por_pagar_id = any (v_deudas)
                             or (cuenta_por_pagar_id is null
                                 and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'))), '{}');

  v_facturas := coalesce((select array_agg(id) from cuentas_por_cobrar
                           where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
                              or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_cobros := coalesce((select array_agg(id) from cobros
                         where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_ventas := coalesce((select array_agg(id) from ventas_directas
                         where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_pagos_s := coalesce((select array_agg(id) from sueldo_dueno_pagos
                          where notas ilike 'zzz-prueba%'), '{}');

  v_movs := coalesce((select array_agg(id) from movimientos
                       where cheque_id = any (v_cheques)
                          or cuenta_por_pagar_id = any (v_deudas)
                          or cobro_id = any (v_cobros)
                          or venta_directa_id = any (v_ventas)
                          or sueldo_pago_id = any (v_pagos_s)
                          or (cheque_id is null and cuenta_por_pagar_id is null and cobro_id is null
                              and venta_directa_id is null and sueldo_pago_id is null
                              and concepto ilike 'zzz-prueba%')), '{}');

  v_cuentas := coalesce((select array_agg(id) from cuentas_dinero where nombre ilike 'zzz-prueba%'), '{}');

  -- ---------------- protecciones (antes de borrar) ----------------

  -- A) un pago de prueba metido en una deuda REAL
  v_txt := (select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
              from cheques c join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
             where not (c.cuenta_por_pagar_id = any (v_deudas))
               and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%'));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- B) un gasto o ingreso ZZZ-PRUEBA ligado a algo REAL
  v_txt := (select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
              from movimientos m
             where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs)));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- C) pagos REALES que salen de una cuenta de dinero de prueba
  v_txt := (select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
              from cheques c
             where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques)));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- ---------------- borrar, en el orden que exigen las reglas ----------------
  delete from movimientos              where id = any (v_movs);            get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);  get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);         get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);          get diagnostics n_deu  = row_count;
  delete from cobros                   where id = any (v_cobros);          get diagnostics n_cob  = row_count;
  delete from cuentas_por_cobrar       where id = any (v_facturas);        get diagnostics n_fac  = row_count;
  delete from ventas_directas          where id = any (v_ventas);          get diagnostics n_ven  = row_count;
  delete from sueldo_dueno_pagos       where id = any (v_pagos_s);         get diagnostics n_pag  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';         get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);         get diagnostics n_cue  = row_count;

  -- ---------------- protecciones (después de borrar: nada real descuadrado) ----------------

  -- D) un pago de sueldo REAL (sin ZZZ-PRUEBA en las notas) que solo cubría ganancias de prueba
  if (select saldo from v_sueldo_dueno) < 0 then
    raise exception 'No borré nada: tu sueldo quedaría en negativo (%). Hay un pago de sueldo de prueba sin "ZZZ-PRUEBA" en las notas.',
      (select saldo from v_sueldo_dueno);
  end if;

  -- E) un abono REAL que quedaría sin facturas (el cliente "debería" negativo)
  v_txt := (select string_agg(k.cuenta, ', ')
              from (select cuenta, sum(monto) as cobrado from cobros where not anulado group by cuenta) k
              left join (select cuenta, sum(monto) as facturado from cuentas_por_cobrar
                          where not anulada and estado <> 'cobrado' group by cuenta) f on f.cuenta = k.cuenta
             where k.cobrado > coalesce(f.facturado, 0));
  if v_txt is not null then
    raise exception 'No borré nada: quedarían abonos sin facturas en: %. Hay un abono de prueba sin "ZZZ-PRUEBA" en las notas.', v_txt;
  end if;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos/ingresos, % cambios de fecha, % facturas por cobrar, % abonos, % ventas, % pagos de sueldo, % fotos de caja, % cuentas.',
    n_deu, n_chq, n_mov, n_hist, n_fac, n_cob, n_ven, n_pag, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                        as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                        as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                          as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
       or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                       as facturas_prueba,
  (select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')   as abonos_prueba,
  (select count(*) from ventas_directas where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%') as ventas_prueba,
  (select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%')                      as sueldo_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                         as cuentas_prueba;

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
--   DEUDAS Y PAGOS
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS sus
--     pagos (cheques, cuotas, abonos), su historial de cambios de fecha y los
--     gastos que generaron;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--   INGRESOS (fase 5)
--   • facturas por cobrar cuyo cliente, concepto, número o notas empieza con
--     ZZZ-PRUEBA (para VATEX: pon ZZZ-PRUEBA en el CONCEPTO);
--   • abonos recibidos cuyo cliente o notas empieza con ZZZ-PRUEBA (para abonos
--     de VATEX: pon ZZZ-PRUEBA en las NOTAS);
--   • ventas directas cuya feria o notas empieza con ZZZ-PRUEBA;
--   • pagos de "Mi sueldo" cuyas notas empiezan con ZZZ-PRUEBA;
--   • y el ingreso o gasto que generó cada uno.
--
-- Borra en el orden que exigen las reglas de la base (gastos e ingresos →
-- historial → pagos → deudas), así nada queda huérfano.
--
-- Seguridad: si algo de prueba está mezclado con datos reales, NO BORRA NADA
-- y dice qué corregir. Y al final revisa que nada real quede descuadrado
-- (que tu sueldo o lo que te debe un cliente no quede negativo); si pasaría,
-- tampoco borra nada.
--
-- Un solo bloque: todo o nada. Repetible. Al final, una verificación que
-- debe salir toda en 0.
-- Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- ============================================================

do $limpieza$
declare
  v_deudas   uuid[];
  v_cheques  uuid[];
  v_movs     uuid[];
  v_cuentas  uuid[];
  v_facturas uuid[];
  v_cobros   uuid[];
  v_ventas   uuid[];
  v_pagos_s  uuid[];
  v_txt      text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_sal int; n_cue int;
  n_fac int; n_cob int; n_ven int; n_pag int;
begin
  -- ---------------- qué es de prueba ----------------
  v_deudas := coalesce((select array_agg(id) from cuentas_por_pagar
                         where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), '{}');

  v_cheques := coalesce((select array_agg(id) from cheques
                          where cuenta_por_pagar_id = any (v_deudas)
                             or (cuenta_por_pagar_id is null
                                 and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'))), '{}');

  v_facturas := coalesce((select array_agg(id) from cuentas_por_cobrar
                           where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
                              or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_cobros := coalesce((select array_agg(id) from cobros
                         where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_ventas := coalesce((select array_agg(id) from ventas_directas
                         where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_pagos_s := coalesce((select array_agg(id) from sueldo_dueno_pagos
                          where notas ilike 'zzz-prueba%'), '{}');

  v_movs := coalesce((select array_agg(id) from movimientos
                       where cheque_id = any (v_cheques)
                          or cuenta_por_pagar_id = any (v_deudas)
                          or cobro_id = any (v_cobros)
                          or venta_directa_id = any (v_ventas)
                          or sueldo_pago_id = any (v_pagos_s)
                          or (cheque_id is null and cuenta_por_pagar_id is null and cobro_id is null
                              and venta_directa_id is null and sueldo_pago_id is null
                              and concepto ilike 'zzz-prueba%')), '{}');

  v_cuentas := coalesce((select array_agg(id) from cuentas_dinero where nombre ilike 'zzz-prueba%'), '{}');

  -- ---------------- protecciones (antes de borrar) ----------------

  -- A) un pago de prueba metido en una deuda REAL
  v_txt := (select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
              from cheques c join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
             where not (c.cuenta_por_pagar_id = any (v_deudas))
               and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%'));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- B) un gasto o ingreso ZZZ-PRUEBA ligado a algo REAL
  v_txt := (select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
              from movimientos m
             where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs)));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- C) pagos REALES que salen de una cuenta de dinero de prueba
  v_txt := (select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
              from cheques c
             where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques)));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- ---------------- borrar, en el orden que exigen las reglas ----------------
  delete from movimientos              where id = any (v_movs);            get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);  get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);         get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);          get diagnostics n_deu  = row_count;
  delete from cobros                   where id = any (v_cobros);          get diagnostics n_cob  = row_count;
  delete from cuentas_por_cobrar       where id = any (v_facturas);        get diagnostics n_fac  = row_count;
  delete from ventas_directas          where id = any (v_ventas);          get diagnostics n_ven  = row_count;
  delete from sueldo_dueno_pagos       where id = any (v_pagos_s);         get diagnostics n_pag  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';         get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);         get diagnostics n_cue  = row_count;

  -- ---------------- protecciones (después de borrar: nada real descuadrado) ----------------

  -- D) un pago de sueldo REAL (sin ZZZ-PRUEBA en las notas) que solo cubría ganancias de prueba
  if (select saldo from v_sueldo_dueno) < 0 then
    raise exception 'No borré nada: tu sueldo quedaría en negativo (%). Hay un pago de sueldo de prueba sin "ZZZ-PRUEBA" en las notas.',
      (select saldo from v_sueldo_dueno);
  end if;

  -- E) un abono REAL que quedaría sin facturas (el cliente "debería" negativo)
  v_txt := (select string_agg(k.cuenta, ', ')
              from (select cuenta, sum(monto) as cobrado from cobros where not anulado group by cuenta) k
              left join (select cuenta, sum(monto) as facturado from cuentas_por_cobrar
                          where not anulada and estado <> 'cobrado' group by cuenta) f on f.cuenta = k.cuenta
             where k.cobrado > coalesce(f.facturado, 0));
  if v_txt is not null then
    raise exception 'No borré nada: quedarían abonos sin facturas en: %. Hay un abono de prueba sin "ZZZ-PRUEBA" en las notas.', v_txt;
  end if;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos/ingresos, % cambios de fecha, % facturas por cobrar, % abonos, % ventas, % pagos de sueldo, % fotos de caja, % cuentas.',
    n_deu, n_chq, n_mov, n_hist, n_fac, n_cob, n_ven, n_pag, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                        as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                        as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                          as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
       or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                       as facturas_prueba,
  (select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')   as abonos_prueba,
  (select count(*) from ventas_directas where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%') as ventas_prueba,
  (select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%')                      as sueldo_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                         as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección B: borró aunque había un gasto ZZZ-PRUEBA ligado a una deuda real';
  exception when others then
    if sqlerrm not ilike '%No borré nada%gastos ZZZ-PRUEBA ligados%' then
      v_fallas := v_fallas || E'\n• protección B: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- C) pago real que sale de una cuenta de dinero ZZZ-PRUEBA
  begin
    insert into cuentas_dinero (id, nombre) values (v_ctz2, 'ZZZ-PRUEBA Banco 2');
    update cheques set cuenta_origen_id = v_ctz2 where cuenta_por_pagar_id = v_real and numero = '3';
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   DEUDAS Y PAGOS
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS sus
--     pagos (cheques, cuotas, abonos), su historial de cambios de fecha y los
--     gastos que generaron;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--   INGRESOS (fase 5)
--   • facturas por cobrar cuyo cliente, concepto, número o notas empieza con
--     ZZZ-PRUEBA (para VATEX: pon ZZZ-PRUEBA en el CONCEPTO);
--   • abonos recibidos cuyo cliente o notas empieza con ZZZ-PRUEBA (para abonos
--     de VATEX: pon ZZZ-PRUEBA en las NOTAS);
--   • ventas directas cuya feria o notas empieza con ZZZ-PRUEBA;
--   • pagos de "Mi sueldo" cuyas notas empiezan con ZZZ-PRUEBA;
--   • y el ingreso o gasto que generó cada uno.
--
-- Borra en el orden que exigen las reglas de la base (gastos e ingresos →
-- historial → pagos → deudas), así nada queda huérfano.
--
-- Seguridad: si algo de prueba está mezclado con datos reales, NO BORRA NADA
-- y dice qué corregir. Y al final revisa que nada real quede descuadrado
-- (que tu sueldo o lo que te debe un cliente no quede negativo); si pasaría,
-- tampoco borra nada.
--
-- Un solo bloque: todo o nada. Repetible. Al final, una verificación que
-- debe salir toda en 0.
-- Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- ============================================================

do $limpieza$
declare
  v_deudas   uuid[];
  v_cheques  uuid[];
  v_movs     uuid[];
  v_cuentas  uuid[];
  v_facturas uuid[];
  v_cobros   uuid[];
  v_ventas   uuid[];
  v_pagos_s  uuid[];
  v_txt      text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_sal int; n_cue int;
  n_fac int; n_cob int; n_ven int; n_pag int;
begin
  -- ---------------- qué es de prueba ----------------
  v_deudas := coalesce((select array_agg(id) from cuentas_por_pagar
                         where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), '{}');

  v_cheques := coalesce((select array_agg(id) from cheques
                          where cuenta_por_pagar_id = any (v_deudas)
                             or (cuenta_por_pagar_id is null
                                 and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'))), '{}');

  v_facturas := coalesce((select array_agg(id) from cuentas_por_cobrar
                           where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
                              or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_cobros := coalesce((select array_agg(id) from cobros
                         where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_ventas := coalesce((select array_agg(id) from ventas_directas
                         where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_pagos_s := coalesce((select array_agg(id) from sueldo_dueno_pagos
                          where notas ilike 'zzz-prueba%'), '{}');

  v_movs := coalesce((select array_agg(id) from movimientos
                       where cheque_id = any (v_cheques)
                          or cuenta_por_pagar_id = any (v_deudas)
                          or cobro_id = any (v_cobros)
                          or venta_directa_id = any (v_ventas)
                          or sueldo_pago_id = any (v_pagos_s)
                          or (cheque_id is null and cuenta_por_pagar_id is null and cobro_id is null
                              and venta_directa_id is null and sueldo_pago_id is null
                              and concepto ilike 'zzz-prueba%')), '{}');

  v_cuentas := coalesce((select array_agg(id) from cuentas_dinero where nombre ilike 'zzz-prueba%'), '{}');

  -- ---------------- protecciones (antes de borrar) ----------------

  -- A) un pago de prueba metido en una deuda REAL
  v_txt := (select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
              from cheques c join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
             where not (c.cuenta_por_pagar_id = any (v_deudas))
               and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%'));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- B) un gasto o ingreso ZZZ-PRUEBA ligado a algo REAL
  v_txt := (select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
              from movimientos m
             where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs)));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- C) pagos REALES que salen de una cuenta de dinero de prueba
  v_txt := (select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
              from cheques c
             where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques)));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- ---------------- borrar, en el orden que exigen las reglas ----------------
  delete from movimientos              where id = any (v_movs);            get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);  get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);         get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);          get diagnostics n_deu  = row_count;
  delete from cobros                   where id = any (v_cobros);          get diagnostics n_cob  = row_count;
  delete from cuentas_por_cobrar       where id = any (v_facturas);        get diagnostics n_fac  = row_count;
  delete from ventas_directas          where id = any (v_ventas);          get diagnostics n_ven  = row_count;
  delete from sueldo_dueno_pagos       where id = any (v_pagos_s);         get diagnostics n_pag  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';         get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);         get diagnostics n_cue  = row_count;

  -- ---------------- protecciones (después de borrar: nada real descuadrado) ----------------

  -- D) un pago de sueldo REAL (sin ZZZ-PRUEBA en las notas) que solo cubría ganancias de prueba
  if (select saldo from v_sueldo_dueno) < 0 then
    raise exception 'No borré nada: tu sueldo quedaría en negativo (%). Hay un pago de sueldo de prueba sin "ZZZ-PRUEBA" en las notas.',
      (select saldo from v_sueldo_dueno);
  end if;

  -- E) un abono REAL que quedaría sin facturas (el cliente "debería" negativo)
  v_txt := (select string_agg(k.cuenta, ', ')
              from (select cuenta, sum(monto) as cobrado from cobros where not anulado group by cuenta) k
              left join (select cuenta, sum(monto) as facturado from cuentas_por_cobrar
                          where not anulada and estado <> 'cobrado' group by cuenta) f on f.cuenta = k.cuenta
             where k.cobrado > coalesce(f.facturado, 0));
  if v_txt is not null then
    raise exception 'No borré nada: quedarían abonos sin facturas en: %. Hay un abono de prueba sin "ZZZ-PRUEBA" en las notas.', v_txt;
  end if;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos/ingresos, % cambios de fecha, % facturas por cobrar, % abonos, % ventas, % pagos de sueldo, % fotos de caja, % cuentas.',
    n_deu, n_chq, n_mov, n_hist, n_fac, n_cob, n_ven, n_pag, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                        as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                        as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                          as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
       or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                       as facturas_prueba,
  (select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')   as abonos_prueba,
  (select count(*) from ventas_directas where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%') as ventas_prueba,
  (select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%')                      as sueldo_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                         as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección C: borró una cuenta de prueba de la que salen pagos reales';
  exception when others then
    if sqlerrm not ilike '%No borré nada%salen de una cuenta ZZZ-PRUEBA%' then
      v_fallas := v_fallas || E'\n• protección C: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- D) un pago de sueldo SIN "ZZZ-PRUEBA" que solo cubría ganancias de prueba
  begin
    perform registrar_venta_directa(gen_random_uuid(), 'feria', 100, 20, '2020-01-20', 'ZZZ-PRUEBA Feria D');
    v_x := (select saldo from v_sueldo_dueno);
    perform pagar_mi_sueldo(gen_random_uuid(), v_x, '2026-10-12', 'efectivo', 'pago olvidé marcar');
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   DEUDAS Y PAGOS
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS sus
--     pagos (cheques, cuotas, abonos), su historial de cambios de fecha y los
--     gastos que generaron;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--   INGRESOS (fase 5)
--   • facturas por cobrar cuyo cliente, concepto, número o notas empieza con
--     ZZZ-PRUEBA (para VATEX: pon ZZZ-PRUEBA en el CONCEPTO);
--   • abonos recibidos cuyo cliente o notas empieza con ZZZ-PRUEBA (para abonos
--     de VATEX: pon ZZZ-PRUEBA en las NOTAS);
--   • ventas directas cuya feria o notas empieza con ZZZ-PRUEBA;
--   • pagos de "Mi sueldo" cuyas notas empiezan con ZZZ-PRUEBA;
--   • y el ingreso o gasto que generó cada uno.
--
-- Borra en el orden que exigen las reglas de la base (gastos e ingresos →
-- historial → pagos → deudas), así nada queda huérfano.
--
-- Seguridad: si algo de prueba está mezclado con datos reales, NO BORRA NADA
-- y dice qué corregir. Y al final revisa que nada real quede descuadrado
-- (que tu sueldo o lo que te debe un cliente no quede negativo); si pasaría,
-- tampoco borra nada.
--
-- Un solo bloque: todo o nada. Repetible. Al final, una verificación que
-- debe salir toda en 0.
-- Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- ============================================================

do $limpieza$
declare
  v_deudas   uuid[];
  v_cheques  uuid[];
  v_movs     uuid[];
  v_cuentas  uuid[];
  v_facturas uuid[];
  v_cobros   uuid[];
  v_ventas   uuid[];
  v_pagos_s  uuid[];
  v_txt      text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_sal int; n_cue int;
  n_fac int; n_cob int; n_ven int; n_pag int;
begin
  -- ---------------- qué es de prueba ----------------
  v_deudas := coalesce((select array_agg(id) from cuentas_por_pagar
                         where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), '{}');

  v_cheques := coalesce((select array_agg(id) from cheques
                          where cuenta_por_pagar_id = any (v_deudas)
                             or (cuenta_por_pagar_id is null
                                 and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'))), '{}');

  v_facturas := coalesce((select array_agg(id) from cuentas_por_cobrar
                           where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
                              or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_cobros := coalesce((select array_agg(id) from cobros
                         where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_ventas := coalesce((select array_agg(id) from ventas_directas
                         where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_pagos_s := coalesce((select array_agg(id) from sueldo_dueno_pagos
                          where notas ilike 'zzz-prueba%'), '{}');

  v_movs := coalesce((select array_agg(id) from movimientos
                       where cheque_id = any (v_cheques)
                          or cuenta_por_pagar_id = any (v_deudas)
                          or cobro_id = any (v_cobros)
                          or venta_directa_id = any (v_ventas)
                          or sueldo_pago_id = any (v_pagos_s)
                          or (cheque_id is null and cuenta_por_pagar_id is null and cobro_id is null
                              and venta_directa_id is null and sueldo_pago_id is null
                              and concepto ilike 'zzz-prueba%')), '{}');

  v_cuentas := coalesce((select array_agg(id) from cuentas_dinero where nombre ilike 'zzz-prueba%'), '{}');

  -- ---------------- protecciones (antes de borrar) ----------------

  -- A) un pago de prueba metido en una deuda REAL
  v_txt := (select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
              from cheques c join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
             where not (c.cuenta_por_pagar_id = any (v_deudas))
               and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%'));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- B) un gasto o ingreso ZZZ-PRUEBA ligado a algo REAL
  v_txt := (select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
              from movimientos m
             where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs)));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- C) pagos REALES que salen de una cuenta de dinero de prueba
  v_txt := (select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
              from cheques c
             where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques)));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- ---------------- borrar, en el orden que exigen las reglas ----------------
  delete from movimientos              where id = any (v_movs);            get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);  get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);         get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);          get diagnostics n_deu  = row_count;
  delete from cobros                   where id = any (v_cobros);          get diagnostics n_cob  = row_count;
  delete from cuentas_por_cobrar       where id = any (v_facturas);        get diagnostics n_fac  = row_count;
  delete from ventas_directas          where id = any (v_ventas);          get diagnostics n_ven  = row_count;
  delete from sueldo_dueno_pagos       where id = any (v_pagos_s);         get diagnostics n_pag  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';         get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);         get diagnostics n_cue  = row_count;

  -- ---------------- protecciones (después de borrar: nada real descuadrado) ----------------

  -- D) un pago de sueldo REAL (sin ZZZ-PRUEBA en las notas) que solo cubría ganancias de prueba
  if (select saldo from v_sueldo_dueno) < 0 then
    raise exception 'No borré nada: tu sueldo quedaría en negativo (%). Hay un pago de sueldo de prueba sin "ZZZ-PRUEBA" en las notas.',
      (select saldo from v_sueldo_dueno);
  end if;

  -- E) un abono REAL que quedaría sin facturas (el cliente "debería" negativo)
  v_txt := (select string_agg(k.cuenta, ', ')
              from (select cuenta, sum(monto) as cobrado from cobros where not anulado group by cuenta) k
              left join (select cuenta, sum(monto) as facturado from cuentas_por_cobrar
                          where not anulada and estado <> 'cobrado' group by cuenta) f on f.cuenta = k.cuenta
             where k.cobrado > coalesce(f.facturado, 0));
  if v_txt is not null then
    raise exception 'No borré nada: quedarían abonos sin facturas en: %. Hay un abono de prueba sin "ZZZ-PRUEBA" en las notas.', v_txt;
  end if;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos/ingresos, % cambios de fecha, % facturas por cobrar, % abonos, % ventas, % pagos de sueldo, % fotos de caja, % cuentas.',
    n_deu, n_chq, n_mov, n_hist, n_fac, n_cob, n_ven, n_pag, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                        as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                        as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                          as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
       or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                       as facturas_prueba,
  (select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')   as abonos_prueba,
  (select count(*) from ventas_directas where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%') as ventas_prueba,
  (select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%')                      as sueldo_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                         as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección D: borró y tu sueldo real quedó en negativo';
  exception when others then
    if sqlerrm not ilike '%No borré nada%sueldo quedaría en negativo%' then
      v_fallas := v_fallas || E'\n• protección D: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- E) un abono de VATEX SIN "ZZZ-PRUEBA" que solo cubría una factura de prueba
  begin
    insert into cuentas_por_cobrar (cliente, es_vatex, concepto, monto, fecha_factura)
    values ('VATEX', true, 'ZZZ-PRUEBA liquidación E', 5000, '2020-01-02');
    v_x := (select saldo from v_cxc_cuentas where cuenta = 'vatex');
    perform registrar_cobro(gen_random_uuid(), null, true, v_x, '2026-10-12', 'transferencia', 'abono olvidé marcar');
    execute $archivo$
-- Panorama — Finanzas · LIMPIEZA de datos de prueba "ZZZ-PRUEBA"
-- ============================================================
-- Borra TODO lo que se creó para probar, identificado porque su nombre
-- empieza con ZZZ-PRUEBA (mayúsculas o minúsculas da igual):
--   DEUDAS Y PAGOS
--   • deudas cuyo proveedor O concepto empieza con ZZZ-PRUEBA, con TODOS sus
--     pagos (cheques, cuotas, abonos), su historial de cambios de fecha y los
--     gastos que generaron;
--   • pagos sueltos (sin deuda) cuyo beneficiario o notas empiezan con ZZZ-PRUEBA;
--   • gastos sueltos cuyo concepto empieza con ZZZ-PRUEBA;
--   • cuentas de dinero cuyo nombre empieza con ZZZ-PRUEBA y sus fotos de saldo.
--   INGRESOS (fase 5)
--   • facturas por cobrar cuyo cliente, concepto, número o notas empieza con
--     ZZZ-PRUEBA (para VATEX: pon ZZZ-PRUEBA en el CONCEPTO);
--   • abonos recibidos cuyo cliente o notas empieza con ZZZ-PRUEBA (para abonos
--     de VATEX: pon ZZZ-PRUEBA en las NOTAS);
--   • ventas directas cuya feria o notas empieza con ZZZ-PRUEBA;
--   • pagos de "Mi sueldo" cuyas notas empiezan con ZZZ-PRUEBA;
--   • y el ingreso o gasto que generó cada uno.
--
-- Borra en el orden que exigen las reglas de la base (gastos e ingresos →
-- historial → pagos → deudas), así nada queda huérfano.
--
-- Seguridad: si algo de prueba está mezclado con datos reales, NO BORRA NADA
-- y dice qué corregir. Y al final revisa que nada real quede descuadrado
-- (que tu sueldo o lo que te debe un cliente no quede negativo); si pasaría,
-- tampoco borra nada.
--
-- Un solo bloque: todo o nada. Repetible. Al final, una verificación que
-- debe salir toda en 0.
-- Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- ============================================================

do $limpieza$
declare
  v_deudas   uuid[];
  v_cheques  uuid[];
  v_movs     uuid[];
  v_cuentas  uuid[];
  v_facturas uuid[];
  v_cobros   uuid[];
  v_ventas   uuid[];
  v_pagos_s  uuid[];
  v_txt      text;
  n_mov int; n_hist int; n_chq int; n_deu int; n_sal int; n_cue int;
  n_fac int; n_cob int; n_ven int; n_pag int;
begin
  -- ---------------- qué es de prueba ----------------
  v_deudas := coalesce((select array_agg(id) from cuentas_por_pagar
                         where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'), '{}');

  v_cheques := coalesce((select array_agg(id) from cheques
                          where cuenta_por_pagar_id = any (v_deudas)
                             or (cuenta_por_pagar_id is null
                                 and (beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'))), '{}');

  v_facturas := coalesce((select array_agg(id) from cuentas_por_cobrar
                           where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
                              or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_cobros := coalesce((select array_agg(id) from cobros
                         where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_ventas := coalesce((select array_agg(id) from ventas_directas
                         where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%'), '{}');

  v_pagos_s := coalesce((select array_agg(id) from sueldo_dueno_pagos
                          where notas ilike 'zzz-prueba%'), '{}');

  v_movs := coalesce((select array_agg(id) from movimientos
                       where cheque_id = any (v_cheques)
                          or cuenta_por_pagar_id = any (v_deudas)
                          or cobro_id = any (v_cobros)
                          or venta_directa_id = any (v_ventas)
                          or sueldo_pago_id = any (v_pagos_s)
                          or (cheque_id is null and cuenta_por_pagar_id is null and cobro_id is null
                              and venta_directa_id is null and sueldo_pago_id is null
                              and concepto ilike 'zzz-prueba%')), '{}');

  v_cuentas := coalesce((select array_agg(id) from cuentas_dinero where nombre ilike 'zzz-prueba%'), '{}');

  -- ---------------- protecciones (antes de borrar) ----------------

  -- A) un pago de prueba metido en una deuda REAL
  v_txt := (select string_agg(format('"%s" en la deuda real "%s"', c.beneficiario, d.proveedor), '; ')
              from cheques c join cuentas_por_pagar d on d.id = c.cuenta_por_pagar_id
             where not (c.cuenta_por_pagar_id = any (v_deudas))
               and (c.beneficiario ilike 'zzz-prueba%' or c.notas ilike 'zzz-prueba%'));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos ZZZ-PRUEBA dentro de deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- B) un gasto o ingreso ZZZ-PRUEBA ligado a algo REAL
  v_txt := (select string_agg(format('"%s" (%s)', m.concepto, m.fecha), '; ')
              from movimientos m
             where m.concepto ilike 'zzz-prueba%' and not (m.id = any (v_movs)));
  if v_txt is not null then
    raise exception 'No borré nada: hay gastos ZZZ-PRUEBA ligados a pagos o deudas REALES: %. Hay que revisarlos a mano.', v_txt;
  end if;

  -- C) pagos REALES que salen de una cuenta de dinero de prueba
  v_txt := (select string_agg(format('"%s" %s', c.beneficiario, c.monto), '; ')
              from cheques c
             where c.cuenta_origen_id = any (v_cuentas) and not (c.id = any (v_cheques)));
  if v_txt is not null then
    raise exception 'No borré nada: hay pagos REALES que salen de una cuenta ZZZ-PRUEBA: %. Cámbiales la cuenta primero.', v_txt;
  end if;

  -- ---------------- borrar, en el orden que exigen las reglas ----------------
  delete from movimientos              where id = any (v_movs);            get diagnostics n_mov  = row_count;
  delete from cheques_reprogramaciones where cheque_id = any (v_cheques);  get diagnostics n_hist = row_count;
  delete from cheques                  where id = any (v_cheques);         get diagnostics n_chq  = row_count;
  delete from cuentas_por_pagar        where id = any (v_deudas);          get diagnostics n_deu  = row_count;
  delete from cobros                   where id = any (v_cobros);          get diagnostics n_cob  = row_count;
  delete from cuentas_por_cobrar       where id = any (v_facturas);        get diagnostics n_fac  = row_count;
  delete from ventas_directas          where id = any (v_ventas);          get diagnostics n_ven  = row_count;
  delete from sueldo_dueno_pagos       where id = any (v_pagos_s);         get diagnostics n_pag  = row_count;
  delete from saldos_caja
   where cuenta_id = any (v_cuentas) or notas ilike 'zzz-prueba%';         get diagnostics n_sal  = row_count;
  delete from cuentas_dinero           where id = any (v_cuentas);         get diagnostics n_cue  = row_count;

  -- ---------------- protecciones (después de borrar: nada real descuadrado) ----------------

  -- D) un pago de sueldo REAL (sin ZZZ-PRUEBA en las notas) que solo cubría ganancias de prueba
  if (select saldo from v_sueldo_dueno) < 0 then
    raise exception 'No borré nada: tu sueldo quedaría en negativo (%). Hay un pago de sueldo de prueba sin "ZZZ-PRUEBA" en las notas.',
      (select saldo from v_sueldo_dueno);
  end if;

  -- E) un abono REAL que quedaría sin facturas (el cliente "debería" negativo)
  v_txt := (select string_agg(k.cuenta, ', ')
              from (select cuenta, sum(monto) as cobrado from cobros where not anulado group by cuenta) k
              left join (select cuenta, sum(monto) as facturado from cuentas_por_cobrar
                          where not anulada and estado <> 'cobrado' group by cuenta) f on f.cuenta = k.cuenta
             where k.cobrado > coalesce(f.facturado, 0));
  if v_txt is not null then
    raise exception 'No borré nada: quedarían abonos sin facturas en: %. Hay un abono de prueba sin "ZZZ-PRUEBA" en las notas.', v_txt;
  end if;

  raise notice 'Limpieza ZZZ-PRUEBA: % deudas, % pagos, % gastos/ingresos, % cambios de fecha, % facturas por cobrar, % abonos, % ventas, % pagos de sueldo, % fotos de caja, % cuentas.',
    n_deu, n_chq, n_mov, n_hist, n_fac, n_cob, n_ven, n_pag, n_sal, n_cue;
end
$limpieza$;

-- Verificación (solo lectura): todo debe salir en 0
select
  (select count(*) from cuentas_por_pagar
    where proveedor ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%')                        as deudas_prueba,
  (select count(*) from cheques
    where beneficiario ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                        as pagos_prueba,
  (select count(*) from movimientos where concepto ilike 'zzz-prueba%')                          as gastos_prueba,
  (select count(*) from cuentas_por_cobrar
    where cliente ilike 'zzz-prueba%' or concepto ilike 'zzz-prueba%'
       or numero_factura ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')                       as facturas_prueba,
  (select count(*) from cobros where cliente ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%')   as abonos_prueba,
  (select count(*) from ventas_directas where evento ilike 'zzz-prueba%' or notas ilike 'zzz-prueba%') as ventas_prueba,
  (select count(*) from sueldo_dueno_pagos where notas ilike 'zzz-prueba%')                      as sueldo_prueba,
  (select count(*) from cuentas_dinero where nombre ilike 'zzz-prueba%')                         as cuentas_prueba;

$archivo$;
    v_fallas := v_fallas || E'\n• protección E: borró y quedaron abonos de VATEX sin facturas';
  exception when others then
    if sqlerrm not ilike '%No borré nada%abonos sin facturas%' then
      v_fallas := v_fallas || E'\n• protección E: error inesperado → ' || sqlerrm;
    end if;
  end;

  -- ##########################################################
  -- 6) Resultado: siempre termina con error para que NADA se guarde
  -- ##########################################################
  if v_fallas <> '' then
    raise exception E'PRUEBA FALLÓ - se deshace todo. Fallaron:%', v_fallas;
  end if;
  raise exception 'PRUEBA OK - se deshace todo (borró todo lo ZZZ-PRUEBA, no tocó lo real, y las 5 protecciones frenaron la limpieza cuando había mezcla)';
end
$prueba$;
