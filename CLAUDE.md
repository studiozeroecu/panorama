# Panorama — worktree de FINANZAS (rama `finanzas`)

App de Bear & Trend: Next.js (App Router) + Supabase (Postgres, Storage, Auth) + Vercel.
Este worktree trabaja **solo el área de Finanzas**. Las otras áreas tienen su propio
worktree en `D:\AGENTE BT\`: `panorama-bot`, `panorama-costos`, `panorama-logistica`,
`panorama-produccion`. El repo principal está en `D:\AGENTE BT\panorama`.

Este documento describe el esquema **después de `supabase/finanzas_v2_sql1_ampliar.sql`**,
sacado de los archivos `.sql` (no de la base real). Si la base y este archivo no
coinciden, manda la base: avisar y corregir este documento.

---

## Reglas de trabajo

- **Por fases, con aprobación del dueño al final de cada una.** No avanzar de fase sin
  aprobación. Fases: 1A SQL-1 y prueba en seco · 1B lógica `src/lib/finanzas/` y
  pantallas Quincena/Mes/Deudas · 1C bot mínimo y alertas · 2 riesgo de protesto
  (cheques vs saldo por banco) · 3 sueldo y retiros · 4 deudas generales · 5 ingresos y VATEX.
- **La base no se toca desde aquí.** Los cambios de base se entregan como `.sql` y los
  ejecuta el dueño en el SQL Editor de Supabase. Los diagnósticos usan solo `select`.
- **Archivos `.sql`:** sin `begin`/`commit`, repetibles sin daño (`if not exists`,
  `create or replace`, `drop ... if exists` + `create`).
  - **El SQL Editor de Supabase puede repartir las sentencias entre conexiones.** Por eso
    cada cambio de base es **un solo bloque `do $nombre$ ... $nombre$;`**, que se aplica
    todo o nada.
  - Nunca depender de tablas temporales, de `set` ni de datos de la conexión entre
    sentencias.
- **Prueba en seco:** también es un solo bloque `do`.
  - Ejecuta el SQL con `execute` dos veces (para probar que se puede repetir), corre las
    pruebas guardando el resultado en variables del bloque, y **siempre termina con
    `raise exception`**: "PRUEBA OK - se deshace todo" o la lista de fallas. Así nada
    queda guardado.
  - Se arma pegando el `.sql` real dentro del bloque. Si el `.sql` cambia, se vuelve a
    armar.
- **Orden de entrega:** primero un SQL que solo **amplía** (el código publicado sigue
  funcionando), después se publica el código, y al final un SQL que **cierra** (quita lo
  viejo). Publicar fuera de los horarios de los crons (13:00 UTC diario, 12:00 UTC lunes).
- **Fechas:** siempre hora de Ecuador. En código: `hoyEcuador()` de `src/lib/fechas.ts`;
  nunca `new Date().toISOString().slice(0,10)`. En la base: `fn_hoy_ecuador()`.
- **No guardar valores que se pueden calcular** (saldos, "pagada", días de atraso,
  antigüedad): se calculan en vistas.
- **Seguridad:** toda tabla nueva con RLS y la regla de admin
  (`using (fn_es_admin()) with check (fn_es_admin())`); toda vista con
  `security_invoker = true`; ninguna función ejecutable por `anon` ni `public`.
- **Gastos:** todo total de gastos (web y bot) filtra por ámbito; por defecto **solo
  empresa**, con opción explícita de incluir personal. Rentabilidad: solo empresa
  (`v_movimientos.cuenta_en_rentabilidad`).
- **Pagar es todo o nada:** usar las funciones de la base (`pagar_cuota`, `abonar_deuda`),
  nunca "update + insert" desde el código.
- **Datos borrados (octubre 2026):** las tablas de finanzas se vaciaron. Copia en
  `respaldo_2026_10_cuentas_por_pagar`, `respaldo_2026_10_cheques`,
  `respaldo_2026_10_movimientos` y `respaldo_2026_10_cuentas_por_cobrar` (con RLS y sin
  políticas: no se ven desde la app). Las finanzas **empiezan el 1 de octubre de 2026**.
- **Respuestas al dueño:** en español simple, sin jerga.

---

## Tablas del área

| Tabla | Dueña | Para qué |
|---|---|---|
| `cuentas_por_pagar` | Finanzas | Deudas |
| `cheques` | Finanzas, **compartida con el bot** | Todos los pagos programados (cuotas): cheque, transferencia o efectivo. También cheques sueltos |
| `cheques_reprogramaciones` | Finanzas | Historial de cambios de fecha o número de cada cheque |
| `movimientos` | Finanzas, **compartida con el bot** | Gastos e ingresos reales |
| `cuentas_dinero` | Finanzas | Bancos y efectivo |
| `saldos_caja` | Finanzas | Foto del saldo de cada cuenta con fecha |
| `cuentas_por_cobrar` | Finanzas | Por cobrar (se rediseña en la fase 5, VATEX) |

Finanzas también **lee** sin escribir: `snapshots` (ventas, fase 5),
`prod_ventas_online` (producción, fase 5), `user_roles` vía `fn_es_admin()`. Usa
`bot_pending_actions` (tipo `urgencias`) en la alerta diaria.

**Vínculos entre tablas (FK):**

- `cheques.cuenta_por_pagar_id` → `cuentas_por_pagar.id`, **on delete restrict**. Vacío =
  cheque suelto. Antes era `set null`.
- `cheques.cuenta_origen_id` → `cuentas_dinero.id` (restrict).
- `cheques_reprogramaciones.cheque_id` → `cheques.id` (restrict).
- `movimientos.cheque_id` → `cheques.id` (restrict). **Único**: un pago genera un solo gasto.
- `movimientos.cuenta_por_pagar_id` → `cuentas_por_pagar.id` (restrict).
- `saldos_caja.cuenta_id` → `cuentas_dinero.id` (restrict).

Nada se borra: las deudas tienen `anulada`, los cheques el estado `anulado`.

---

## Esquema

### `cuentas_por_pagar` (deuda)

| Columna | Notas |
|---|---|
| `id`, `created_at` | |
| `proveedor`, `concepto` | a quién se le debe |
| `monto` | total adeudado (>0). En deudas anteriores a octubre = **saldo al 1 de octubre** |
| `monto_original` | opcional, informativo |
| `tipo_deuda` | `proveedor` · `prestamo` · `tarjeta` · `familia` · `sueldo` · `otra` (default `proveedor`) |
| `exigibilidad` | `firme` · `flexible` (default `firme`) |
| `fecha_estimada` | opcional; **solo** si es flexible |
| `es_saldo_inicial` | viene de antes del 1 de octubre de 2026 |
| `cuota_mensual`, `saldo_al` | opcionales (préstamos o tarjetas: cuota y fecha del saldo informado) |
| `documento_tipo` | opcional: `factura` · `nota_venta` · `promedio` · `otro` |
| `documento_numero` | opcional |
| `fecha_factura` | fecha del documento; **opcional**; por defecto hoy en Ecuador |
| `categoria` | `maquila` · `estampado` · `corte` · `arriendo` · `servicios` · `transporte` · `sueldos` · `otros` (+ `personal`, que es legado y se quita en SQL-2) |
| `ambito` | `empresa` · `personal` |
| `anulada` | en vez de borrar |
| `notas` | |
| **Legado (se quitan en SQL-2):** `fecha_vencimiento`, `tipo_pago`, `estado`, `fecha_pago`, `alertado_hasta` | el código nuevo no las usa: fechas y estado salen de los cheques |

### `cheques` (pago programado / cuota)

| Columna | Notas |
|---|---|
| `id`, `created_at` | |
| `tipo` | `por_pagar` · `por_cobrar` |
| `medio` | `cheque` · `transferencia` · `efectivo` (default `cheque`) |
| `monto`, `beneficiario`, `banco`, `numero`, `fecha_emision`, `foto_path`, `notas` | como antes |
| `cuenta_por_pagar_id` | deuda a la que pertenece. Solo para `por_pagar`; vacío = suelto |
| `cuenta_origen_id` | de qué cuenta mía sale (`cuentas_dinero`) |
| `categoria`, `ambito` | solo para pagos sueltos. Si tiene deuda, mandan los de la deuda |
| `fecha_cobro` | **fecha vigente** (la que usa todo el código) |
| `fecha_original` | la primera fecha pactada. La pone la base y **no se puede cambiar** |
| `fecha_reprogramada` | fecha nueva de la última reprogramación (= `fecha_cobro`) o vacía |
| `tipo_reprogramacion` | `acordada` (con el proveedor) · `cambiado_devuelto` |
| `nota_reprogramacion` | |
| `estado` | `pendiente` · `pagado` · `cobrado` · `rebotado` · `anulado`. `pagado` = lo pagué yo; `cobrado` debería ser solo para por_cobrar, pero se acepta en por_pagar por el código viejo hasta SQL-2 |
| `fecha_pago` | obligatoria si está `pagado` |
| `alertado_hasta` | silencio de la alerta diaria |

### `cheques_reprogramaciones` (historial; solo se agrega)

`cheque_id`, `fecha_anterior`, `fecha_nueva`, `numero_anterior`, `numero_nuevo`,
`estado_anterior`, `tipo` (`acordada` · `cambiado_devuelto` · vacío = cambio directo sin
motivo), `nota`, `hecho_por` (usuario), `created_at`.
La escribe solo la base (trigger). La app solo la puede leer.

### `movimientos`

Columnas de antes (`fecha` (por defecto hoy en Ecuador), `tipo` gasto/ingreso, `monto`,
`concepto`, `categoria`, `origen`), más:
`ambito` (`empresa` · `personal`, default empresa), `cheque_id` (único),
`cuenta_por_pagar_id`.

### `cuentas_dinero`

`nombre` (único), `tipo` (`banco` · `efectivo`), `banco`, `ambito`, `activa`, `notas`.

### `saldos_caja`

`fecha`, `cuenta_id`, `monto` (puede ser negativo), `notas`. Una foto por cuenta y por
fecha. **La app no mantiene el saldo sola.**

### `cuentas_por_cobrar`

Sin cambios de columnas en SQL-1. Solo `fecha_factura` pasa a tener por defecto la fecha
de hoy en Ecuador. Se rediseña en la fase 5 (liquidaciones de VATEX).

---

## Reglas que cumple la base sola

1. **Suma de pagos** (trigger diferido `fin_validar_cuotas`, en `cheques` y
   `cuentas_por_pagar`; se revisa al final de cada operación). Los pagos no anulados de
   una deuda:
   - nunca suman más que el `monto`;
   - en una deuda **firme con pagos pendientes**, suman **exacto**.
   - Una flexible puede quedar por debajo (abonos). Los rebotados **sí** cuentan en la
     suma, porque la deuda sigue.
2. **Fechas de cheques** (trigger `fin_cheques_fechas`):
   - `fecha_original` se fija sola y no se pisa.
   - Todo cambio de `fecha_cobro`, o de número al reprogramar, agrega una fila al historial.
   - Los campos de reprogramación solo cambian reprogramando.
3. **Nada se borra si tiene historia:** deuda con pagos, pago con gasto, pago con
   historial (FK restrict).
4. **Un pago, un gasto:** índice único `fin_movimientos_un_gasto_por_pago`.
5. Fecha estimada solo en flexibles; `pagado` exige `fecha_pago`; solo un `por_pagar`
   puede tener deuda.

## Funciones (llamar con `supabase.rpc`)

Todas revisan: admin, `service_role` (bot y crons) o SQL Editor. Corren con los permisos
de quien llama. Ninguna la puede usar `anon`.

| Función | Qué hace | Protección contra duplicados |
|---|---|---|
| `crear_deuda(p_deuda jsonb, p_cuotas jsonb)` → uuid | Deuda + pagos programados juntos. Una firme nueva necesita al menos un pago | Si `p_deuda.id` ya existe, devuelve ese id sin hacer nada |
| `pagar_cuota(p_cheque_id, p_fecha?, p_origen?)` → jsonb | Marca pagado + crea el gasto ligado. También pagos personales (ámbito personal) | Si ya estaba pagado responde `ya_pagado` |
| `abonar_deuda(p_deuda_id, p_monto, p_id_operacion, p_fecha?, p_medio?, p_cuenta_origen_id?, p_origen?, p_notas?)` → jsonb | Para deudas sin pagos programados (flexibles, sueldo, informativas). Crea el pago ya pagado + el gasto. No puede pasar de lo sin programar | `p_id_operacion` lo genera la pantalla o el bot; repetido → `ya_registrado` |
| `reprogramar_cheque(p_cheque_id, p_nueva_fecha, p_tipo, p_nota?, p_nuevo_numero?)` → jsonb | Solo pendientes o rebotados. Un rebotado reprogramado vuelve a `pendiente` y se limpia `alertado_hasta` | — |
| `fn_hoy_ecuador()` → date | Fecha de hoy en Ecuador | — |

Internas (solo triggers): `fn_validar_cuotas_deuda`, `fn_trg_validar_cuotas`,
`fn_trg_cheques_fechas`.

**Sueldo de Mateo:** deuda `tipo_deuda = 'sueldo'`, `exigibilidad = 'flexible'`,
categoría `sueldos`. Los retiros se registran con `abonar_deuda` y **no cuentan como
gasto nuevo**. Cuándo y cómo se reconoce el sueldo como gasto se decide en la fase 3.

## Vistas (todas `security_invoker = true`)

- **`v_deudas`:** cada deuda con `total_pagado`, `total_pendiente` (va al calendario),
  `total_rebotado` (sección roja, **no** va al calendario), `saldo` = monto − pagado,
  `sin_programar` = monto − pagado − pendiente − rebotado (sección "Deudas sin fecha":
  suma al total adeudado, no a quincena ni a mes), `cuotas_pendientes`, `proxima_fecha`,
  `estado_calculado` (pendiente · pagada · anulada).
- **`v_cheques`:** cada cheque con su deuda, `cuenta_origen`, `categoria_efectiva`,
  `ambito_efectivo`, `reprogramado`, `veces_reprogramado`, `dias_para_fecha`.
- **`v_movimientos`:** cada movimiento con `cuenta_en_rentabilidad`. Es verdadero solo si
  es gasto de empresa y no viene de una deuda anterior a octubre ni de una deuda de tipo
  préstamo, tarjeta, familia o sueldo.
- **`v_caja_actual`:** última foto por cuenta activa, `dias_antiguedad` y `aviso`
  (`ok` · `ambar` desde 7 días · `rojo` desde 15).

---

## Código de Finanzas (fase 1B)

- `src/lib/finanzas/`:
  - `tipos.ts`: filas de las vistas.
  - `categorias.ts`: listas únicas (categorías, ámbitos, tipos de deuda, medios).
  - `formato.ts`: el único `money()` y las sumas en centavos.
  - `periodos.ts`: quincenas y meses en hora de Ecuador.
  - `cuotas.ts`: generador "30/60/90/120" (los centavos que sobran van a la última
    cuota) y la misma validación que la base.
  - `cargar.ts`: **único lugar que consulta la base**. Lee por páginas, y si falla lanza
    `ErrorCarga` con "No se pudo cargar X — los totales no son confiables".
  - `agenda.ts`: **`armarAgenda`, la única función de "qué hay que pagar"**. Es pura y
    tiene pruebas. La usan la web, el bot (`flujo_semana`), la alerta diaria y el
    resumen del lunes.
  - `alertas.ts` (1C): qué avisa la alerta diaria (pagos a menos de 3 días o vencidos, y
    rebotados, sin silenciar).
  - `textos.ts` (1C): cómo se cuenta la agenda en el bot (texto plano) y en Telegram
    (HTML con `esc`).
  - `ids.ts` (1C): buscar un cheque por su id corto **por rango** de uuid. La base no
    acepta `like` sobre un uuid.
- `src/components/finanzas/`:
  - `FinanzasApp.tsx`: solo las pestañas.
  - `VistaPeriodo.tsx`: quincena y mes.
  - `Deudas.tsx`.
  - `FormDeuda.tsx`: deuda + pagos con `crear_deuda`.
  - `ModalesPago.tsx`: `pagar_cuota` y `abonar_deuda`.
  - `PorCobrar.tsx`: versión simple hasta la fase 5.
  - `comunes.tsx`.
- Pruebas: `tests/finanzas-*.test.ts`.

## Decisiones tomadas

1. Se mantiene la tabla `cheques` (con columna `medio`) para todas las cuotas.
2. Los pagos personales se registran como movimiento con `ambito = 'personal'`.
3. Una deuda flexible con fecha estimada aparece en gris como "posible", **sin sumar**.
4. Aviso de caja: 7 días ámbar, 15 rojo.
5. La categoría `personal` pasa a llamarse `sueldos`. El ámbito empresa/personal se mantiene.
6. Escenario A (fase 5): una liquidación atrasada solo cuenta si su fecha esperada fue
   reprogramada a una fecha futura.
7. Cheques rebotados: sección roja visible hasta resolverse, nunca sumados en silencio
   al calendario.

## Pendiente por fase (no está en SQL-1)

- **1B:** hecha y aprobada (pantallas Quincena · Mes · Deudas).
- **1C:** código listo, **pendiente de aprobación y de publicar**.
  - `tools.ts`: categorías, ámbito, fechas, totales sin tope, `actualizar_cheque` por
    rango + `pagar_cuota`, `flujo_semana` con la agenda.
  - `webhook`: toma atómica del botón, "Marcar todos como pagados" con `pagar_cuota`,
    silencio en hora de Ecuador.
  - `cron/urgencias`: reescrito.
  - `cron/resumen`: pagos con la agenda, gastos solo de empresa.
  - `claude.ts`: reglas de categorías, ámbito y "ventas no es dinero cobrado".
  - **Tocar el bot desde la rama `bot` después de unir `finanzas`**: estos archivos
    cambiaron aquí.
- **SQL-2 "cerrar"** (después de publicar 1B y 1C): quitar la categoría `personal`, quitar
  `cobrado` en por_pagar y las columnas de legado de `cuentas_por_pagar`.
- **2:** riesgo de protesto (cheques por cuenta de origen vs saldo).
- **3:** reconocimiento del sueldo como gasto.
- **4:** editar o anular deudas y pagos.
- **5:** ingresos, VATEX (estimados diarios, liquidaciones, "dinero en la calle") y
  `movimientos.cuenta_por_cobrar_id`.
- **No cubierto aún:**
  - devoluciones de VATEX;
  - flujo de cobro de cheques por cobrar;
  - vincular la foto de un cheque del bot a una deuda;
  - las copias repetidas de `money()` en otras áreas.

## Orden histórico de los SQL

`schema.sql` → `schema_fase2.sql` → `schema_fase3.sql` + `migracion_produccion.sql` →
`schema_fase4.sql` + `migracion_costos.sql` → `schema_fase5.sql` → `schema_fase6.sql` →
`actualizacion_match_y_bot.sql` → `migracion_pagos.sql` → `actualizacion_v3.sql` →
`actualizacion_alertas.sql` → **`finanzas_v2_sql1_ampliar.sql`** (pendiente de ejecutar).
