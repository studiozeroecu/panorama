-- Panorama — Bear & Trend · Fase 8n: la cortadora puede CREAR una maquiladora
-- Ejecutar DESPUÉS de schema_fase8l_cortadora_recibe_tela.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; y SIN asignaciones con la palabra clave de destino de
-- PL/pgSQL — ver la cabecera de schema_fase8l (el SQL Editor de Supabase las
-- confunde con crear una tabla y rompe el script).
--
-- ════════════════════════════════════════════════════════════
-- QUÉ Y POR QUÉ
--
-- Al registrar un corte, la cortadora elige a qué maquiladora va. Si es una
-- nueva, hasta ahora tenía que pedirle a Mateo que la diera de alta. Con esto la
-- crea ella misma desde el formulario del corte.
--
-- Se le da SOLO insert, y acotado:
--   · `archivada_en is null` en el with check: no puede crear una ya archivada.
--   · NADA de update ni delete: no puede renombrar ni archivar las que existen.
--     Archivar y corregir sigue siendo de Mateo (ProveedoresTab).
--
-- RLS es de fila, no de columna, pero aquí no hay nada que esconder: la tabla
-- solo tiene id, nombre, created_at y archivada_en. Lo único que ella fija es el
-- nombre, y el índice único de `nombre` ya impide duplicados (también contra las
-- archivadas — la pantalla lo explica en vez de mostrar el error crudo).
--
-- Sin función: crear una maquiladora es UN insert de UNA columna. No hay cadena
-- de escrituras que hacer atómica, que es lo que justificó las RPC.
-- ════════════════════════════════════════════════════════════

drop policy if exists "cortadora_crea_maquiladora" on prod_maquiladoras;
create policy "cortadora_crea_maquiladora" on prod_maquiladoras
  for insert to authenticated
  with check (fn_es_cortadora() and archivada_en is null);

comment on policy "cortadora_crea_maquiladora" on prod_maquiladoras is
  'Fase 8n: la cortadora da de alta maquiladoras al registrar un corte. Solo insert; archivar/editar es del admin.';

-- ============================================================
-- Verificación final — solo mira, no cambia nada.
-- La cortadora no debe poder MODIFICAR ni BORRAR maquiladoras.
-- ============================================================

do $VERIF8N$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'prod_maquiladoras'
                   and policyname = 'cortadora_crea_maquiladora'
                   and cmd = 'INSERT') then
    raise exception 'Fase 8n: no se creó cortadora_crea_maquiladora.';
  end if;

  if exists (select 1 from pg_policies
             where tablename = 'prod_maquiladoras'
               and cmd in ('UPDATE', 'DELETE', 'ALL')
               and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%fn_es_cortadora%') then
    raise exception 'Fase 8n: la cortadora tiene permiso de editar o borrar maquiladoras. No debe.';
  end if;

  raise notice 'Fase 8n aplicada: la cortadora puede crear maquiladoras, no editarlas ni borrarlas.';
end $VERIF8N$;

-- ============================================================
-- DESHACER:
--   drop policy if exists "cortadora_crea_maquiladora" on prod_maquiladoras;
-- ============================================================
