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
`actualizacion_alertas.sql` → `schema_fase7_colores.sql` ✅ **aplicada el 2026-09-07** →
`schema_fase7b_trigger_maquila.sql` ✅ **aplicada el 2026-09-07** →
`schema_fase8a_retorno_estampado.sql` ✅ **aplicada el 2026-09-09** →
`schema_fase8b_idempotencia.sql` ✅ **aplicada el 2026-09-09**

> ✅ **Base y código alineados desde el 2026-09-08.** El TypeScript de la fase 7 está desplegado
> en `main`, y `resync_fase7.sql` recuperó lo que la app vieja había escrito solo en el jsonb.
> Las tres invariantes (cortes descuadrados, maquilas descuadradas, estados desincronizados) dan 0.
>
> **La lección, por si vuelve a pasar:** entre aplicar una migración y desplegar el código que la
> usa, la app en vivo sigue escribiendo a la manera vieja. Aquí esa ventana duró un día y dejó un
> corte con jsonb y cero filas normalizadas. Si vuelves a separar migración y deploy, corre
> `resync_fase7.sql` justo después de desplegar — o no separes.

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

#### Colores normalizados — fase 7 ✅ aplicada (2026-09-07)

`schema_fase7_colores.sql` saca los arrays `colores` jsonb de `prod_pedidos_tela`, `prod_cortes` y
`prod_maquilas` a tablas propias. **Las columnas jsonb NO se borran**: quedan congeladas como
respaldo, así que el código viejo seguiría funcionando si hiciera falta revertir el deploy.
**La fuente de verdad son ya las tablas normalizadas**: la app las lee y escribe, y los dos
triggers mantienen el jsonb al día detrás.

| Tabla | PK | Columnas clave | FKs (todas internas) |
|---|---|---|---|
| `prod_pedido_colores` | uuid | `color`, `metros`, `kilos`, `orden`; índice único `(pedido_id, lower(btrim(color)))` | `pedido_id → prod_pedidos_tela` **cascade** |
| `prod_corte_colores` | uuid | `color`, `unidades`, `metros_usados`, `orden`; índice único `(corte_id, lower(btrim(color)))` | `corte_id → prod_cortes` **cascade** · `pedido_color_id → prod_pedido_colores` set null |
| `prod_corte_color_tallas` | uuid | `talla`, `unidades`, **unique** (`corte_color_id`,`talla`); las tallas en cero no se guardan | `corte_color_id → prod_corte_colores` **cascade** |
| `prod_maquila_colores` | uuid | `estado` (pendiente\|enviado\|entregado), `fecha_envio/entrega`, `procesado`, **unique** (`maquila_id`,`corte_color_id`) | `maquila_id → prod_maquilas` **cascade** · `corte_color_id → prod_corte_colores` **restrict** |

`prod_maquila_colores` **no repite** `color`/`tallas`/`unidades`: los toma por join de
`prod_corte_colores`. Es válido porque `CorteTab` los copia literales del corte y ningún otro código
los vuelve a tocar — `MaquilaTab` solo escribe estado y fechas, `EnvioTab` solo `procesado`.

El mismo archivo crea cinco funciones. Las dos RPC reemplazan las cadenas de escrituras sueltas que
hoy hace el navegador — que al fallar a mitad y reintentarse duplicaban datos:

| Función | Reemplaza | Por qué |
|---|---|---|
| `fn_registrar_corte(pedido, fecha, maquiladora, obs, costo_maquila, colores jsonb, idem_id uuid) → jsonb` | `CorteTab.guardarCorte()` | Corte + maquila + colores + tallas en una transacción; bloquea el pedido mientras valida el saldo de tela. Firma ampliada en la fase 8b (antes 6 parámetros y devolvía `uuid`) |
| `fn_procesar_lote_maquila(maquila_color_id, destino, …) → jsonb` | `EnvioTab.procesar()` | Los 3 destinos en una transacción; `for update` + guarda de `procesado` hacen imposible procesar dos veces el mismo lote |
| `fn_sumar_stock_online(...)` | `src/lib/produccion/stock.ts` | Upsert atómico en vez de select→update (dos escrituras a la vez se pisaban) |
| `fn_repartir_por_talla(tallas, total) → jsonb` | la heurística duplicada en `EnvioTab` y `EstampadosTab` | Única implementación de la regla, en orden XS→XXL |
| `fn_hoy_ecuador() → date` | `current_date` | `current_date` usa la zona del servidor (UTC) y de 19:00 a medianoche registraría el día siguiente |

Son `SECURITY INVOKER`: las políticas RLS siguen aplicando con el usuario que llama; el chequeo
`fn_es_admin()` dentro de cada RPC solo da un mensaje entendible en vez de un error opaco de RLS.

`schema_fase8a_retorno_estampado.sql` añade una sexta:
`fn_retornar_lote_estampado(lote_id, fecha) → jsonb`, que reemplaza a `EstampadosTab.retornar()`.
Suma el stock y marca el lote en una transacción, con `for update` sobre el lote. A diferencia de las
otras dos, **un reintento no lanza excepción**: devuelve `{"ya_retornado": true}` para que la interfaz
lo muestre como aviso y no como error.

**Dual-write:** las dos RPC escriben las filas normalizadas **y** mantienen los `colores` jsonb al
día. Por eso revertir el deploy es un rollback real — el código viejo lee el jsonb y no pierde nada
de lo creado después de la migración. Al retirar los jsonb (fase posterior) hay que quitar antes ese
dual-write de las dos funciones.

Fuera del alcance de la fase 7 (queda para una fase 8): `prod_lotes_estampado` y
`prod_envios_locales` siguen ligados a la maquila por `maquila_id` + un `color` de texto suelto, sin
FK a la fila de color. Hasta que eso cambie, "¿a dónde fue el color X del corte Y?" no se puede
responder en SQL. `total_unidades` también sigue almacenado en `prod_cortes` y `prod_maquilas` en
vez de derivarse, a propósito, para no mezclar cambios.

`prod_pedido_colores` se mantiene al día con un **trigger** (`trg_sync_pedido_colores`) sobre
`prod_pedidos_tela`, porque PedidosTab inserta el pedido directo y no por RPC. Sin él, todo pedido
creado después de la migración quedaría sin filas de color y sus cortes con `pedido_color_id` nulo.
Cuando se retire el jsonb, el trigger se va y PedidosTab pasa a escribir las filas.

Tablas de respaldo que crea la migración (admin-only, borrables cuando el código nuevo esté
estable): `respaldo_fase7_pedidos`, `respaldo_fase7_cortes`, `respaldo_fase7_maquilas`.

`supabase/smoke_test_fase7.sql` **no forma parte de la cadena**: se corre DESPUÉS de la migración y
ejercita el trigger y las dos RPC con datos de mentira. Es **un solo bloque `DO`** que termina
lanzando una excepción a propósito — ese "error" es el reporte, y al lanzarlo PostgreSQL revierte
todo lo que la prueba creó.

⚠️ **Ningún `.sql` de este proyecto debe llevar `begin;`/`commit;` explícitos.** El SQL Editor de
Supabase reparte las sentencias de un script con transacción explícita entre varias conexiones del
pool, y una tabla creada en una sentencia deja de existir para la siguiente
(`relation ... does not exist`). Sin transacción explícita cada sentencia autocommitea y funciona.
Cuando hace falta atomicidad de verdad, la forma es un bloque `DO` — que es **una sola sentencia**
y por tanto una sola transacción en una sola conexión.

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

### 2026-09-09 — producción — `schema_fase8b_idempotencia.sql` ✅ EJECUTADA

- **Columnas nuevas:** `prod_cortes.idempotencia_id` y `prod_pedidos_tela.idempotencia_id` (uuid,
  **nullable**), cada una con índice único (`uq_cortes_idempotencia`, `uq_pedidos_idempotencia`).
  Nullable a propósito: las filas viejas no tienen valor y un índice único admite muchos NULL, así
  que el bot y cualquier insert manual siguen funcionando sin id (sin deduplicar, pero sin romperse).
- **Por qué:** el guard contra doble clic era solo de cliente. Con dos pestañas, o si un cliente HTTP
  reintenta un POST que sí llegó, se creaban dos cortes idénticos y la tela se descontaba dos veces.
  `for update` serializa las llamadas pero no las deduplica. Aquí no sirve una guarda por estado
  (como `procesado` o `retornado`) porque el registro todavía no existe: hace falta una clave que
  identifique el **intento**, generada por el cliente al abrir el formulario.
- **`fn_registrar_corte` cambió de firma:** 7 parámetros (nuevo `p_idem_id uuid default null`) y
  devuelve `jsonb` en vez de `uuid`. Hubo que hacer **drop + create** — añadir un parámetro habría
  creado una sobrecarga y una llamada con 6 argumentos habría seguido usando la versión sin
  protección. Ambas sentencias van en un bloque `DO` para que no haya un instante sin función.
- ⚠️ **El orden dentro de la función no es cosmético:** el chequeo del `idem_id` va **después** del
  lock del pedido y **antes** de validar el saldo de tela. Si fuera después de validar, un reintento
  recalcularía la tela que la primera llamada ya consumió y levantaría un *"supera el saldo"* falso
  sobre un corte que sí se guardó. La comprobación 2 del smoke test existe para detectar esa
  regresión y falla con un mensaje que lo dice explícitamente.
- **PedidosTab** no usa RPC: hace `upsert` con `onConflict: "idempotencia_id"` +
  `ignoreDuplicates: true`, que se traduce a `on conflict do nothing`. Al no haber insert, el trigger
  `trg_sync_pedido_colores` tampoco dispara, así que los colores no se duplican. Mover sus
  validaciones al servidor queda para una fase aparte.
- Verificable con `supabase/smoke_test_fase8b.sql` (12 comprobaciones, termina en rollback).
- **Impacto en otras áreas: ninguno.**

### 2026-09-09 — producción — `schema_fase8a_retorno_estampado.sql` ✅ EJECUTADA

- **Función nueva:** `fn_retornar_lote_estampado(p_lote_id uuid, p_fecha date) → jsonb`. Reemplaza a
  `EstampadosTab.retornar()`, que hacía N sumas de stock desde el navegador y *después* marcaba el
  lote, sin transacción: si fallaba a mitad, el lote seguía `en_taller` y reintentar **duplicaba el
  stock**. Es el mismo defecto que la fase 7 cerró en Envío, detectado en la auditoría del 2026-09-08.
- **Cierra la mitad pendiente del bug 1.2:** el reparto por talla sale de `fn_repartir_por_talla`, así
  que desaparece la copia que `EstampadosTab` mantenía en orden de inserción del objeto.
- **Decisiones:** exige `estado = 'en_taller'` estricto; si `sum(tallas) < total_unidades` levanta
  error en vez de perder unidades en silencio; un reintento devuelve `{"ya_retornado": true}` como
  resultado normal, no como excepción.
- Verificable con `supabase/smoke_test_fase8a.sql` (9 comprobaciones, termina en rollback).
- **Impacto en otras áreas: ninguno.** Solo toca `prod_lotes_estampado` y `prod_stock_online`.
- **Pendiente:** cambiar `EstampadosTab.tsx` para que llame a la RPC y borrar
  `src/lib/produccion/stock.ts`, que queda sin llamadores. Hasta entonces la app sigue usando el
  camino viejo — la función existe pero nadie la llama, así que no hay estado roto.

### 2026-09-08 — producción — `resync_fase7.sql` (no es un cambio de schema)

- Rellena filas normalizadas de cortes/maquilas creados con el **código viejo**, que
  escribía solo el `colores` jsonb. Detectado el 2026-09-08: un corte del 07 tenía 1 color en
  jsonb y 0 filas normalizadas, porque la app en vivo (main) aún no tenía la fase 7.
- **Cuándo correrlo:** pegado al deploy del código nuevo, y otra vez si alguien siguió usando
  una versión vieja. Es idempotente. El paso 3 trata el jsonb como fuente de verdad para
  `estado`/fechas/`procesado`, así que **no** correrlo semanas después del deploy.
- Comprobación posterior: las tres consultas de integridad (cortes descuadrados, maquilas
  descuadradas, estados desincronizados) deben dar 0.

### 2026-09-07 — producción — `schema_fase7b_trigger_maquila.sql` ✅ EJECUTADA

- **Trigger nuevo:** `trg_sync_maquila_colores` sobre `prod_maquila_colores` (+ su función
  `fn_sync_maquila_colores`). Espeja `estado`, `fecha_envio`, `fecha_entrega` y `procesado` al
  `colores` jsonb de `prod_maquilas`.
- Por qué: MaquilaTab pasa a actualizar una sola fila de `prod_maquila_colores` en vez de reescribir
  el array entero. Sin el trigger el jsonb quedaría desfasado y se perdería la garantía de que
  revertir el deploy es un rollback real.
- `fn_procesar_lote_maquila` ya espejaba `procesado` por su cuenta; con el trigger esa parte queda
  redundante pero converge al mismo valor. Se deja para no duplicar la función en dos archivos.
- **Impacto en otras áreas: ninguno.**

### 2026-09-07 — producción — `schema_fase7_colores.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase7.sql`: 15/15 comprobaciones OK. Backfill contra los datos
reales: **37 colores de pedido · 6 de corte · 18 tallas · 6 de maquila.**

- **Resuelto el 2026-09-08** con `resync_fase7.sql`, tras desplegar el TS a `main`. Durante el día
  que la base tuvo la fase 7 sin el código, la app en vivo creó un corte que quedó solo en el jsonb.
- **Tablas nuevas:** `prod_pedido_colores`, `prod_corte_colores`,
  `prod_corte_color_tallas`, `prod_maquila_colores`, más los respaldos `respaldo_fase7_*`.
  Sacan los arrays `colores` jsonb de `prod_pedidos_tela`, `prod_cortes` y `prod_maquilas` a filas
  propias, para acabar con la lectura-modificación-escritura del array entero, la identidad de color
  por posición y la falta de integridad entre pedido, corte y maquila.
- `prod_pedidos_tela.colores`, `prod_cortes.colores`, `prod_maquilas.colores`: **NO se borran.**
  Quedan congeladas como respaldo hasta que el código nuevo lleve unos días estable. Mientras tanto
  siguen siendo la fuente de verdad y el código viejo funciona igual — por eso la migración puede
  correrse antes del deploy sin ventana de riesgo. El rollback es revertir el deploy.
- Las 7 tablas nuevas llevan RLS + política `admin_all_<tabla>`, incluidos los respaldos.
- **Funciones nuevas:** `fn_registrar_corte`, `fn_procesar_lote_maquila` (las dos RPC atómicas que
  reemplazan a `CorteTab.guardarCorte()` y `EnvioTab.procesar()`), más `fn_sumar_stock_online`,
  `fn_repartir_por_talla` y `fn_hoy_ecuador`. Las dos RPC hacen dual-write: mantienen también los
  `colores` jsonb, para que revertir el deploy siga siendo un rollback real.
- **Trigger nuevo:** `trg_sync_pedido_colores` sobre `prod_pedidos_tela` — normaliza los colores de
  cada pedido a partir del jsonb, porque PedidosTab inserta directo y no por RPC.
- **Cambio de comportamiento a revisar:** al mandar un lote parcial a estampado,
  `prod_lotes_estampado.tallas` pasa a guardar solo las tallas que van al taller (antes guardaba el
  desglose completo del lote con un `total_unidades` parcial, así que `sum(tallas) ≠ total_unidades`).
  Esto **ya resuelve la mitad del bug 1.2**: al quedar `sum(tallas) = total_unidades`, el reparto que
  hace `EstampadosTab` al recibir el retorno se vuelve identidad y las unidades estampadas entran al
  stock en la talla correcta, sin tocar ese archivo. Lo que queda de 1.2 para la fase 8 es que
  `EnvioTab` y `EstampadosTab` sigan teniendo cada uno su propia copia de la heurística de reparto:
  `fn_repartir_por_talla` ya es la implementación única, pero el TS todavía no la usa.
- **Impacto en otras áreas: ninguno.** Ninguna tabla fuera de `prod_*` cambia, y no se toca la única
  FK que cruza áreas. El bot sí lee estos datos (`stock_telas`, `ordenes_en_proceso` en
  `src/lib/bot/tools.ts`), pero vive en el mismo Next app, así que web y bot se despliegan juntos por
  construcción.
- **Pendiente:** correr el SQL, adaptar `useProduccion.tsx`, `types.ts`, `CorteTab`, `MaquilaTab`,
  `EnvioTab`, `PedidosTab`, `LlegadaTab`, `ProduccionApp` y `bot/tools.ts`. `ResumenTab` no toca
  `colores`, no necesita cambios. Cuando se ejecute, quitar los ⚠️ de este documento.
