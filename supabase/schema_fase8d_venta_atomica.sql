-- Panorama — Bear & Trend · Fase 8d: venta online atómica
-- Ejecutar DESPUÉS de schema_fase8c_colores_repetidos.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Por qué: StockTab.confirmarVenta hace insert de venta + update de stock por
-- separado, sin transacción. Si el segundo falla, queda una venta sin descontar.
--
-- Pero el fallo más grave es otro: el update es ABSOLUTO.
--   .update({ disponibles: venta.disponibles - cant })
-- `venta.disponibles` viene del estado de la PANTALLA. Si el stock real es 3 y la
-- pantalla muestra 10, vender 2 escribe 8: se inventan 5 unidades de la nada. El
-- `check (disponibles >= 0)` no lo detecta, porque 8 es positivo. Aquí el descuento
-- pasa a ser relativo (`disponibles - N`) y calculado dentro de la base.
--
-- PENDIENTE, FUERA DE ESTE ALCANCE: el cálculo de "Ingreso online (30 días)" de
-- StockTab usa new Date(Date.now() - 30*86400000).toISOString(), que es UTC y
-- contradice la regla de fechas del proyecto. Es un bug de visualización de un
-- reporte, no del backend; va en su propio commit.

-- ============================================================
-- 1) Columna de idempotencia (mismo patrón que la fase 8b) y default de fecha
-- ============================================================

alter table prod_ventas_online add column if not exists idempotencia_id uuid;

create unique index if not exists uq_ventas_online_idempotencia
  on prod_ventas_online (idempotencia_id);

-- `current_date` es la zona del SERVIDOR (UTC). Entre las 19:00 y medianoche en
-- Ecuador registraría el día siguiente. La RPC siempre manda la fecha explícita,
-- pero este default seguía mal para cualquier insert manual.
alter table prod_ventas_online alter column fecha set default fn_hoy_ecuador();

-- ============================================================
-- 2) La función
-- ============================================================

create or replace function fn_confirmar_venta_online(
  p_stock_id uuid,
  p_cantidad integer,
  p_precio numeric,
  p_fecha date default null,
  p_idem_id uuid default null
) returns jsonb
language plpgsql as $$
declare
  v_stock record;
  v_venta record;
  v_fecha date;
  v_venta_id uuid;
begin
  if not fn_es_admin() then
    raise exception 'Solo un administrador puede registrar ventas.';
  end if;

  -- Lock de la fila de stock. Serializa las ventas del mismo producto.
  select s.id, s.prenda_nombre, s.color, s.estampado, s.talla,
         s.disponibles, s.vendidas
    into v_stock
  from prod_stock_online s
  where s.id = p_stock_id
  for update;

  if not found then
    raise exception 'Ese stock ya no existe.';
  end if;

  -- ⚠️ IDEMPOTENCIA DESPUÉS DEL LOCK Y ANTES DE VALIDAR.
  -- Después del lock: dos llamadas simultáneas con el mismo id se serializan aquí,
  -- y la segunda ve la venta que registró la primera.
  -- Antes de validar: si fuera después, un reintento chocaría contra el stock que
  -- la primera llamada ya descontó y levantaría un "solo quedan N" falso sobre una
  -- venta que sí se registró.
  if p_idem_id is not null then
    select v.id, v.cantidad, v.total, v.talla into v_venta
    from prod_ventas_online v where v.idempotencia_id = p_idem_id;
    if found then
      return jsonb_build_object(
        'ya_registrada', true,
        'venta_id', v_venta.id,
        'cantidad', v_venta.cantidad,
        'total',    v_venta.total,
        'talla',    v_venta.talla
      );
    end if;
  end if;

  if coalesce(p_cantidad, 0) <= 0 then
    raise exception 'La cantidad debe ser mayor a 0.';
  end if;
  if coalesce(p_precio, -1) < 0 then
    raise exception 'Ingresa el precio de venta.';
  end if;

  -- El chequeo va contra el valor REAL de la base, con el lock tomado.
  if v_stock.disponibles < p_cantidad then
    raise exception 'Solo quedan % unidades disponibles en talla % (pediste %).',
      v_stock.disponibles, v_stock.talla, p_cantidad;
  end if;

  v_fecha := coalesce(p_fecha, fn_hoy_ecuador());

  -- prenda, color, estampado y talla salen de la fila de stock, no del cliente:
  -- una pantalla desactualizada no puede registrar una venta con datos viejos.
  insert into prod_ventas_online
    (fecha, stock_id, prenda_nombre, color, estampado, talla,
     cantidad, precio_unitario, total, idempotencia_id)
  values (v_fecha, v_stock.id, v_stock.prenda_nombre, v_stock.color,
          v_stock.estampado, v_stock.talla,
          p_cantidad, p_precio, round(p_cantidad * p_precio, 2), p_idem_id)
  on conflict (idempotencia_id) do nothing
  returning id into v_venta_id;

  -- Segunda línea de defensa, como en la fase 8b: si otra transacción ganó la
  -- carrera, el índice único la absorbe y devolvemos la venta que quedó.
  if v_venta_id is null then
    select v.id, v.cantidad, v.total, v.talla into v_venta
    from prod_ventas_online v where v.idempotencia_id = p_idem_id;
    return jsonb_build_object('ya_registrada', true, 'venta_id', v_venta.id,
      'cantidad', v_venta.cantidad, 'total', v_venta.total, 'talla', v_venta.talla);
  end if;

  -- Aritmética RELATIVA. Aunque el lock fallara, esto no puede pisar el descuento
  -- de otra venta ni inventar unidades a partir de un valor viejo del cliente.
  update prod_stock_online
     set disponibles = disponibles - p_cantidad,
         vendidas    = vendidas + p_cantidad
   where id = p_stock_id;

  return jsonb_build_object(
    'ya_registrada', false,
    'venta_id',  v_venta_id,
    'cantidad',  p_cantidad,
    'total',     round(p_cantidad * p_precio, 2),
    'restantes', v_stock.disponibles - p_cantidad,
    'talla',     v_stock.talla
  );
end $$;

-- ============================================================
-- DESHACER:
--   drop function if exists fn_confirmar_venta_online(uuid, integer, numeric, date, uuid);
--   drop index if exists uq_ventas_online_idempotencia;
--   alter table prod_ventas_online drop column if exists idempotencia_id;
--   alter table prod_ventas_online alter column fecha set default current_date;
-- ============================================================
