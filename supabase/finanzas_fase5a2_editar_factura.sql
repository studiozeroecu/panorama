-- Panorama — Finanzas · Fase 5A-2 "EDITAR FACTURAS POR COBRAR"
-- ============================================================
-- Ejecutar en el SQL Editor DESPUÉS de finanzas_fase5a_ingresos.sql.
--
-- • UN SOLO bloque DO: todo o nada. Sin begin/commit. Repetible sin daño.
-- • Las variables se asignan con  v := (select …)  (regla del SQL Editor).
-- • Probarlo antes con finanzas_fase5a2_editar_factura_prueba_en_seco.sql.
--
-- Por qué existe: para poder EDITAR una factura ya creada (sobre todo para
-- agregarle las prendas y que se sume "Mi sueldo"). Al final hay un resumen
-- en español simple.
-- ============================================================

do $editar$
begin

-- ============================================================
-- 1) Regla de la factura, reescrita (mismo trigger fin_cxc_ganancia):
--    a) Si el cliente se escribió "VATEX" (con cualquier mayúscula o
--       espacios), ES VATEX: así no quedan dos cuentas de VATEX.
--    b) La ganancia por prenda la pone la base y queda congelada... salvo
--       si la factura nunca la tuvo (vale 0: se creó antes de la fase 5A).
--       En ese caso se le pone la tarifa que corresponde.
--    c) Al EDITAR, nunca puede quedar que un cliente te abonó MÁS de lo que
--       le facturaste (al bajar un monto, anular, o cambiar de cliente).
--       Los abonos van a la cuenta, no a una factura: si una factura baja,
--       lo que ya estaba abonado pasa solo a la siguiente factura.
-- ============================================================

create or replace function fn_trg_cxc_ganancia() returns trigger
language plpgsql set search_path = public as
$$
declare
  v_cuenta_vieja text;
  v_cobrado numeric;
  v_facturado numeric;
begin
  -- a) "VATEX" escrito a mano = VATEX
  if lower(btrim(coalesce(new.cliente, ''))) = 'vatex' then
    new.es_vatex := true;
  end if;
  if new.es_vatex then
    new.cliente := 'VATEX';
  end if;

  -- b) tarifa: se pone al crear, si cambia VATEX/no VATEX, o si nunca la tuvo
  if tg_op = 'INSERT'
     or new.es_vatex is distinct from old.es_vatex
     or coalesce(old.ganancia_por_prenda, 0) = 0 then
    new.ganancia_por_prenda := fn_ganancia_por_prenda(new.es_vatex);
  else
    new.ganancia_por_prenda := old.ganancia_por_prenda;
  end if;

  -- c) al editar: lo abonado a la cuenta vieja no puede pasar de lo facturado
  if tg_op = 'UPDATE' then
    v_cuenta_vieja := old.cuenta;
    -- el mismo candado que usa registrar_cobro: un abono y una edición a la vez no se cruzan
    perform pg_advisory_xact_lock(hashtext('fin_cobro:' || v_cuenta_vieja));
    v_cobrado := coalesce((select sum(monto) from cobros where cuenta = v_cuenta_vieja and not anulado), 0);
    v_facturado :=
      coalesce((select sum(monto) from cuentas_por_cobrar
                 where cuenta = v_cuenta_vieja and id <> old.id and not anulada and estado <> 'cobrado'), 0)
      + case
          when not new.anulada and new.estado <> 'cobrado'
               and (case when new.es_vatex then 'vatex' else lower(btrim(new.cliente)) end) = v_cuenta_vieja
          then new.monto
          else 0
        end;
    if v_cobrado > v_facturado then
      raise exception using errcode = '23514',
        message = format('Ya te abonaron %s en esta cuenta y quedaría facturado solo %s: no puede quedar abonado más de lo facturado.',
                         v_cobrado, v_facturado);
    end if;
  end if;

  return new;
end
$$;

-- (el trigger ya existe desde la 5A; se recrea por si acaso, igual)
drop trigger if exists fin_cxc_ganancia on cuentas_por_cobrar;
create trigger fin_cxc_ganancia
  before insert or update on cuentas_por_cobrar
  for each row execute function fn_trg_cxc_ganancia();

revoke all on function fn_trg_cxc_ganancia() from public, anon, authenticated;


-- ============================================================
-- 2) Arreglar las facturas que ya existen
--    • las escritas "VATEX" a mano pasan a ser de VATEX;
--    • las que nunca tuvieron tarifa (creadas antes de la 5A) la reciben.
--    (El "set notas = notas" no cambia nada: solo hace pasar la fila por la
--    regla de arriba.)
-- ============================================================

update cuentas_por_cobrar
   set es_vatex = true
 where lower(btrim(cliente)) = 'vatex' and not es_vatex;

update cuentas_por_cobrar
   set notas = notas
 where ganancia_por_prenda = 0;

end
$editar$;


-- ============================================================
-- RESUMEN EN ESPAÑOL SIMPLE
-- ============================================================
--
-- QUÉ HACE
--  • Permite editar facturas por cobrar con seguridad: al bajar el monto,
--    anular o cambiar de cliente, la base no deja que quede "abonado más de
--    lo facturado". Si una factura baja, lo ya abonado pasa solo a la
--    siguiente (los abonos van a la cuenta, no a una factura).
--  • Si escribes "VATEX" como cliente (como sea), cuenta como VATEX.
--  • Las facturas creadas antes de la fase 5A no tenían tarifa de sueldo
--    ($0): ahora reciben la suya ($2,50 VATEX, $5 los demás). Así, al ponerles
--    prendas, tu sueldo se suma.
--
-- QUÉ NO CAMBIA
--  • Las facturas nuevas siguen con su tarifa congelada del día.
--  • No crea tablas ni columnas, no toca abonos, ventas, sueldo, deudas ni
--    otras áreas.
--  • No toca código de la app (el botón "Editar" va en la pantalla).
