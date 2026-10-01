-- Panorama — Bear & Trend · Fase 8g: proteger la edición de un pedido con cortes
-- Ejecutar DESPUÉS de schema_fase8f… (no hay: la 8f no tocó schema).
-- El anterior con SQL es schema_fase8e_archivar_catalogos.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Puramente aditivo: una función y un trigger. No crea ni altera ninguna tabla,
-- así que no hace falta política RLS nueva.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- PedidosTab gana un modo edición. Corregir el proveedor de un pedido ya creado
-- es inofensivo —nadie downstream lo copia y la fecha de entrega estimada se
-- recalcula sola— pero hay dos campos que sí hacen daño, y en silencio:
--
--   colores      trg_sync_pedido_colores (AFTER UPDATE OF colores) BORRA las filas
--                de prod_pedido_colores que ya no estén en el jsonb. Como
--                prod_corte_colores.pedido_color_id es `on delete set null`, quitar
--                o RENOMBRAR un color deja los cortes apuntando a null: se pierde
--                el rastro de qué color del pedido salió cada corte, que es justo
--                la trazabilidad que construyó la fase 7. Sin error y sin aviso.
--
--   total_metros no tiene ningún check en la tabla. El saldo de tela
--                (total_metros − suma de metros_consumidos) solo se valida al
--                CREAR un corte, dentro de fn_registrar_corte. Bajar el total por
--                debajo de lo ya consumido deja el saldo negativo, y lo leen tres
--                sitios: fn_registrar_corte, CorteTab y bot/tools.ts.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ UN TRIGGER Y NO UNA RPC
--
-- Editar un pedido es UN SOLO update: no hay cadena de escrituras que hacer
-- atómica, que es lo que justificó las RPC de las fases 7, 8a y 8d. Una RPC aquí
-- solo añadiría una firma más que mantener.
--
-- Y el trigger cierra una carrera que el cliente no puede cerrar: el update toma
-- el lock de la fila del pedido, y fn_registrar_corte hace `select … for update`
-- sobre esa MISMA fila. Las dos operaciones se serializan solas, así que el
-- trigger nunca ve un estado a medias:
--   · si el update va primero, el corte se registra después contra el total nuevo;
--   · si el corte va primero, el update espera y el trigger ya lo ve.
-- El cliente valida lo mismo antes de enviar, pero sobre `data.cortes`, que es una
-- foto cargada al entrar a /produccion. Entre esa foto y el guardado puede aparecer
-- un corte desde otra pestaña, desde CorteTab o desde el bot.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ `unidad` Y `rendimiento` NO ESTÁN EN EL TRIGGER
--
-- En la pantalla los tres se bloquean juntos, porque total_metros se CALCULA en el
-- formulario como (suma de colores × rendimiento si es kilos): bloquear solo los
-- colores dejaría bajar el total por el rendimiento, sin tocar ni un color.
--
-- Pero en la base total_metros es una columna almacenada, no un derivado. Un update
-- que cambie `rendimiento` sin tocar `total_metros` no mueve el saldo, así que no
-- hay nada que proteger ahí. Vigilar `total_metros` cubre el daño real por
-- cualquier camino. Menos columnas en la lista = menos disparos inútiles.

create or replace function fn_proteger_pedido_con_cortes() returns trigger
language plpgsql as $$
declare
  v_cortes    int;
  v_consumido numeric;
begin
  -- Los cortes sin metros registrados cuentan como 0, igual que fn_registrar_corte
  -- y que CorteTab. Coherencia antes que exactitud: si aquí contaran distinto, el
  -- saldo diría una cosa al cortar y otra al editar.
  select count(*), coalesce(sum(c.metros_consumidos), 0)
    into v_cortes, v_consumido
  from prod_cortes c
  where c.pedido_id = new.id;

  -- Sin cortes no hay nada downstream que romper: se edita libremente, incluidos
  -- los colores. El AFTER trigger resincroniza prod_pedido_colores como siempre.
  if v_cortes = 0 then
    return new;
  end if;

  -- ── Guarda A · colores ──
  -- `is distinct from` sobre jsonb compara el contenido, no el texto: jsonb ordena
  -- las claves, así que reordenar el objeto no cuenta como cambio.
  if new.colores is distinct from old.colores then
    raise exception
      'No se pueden cambiar los colores de un pedido que ya tiene cortes registrados: los cortes quedarían sin saber de qué color del pedido salieron.';
  end if;

  -- ── Guarda B · saldo de tela ──
  -- Independiente de la A: renombrar un color deja el total igual (lo atrapa A),
  -- y bajar el rendimiento baja el total sin tocar colores (lo atrapa B).
  if new.total_metros < v_consumido then
    raise exception
      'El pedido no puede quedar en % m: los cortes ya registrados consumieron % m.',
      round(new.total_metros, 1), round(v_consumido, 1);
  end if;

  return new;
end $$;

-- BEFORE, no AFTER, y por dos razones:
--   · la excepción aborta la sentencia antes de que corra
--     trg_sync_pedido_colores (AFTER UPDATE OF colores), así que no llega a borrar
--     ninguna fila de prod_pedido_colores — no hay estado a medias que limpiar;
--   · es más barato: no se escribe la fila para luego revertirla.
--
-- La lista de columnas deja fuera los updates que NO deben dispararlo:
-- LlegadaTab (estado, fecha_entrega_real, ancho_real) y marcarEnCamino (estado).
-- Un trigger por columnas dispara si la columna aparece en el SET aunque el valor
-- no cambie; por eso las guardas comparan igual con `is distinct from`.
drop trigger if exists trg_proteger_pedido_con_cortes on prod_pedidos_tela;
create trigger trg_proteger_pedido_con_cortes
  before update of colores, total_metros on prod_pedidos_tela
  for each row execute function fn_proteger_pedido_con_cortes();

-- ============================================================
-- DESHACER:
--   drop trigger if exists trg_proteger_pedido_con_cortes on prod_pedidos_tela;
--   drop function if exists fn_proteger_pedido_con_cortes();
-- Nada más: no se creó ni se alteró ninguna tabla.
-- ============================================================
