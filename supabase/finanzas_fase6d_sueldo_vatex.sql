-- Panorama — Finanzas · Fase 6D "SUELDO DE VATEX" (personal del dueño)
-- ============================================================
-- Ejecutar en el SQL Editor DESPUÉS de finanzas_fase6a_planificacion.sql.
--
-- • UN SOLO bloque DO: todo o nada. Sin begin/commit. Repetible sin daño.
-- • Solo AGREGA dos tablas: no borra ni renombra nada.
-- • Probarlo antes con finanzas_fase6d_sueldo_vatex_prueba_en_seco.sql.
--
-- Qué es: VATEX le paga al dueño un sueldo PERSONAL ($300 al mes), aparte
-- de lo que compra a Bear & Trend. Es plata de él, NO de la empresa: no
-- crea movimientos, no entra a la caja, a los gastos ni a la rentabilidad.
--
-- Lo que se debe NO se guarda: cada mes que ya cumplió su día de pago suma
-- el sueldo vigente ese mes, menos los pagos recibidos (el más antiguo
-- primero). Lo calcula la app (src/lib/finanzas/sueldoVatex.ts).
-- ============================================================

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

-- ============================================================
-- RESUMEN EN ESPAÑOL SIMPLE
-- ============================================================
--
-- QUÉ CREA
--  • Una tabla con cuánto te paga VATEX al mes y desde cuándo (si el valor
--    cambia, se agrega otra fila desde ese mes).
--  • Una tabla con cada pago que VATEX te hace de ese sueldo.
--  • Reglas de seguridad: solo el admin las ve y las cambia.
--
-- QUÉ NO CAMBIA
--  • No toca nada de Bear & Trend: ni caja, ni gastos, ni rentabilidad, ni
--    "Mi sueldo" por prendas, ni las facturas de VATEX.
--  • No borra ni renombra nada. Volver a correrlo no cambia tus datos.
