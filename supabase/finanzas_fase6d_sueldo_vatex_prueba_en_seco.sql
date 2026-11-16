-- Panorama — Finanzas · PRUEBA EN SECO de la Fase 6D (sueldo de VATEX) — NO GUARDA NADA
-- ============================================================
-- Un solo bloque DO. Siempre termina con un error a propósito para que
-- Postgres deshaga todo:
--   • "PRUEBA OK - se deshace todo ..." → todo pasó y no se guardó nada.
--   • "PRUEBA FALLÓ ..." o "SQL 6D falló ..." → dice qué falló; tampoco se guardó nada.
--
-- Qué hace: ejecuta finanzas_fase6d_sueldo_vatex.sql DOS veces (prueba que
-- se puede repetir) y corre 10 pruebas con datos de 2020.
-- Pega TODO el archivo en Supabase → SQL Editor → Run. Que salga en rojo es
-- lo esperado: lee el mensaje.
-- Se ARMA a partir de finanzas_fase6d_sueldo_vatex.sql; si ese cambia, se vuelve a armar.
-- ============================================================

do $prueba$
declare
  v_fallas  text := '';
  v_pasaron int  := 0;
  v_ctx     text;
  v_b       boolean;
  v_n       bigint;
  v_d       date;
  v_p1 uuid := gen_random_uuid();
begin
  -- 0) El SQL real, dos veces
  for v_n in 1..2 loop
    begin
      execute $archivo$
do $sueldo_vatex$
begin

-- ============================================================
-- 1) Cuánto paga VATEX, desde qué mes. Una fila por cambio de valor:
--    "desde noviembre 2026, $300, el día 30". Monto 0 = desde ese mes ya
--    no hay sueldo. Los meses anteriores a un cambio no se tocan.
-- ============================================================
create table if not exists sueldo_vatex_tarifas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  desde date not null,
  monto numeric(12,2) not null check (monto >= 0),
  dia_pago integer not null default 31 check (dia_pago between 1 and 31),
  notas text not null default '',
  constraint fin_svt_desde_primero check (extract(day from desde) = 1),
  constraint fin_svt_un_cambio_por_mes unique (desde)
);

-- ============================================================
-- 2) Lo que VATEX le ha pagado. El id lo genera la pantalla al abrir el
--    formulario: si "Guardar" llega dos veces, no se duplica.
-- ============================================================
create table if not exists sueldo_vatex_pagos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null default fn_hoy_ecuador(),
  monto numeric(12,2) not null check (monto > 0),
  notas text not null default ''
);
create index if not exists idx_svp_fecha on sueldo_vatex_pagos (fecha);

-- ============================================================
-- 3) Seguridad: solo admin; nada para anon.
-- ============================================================
alter table sueldo_vatex_tarifas enable row level security;
alter table sueldo_vatex_pagos   enable row level security;

drop policy if exists "admin_all_sueldo_vatex_tarifas" on sueldo_vatex_tarifas;
create policy "admin_all_sueldo_vatex_tarifas" on sueldo_vatex_tarifas
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());
drop policy if exists "admin_all_sueldo_vatex_pagos" on sueldo_vatex_pagos;
create policy "admin_all_sueldo_vatex_pagos" on sueldo_vatex_pagos
  for all to authenticated using (fn_es_admin()) with check (fn_es_admin());

revoke all on table sueldo_vatex_tarifas, sueldo_vatex_pagos from anon;
grant select, insert, update, delete on table sueldo_vatex_tarifas, sueldo_vatex_pagos to authenticated;
grant all on table sueldo_vatex_tarifas, sueldo_vatex_pagos to service_role;

end
$sueldo_vatex$;
$archivo$;
    exception when others then
      get stacked diagnostics v_ctx = pg_exception_context;
      raise exception 'SQL 6D falló en la vuelta %: % (%)', v_n, sqlerrm, v_ctx;
    end;
  end loop;

  -- 1) Las dos tablas existen
  v_b := to_regclass('public.sueldo_vatex_tarifas') is not null and to_regclass('public.sueldo_vatex_pagos') is not null;
  if v_b then v_pasaron := v_pasaron + 1; else v_fallas := v_fallas || E'\n1) faltan tablas'; end if;

  -- 2) RLS activa en las dos
  v_b := (select bool_and(relrowsecurity) from pg_class
           where oid in ('public.sueldo_vatex_tarifas'::regclass, 'public.sueldo_vatex_pagos'::regclass));
  if v_b then v_pasaron := v_pasaron + 1; else v_fallas := v_fallas || E'\n2) RLS apagada'; end if;

  -- 3) Una sola regla de admin en cada una
  v_n := (select count(*) from pg_policies
           where schemaname = 'public'
             and tablename in ('sueldo_vatex_tarifas', 'sueldo_vatex_pagos')
             and policyname like 'admin_all_%');
  if v_n = 2 then v_pasaron := v_pasaron + 1; else v_fallas := v_fallas || E'\n3) reglas de admin: ' || v_n; end if;

  -- 4) anon no puede leer
  v_b := has_table_privilege('anon', 'public.sueldo_vatex_tarifas', 'select')
      or has_table_privilege('anon', 'public.sueldo_vatex_pagos', 'select');
  if not v_b then v_pasaron := v_pasaron + 1; else v_fallas := v_fallas || E'\n4) anon puede leer'; end if;

  -- 5) Se guarda un sueldo válido desde el primer día del mes
  begin
    insert into sueldo_vatex_tarifas (desde, monto, dia_pago, notas) values ('2020-01-01', 300, 30, 'ZZZ-PRUEBA');
    v_pasaron := v_pasaron + 1;
  exception when others then
    v_fallas := v_fallas || E'\n5) no guardó un sueldo válido: ' || sqlerrm;
  end;

  -- 6) "desde" que no es día 1 se rechaza
  begin
    insert into sueldo_vatex_tarifas (desde, monto) values ('2020-02-15', 300);
    v_fallas := v_fallas || E'\n6) aceptó un desde que no es día 1';
  exception when check_violation then
    v_pasaron := v_pasaron + 1;
  end;

  -- 7) Dos cambios el mismo mes se rechazan
  begin
    insert into sueldo_vatex_tarifas (desde, monto) values ('2020-01-01', 350);
    v_fallas := v_fallas || E'\n7) aceptó dos sueldos para el mismo mes';
  exception when unique_violation then
    v_pasaron := v_pasaron + 1;
  end;

  -- 8) Monto negativo se rechaza (0 sí vale: "ya no hay sueldo")
  begin
    insert into sueldo_vatex_tarifas (desde, monto) values ('2020-03-01', -1);
    v_fallas := v_fallas || E'\n8) aceptó un sueldo negativo';
  exception when check_violation then
    v_pasaron := v_pasaron + 1;
  end;

  -- 9) Un pago en 0 se rechaza
  begin
    insert into sueldo_vatex_pagos (monto) values (0);
    v_fallas := v_fallas || E'\n9) aceptó un pago en 0';
  exception when check_violation then
    v_pasaron := v_pasaron + 1;
  end;

  -- 10) Un pago sin fecha queda con la fecha de hoy en Ecuador
  insert into sueldo_vatex_pagos (id, monto, notas) values (v_p1, 300, 'ZZZ-PRUEBA');
  v_d := (select fecha from sueldo_vatex_pagos where id = v_p1);
  if v_d = fn_hoy_ecuador() then v_pasaron := v_pasaron + 1;
  else v_fallas := v_fallas || E'\n10) fecha por defecto: ' || coalesce(v_d::text, 'vacía'); end if;

  if v_fallas <> '' then
    raise exception 'PRUEBA FALLÓ (% de 10 pasaron):%', v_pasaron, v_fallas;
  end if;
  raise exception 'PRUEBA OK - se deshace todo (% de 10 pruebas pasaron, no se guardó nada)', v_pasaron;
end
$prueba$;
