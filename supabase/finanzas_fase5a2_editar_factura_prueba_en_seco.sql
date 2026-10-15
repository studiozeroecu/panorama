-- Panorama — Finanzas · PRUEBA EN SECO de la Fase 5A-2 (editar facturas) — NO GUARDA NADA
-- ============================================================
-- Un solo bloque DO que siempre termina con un error a propósito:
--   • "PRUEBA OK - se deshace todo ..." → todo pasó y no se guardó nada.
--   • "PRUEBA FALLÓ ..." o "SQL 5A-2 falló ..." → dice qué falló; nada se guardó.
--
-- Simula facturas "viejas" (creadas antes de la fase 5A, sin tarifa), ejecuta
-- finanzas_fase5a2_editar_factura.sql DOS veces y corre 9 pruebas con datos
-- "ZZZ". Pega TODO el archivo en Supabase → SQL Editor → Run.
-- Se ARMA a partir de finanzas_fase5a2_editar_factura.sql.
-- ============================================================

do $prueba$
declare
  v_fallas  text := '';
  v_pasaron int  := 0;
  v_ctx     text;
  v_viejo_vx uuid := gen_random_uuid();
  v_viejo_cl uuid := gen_random_uuid();
  v_f1 uuid := gen_random_uuid();
  v_f2 uuid := gen_random_uuid();
  v_f3 uuid := gen_random_uuid();
  v_sueldo0 numeric;
  v_admin uuid;
  v_n bigint;
begin
  -- ##########################################################
  -- 0) Facturas "viejas": como las dejó la pantalla anterior (sin tarifa,
  --    VATEX escrito a mano y sin marcar). Se crean con la regla apagada.
  -- ##########################################################
  alter table cuentas_por_cobrar disable trigger fin_cxc_ganancia;
  insert into cuentas_por_cobrar (id, cliente, es_vatex, concepto, monto, fecha_factura, ganancia_por_prenda)
  values (v_viejo_vx, ' vatex ', false, 'ZZZ vieja VATEX', 900, '2019-12-01', 0),
         (v_viejo_cl, 'ZZZ Cliente Viejo', false, 'ZZZ vieja', 60, '2019-12-02', 0);
  alter table cuentas_por_cobrar enable trigger fin_cxc_ganancia;

  -- ##########################################################
  -- 1) SQL 5A-2, primera vez
  -- ##########################################################
  begin
    execute $archivo$
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

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'SQL 5A-2 falló la PRIMERA vez (nada se guardó): % | dónde: %', sqlerrm, v_ctx;
  end;

  -- ##########################################################
  -- 2) SQL 5A-2, segunda vez (debe pasar: es repetible)
  -- ##########################################################
  begin
    execute $archivo$
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

$archivo$;
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    raise exception 'SQL 5A-2 falló la SEGUNDA vez, no es repetible (nada se guardó): % | dónde: %', sqlerrm, v_ctx;
  end;

  v_sueldo0 := (select saldo from v_sueldo_dueno);

  -- ---------------- pruebas ----------------

  begin
    if not coalesce(
         (select es_vatex and cliente = 'VATEX' and cuenta = 'vatex' and ganancia_por_prenda = 2.50
            from cuentas_por_cobrar where id = v_viejo_vx)
         and (select not es_vatex and ganancia_por_prenda = 5.00 from cuentas_por_cobrar where id = v_viejo_cl), false) then
      raise exception 'las facturas viejas no se arreglaron';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 01 facturas viejas: "vatex" a mano pasa a VATEX y reciben su tarifa → ' || sqlerrm;
  end;

  begin
    update cuentas_por_cobrar set prendas = 100 where id = v_viejo_vx;
    if not coalesce(
         (select ganancia_dueno = 250 from v_cxc where id = v_viejo_vx)
         and (select saldo from v_sueldo_dueno) = v_sueldo0 + 250, false) then
      raise exception 'el sueldo no subió $250: %', (select saldo from v_sueldo_dueno) - v_sueldo0;
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 02 ponerle prendas a una factura vieja de VATEX suma tu sueldo → ' || sqlerrm;
  end;

  begin
    insert into cuentas_por_cobrar (id, cliente, concepto, monto, fecha_factura, prendas)
    values (v_f1, 'VaTeX', 'ZZZ nueva', 100, '2019-12-03', 4);
    update cuentas_por_cobrar set ganancia_por_prenda = 99 where id = v_f1;
    if not coalesce((select es_vatex and cliente = 'VATEX' and ganancia_por_prenda = 2.50 from cuentas_por_cobrar where id = v_f1), false) then
      raise exception 'la factura nueva no quedó como VATEX con tarifa congelada';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 03 factura nueva escrita "VaTeX": es VATEX y su tarifa sigue congelada → ' || sqlerrm;
  end;

  begin
    insert into cuentas_por_cobrar (id, cliente, concepto, monto, fecha_factura)
    values (v_f2, 'ZZZ Cliente Editar', 'ZZZ', 100, '2019-12-04');
    perform registrar_cobro(gen_random_uuid(), 'ZZZ Cliente Editar', false, 80, '2026-10-15');
    update cuentas_por_cobrar set monto = 150, concepto = 'ZZZ editada', numero_factura = 'Z-9', notas = 'x' where id = v_f2;
    update cuentas_por_cobrar set monto = 80 where id = v_f2;   -- justo lo abonado: se puede
    if not coalesce((select monto = 80 and saldo = 0 and concepto = 'ZZZ editada' from v_cxc where id = v_f2), false) then
      raise exception 'no quedó editada como se esperaba';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 04 editar monto (subir, o bajar hasta lo abonado), concepto y número → ' || sqlerrm;
  end;

  begin
    update cuentas_por_cobrar set monto = 50 where id = v_f2;
    v_fallas := v_fallas || E'\n• 05 dejó bajar el monto por debajo de lo abonado';
  exception when others then
    if sqlerrm ilike '%abonado más de lo facturado%' then v_pasaron := v_pasaron + 1;
    else v_fallas := v_fallas || E'\n• 05 bajar monto: error inesperado → ' || sqlerrm; end if;
  end;

  begin
    update cuentas_por_cobrar set anulada = true where id = v_f2;
    v_fallas := v_fallas || E'\n• 06 dejó anular una factura que ya tiene abonos';
  exception when others then
    if sqlerrm ilike '%abonado más de lo facturado%' then v_pasaron := v_pasaron + 1;
    else v_fallas := v_fallas || E'\n• 06 anular: error inesperado → ' || sqlerrm; end if;
  end;

  begin
    update cuentas_por_cobrar set cliente = 'ZZZ Otro Cliente' where id = v_f2;
    v_fallas := v_fallas || E'\n• 07 dejó pasar a otro cliente una factura que ya tiene abonos';
  exception when others then
    if sqlerrm ilike '%abonado más de lo facturado%' then v_pasaron := v_pasaron + 1;
    else v_fallas := v_fallas || E'\n• 07 cambiar cliente: error inesperado → ' || sqlerrm; end if;
  end;

  begin
    -- sin abonos sí se puede anular y cambiar de cliente
    insert into cuentas_por_cobrar (id, cliente, concepto, monto, fecha_factura)
    values (v_f3, 'ZZZ Cliente Libre', 'ZZZ', 40, '2019-12-05');
    update cuentas_por_cobrar set cliente = 'ZZZ Cliente Libre 2' where id = v_f3;
    update cuentas_por_cobrar set anulada = true where id = v_f3;
    if not coalesce((select anulada and cuenta = 'zzz cliente libre 2' from cuentas_por_cobrar where id = v_f3), false) then
      raise exception 'no se pudo';
    end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 08 sin abonos se puede cambiar de cliente y anular → ' || sqlerrm;
  end;

  -- como ADMIN desde la app (reglas de seguridad activas)
  v_admin := (select user_id from user_roles where rol = 'admin' limit 1);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(v_admin::text, ''), true);
  set local role authenticated;
  begin
    if v_admin is null or not fn_es_admin() then raise exception 'no encontré un usuario admin'; end if;
    update cuentas_por_cobrar set prendas = 7, notas = 'ZZZ admin' where id = v_f1;
    v_n := (select prendas from cuentas_por_cobrar where id = v_f1);
    if v_n <> 7 then raise exception 'el admin no pudo editar'; end if;
    v_pasaron := v_pasaron + 1;
  exception when others then v_fallas := v_fallas || E'\n• 09 el admin puede editar desde la app → ' || sqlerrm;
  end;
  reset role;

  -- ##########################################################
  -- RESULTADO: siempre termina con error para que NADA se guarde
  -- ##########################################################
  if v_fallas <> '' then
    raise exception E'PRUEBA FALLÓ - se deshace todo. Pasaron % de 9. Fallaron:%', v_pasaron, v_fallas;
  end if;
  if v_pasaron <> 9 then
    raise exception 'PRUEBA INCOMPLETA - se deshace todo. Pasaron % de 9.', v_pasaron;
  end if;
  raise exception 'PRUEBA OK - se deshace todo (9 de 9 pruebas pasaron; el SQL 5A-2 corrió 2 veces sin error)';
end
$prueba$;
