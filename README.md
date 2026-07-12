# Panorama — Bear & Trend

App web para cargar el reporte de ventas/existencia de Adosoft/VATEX, guardarlo como
snapshot histórico y ver: resumen de ventas (ingreso neto post-comisión), top productos
y alertas de stock por local.

**Stack**: Next.js (App Router) + Supabase (Postgres + Storage + Auth) + Vercel.

## Fase 1 — qué hace

- Carga manual del Excel de Adosoft (un solo archivo con las dos hojas). Detecta las
  hojas por **contenido** de encabezados, no por nombre (soporta typos como "exixtsnecia").
- Cada carga se guarda como **snapshot** con su periodo (desde/hasta). Si ya existe un
  snapshot del mismo periodo, avisa y deja elegir: reemplazar o guardar aparte.
- Resumen: unidades, ingreso neto (columna "PRECIO TOTAL 61.2%" del reporte, ya calculada),
  top productos por neto.
- Alertas de stock: existencia ≤ 5 **y** movimiento real en el periodo (venta o ingreso).
  Este filtro es el validado en el prototipo (3,256 → 215 alertas reales).
- El archivo original queda guardado en Storage (bucket `reportes`) para reprocesar.

Fuera de fase 1 (los ganchos ya existen): comparación entre periodos (snapshots fechados),
margen por producto (tabla `products` lista para costos), agrupación por modelo base
(columna `products.modelo_base`).

## Setup (una sola vez)

1. **Supabase**: crea un proyecto en [supabase.com](https://supabase.com). En el
   **SQL Editor**, pega y ejecuta el contenido completo de `supabase/schema.sql`.
2. **Usuario**: en Authentication → Users → *Add user*, crea tu usuario con correo y
   contraseña (no hay registro abierto en la app, a propósito).
3. **Credenciales**: copia `.env.local.example` a `.env.local` y llena con
   Settings → API → *Project URL* y *anon public key*.
4. **Local**:
   ```
   npm install
   npm run dev
   ```
   Abre http://localhost:3000 y entra con tu usuario.

## Deploy en Vercel

1. Sube este repo a GitHub (privado).
2. En [vercel.com](https://vercel.com): *New Project* → importa el repo.
3. En Environment Variables agrega `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (los mismos de `.env.local`).
4. Deploy. Listo — la app queda protegida por login.

## Tests

```
npm test
```

Corre el parser contra el archivo real de muestra (`tests/fixtures/`) y verifica las
cifras de referencia: 115 líneas de venta, 283 unidades, $4,421.98 neto, 11 locales,
4,136 líneas de stock y exactamente 215 alertas.

## Fase 2 — bot de Telegram

El bot vive en el mismo backend (`/api/telegram/webhook`). Funciones: carga del Excel
por Telegram (caption con el periodo, ej. "1/6 al 30/6"), registro de pagos/gastos por
texto, lectura de cheques por foto (con confirmación por botones), consultas en lenguaje
natural (Claude Haiku 4.5 con herramientas — la IA nunca toca la base directamente) y
resumen semanal cada lunes 7:00 (Ecuador) vía cron de Vercel.

Setup adicional (una sola vez):

1. Ejecuta `supabase/schema_fase2.sql` en el SQL Editor de Supabase.
2. Completa en `.env.local` (y en Vercel → Environment Variables): `ANTHROPIC_API_KEY`,
   `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_MODEL`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`,
   `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Settings → API → service_role) y
   `TELEGRAM_ALLOWED_CHAT_ID` (el bot te lo dice la primera vez que le escribas).
3. Con la app ya desplegada, registra el webhook:
   ```
   node scripts/set-webhook.mjs https://tu-app.vercel.app
   ```
4. Prueba de la integración con Claude sin tocar Telegram: `node scripts/smoke-claude.mjs`.

## Fase 3 — Control de Producción (/produccion)

La app de producción (antes HTML independiente con localStorage/Supabase propio) vive ahora
en `/produccion`, detrás del mismo login: prendas, proveedores, costos fijos, pedidos de tela,
llegada, corte (con inventario de tela y cortes parciales), maquila, envío (estampado / stock
online / locales con vínculo opcional a productos VATEX), estampados (costo configurable y
validación de unidades), venta online (con fecha y precio reales) y resumen mensual coherente.

Setup (una sola vez):

1. Ejecuta `supabase/schema_fase3.sql` en el SQL Editor de Supabase.
2. Ejecuta `supabase/migracion_produccion.sql` (una sola vez) — trae los datos del proyecto
   viejo de Supabase de la app original. Regenerable con
   `node scripts/generar-migracion-produccion.mjs`.

El bot puede consultar producción: "¿cuánta tela me queda?", "¿qué hay en maquila?",
"stock online". El resumen del lunes avisa de pedidos de tela atrasados.

## Fase 4 — Costos reales y margen (/costos)

Tabla `costos_prendas` (los derivados nunca se guardan: `costo_total` es columna generada
y ganancias/márgenes se calculan al vuelo) + `costos_vinculos` (vínculo manual código→costo).
Pantalla `/costos`: edición inline con recálculo en vivo, keywords de auto-asignación
(regla: "COLOR ENTERO" = básica) y vinculación manual de productos sin match. El detalle
de cada snapshot muestra la ganancia estimada del periodo con su % de cobertura, y el bot
responde `margen_producto` ("¿cuánto me deja la camiseta?").

Setup: ejecutar `supabase/schema_fase4.sql` y luego `supabase/migracion_costos.sql`
(regenerable con `node scripts/generar-migracion-costos.mjs "ruta/al/excel.xlsx"`).

## Fase 5 — Finanzas (/finanzas)

`cuentas_por_cobrar` y `cuentas_por_pagar` (schema_fase5.sql; extiende `cheques` con
vínculo a cuentas). Pantalla con 3 pestañas: por cobrar (semáforo de urgencia), por pagar
(marcar pagada registra el gasto en `movimientos` automáticamente) y flujo de caja a 30
días (entradas vs salidas, incluye cheques). El estado "vencido" se calcula, no se guarda.
Bot: `flujo_semana` ("¿qué tengo que pagar esta semana?"), lunes con facturas vencidas y
pagos próximos, y cron diario 8:00 Ecuador (`/api/cron/urgencias`) que avisa solo si algo
vence en menos de 3 días — repite cada mañana mientras siga pendiente.

## Fase 6 — Logística y roles (/logistica)

`schema_fase6.sql` **reescribe la seguridad de toda la base**: tabla `user_roles`
(admin / logistica), funciones `fn_es_admin()`/`fn_es_logistica()`, y políticas RLS
admin-only en todas las tablas de negocio. El rol logistica solo puede: subir guías,
ver las suyas y leer el catálogo `products`. El middleware la enruta siempre a
`/logistica`. El bot y los crons usan service role — no les afecta.

Guías de transferencia: fecha, local VATEX, productos con cantidades/precios,
"recibido por" y foto opcional (bucket `guias`). En /produccion → Envío, el admin ve
el cruce guía↔envío (mismo local, ±3 días, unidades) con semáforo de discrepancias
(por eso Envío ahora pide "local destino" al mandar lotes a locales).

Alta de la usuaria: ejecutar schema_fase6.sql → crear su cuenta en Authentication →
Users → `insert into user_roles (user_id, rol) values ('<su-uuid>', 'logistica')` →
darle la URL de la app.

## Actualización — match por categorías y bot de logística

Ejecutar `supabase/actualizacion_match_y_bot.sql`. El match de costos funciona por
**reglas de categoría** definidas una vez en /costos: "debe contener" (todas, con
alternativas `A|B`) y "no debe contener" (ninguna) — ej. HODDIE sin BASICA → hoddies
estampadas. Lo que no matchea cae en "sin categoría" sin bloquear el cálculo. /costos
también permite agregar prendas nuevas.

Bot de logística: la usuaria manda la **foto de la guía** por Telegram; la IA extrae
local, productos, cantidades y precios; ella confirma con un botón (o corrige por
texto) y recién ahí se guarda con la foto de respaldo. Registro: ella le escribe
/start al bot (que le dice su chat_id) y el admin ejecuta
`update user_roles set telegram_chat_id = '<chat_id>' where rol = 'logistica';`

## Estructura

- `src/lib/parser.ts` — parser del Excel (lógica portada del prototipo validado)
- `src/app/api/snapshots/route.ts` — carga: parseo en servidor, conflicto de periodo, inserción
- `supabase/schema.sql` — esquema completo (tablas, RLS, bucket)
- `src/app/page.tsx` — historial de snapshots + carga
- `src/app/snapshots/[id]/page.tsx` — detalle: resumen, top productos, alertas
