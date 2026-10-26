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
