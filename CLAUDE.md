# Panorama — Bear & Trend

Referencia compartida para cualquier sesión que trabaje en este proyecto. **Léelo antes de tocar
código o schema.** Si cambias tablas o columnas, anótalo en *Registro de cambios de schema* (al final).

## Stack

- **Next.js 15** (App Router, React 19, TypeScript strict). Alias `@/*` → `src/*`.
- **Supabase**: Postgres + Auth + Storage. RLS activa en todo. Buckets privados: `reportes`, `cheques`, `guias`.
- **Vercel**: deploy + crons (`vercel.json`). Los crons corren en UTC: `0 12 * * 1` = lunes 7:00 Ecuador,
  `0 13 * * *` = diario 8:00 Ecuador.
- **Anthropic SDK** para el bot de Telegram (Claude Haiku 4.5). La IA **nunca** toca la base:
  elige herramienta + parámetros, el backend valida y ejecuta (`src/lib/bot/tools.ts`).
- **Vitest** (`npm test`). Dev: `npm run dev` (o el preview `panorama-dev` de `.claude/launch.json`).

Variables de entorno (`.env.local` y Vercel): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_ID`, `CRON_SECRET`.

## Áreas y sus rutas

| Área | Ruta web | Componente raíz | Tablas propias |
|---|---|---|---|
| Ventas / snapshots | `/`, `/snapshots/[id]` | `src/app/page.tsx` | `snapshots`, `products`, `sales_lines`, `stock_lines` |
| Producción | `/produccion` | `components/produccion/ProduccionApp.tsx` | `prod_*` |
| Costos | `/costos` | `components/costos/CostosApp.tsx` | `costos_*` |
| Finanzas | `/finanzas` | `components/finanzas/FinanzasApp.tsx` | `movimientos`, `cheques`, `cuentas_por_*` |
| Logística | `/logistica` | `components/logistica/LogisticaApp.tsx` | `guias_transferencia`, `user_roles` |
| Bot Telegram | `/api/telegram/webhook` | `src/lib/bot/*` | `bot_pending_actions`, `telegram_updates`, `dtf_lotes` |

Crons: `/api/cron/resumen` (lunes), `/api/cron/urgencias` (diario). Ambos usan `CRON_SECRET` y service role.

---

## Schema completo

Los archivos SQL en `supabase/` son **acumulativos y se ejecutan en orden**; no hay migraciones
versionadas. Orden real de ejecución:

`schema.sql` → `schema_fase2.sql` → `schema_fase3.sql` → `migracion_produccion.sql` →
`schema_fase4.sql` → `migracion_costos.sql` → `schema_fase5.sql` → `migracion_pagos.sql` →
`schema_fase6.sql` → `actualizacion_match_y_bot.sql` → `actualizacion_v3.sql` →
`actualizacion_alertas.sql`

> El schema efectivo de una tabla es la suma de su `create table` **más** los `alter table` de los
> archivos posteriores. Ejemplos: `cheques` gana `cuenta_por_pagar_id` en fase 5 y `alertado_hasta`
> en `actualizacion_alertas.sql`; `cuentas_por_pagar` gana `ambito` en `migracion_pagos.sql`.

### Ventas / snapshots

| Tabla | PK | Columnas clave | FKs |
|---|---|---|---|
| `snapshots` | `id` uuid | `periodo_desde/hasta`, `archivo_nombre`, `archivo_path`, `total_unidades`, `total_neto`, `num_alertas`, `num_lineas_venta`, `locales text[]`, `warnings text[]` | — |
| `products` | `codigo` text | `descripcion`, `modelo_base`, `updated_at` | — |
| `sales_lines` | `id` bigint identity | `codigo`, `descripcion`, `cantidad`, `pvp`, `neto` | `snapshot_id → snapshots.id` **cascade** *(interna)* |
| `stock_lines` | `id` bigint identity | `codigo`, `local`, `ing`, `venta`, `otros`, `exist`, `es_alerta` | `snapshot_id → snapshots.id` **cascade** *(interna)* |

`neto` = columna "PRECIO TOTAL 61.2%" del reporte (ya viene neta de la comisión VATEX del 38.8%).
`es_alerta` = `exist <= 5` **y** movimiento real en el periodo; se calcula al cargar, no al consultar.

### Producción (`prod_*`) — todas las FKs son internas del área

| Tabla | PK | Columnas clave | FKs (todas internas) |
|---|---|---|---|
| `prod_prendas` | uuid | `nombre`, `consumo_metros`, `costo_maquila`, `precio_venta_local/online`, `lleva_estampado`, `tallas text[]`, `legacy_id` | — |
| `prod_proveedores` | uuid | `empresa`, `contacto`, `dias_entrega`, `legacy_id` | — |
| `prod_costos_fijos` | uuid | `nombre`, `valor`, `legacy_id` | — |
| `prod_maquiladoras` | uuid | `nombre` unique | — |
| `prod_talleres` | uuid | `nombre` unique | — |
| `prod_pedidos_tela` | uuid | `nombre_tela`, `unidad` (metros\|kilos), `rendimiento`, `ancho_pedido/real`, `colores jsonb`, `total_metros`, `valor_metro`, `total_pagar`, `estado` (pendiente\|en_camino\|entregado) | `proveedor_id → prod_proveedores` set null · `prenda_id → prod_prendas` set null |
| `prod_cortes` | uuid | `fecha`, `colores jsonb`, `total_unidades`, `metros_consumidos` (null = no registrado) | `pedido_id → prod_pedidos_tela` **restrict** · `maquiladora_id → prod_maquiladoras` set null |
| `prod_maquilas` | uuid | `costo_unitario`, `colores jsonb` (estado y fechas por color), `total_unidades` | `corte_id → prod_cortes` **cascade** · `maquiladora_id → prod_maquiladoras` set null |
| `prod_lotes_estampado` | uuid | `tallas jsonb`, `disenos jsonb`, `costo_unitario` (def. 2), `costo_total`, `fecha_envio/retorno`, `estado` | `maquila_id → prod_maquilas` set null · `prenda_id → prod_prendas` set null · `taller_id → prod_talleres` set null |
| `prod_stock_online` | uuid | `disponibles` (>=0), `vendidas`, **unique** (`prenda_nombre`,`color`,`estampado`,`talla`) | `prenda_id → prod_prendas` set null |
| `prod_ventas_online` | uuid | `fecha`, `cantidad`, `precio_unitario`, `total` | `stock_id → prod_stock_online` set null |
| `prod_envios_locales` | uuid | `fecha`, `tallas jsonb`, `unidades`, `precio/costo_unitario`, `ingreso`, `margen`, `producto_codigo`, `local_destino` (añadida en fase 6) | `maquila_id → prod_maquilas` set null · `prenda_id → prod_prendas` set null |

### Costos (`costos_*`) — FKs internas del área

| Tabla | PK | Columnas clave | FKs |
|---|---|---|---|
| `costos_prendas` | uuid | `producto` unique, `costo_tela`, `maquila`, `dtf`, `corte`, `insumos`, `etiqueta`, **`costo_total` (columna generada)**, `pvp_vatex`, `precio_online`, `precio_mayoreo_1_2/3_5/6plus`, `match_keywords text[]`, `match_excluir text[]` | — |
| `costos_vinculos` | `codigo` text | vínculo manual código VATEX → costo; gana sobre las keywords | `costo_id → costos_prendas` **cascade** *(interna)* |
| `costos_categorias` | uuid | `nombre` unique, `prioridad` (menor = se evalúa antes), `incluir text[]`, `excluir text[]` | `costo_id → costos_prendas` set null *(interna)* |

Match por categoría (`src/lib/costos/match.ts`): `incluir`/`match_keywords` = **todas** deben aparecer,
cada entrada admite alternativas con `|`; `excluir`/`match_excluir` = **ninguna**. Primera prioridad que
aplica gana (CUELLO CHINO antes que CAMISETA). Lo que no matchea cae en "sin categoría" y **no bloquea**
el cálculo del resto. `COMISION_VATEX = 0.612`.

**Nunca guardar derivados**: `costo_total` es columna generada; ganancias y márgenes se calculan al vuelo.

### Finanzas

| Tabla | PK | Columnas clave | FKs |
|---|---|---|---|
| `movimientos` | uuid | `fecha`, `tipo` (gasto\|ingreso), `monto` (>0), `concepto`, `categoria`, `origen` | — |
| `cuentas_por_cobrar` | uuid | `cliente`, `concepto`, `monto` (>0), `fecha_factura`, `fecha_vencimiento`, `estado` (pendiente\|cobrado), `fecha_cobro` | — |
| `cuentas_por_pagar` | uuid | `proveedor`, `concepto`, `monto` (>0), `fecha_vencimiento`, `tipo_pago` (efectivo\|cheque\|transferencia), `categoria`, `estado` (pendiente\|pagado), `fecha_pago`, **`ambito`** (personal\|empresa), **`alertado_hasta`** | — |
| `cheques` | uuid | `tipo` (por_cobrar\|por_pagar), `monto` (>0), `beneficiario`, `banco`, `numero`, `fecha_emision`, `fecha_cobro`, `estado` (pendiente\|cobrado\|rebotado\|anulado), `foto_path`, **`alertado_hasta`** | **`cuenta_por_pagar_id → cuentas_por_pagar.id` set null — ver abajo** |

`categoria` (en `movimientos` y `cuentas_por_pagar`) usa el mismo enum en ambos lados y en el bot:
`maquila, estampado, corte, arriendo, servicios, transporte, personal, otros`.
La lista canónica vive en `CATEGORIAS` de `src/lib/bot/tools.ts` — si cambia, cambia en los 3 sitios.

Reglas de negocio que no están en el schema:
- "vencido" **no se guarda**: es `estado = 'pendiente'` + fecha pasada.
- Marcar pagada una cuenta de **empresa** inserta el gasto en `movimientos`; una **personal**, no.
- `alertado_hasta` silencia el ítem en el cron de urgencias (7 días tras avisar, 30 con el botón 🔕).
  Si la columna no existe, el cron no envía nada — mejor silencio que spam.

### Logística y roles

| Tabla | PK | Columnas clave | FKs |
|---|---|---|---|
| `user_roles` | `user_id` uuid | `rol` (admin\|logistica), `telegram_chat_id` unique | `user_id → auth.users.id` cascade |
| `guias_transferencia` | uuid | `fecha`, `local_destino` (enum de 11 locales), `items jsonb`, `total_unidades`, `total_valor`, `recibido_por`, `foto_path` | `subido_por → auth.users.id` (default `auth.uid()`) |

Locales VATEX (lista duplicada a propósito en el check de la tabla y en `src/lib/locales.ts` —
**mantener sincronizadas**): `PK, LJ, GL, GT, BS, IBA, HUMZO, CV, HUMMER, QUITO, FRATELLI`.

### Bot

| Tabla | PK | Columnas clave | FKs |
|---|---|---|---|
| `bot_pending_actions` | uuid | `chat_id`, `kind` (cheque\|snapshot_conflict\|guia\|dtf_lote\|urgencias), `payload jsonb`, `resolved` | — |
| `telegram_updates` | `update_id` bigint | dedupe de reintentos de Telegram. RLS activa **sin políticas**: solo service role. | — |
| `dtf_lotes` | uuid | `prenda`, `modelo`, `tecnica`, `unidades_claras/oscuras`, `por_metro` (>0), `precio_metro`, `metros_claros/oscuros/metros`, `valor_total`, `valor_unitario` | — |

`dtf_lotes` convive a propósito con `prod_lotes_estampado`: son dos sistemas distintos, no unificar sin
decisión explícita. Regla de metros: `ceil(claras/por_metro) + ceil(oscuras/por_metro)` — claros y
oscuros nunca comparten metro de film (`src/lib/dtf/calculo.ts`).

### 🔴 La única FK que cruza áreas

```
cheques.cuenta_por_pagar_id  →  cuentas_por_pagar.id   (on delete set null)
```

Es el **único** punto donde una tabla referencia por foreign key real a otra de un área distinta
(cheques, nacida con el bot en fase 2 → finanzas, fase 5). Todas las demás FKs son internas de su área.

**Si tocas `cuentas_por_pagar` o `cheques`, revisa el otro lado y anótalo en el registro de cambios.**

### Vínculos suaves (sin FK — sin integridad referencial; romperlos no da error en la base)

- `prod_envios_locales.producto_codigo` → `products.codigo` (producción → ventas)
- `costos_vinculos.codigo` → `products.codigo` (costos → ventas)
- `sales_lines.codigo` / `stock_lines.codigo` → `products.codigo`
- `prod_envios_locales.local_destino` ↔ `guias_transferencia.local_destino` (cruce guía↔envío:
  mismo local, ±3 días, unidades, con semáforo de discrepancias en /produccion → Envío)
- `user_roles.telegram_chat_id` ↔ chat de Telegram del bot de logística
- Los `legacy_id` de `prod_*` apuntan a ids del proyecto viejo; solo sirven para las migraciones.

### RLS (reescrita por `schema_fase6.sql`)

- Todas las tablas de negocio: política `admin_all_<tabla>` — `using (fn_es_admin())`.
- `products`: además `products_lectura_todos` — lectura para admin **y** logística.
- `guias_transferencia`: logística inserta y ve **las suyas** (`subido_por = auth.uid()`); admin ve todo.
- `user_roles`: cada quien ve su fila; solo admin gestiona.
- `fn_es_admin()` / `fn_es_logistica()` son `security definer` (necesario para usarse dentro de políticas).
- Bot y crons usan **service role** → omiten RLS. Por eso `telegram_updates` no necesita políticas.

**Tabla nueva ⇒ `enable row level security` + política `admin_all_<tabla>`.** Sin eso queda inaccesible
desde la web (y el bug se ve como "no hay datos", no como un error).

---

## Convenciones de código

**Idioma.** Todo en español: tablas, columnas, variables, funciones, comentarios y UI. Los comentarios
explican **por qué**, no qué hace la línea (ver los headers de `src/lib/costos/match.ts` y
`src/lib/fechas.ts`). Los mensajes al usuario van sin tecnicismos: el dueño del negocio los lee.

**Fechas.** Siempre por `src/lib/fechas.ts` (`hoyEcuador`, `fmtFecha`, `diasHasta`, `sumarDiasLaborables`).
Nunca `new Date("YYYY-MM-DD")` para fechas-solo-día: se interpreta como medianoche UTC y en Ecuador
(UTC-5) muestra el día anterior. Las fechas-solo-día se manejan como **strings**; cuando hace falta un
`Date` se ancla a mediodía UTC (`T12:00:00Z`). Dinero y fechas de UI: `src/lib/format.ts`
(`money`, `fecha`, `periodo`), locale `es-EC`.

**Nada de derivados en la base.** Se guardan insumos; totales, márgenes, "vencido", ganancias y
coberturas se calculan al vuelo o son columnas generadas. Si necesitas un total precalculado por
rendimiento (como `snapshots.total_*`), documenta por qué.

**Supabase, tres clientes — no mezclarlos:**
- `@/lib/supabase/client` — `createClient()` en Client Components (`"use client"`).
- `@/lib/supabase/server` — `await createClient()` en Server Components y rutas con sesión.
- `@/lib/supabase/service` — `createServiceClient()` **solo** en rutas de servidor sin sesión
  (webhook, crons). Omite RLS; nunca importarlo desde código de cliente.

**Rutas.** Página de área = Server Component mínimo (`metadata` + `export const dynamic = "force-dynamic"`)
que renderiza un único componente cliente `<Area>App`. Las tabs viven en `components/<area>/*Tab.tsx` y
el estado compartido en un hook (`useProduccion.tsx`). Las API routes declaran
`export const runtime = "nodejs"` y `maxDuration`.

**Auth.** `src/middleware.ts` protege todo y enruta por rol (logística → siempre `/logistica`).
`api/telegram` y `api/cron` están **excluidos** del matcher: se autentican solos con
`TELEGRAM_WEBHOOK_SECRET` / `CRON_SECRET`.

**Estilos.** CSS global con variables en `src/app/globals.css` (`--bg`, `--surface`, `--border`, `--text`,
`--muted`, `--accent`, `--good`, `--warn`, `--bad`). Clases utilitarias existentes (`.wrap`, `.card`,
`.btn`, `.empty`, `.section-head`, `.dialog`, `.prod-tab`, `.stock-pill`…) más `style={{}}` inline para
ajustes puntuales. Sin Tailwind ni librerías de UI. Componentes compartidos en `src/components/ui.tsx`
(`Modal`, `Campo`…).

**El bot no toca la base.** Cada capacidad nueva es una herramienta declarada en `src/lib/bot/tools.ts`
con su `input_schema`; el backend valida los parámetros y ejecuta. Las acciones con datos extraídos por
IA (cheques, guías, lotes DTF) pasan por `bot_pending_actions` y se guardan **solo tras confirmación
por botón**.

**Mensajes proactivos — regla estricta.** El bot solo habla sin que le hablen en 2 casos: resumen del
lunes 7:00 y urgencias (<3 días), máximo una vez al día y solo si hay algo **nuevo**. No añadir más
mensajes automáticos. Ante la duda, silencio.

**Tests.** `tests/*.test.ts` con Vitest, contra el archivo real de `tests/fixtures/`. `parser.test.ts`
fija cifras de referencia (115 líneas de venta, 283 unidades, $4,421.98 neto, 11 locales, 4,136 líneas
de stock, 215 alertas): si cambian, es un bug, no un test desactualizado.

**Datos migrados.** Los `scripts/generar-migracion-*.mjs` **regeneran** los `.sql` desde los Excel
originales; los archivos de migración no se editan a mano. Se ejecutan una sola vez y solo insertan.

---

## Registro de cambios de schema

Anota aquí **cualquier** cambio a tablas, columnas, constraints, enums o políticas RLS, para que las
demás áreas se enteren sin releer todo el SQL. Lo más reciente arriba.

Formato:

```
### YYYY-MM-DD — <área> — <archivo .sql>
- <tabla.columna>: qué cambió y por qué.
- Impacto en otras áreas: <ninguno | qué revisar>.
```

<!-- Nuevas entradas debajo de esta línea -->

*(sin entradas todavía — el estado actual es el descrito arriba, tras `actualizacion_alertas.sql`)*
