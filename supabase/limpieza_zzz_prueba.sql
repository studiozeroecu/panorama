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
