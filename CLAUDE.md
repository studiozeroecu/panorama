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
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_ID`, `CRON_SECRET`,
`TELEGRAM_FICHAS_BOT_TOKEN`, `TELEGRAM_FICHAS_CHAT_ID` (bot **aparte** para las fichas de
estampado — solo envío, sin IA ni webhook; nunca reutilizar las del bot principal).

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
`schema_fase8b_idempotencia.sql` ✅ **aplicada el 2026-09-09** →
`schema_fase8c_colores_repetidos.sql` ✅ **aplicada el 2026-09-10** →
`schema_fase8d_venta_atomica.sql` ✅ **aplicada el 2026-09-10** →
`schema_fase8e_archivar_catalogos.sql` ✅ **aplicada el 2026-09-10** →
`schema_fase8g_editar_pedido.sql` ✅ **aplicada el 2026-10-01** →
`schema_fase8h_consumo_m2.sql` ✅ **aplicada el 2026-10-02** →
`schema_fase8i_rol_cortadora.sql` ✅ **aplicada el 2026-10-02** →
`schema_fase8j_cortadora_escritura.sql` ✅ **aplicada el 2026-10-02** →
`schema_fase8k_capas_por_color.sql` ✅ **aplicada el 2026-10-05** →
`schema_fase8m_lock_pedido_cortadora.sql` ✅ **aplicada el 2026-10-05** →
`schema_fase8l_cortadora_recibe_tela.sql` ⏳ **escrita, PENDIENTE de aplicar** →
`schema_fase8n_cortadora_crea_maquiladora.sql` ⏳ **escrita, PENDIENTE de aplicar**
*(sí: la 8m va ANTES que la 8l. Se escribió después, pero se aplicó primero)*
*(no hay 8f en la cadena: esa fase fue la ficha de estampado y no tocó schema)*

> ✅ **Base y código alineados desde el 2026-09-08.** El TypeScript de la fase 7 está desplegado
> en `main`, y `resync_fase7.sql` recuperó lo que la app vieja había escrito solo en el jsonb.
> Las tres invariantes (cortes descuadrados, maquilas descuadradas, estados desincronizados) dan 0.
>
> **La lección, por si vuelve a pasar:** entre aplicar una migración y desplegar el código que la
> usa, la app en vivo sigue escribiendo a la manera vieja. Aquí esa ventana duró un día y dejó un
> corte con jsonb y cero filas normalizadas. Si vuelves a separar migración y deploy, corre
> `resync_fase7.sql` justo después de desplegar — o no separes.

> ⚠️ **NO vuelvas a correr un `.sql` ya aplicado "por si acaso".** Los archivos son acumulativos y
> varios contienen `create or replace function` de funciones que fases POSTERIORES reemplazaron con
> otra firma. Reejecutar uno viejo **revive la versión antigua** y deja dos sobrecargas vivas; PostgreSQL
> entonces elige por número de argumentos y media app escribe contra la función equivocada **sin ningún
> error**. Pasó el 2026-10-05 con `fn_registrar_corte` (ver fase 8k). Si dudas de si algo se aplicó,
> CONSULTA el estado (`pg_proc`, `information_schema.columns`) en vez de reejecutar.
>
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
| `prod_pedidos_tela` | uuid | `nombre_tela`, `unidad` (metros\|kilos), `rendimiento`, `ancho_pedido/real`, `colores jsonb`, `total_metros`, `valor_metro`, `total_pagar`, `estado` (pendiente\|en_camino\|entregado), `recibido_por_rol` + `ancho_recibido` (fase 8l) | `proveedor_id → prod_proveedores` set null · `prenda_id → prod_prendas` set null |
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

`schema_fase8d_venta_atomica.sql` añade una séptima: `fn_confirmar_venta_online(stock_id, cantidad,
precio, fecha, idem_id) → jsonb`, que reemplaza a `StockTab.confirmarVenta()`. Bloquea la fila de
stock, valida contra el valor real de la base y descuenta con **aritmética relativa**
(`disponibles - N`), nunca con un valor absoluto calculado en el cliente.

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

> ⚠️ **`fn_sync_pedido_colores` fue redefinida en `schema_fase8c_colores_repetidos.sql`.**
> La definición que aparece en `schema_fase7_colores.sql` está **obsoleta** — le falta la
> validación de colores repetidos. Si necesitas leer la función vigente, mira la de la fase 8c.

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

⚠️ **Tampoco `select … into variable` ni `returning … into variable`, ni dentro de PL/pgSQL**
(desde el 2026-10-05). El SQL Editor de Supabase añade solo un *"enable Row Level Security on newly
created tables"*, confunde esas asignaciones con un `SELECT INTO` que crea una tabla, inyecta
`ALTER TABLE v_n ENABLE ROW LEVEL SECURITY` en medio del script y lo rompe con *"unterminated
dollar-quoted string"* (no se ejecuta nada). La forma segura: `v := (select …)` para asignar,
`perform … for update` + `found` para bloquear, y generar el id antes del insert
(`v := gen_random_uuid()`) en vez de `returning id into`. Los `.sql` anteriores a la 8l sí lo usan:
ya están aplicados y **no se vuelven a correr**, así que no hay que tocarlos.

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

**No correr `npm run build` con `npm run dev` levantado.** Los dos escriben en `.next/` y el build
deja el servidor de desarrollo sirviendo páginas en blanco (`__webpack_modules__[moduleId] is not a
function`). Si pasa: parar el dev, borrar `.next/` y volver a levantarlo.

**Ids en el navegador: `nuevoId()` de `src/lib/id.ts`, nunca `crypto.randomUUID()` directo.** Este
último solo existe en contextos seguros (https o localhost) y revienta al abrir la app desde el
teléfono por la IP de la red local.

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

### 2026-10-05 — producción — `schema_fase8n_cortadora_crea_maquiladora.sql` ⏳ PENDIENTE DE APLICAR

Verificable con `supabase/smoke_test_fase8n.sql` (4 comprobaciones, con RLS aplicando como el de la 8m).

- **Política nueva:** `cortadora_crea_maquiladora` — `for insert with check (fn_es_cortadora() and
  archivada_en is null)`. La cortadora da de alta una maquiladora desde el formulario del corte
  (`MaquilaDelCorte.tsx`). **Solo insert:** renombrar, archivar o borrar sigue siendo del admin.
- **Sin función:** es un insert de una sola columna; no hay cadena de escrituras que proteger.
- El índice único de `nombre` también choca con las archivadas: la pantalla lo traduce a
  *"está archivada, pídele a Mateo que la reactive"* en vez del error crudo.
- **Precio unitario de maquila editable por la cortadora** (no es schema, pero va con esto): arranca
  con `prod_prendas.costo_maquila`, como en `CorteTab`, y ella lo puede cambiar para ESE corte. Se
  congela en `prod_maquilas.costo_unitario`. En blanco viaja null y `fn_registrar_corte` guarda 0
  (`coalesce`): la pantalla lo avisa en vez de inventar un valor.
- **Impacto en otras áreas: ninguno.**

### 2026-10-05 — producción — `schema_fase8m_lock_pedido_cortadora.sql` ✅ EJECUTADA

Verificable con `supabase/smoke_test_fase8m.sql` (7 comprobaciones). Es el **primer smoke que corre
con RLS aplicando** (`set local role authenticated`): como `postgres` las políticas se saltan y no
se probaría nada.

- **El fallo:** la cortadora recibía *"El pedido de tela no existe"* al registrar un corte.
  `fn_registrar_corte` (SECURITY INVOKER) empieza con `select … for update` sobre el pedido, y en
  PostgreSQL **bloquear una fila con RLS exige pasar el `using` de una política de UPDATE**, no solo
  la de SELECT. Sin ella, la fila simplemente no aparece — sin error.
- **Política nueva:** `cortadora_bloquea_pedido` — `for update using (fn_es_cortadora() and
  estado = 'entregado') with check (false)`. El `using` le deja tomar el lock; el `with check (false)`
  rechaza cualquier escritura real. **Puede bloquear, nunca modificar.**
- ⚠️ **Toda verificación de "la cortadora no escribe en `prod_pedidos_tela`" tiene que aceptar
  esta política.** La regla que usan la 8l y los smoke 8l/8m: una política de escritura sobre esa
  tabla solo vale si es la de admin (`using` y `with check` = `fn_es_admin()`) o un UPDATE con
  `with check (false)`. Se juzga por lo que HACE, no por el nombre.
- **Impacto en otras áreas: ninguno.**

### 2026-10-05 — producción — `schema_fase8l_cortadora_recibe_tela.sql` ⏳ PENDIENTE DE APLICAR

Verificar con `supabase/smoke_test_fase8l.sql` (11 comprobaciones, termina en rollback).
⚠️ **Aplicar ANTES de desplegar**: `useProduccion` ya pide las dos columnas nuevas y, sin ellas,
`/produccion` entera falla al cargar.

- **Qué:** la cortadora confirma la llegada de una tela desde `/cortadora` — mide el ancho, lo
  escribe (siempre en cm) y el pedido pasa a `entregado`. Mateo lo sigue pudiendo hacer en
  `LlegadaTab`, que ahora usa **la misma función**.
- **Columnas nuevas** en `prod_pedidos_tela`: `recibido_por_rol text` (check `admin | cortadora`,
  null = anterior a esta fase, no se inventa) y `ancho_recibido numeric(8,2)`.
- ⚠️ **`ancho_recibido` es una FOTO y no duplica `ancho_real`.** Mateo puede corregir
  `ancho_real` después (Pedidos → Editar, campo nuevo solo en entregados); sin la foto, el aviso
  *"Recibido por la cortadora · ancho X"* le atribuiría a ella un número que puso él. Cuando difieren,
  la pantalla dice los dos. Mismo patrón que `corrida_base` en pedido y en corte.
- **Función nueva:** `fn_recibir_tela(p_pedido_id, p_ancho_real, p_fecha) → jsonb`.
  ⚠️ **Es `SECURITY DEFINER`, la primera RPC de negocio del proyecto que lo es**, y a propósito:
  RLS es de fila, y una política `for update` sobre `prod_pedidos_tela` le dejaría tocar precios,
  proveedor o colores por la API. Así la cortadora **no tiene ninguna política de escritura** sobre
  esa tabla, y la función solo escribe 5 columnas. El precio: la guarda `fn_es_admin() or
  fn_es_cortadora()` de dentro deja de ser cosmética y es **la única barrera**. Se le quitó el
  `EXECUTE` a `anon` y `public`. **No relajar esa guarda.** (La política de la 8m es de UPDATE pero
  con `with check (false)`: bloquea sin escribir, y la verificación final de la 8l la acepta.)
- **Validaciones:** ancho entre 10 y 400 cm (por debajo es un ancho en metros —la base ya los
  mezcla—, por encima, milímetros), fecha no nula y no futura. Los mismos límites viven en
  `src/lib/produccion/recepcion.ts` para avisar antes de enviar: **se mueven juntos**.
- **Idempotencia por estado, sin `idem_id`:** aquí sí basta, porque el registro ya existe. Un pedido
  ya `entregado` devuelve `{"ya_recibido": true, …}` con lo guardado y **no modifica nada** — un
  doble toque, o Mateo y ella a la vez, se ven como aviso y no como error rojo. Con `for update`.
- **No dispara los triggers de las fases 7 / 8g:** el update no nombra `colores` ni `total_metros`,
  y los dos triggers son por columna. La comprobación 7 del smoke lo fija con un pedido cuyo corte
  consumió más de lo que tiene — si la guarda B de la 8g disparara, fallaría.
- **Lectura ampliada:** `cortadora_lee_pedidos` y `cortadora_lee_pedido_colores` dejan de filtrar
  `estado = 'entregado'` (necesita ver lo que viene). Cortes, maquilas y demás **siguen** acotados:
  no hay cortes de una tela que no llegó. `CortadoraApp` separa por estado en el cliente.
- **Pantallas:** `/cortadora` gana la sección *"Por recibir"* (`RecibirTela.tsx`; el ancho arranca
  vacío para obligar a medir). `PedidosTab` muestra el indicador bajo el estado; `LlegadaTab` lista
  lo recibido por ella en los últimos 14 días, porque esas telas desaparecen de sus pendientes
  sin que él las haya tocado.
- **Impacto en otras áreas: ninguno.**

<!-- Nuevas entradas debajo de esta línea -->

### 2026-10-05 — producción — `schema_fase8k_capas_por_color.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8k.sql`: 10/10 — tras pasar por
`supabase/reparar_fase8k.sql`, ver abajo.

- **Corrige a la 8j, que estaba mal:** las capas no son una por corte sino **una por COLOR**. Las
  telas no llegan con el metraje exacto por color y uno puede dar más tendidos que otro. La
  **corrida** (proporción por talla) sí sigue siendo una sola para toda la tela.
- **Columna nueva:** `prod_corte_colores.capas integer` (+ check `capas is null or capas > 0`).
  **`prod_cortes.capas` se ELIMINA**, no se deja como total: sumar capas entre colores no significa
  nada — son tendidos separados, no una cantidad acumulable — y sería un derivado almacenado.
- `prod_cortes.corrida_base` **se queda**: esa sí es una sola para todo el corte.
- **`fn_registrar_corte` pierde `p_capas`** (vuelve a 8 parámetros). Las capas viajan dentro de cada
  elemento de `p_colores`, junto a `tallas` y `metros_usados`.
- ⚠️ **LA LECCIÓN DE ESTA FASE, y es cara:** al aplicarla aparecieron **dos versiones vivas** de
  `fn_registrar_corte` (la de 7 parámetros de la fase 8i y la de 8 nueva), porque un archivo
  anterior se volvió a ejecutar y su `create or replace` **revivió la firma vieja**. Con dos
  sobrecargas, PostgreSQL elige por número de argumentos: `CorteTab` llama con 7 y habría seguido
  registrando cortes **sin guardar las capas y sin dar ningún error**.
  Lo arregló `supabase/reparar_fase8k.sql`, que borra las TRES firmas posibles (7, 8 y 9) antes de
  crear la buena y **verifica al final**, abortando si queda más de una.
- ⚠️ **Y la lección de forma:** en la 8k el `drop column` iba dentro de un `if exists (...) then`, y
  al no entrar esa condición el bloque entero se saltó **en silencio**. Un `alter table ... drop
  column if exists` suelto no se puede saltar. Las condiciones que envuelven varias sentencias
  esconden fallos; las de cada sentencia, no.
- **El descuadre pasa a calcularse por color** (`compararCorte` en `src/lib/produccion/descuadre.ts`).
  El aviso es **por color y no sobre el total**: un total puede salir exacto con dos tendidos mal
  — +8 en Negro y −8 en Crudo se compensan — y nadie iría a mirar. Hay un test que fija ese caso.
- **`supabase/smoke_test_fase8j.sql` queda OBSOLETO**: su comprobación 6 lee `prod_cortes.capas` y
  llama con 9 argumentos. Falla a propósito; no es una regresión.
- **Impacto en otras áreas: ninguno.** `CorteTab` sigue llamando con 7 argumentos — que ahora
  resuelven a la única función viva, con las capas en null.

### 2026-10-02 — producción — `schema_fase8j_cortadora_escritura.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8j.sql`: 11/11. Cierra las piezas 4 y 7 de
`docs/plan_cortadora.md`. El **destino** (pieza 8) y el **costo por hora** (pieza 5) quedan fuera a
propósito.

- **Columnas nuevas:** `prod_pedidos_tela.corrida_base jsonb`, `prod_cortes.corrida_base jsonb` y
  `prod_cortes.capas integer` (+ check `capas is null or capas > 0`). Las tres nullable.
- ⚠️ **La corrida vive en DOS sitios, y no es duplicación.** Un pedido admite VARIOS cortes, así que
  si la corrida viviera solo en el pedido, editarla para un segundo corte cambiaría el significado
  del primero **retroactivamente** y el descuadre de aquel día sería irreconstruible. Por eso:
  `prod_pedidos_tela.corrida_base` es el **PLAN** (mutable, lo edita el admin) y
  `prod_cortes.corrida_base` + `capas` son la **FOTO** (se copian al registrar y no se tocan).
  Mismo patrón que `prod_maquilas.costo_unitario`.
- **jsonb y no tabla normalizada**, al revés que la fase 7 con los colores: lo que hacía daño allí
  no está aquí. Los colores tenían IDENTIDAD y otras filas los REFERENCIABAN; la corrida es un mapa
  plano talla→unidades que se reescribe entero y que nada referencia.
- **Tablas nuevas:** `prod_corte_retazos`, `prod_jornadas`, `prod_jornada_cortes`,
  `prod_corte_insumos`. Las cuatro con RLS + `admin_all_*` + select/insert/update de cortadora.
  **Sin delete**: corregir es editar.
- ⚠️ **`prod_jornada_cortes` es tabla intermedia y no una FK directa**, y no por el caso frecuente
  sino por el raro: un corte grande puede ocupar DOS días. Con `jornada.corte_id` ese corte habría
  que partirlo en jornadas que fingen ser de cortes distintos. Las horas viven en la JORNADA, no en
  el cruce — repartirlas entre cortes sería inventar un dato que nadie midió.
- **Retazos SIN unique `(corte_id, talla)`**: cada fila es un EVENTO de registro, no un acumulado.
  No suman al total del corte — son tela que PODRÍA dar una unidad.
- ⚠️ **`fn_registrar_corte` cambia de firma otra vez: 9 parámetros** (`p_capas`, `p_corrida_base`,
  al final y con default). **DROP + CREATE obligatorio**, no `create or replace`: añadir parámetros
  crearía una SOBRECARGA y una llamada de 7 argumentos iría a la versión vieja, perdiendo capas y
  corrida EN SILENCIO. Es la trampa de la fase 8b. La comprobación 5 del smoke existe para eso.
- **El cálculo del descuadre es puro cliente** (`src/lib/produccion/descuadre.ts`): no hay nada que
  proteger de concurrencia, y lo que se guarda son las cantidades ya ajustadas. La severidad mira el
  TOTAL y no cada talla — un trasvase entre tallas es otro reparto, no una pérdida — y usa
  tolerancia relativa (5%) **y** absoluta (2 unidades), porque con cifras pequeñas el porcentaje
  engaña: 1 de 6 ya es un 17%.
- **Retazos, insumos y jornadas van en llamadas APARTE**, no dentro de la RPC: son eventos que se
  añaden y corrigen después, no necesitan atomicidad con el corte, y meterlos complicaría una
  función ya hardeneada sin ganar nada.
- **Impacto en otras áreas: ninguno.** Las políticas son aditivas y los parámetros nuevos tienen
  default, así que `CorteTab` sigue llamando con 7 argumentos sin cambios.

### 2026-10-02 — producción — `schema_fase8i_rol_cortadora.sql` ✅ EJECUTADA

Rol `cortadora`, **andamiaje de solo lectura**. La escritura llegó en la fase 8j.

- **`user_roles.rol`**: el check pasa a `('admin', 'logistica', 'cortadora')`. El check viejo se
  busca en `pg_constraint` en vez de borrarlo por nombre — si el nombre no coincidiera quedarían
  DOS checks y 'cortadora' seguiría rechazada, en silencio.
- **Función nueva:** `fn_es_cortadora()`, molde idéntico a `fn_es_logistica()`.
- **Nueve políticas `cortadora_lee_*`**, permisivas: se SUMAN a las `admin_all_*`, que no se tocan.
  `prod_prendas` y `prod_maquiladoras` completas; `prod_pedidos_tela` acotada a
  **`estado = 'entregado'`**, y todo lo que cuelga de un pedido hereda ese filtro por `exists`.
- **`fn_registrar_corte`**: la guarda pasa a `fn_es_admin() or fn_es_cortadora()`. Es lo único que
  cambia — el cuerpo se extrae literal de `schema_fase8b_idempotencia.sql` con un script que aborta
  si el diff quita más de 2 líneas. **Aún no puede registrar cortes**: faltan las políticas de
  `insert`, que van con la fase de escritura.
- ⚠️ **RLS ES DE FILA, NO DE COLUMNA.** De las filas que puede leer ve TODAS las columnas, incluidos
  `prod_pedidos_tela.valor_metro` / `total_pagar` y los precios de `prod_prendas`. La pantalla no los
  muestra, pero la API sí. Arreglarlo exige **vistas `security_invoker`**, no políticas.
- ⚠️ **El check de la base y `ZONA_DEL_ROL` de `src/middleware.ts` se mueven JUNTOS.** Añadir un rol
  en SQL y olvidarlo en el mapa lo deja entrando a TODA la app sin restricción, sin ningún error.
- **El middleware deja de ser binario.** Antes era `esLogistica ? ... : ...`, así que todo lo que no
  fuera logística se trataba como admin. Ahora es un mapa explícito; `admin` no está en él y por eso
  entra a todo y sigue aterrizando en `/`. Un usuario SIN fila en `user_roles` se comporta como antes.
- **Pantalla nueva:** `/cortadora` + `components/cortadora/CortadoraApp.tsx`, patrón de dos archivos
  como logística (cliente propio, `reload()` propio, **sin `useProduccion`** — carga trece consultas
  que ella no puede leer y volverían vacías, pareciendo un fallo). Mobile primero. **Solo lectura.**
- **Lo que NO hace y por qué:** registrar capas, retazos, horas e insumos, y ver el destino, necesitan
  tablas y columnas que **no existen** (`prod_cortes` no tiene capas ni horas, no hay tabla de
  insumos, y el destino nunca se guarda — hoy es un parámetro de `fn_procesar_lote_maquila`).
  Son las piezas 4, 7 y 8 de `docs/plan_cortadora.md`.
- **Impacto en otras áreas: ninguno.** Las políticas son aditivas y nada existente cambia.

### 2026-10-02 — producción — `schema_fase8h_consumo_m2.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8h.sql`: 7/7 comprobaciones OK.

- **Columna nueva:** `prod_prendas.consumo_m2 numeric(8,3)` **nullable y sin default**, más el check
  `prod_prendas_consumo_m2_positivo` (`consumo_m2 is null or consumo_m2 > 0`). Puramente aditiva.
- ⚠️ **`consumo_m2` y `consumo_metros` son fuentes INDEPENDIENTES, no se deriva una de otra.**
  `consumo_metros` son metros **lineales** y solo valen para el ancho con el que se midieron;
  `consumo_m2` son metros **cuadrados**, medidos aparte con la experiencia real de corte. Derivarlo
  no aportaría nada porque el ancho se cancela:
  `(usables × ancho/100) ÷ (consumo_metros × ancho/100) = usables ÷ consumo_metros`.
- **Por qué el check:** hace que `null` sea la ÚNICA forma de decir "sin medir". Es un **divisor**, y
  un 0 guardado se leería como dato real — el mismo patrón del `?? 0` del costo de maquila (fase 8e).
- **`numeric(8,3)` y no `(8,2)` como `consumo_metros`**: al ser divisor, redondear a dos decimales
  arrastra el error a todas las unidades estimadas.
- **Sin RLS nueva, y está verificado:** `admin_all_prod_prendas` es `for all … using (fn_es_admin())`
  — de FILA, sin lista de columnas — y el proyecto no declara ni un `grant`, así que valen los de
  Supabase, que son de tabla. Las dos capas cubren solas una columna nueva. (La regla
  "tabla nueva ⇒ RLS + política" es para TABLAS; aquí no se crea ninguna.)
- **PedidosTab** pasa a estimar por área cuando puede: cuenta capas completas sobre la mesa más larga
  de las dos de localStorage, descuenta los `(n−1)` dobleces de 15 cm, y divide el área tendida entre
  `consumo_m2`. **Cae a la fórmula lineal** si falta `consumo_m2`, si no hay mesa configurada, si el
  ancho es menor de 10 cm (parecería estar en metros) o si la tela no da ni para una capa completa.
- ⚠️ **Las prendas arrancan todas sin `consumo_m2`**, así que hasta medir alguna la estimación sigue
  siendo la lineal de siempre. El recuadro lo dice en pantalla para que no parezca que no funciona.
- ⚠️ **PostgREST devuelve los `numeric` como texto y `prendas` se castea sin convertir**
  (`as Prenda[]` sobre un `select("*")`). `estimar()` hace `Number()` explícito; el código viejo
  funcionaba por coerción de JavaScript, no porque el tipo fuera cierto.
- **Impacto en otras áreas: ninguno.**

### 2026-10-02 — producción — Área estimada de corte (pieza 2 del plan de cortadora)

*(No es un cambio de schema: solo TypeScript.)*

- En el modal de corrida, dos mesas con largo editable y, por tela, el área por tendida
  (`largo × ancho real`) más cuántas tendidas daría la tela entera. Opcional y siempre con aviso de
  que es aproximado.
- ⚠️ **Primer uso de `localStorage` en el proyecto.** No existe ninguna tabla de configuración —de
  las 32 tablas ninguna es key-value— y crear una (migración + RLS + smoke test + pantalla) por dos
  números que se miden una vez no se sostiene. Los largos viven en **ese navegador**: otro equipo no
  los ve, ni la cortadora cuando tenga usuario (pieza 3). Mudarlos a una tabla solo exige cambiar
  `leerMesas()` / `guardarMesas()` en `src/lib/produccion/corrida.ts`.
- ⚠️ **Guarda contra el ancho en unidades mezcladas:** por debajo de 10 cm no se calcula nada. Aquí
  el ancho entra en una multiplicación (en la pieza 1 solo se muestra), y un `1.05` migrado daría
  `0.05 m²` — una cifra absurda que podría pasar por buena en una decisión de corte.
- **Impacto en otras áreas: ninguno.**

### 2026-10-02 — producción — Corrida de corte (pieza 1 del plan de cortadora)

*(No es un cambio de schema: solo TypeScript y CSS.)*

- **Qué es:** en `CorteTab`, un botón *"📄 Corrida de corte"* abre un modal donde se eligen varias
  telas entregadas y se escribe, para cada una, cuántas unidades de cada talla salen de **una capa**.
  Se imprime o se guarda como PDF con `window.print()` — sin dependencias nuevas.
- **EFÍMERO**, como la ficha de estampado: no se guarda en Storage ni en la base.
- **La visión completa está en [`docs/plan_cortadora.md`](docs/plan_cortadora.md)** — ocho piezas, de
  las cuales solo esta está construida. Las otras siete son documentación; varias (3, 4, 5, 7, 8)
  **sí tocarían schema**, y la 3 (rol `cortadora`) es el cuello de botella de casi todas.
- ⚠️ **Dato sucio que esto destapó:** `prod_pedidos_tela.ancho_real` está **nulo en la mayoría de los
  pedidos migrados** (nunca pasaron por `LlegadaTab`, que es quien lo escribe y sí lo exige `> 0`), y
  las unidades están **mezcladas**: conviven `150`/`180` (cm, correcto) con `1.05`/`1.45` (metros).
  El documento muestra el valor tal cual y **no convierte nada**; cuando falta el real cae al ancho
  del pedido **con un aviso visible**. Es limpieza de datos pendiente, no de código.
- ⚠️ **Las reglas globales de tabla son del tema oscuro y pisan a la hoja impresa** (`table` trae
  `background: var(--surface)` y `tr:last-child td` quita el borde inferior). Los selectores de
  `.corrida-hoja` ganan por especificidad; si alguien los simplifica, la hoja sale negra sobre negro.
- **Impacto en otras áreas: ninguno.**

### 2026-10-01 — producción — `schema_fase8g_editar_pedido.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8g.sql`: 6/6 comprobaciones OK.

- **Función y trigger nuevos:** `fn_proteger_pedido_con_cortes()` +
  `trg_proteger_pedido_con_cortes` (`before update of colores, total_metros` sobre
  `prod_pedidos_tela`). Aditivo puro: ni tabla ni columna, así que **no hace falta política RLS**.
- **Por qué:** `PedidosTab` gana un modo edición, y editar un pedido con cortes rompía dos cosas
  en silencio. **`colores`:** `trg_sync_pedido_colores` (fase 7, redefinido en la 8c) BORRA las
  filas de `prod_pedido_colores` que ya no estén en el jsonb, y como
  `prod_corte_colores.pedido_color_id` es `on delete set null`, quitar o **renombrar** un color
  dejaba los cortes apuntando a null — se perdía la trazabilidad que construyó la fase 7.
  **`total_metros`:** no tiene ningún check, y el saldo de tela solo se valida al CREAR un corte
  dentro de `fn_registrar_corte`; bajarlo por debajo de lo consumido dejaba el saldo negativo.
- **Trigger y no RPC** porque editar un pedido es **un solo update**: no hay cadena de escrituras
  que hacer atómica, que es lo que justificó las RPC de las fases 7, 8a y 8d. Y el trigger cierra
  una carrera que el cliente no puede cerrar: el update toma el lock de la fila y
  `fn_registrar_corte` hace `select … for update` sobre esa MISMA fila, así que las dos
  operaciones se serializan solas. El cliente valida sobre `data.cortes`, que es una foto.
- ⚠️ **`unidad` y `rendimiento` NO están en la lista de columnas del trigger, a propósito.** En la
  pantalla los tres se bloquean juntos porque ahí `total_metros` **se calcula**
  (suma de colores × rendimiento si es kilos), y bloquear solo los colores dejaría bajar el total
  por el rendimiento. Pero en la base `total_metros` es una columna **almacenada**: vigilarla cubre
  el daño real por cualquier camino. Si alguien añade columnas a esa lista, `LlegadaTab` dejaría de
  poder confirmar entregas de pedidos con cortes — la comprobación 5 del smoke test existe para eso.
- ⚠️ **`estado` no viaja NUNCA en el update de edición.** El alta lo fija en `"pendiente"`; reusar el
  mismo objeto habría devuelto a pendiente un pedido ya entregado, borrando el trabajo de
  `LlegadaTab`. Lo mismo `idempotencia_id`, que identifica un intento de ALTA.
- **Con el pedido bloqueado, el cliente OMITE las cuatro columnas congeladas** en vez de reenviarlas
  iguales: el jsonb rearmado no tiene por qué coincidir con el guardado (en metros se escribe
  `{color, metros}` **sin** la clave `kilos`, y los datos migrados pueden traer más decimales).
  Al no ir la columna, el trigger ni dispara para ella.
- **No se duplicó la validación de saldo en el cliente**: con los tres campos bloqueados sería
  código inalcanzable, el tercer *"mensaje muerto"* del proyecto. La capa de cliente aquí es
  **bloquear los inputs**; el servidor es la autoridad.
- Las validaciones de tela (rendimiento, colores) se saltan cuando está bloqueado: un pedido migrado
  en kilos y **sin rendimiento** habría quedado imposible de editar, justo el caso que motivó la fase.
- **Impacto en otras áreas: ninguno.**

### 2026-10-01 — producción — CorteTab, estimación de unidades por pedido

*(No es un cambio de schema: solo TypeScript.)*

- La tarjeta de cada pedido esperando corte muestra *"Consumo por unidad: X m · con Y m saldrían
  ≈ Z unidades"*, con la misma fórmula y el mismo texto que el recuadro de `PedidosTab`.
- Se calcula sobre **`total_metros`**, no sobre el saldo: la tela de un pedido se dedica entera a su
  propósito. Por eso ese número y el badge *"Saldo de tela"* de al lado **no coinciden** en cuanto
  hay un corte previo; es deliberado.
- Sin prenda asignada (`prenda_id` es opcional) o con `consumo_metros` en 0 no se muestra nada, sin
  aviso — el mismo silencio que ya usaba `PedidosTab`.
- ⚠️ **`prod_prendas.consumo_metros` pasa de tener UN lector a tener DOS** (`PedidosTab` y
  `CorteTab`). Importa para una fase futura: es un parámetro vivo que el historial **no fotografía**,
  el mismo defecto que el pendiente *"Costos fijos no se congelan por mes"*. Si algún día se congela
  al momento del corte —como ya hace `prod_maquilas.costo_unitario`— hay que mirar los dos sitios.
- **Impacto en otras áreas: ninguno.**

### 2026-09-17 — producción — Ficha visual de estampado ✅ (NO toca schema)

*(No es un cambio de schema: ni una tabla, ni una columna, ni una migración. Se anota aquí porque
el registro es donde se busca qué cambió en producción.)*

- **Qué es:** en EstampadosTab, un botón *"Ficha visual"* abre un modal que compone con Canvas una
  imagen de la prenda (frente y espalda) con los diseños en posiciones predefinidas, y la manda a
  un bot de Telegram **aparte** — solo envío, sin IA, sin webhook y sin `bot_pending_actions`.
- **Las fichas son EFÍMERAS por decisión explícita.** No se guardan en Storage ni en la base: las
  imágenes viven en memoria del navegador mientras el modal está abierto. El archivo de verdad
  queda en el chat del bot, **y se busca ahí por la fecha** — por eso la fecha va grande en la
  cabecera de la imagen y en la primera línea del mensaje. Se descartó numerar los lotes: habría
  exigido una columna nueva, porque un número derivado del orden se desplaza en silencio si alguien
  borra un lote a mano y deja apuntando mal a todas las fichas ya enviadas.
- **Por tanto `prod_lotes_estampado.disenos` NO cambia** y sigue siendo `[{ nombre, unidades }]`.
  La ficha **no** resuelve que no se sepa qué tallas llevan qué diseño (el obstáculo de la sección 5
  de [`docs/plan_ficha_estampado.md`](docs/plan_ficha_estampado.md)): imprime el desglose de tallas
  del lote y las unidades por diseño como dos datos sueltos, igual que hoy. Tampoco lo empeora.
- **Archivos nuevos:** seis siluetas SVG en `public/siluetas/` (la carpeta `public/` no existía),
  `src/lib/produccion/posiciones.ts` (catálogo), `src/lib/produccion/ficha.ts` (compositor),
  `components/produccion/FichaEstampadoModal.tsx`, `api/estampados/ficha/route.ts` y
  `tests/posiciones.test.ts`. `sendPhoto` se añade a `src/lib/telegram.ts`. Sin dependencias nuevas.
- ⚠️ **`sendPhoto` recibe el token por parámetro**, a diferencia del resto de `telegram.ts`, que usa
  `BASE()` con `TELEGRAM_BOT_TOKEN` incrustado. Reutilizar `BASE()` mandaría la ficha al chat del
  bot principal **sin dar ningún error**. Y va en `multipart/form-data` **sin fijar `Content-Type`**:
  ponerlo a mano rompe el boundary.
- **El catálogo de posiciones vive en código, no en una tabla**, a propósito: las coordenadas solo
  tienen sentido contra un dibujo concreto, y en la base se desincronizarían en silencio del SVG.
  Son 17 posiciones en camiseta y 18 en sudadera y buso — la camiseta es de manga corta y **no**
  tiene antebrazo. Las mangas guardan **un solo recuadro** y el otro sale por espejo; lo que se
  refleja es el recuadro, **nunca el dibujo** (un logo volteado saldría al revés en una manga).
- Izquierda y derecha son siempre **las de quien usa la prenda**: el pecho izquierdo se dibuja a la
  derecha del lienzo.
- **Impacto en otras áreas: ninguno.**

### ⏳ PENDIENTE — producción — Costos fijos no se congelan por mes

- `ResumenTab` calcula `cfPorUnidad` sumando los costos fijos **vigentes hoy** y lo multiplica por
  las unidades cortadas de cualquier mes. Editar o borrar un costo fijo **reescribe el resultado de
  todos los meses pasados**.
- **No es el bug de desvinculación de la fase 8e:** ninguna FK apunta a `prod_costos_fijos`, así que
  borrar uno no deja nada huérfano. El problema es que es un **derivado que debería fotografiarse**
  al momento del corte, como ya hace `prod_maquilas.costo_unitario`. Por eso quedó fuera de la 8e:
  mezclarlos habría confundido dos bugs de naturaleza distinta.
- Investigación aparte. `CostosTab` conserva su mensaje muerto *"No se pudo eliminar."*, que también
  es inalcanzable, pero es ruido cosmético comparado con lo anterior.

### 2026-09-10 — producción — `schema_fase8e_archivar_catalogos.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8e.sql`: 3/3 comprobaciones OK. Cierra el **bug 1.1**.

- **Columnas nuevas:** `archivada_en timestamptz` (null = activa) en `prod_prendas`,
  `prod_proveedores`, `prod_maquiladoras` y `prod_talleres`. Migración puramente aditiva.
- **Por qué:** las cinco FK hacia esos catálogos son `on delete set null`, así que borrar **nunca
  fallaba** pero desvinculaba el historial en silencio. Peor: contaminaba registros nuevos — un corte
  registrado después entraba con `costo_maquila 0`, congelado para siempre en `prod_maquilas`; un
  despacho a local con `ingreso 0`; y un pedido sin proveedor **deja de contarse como atrasado** en
  el resumen del lunes, sin aviso. Los mensajes *"No se pudo eliminar…"* de `PrendasTab` y
  `ProveedoresTab` eran **código muerto**: nunca se ejecutaban.
- **El borrado desapareció de la interfaz.** Solo se archiva, siempre, y es reversible. Se descartó
  el híbrido "borrar si no hay historial" para no introducir una condición de carrera
  (comprobar-y-actuar) ni cuatro consultas de conteo duplicadas.
- ⚠️ **La regla que hay que respetar al añadir cualquier desplegable nuevo:**
  **cargar todas las filas, filtrar solo donde se ELIGE.** `useProduccion` sigue trayendo activas y
  archivadas con `select("*")`. Si se filtraran ahí, todo `find()` que resuelve un id del historial
  devolvería `undefined` y **se reintroduciría exactamente el bug que esto cierra**.
  Los cinco puntos donde se elige, y por tanto se filtra: los dos desplegables de `PedidosTab`,
  el de maquiladora en `CorteTab`, el de taller en `EstampadosTab`, y el de maquiladora en
  `MaquilaTab` — este último **conserva la ya seleccionada aunque esté archivada**, porque está
  enlazado a un valor guardado y en blanco un cambio accidental la borraría.
- El índice único de `nombre` en maquiladoras y talleres **no distingue activos de archivados**: un
  nombre archivado sigue ocupando el sitio. `CatalogoCard` lo explica en el mensaje de error en vez
  de cambiar el índice.
- **Impacto en otras áreas: ninguno.**

### 2026-09-10 — producción — StockTab, "Ingreso online (30 días)" en UTC ✅ RESUELTO

*(No es un cambio de schema: solo TypeScript. Se anota aquí porque estaba pendiente en este registro.)*

- `StockTab` calculaba el corte de la ventana con
  `new Date(Date.now() - 30*86400000).toISOString().slice(0,10)`, que es **UTC**. Entre las 19:00 y
  medianoche en Ecuador el corte caía un día tarde y la ventana dejaba fuera el día más antiguo de
  ventas. Ahora usa `sumarDias(hoyEcuador(), -30)`.
- **Utilidad nueva:** `sumarDias(iso, dias)` en `src/lib/fechas.ts` — días de calendario, negativo
  para restar, anclada a mediodía UTC como el resto del archivo. No existía: `sumarDiasLaborables`
  salta fines de semana y habría dado un rango distinto.
- Cubierto por `tests/fechas.test.ts` con los bordes que rompen la aritmética ingenua (fin de mes,
  cambio de año, la ventana de 30 días). **No es verificable en pantalla de forma fiable**: los dos
  cálculos coinciden 19 horas de cada 24.
- **Pendiente relacionado:** el mismo patrón UTC sigue en cinco sitios de servidor —
  `cron/resumen` (×2), el webhook de Telegram y `bot/tools.ts` (×2). Ahora que `sumarDias` existe,
  unificarlos es trivial, pero son del área del bot y quedaron fuera de este commit.

### 2026-09-10 — producción — `schema_fase8d_venta_atomica.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8d.sql`: 9/9 comprobaciones OK.

- **Función nueva:** `fn_confirmar_venta_online(stock_id, cantidad, precio, fecha, idem_id) → jsonb`.
  Reemplaza a `StockTab.confirmarVenta()`, que hacía insert de venta + update de stock por separado
  y sin transacción.
- **El fallo grave no era el stock negativo** (el `check (disponibles >= 0)` ya lo impedía) sino que
  el update era **absoluto**: `disponibles: venta.disponibles - cant`, con `venta.disponibles`
  tomado del estado de la pantalla. Stock real 3, pantalla mostrando 10, vender 2 → escribía 8, es
  decir **inventaba 5 unidades**, y ningún check lo detectaba porque 8 es positivo. Ahora el
  descuento es relativo (`disponibles - N`) y se calcula dentro de la base.
- **Columna nueva:** `prod_ventas_online.idempotencia_id` (uuid, nullable) + índice único
  `uq_ventas_online_idempotencia`. Mismo patrón que la fase 8b: una venta es un evento nuevo por
  naturaleza, pero un reintento tras timeout sí duplicaría, y eso es lo que la clave evita.
- ⚠️ **El orden dentro de la función importa:** el chequeo del `idem_id` va **después** del lock del
  stock (para que dos llamadas simultáneas se serialicen) y **antes** de validar disponibilidad (si
  fuera después, un reintento chocaría contra el stock que la primera llamada ya descontó y
  levantaría un *"solo quedan N"* falso sobre una venta que sí se registró).
- Los datos descriptivos de la venta (prenda, color, estampado, talla) salen de la fila de stock, no
  del cliente: una pantalla desactualizada ya no puede registrar una venta con datos viejos.
- **`prod_ventas_online.fecha`** pasa de `default current_date` (UTC) a `default fn_hoy_ecuador()`.
  La RPC siempre manda la fecha explícita, pero el default seguía mal para inserts manuales.
- `StockTab` gana además el guard `ocupado` que no tenía: era el único de los tres formularios sin
  protección contra doble clic.
- **Impacto en otras áreas: ninguno.**

### 2026-09-10 — producción — `schema_fase8c_colores_repetidos.sql` ✅ EJECUTADA

Verificada con `supabase/smoke_test_fase8c.sql`: 5/5 comprobaciones OK.


- ⚠️ **`fn_sync_pedido_colores` queda REDEFINIDA aquí. La versión de
  `schema_fase7_colores.sql` está OBSOLETA** — le falta la validación de repetidos. Cualquiera que
  lea la fase 7 buscando esta función estará leyendo código que ya no es el vigente. Basta
  `create or replace`: misma firma, sin drop.
- **Qué añade:** antes del `INSERT ... ON CONFLICT`, detecta nombres de color que colisionan al
  normalizar (`lower(btrim(color))`, el mismo criterio del índice único de `prod_pedido_colores`) y
  levanta una excepción propia en español.
- **Por qué:** un `INSERT ... ON CONFLICT` no puede tocar la misma fila dos veces. Con "Negro" y
  "negro" en el mismo pedido, Postgres levantaba *"ON CONFLICT DO UPDATE command cannot affect row a
  second time"*, que PedidosTab mostraba tal cual — sin decir qué colores chocaban ni por qué.
- El cliente valida lo mismo antes de enviar (`PedidosTab.guardar`); esta defensa cubre al bot, al
  SQL manual y a migraciones futuras que no pasen por esa pantalla.
- **Sin datos que limpiar:** no puede haber pedidos con colores duplicados normalizados. El backfill
  de la fase 7 hacía un `insert ... select` sin `on conflict` contra un índice único, así que si
  hubiera existido alguno la migración habría fallado — y no falló.
- **Tildes no se normalizan:** "Café" y "Cafe" son colores distintos, en el cliente y en la base.
  Coherente entre ambos; normalizarlas exigiría cambiar el índice único.
- Verificable con `supabase/smoke_test_fase8c.sql` (5 comprobaciones, termina en rollback).
- **Impacto en otras áreas: ninguno.**

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
