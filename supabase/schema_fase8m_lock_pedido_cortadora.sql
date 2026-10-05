-- Panorama — Bear & Trend · Fase 8m: la cortadora puede BLOQUEAR el pedido
-- Ejecutar DESPUÉS de schema_fase8k_capas_por_color.sql. Idempotente.
-- ✅ Aplicada el 2026-10-05, ANTES que la 8l (que se escribió primero pero se
-- ejecuta después). Verificable con supabase/smoke_test_fase8m.sql.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- ════════════════════════════════════════════════════════════
-- EL FALLO
--
-- Al registrar un corte, la cortadora recibía «El pedido de tela no existe»
-- aunque el pedido estuviera delante de ella en la pantalla.
--
-- `fn_registrar_corte` empieza bloqueando el pedido para serializar dos llamadas
-- simultáneas:
--
--     select estado into v_estado
--     from prod_pedidos_tela
--     where id = p_pedido_id
--     for update;
--     if not found then raise exception 'El pedido de tela no existe.';
--
-- En PostgreSQL un `SELECT ... FOR UPDATE` sobre una tabla con RLS **no basta
-- con la política de SELECT**: exige también que la fila pase el `using` de una
-- política de UPDATE, porque bloquear una fila se considera una modificación en
-- potencia. La fase 8i le dio a la cortadora SOLO lectura sobre
-- `prod_pedidos_tela` —a propósito, para que no pudiera editar la corrida— así
-- que el lock no encontraba la fila y la función concluía que no existía.
--
-- LA SOLUCIÓN, Y POR QUÉ NO ES ABRIRLE LA MANO
--
-- Una política de UPDATE con `with check (false)`:
--
--   · el `using` se evalúa al bloquear  → puede tomar el lock;
--   · el `with check` se evalúa al escribir → cualquier UPDATE real se rechaza.
--
-- Es decir: puede bloquear la fila, nunca modificarla. La corrida base sigue
-- siendo territorio exclusivo del admin, que era el punto de la fase 8i.
--
-- Sigue acotada a `estado = 'entregado'`, igual que su política de lectura: solo
-- puede bloquear la tela que puede cortar.
-- ════════════════════════════════════════════════════════════

drop policy if exists "cortadora_bloquea_pedido" on prod_pedidos_tela;
create policy "cortadora_bloquea_pedido" on prod_pedidos_tela
  for update to authenticated
  using (fn_es_cortadora() and estado = 'entregado')
  with check (false);

comment on policy "cortadora_bloquea_pedido" on prod_pedidos_tela is
  'Permite el SELECT ... FOR UPDATE de fn_registrar_corte. with check (false) impide cualquier modificación real.';

-- ============================================================
-- DESHACER:
--   drop policy if exists "cortadora_bloquea_pedido" on prod_pedidos_tela;
--   (y la cortadora vuelve a no poder registrar cortes)
-- ============================================================
