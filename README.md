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

## Estructura

- `src/lib/parser.ts` — parser del Excel (lógica portada del prototipo validado)
- `src/app/api/snapshots/route.ts` — carga: parseo en servidor, conflicto de periodo, inserción
- `supabase/schema.sql` — esquema completo (tablas, RLS, bucket)
- `src/app/page.tsx` — historial de snapshots + carga
- `src/app/snapshots/[id]/page.tsx` — detalle: resumen, top productos, alertas
