-- Panorama — Corrección: el bot repetía la MISMA alerta de pagos cada mañana.
-- Ejecutar en el SQL Editor (una vez). Es idempotente.
--
-- Causa: la alerta diaria buscaba todo lo vencido sin recordar qué ya había
-- avisado, así que una deuda vencida sin resolver disparaba el mismo mensaje
-- todos los días. Ahora cada ítem queda en silencio tras avisarse.

-- 1) Control de "hasta cuándo callar" por ítem
alter table cheques            add column if not exists alertado_hasta date;
alter table cuentas_por_pagar  add column if not exists alertado_hasta date;

-- 2) Silenciar TODO lo que ya está pendiente hoy: son los pagos de los que el
--    bot ya te venía avisando a diario. A partir de ahora solo te escribe si
--    aparece algo nuevo (o cuando pasen 7 días).
update cheques
   set alertado_hasta = current_date + 7
 where estado = 'pendiente' and alertado_hasta is null;

update cuentas_por_pagar
   set alertado_hasta = current_date + 7
 where estado = 'pendiente' and alertado_hasta is null;

-- Nota: el botón "🔕 Silenciar 30 días" del bot escribe en esta misma columna.
-- Marcar un pago como pagado/cobrado lo saca de las alertas automáticamente.
