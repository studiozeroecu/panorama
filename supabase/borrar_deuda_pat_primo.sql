-- ============================================================
-- Borrar la deuda "Pat primo" ($3.430,90), que se registró mal.
--
-- Se puede borrar de verdad (y no solo anular) porque NO tiene ningún
-- pago hecho: todos sus pagos siguen pendientes y no hay ningún gasto
-- ligado. Si encuentra algo pagado, se detiene y no borra nada.
--
-- Cómo usarlo:
--   1) Ejecútalo tal cual (modo prueba). Debe terminar con el mensaje
--      "PRUEBA OK ..." en rojo: eso es bueno, NO borró nada.
--   2) Cambia  v_modo_prueba boolean := true  por  false  y ejecútalo otra vez.
--      Esa vez sí borra.
--
-- Un solo bloque: o se borra todo (deuda + sus pagos + su historial de
-- fechas) o no se borra nada.
-- ============================================================
do $borrar$
declare
  v_modo_prueba boolean := true;      -- <<< cambiar a false para borrar de verdad

  v_cuantas   integer;
  v_deuda     uuid;
  v_pagados   integer;
  v_gastos    integer;
  v_pagos     integer;
  v_historial integer;
begin
  -- 1) Encontrar la deuda: tiene que ser UNA sola
  v_cuantas := (select count(*) from cuentas_por_pagar
                 where lower(btrim(proveedor)) = 'pat primo'
                   and monto = 3430.90
                   and not anulada);
  if v_cuantas = 0 then
    raise exception 'No encontré la deuda de Pat primo por $3.430,90. No se borró nada.';
  end if;
  if v_cuantas > 1 then
    raise exception 'Hay % deudas de Pat primo por $3.430,90. No se borró nada: avísale a Claude.', v_cuantas;
  end if;
  v_deuda := (select id from cuentas_por_pagar
               where lower(btrim(proveedor)) = 'pat primo'
                 and monto = 3430.90
                 and not anulada);

  -- 2) Protecciones: nada pagado, ningún gasto ligado
  v_pagados := (select count(*) from cheques
                 where cuenta_por_pagar_id = v_deuda
                   and estado in ('pagado', 'cobrado'));
  v_gastos := (select count(*) from movimientos
                where cuenta_por_pagar_id = v_deuda
                   or cheque_id in (select id from cheques where cuenta_por_pagar_id = v_deuda));
  if v_pagados > 0 or v_gastos > 0 then
    raise exception 'Esta deuda ya tiene % pago(s) hechos y % gasto(s) registrados. No se borra: hay que anularla.', v_pagados, v_gastos;
  end if;

  v_pagos := (select count(*) from cheques where cuenta_por_pagar_id = v_deuda);
  v_historial := (select count(*) from cheques_reprogramaciones
                   where cheque_id in (select id from cheques where cuenta_por_pagar_id = v_deuda));

  -- 3) Borrar: primero el historial de fechas, después los pagos, al final la deuda
  delete from cheques_reprogramaciones
   where cheque_id in (select id from cheques where cuenta_por_pagar_id = v_deuda);
  delete from cheques where cuenta_por_pagar_id = v_deuda;
  delete from cuentas_por_pagar where id = v_deuda;

  if exists (select 1 from cuentas_por_pagar where id = v_deuda)
     or exists (select 1 from cheques where cuenta_por_pagar_id = v_deuda) then
    raise exception 'Algo quedó sin borrar. Se deshace todo.';
  end if;

  if v_modo_prueba then
    raise exception 'PRUEBA OK - se deshace todo. Se borraría la deuda de Pat primo con % pago(s) pendientes y % cambio(s) de fecha. Cambia v_modo_prueba a false para borrar de verdad.', v_pagos, v_historial;
  end if;

  raise notice 'Listo: deuda de Pat primo borrada con % pago(s) pendientes.', v_pagos;
end
$borrar$;
