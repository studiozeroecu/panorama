-- Panorama — Bear & Trend · Fase 8h: consumo en metros cuadrados por prenda
-- Ejecutar DESPUÉS de schema_fase8g_editar_pedido.sql. Idempotente.
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- Primer cambio de schema del plan de cortadora (docs/plan_cortadora.md).
-- Puramente aditivo: una columna nullable. Ninguna fila existente cambia.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ UNA COLUMNA NUEVA Y NO DERIVARLA DE consumo_metros
--
-- `consumo_metros` son metros LINEALES de tela por unidad, y ese número solo vale
-- para el ancho con el que se midió: la misma prenda sobre una tela más angosta
-- consume más metros lineales aunque su patrón ocupe la misma superficie.
--
-- Derivar los m² desde ahí no aportaría nada, porque el ancho se cancela:
--   unidades = (metros_usables × ancho/100) ÷ (consumo_metros × ancho/100)
--            =  metros_usables ÷ consumo_metros
-- El paso por m² sería decorativo y daría exactamente el mismo resultado.
--
-- Son dos fuentes INDEPENDIENTES: `consumo_m2` es un dato medido aparte, de la
-- experiencia real de corte. Por eso convive con `consumo_metros` en vez de
-- reemplazarlo — y por eso la estimación cae a la fórmula lineal cuando falta.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ NO HACE FALTA TOCAR RLS
--
-- `prod_prendas` ya tiene su política `admin_all_prod_prendas`, creada en
-- schema_fase6.sql como `for all to authenticated using (fn_es_admin())`. Es una
-- política de FILA, sin lista de columnas, así que cubre la columna nueva sola.
-- Y el proyecto no declara ni un `grant` explícito: valen los de Supabase, que
-- son a nivel de tabla y también alcanzan a las columnas nuevas.
--
-- (La regla de CLAUDE.md —"tabla nueva ⇒ RLS + política"— es para TABLAS nuevas.
--  Aquí no se crea ninguna.)

-- ============================================================
-- 1) La columna
--
--    NULLABLE y SIN DEFAULT a propósito. `null` significa "todavía no medido", y
--    el check de abajo hace que sea la ÚNICA forma de decirlo: sin él, un 0
--    podría colarse como si fuera un dato y dividir por él reventaría o daría
--    infinito. Es el mismo patrón de fallo que ya mordió al proyecto con el
--    `?? 0` del costo de maquila (ver fase 8e) — un cero que se guarda y se
--    congela sin que nadie lo note.
-- ============================================================

alter table prod_prendas add column if not exists consumo_m2 numeric(8,3);

-- numeric(8,3) y no (8,2) como `consumo_metros`: este valor es un DIVISOR, y
-- redondearlo a dos decimales arrastra el error a todas las unidades estimadas.
-- Una prenda ronda 0.8–2 m², así que tres decimales son ~1 cm² de precisión.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'prod_prendas'::regclass
      and conname  = 'prod_prendas_consumo_m2_positivo'
  ) then
    alter table prod_prendas
      add constraint prod_prendas_consumo_m2_positivo
      check (consumo_m2 is null or consumo_m2 > 0);
  end if;
end $$;

comment on column prod_prendas.consumo_m2 is
  'Metros cuadrados de tela que consume UNA unidad. Dato medido aparte, independiente de consumo_metros. null = sin medir.';

-- ============================================================
-- DESHACER:
--   alter table prod_prendas drop constraint if exists prod_prendas_consumo_m2_positivo;
--   alter table prod_prendas drop column if exists consumo_m2;
-- Nada más: no se creó ninguna tabla, función, trigger ni política.
-- ============================================================
