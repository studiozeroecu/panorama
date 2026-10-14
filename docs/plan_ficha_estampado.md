# Ficha visual de estampado — investigación previa

> **Estado: IMPLEMENTADA el 2026-09-17.** Este documento se conserva como el registro de la
> averiguación previa y de las decisiones que se tomaron. Lo que quedó construido está resumido en
> la entrada del **registro de cambios de schema de CLAUDE.md** (2026-09-17); el código es la
> fuente de verdad.
>
> **Las dos decisiones que estaban abiertas quedaron así:**
>
> 1. **Las fichas son EFÍMERAS** (sección 6). No se guardan en Storage ni en la base. Por tanto
>    **no se tocó el schema** y el obstáculo de la sección 5 sigue intacto: la ficha no resuelve
>    qué tallas llevan qué diseño, solo deja de empeorarlo.
> 2. **Las mangas sí distinguen lado** (sección 2), al contrario de lo que se supuso al principio:
>    hay diseños que van en un lado, en los dos, o distintos en cada uno. No se duplicó el
>    catálogo — se guarda un recuadro y el otro se calcula por espejo.
>
> **Lo que cambió respecto a lo previsto aquí:** hicieron falta **seis** siluetas y no tres (el
> catálogo incluye espalda, así que la ficha muestra frente y espalda); la camiseta **no** lleva
> `manga_antebrazo` porque es de manga corta; y se descartó numerar los lotes para buscarlos en el
> chat — se buscan por fecha, que no exige columna nueva.

---

## 1. Objetivo

Al seleccionar un lote en **EstampadosTab**, poder armar una **ficha visual**: una imagen que
combine un dibujo base de la prenda (camiseta / sudadera / buso) con las imágenes de diseño
colocadas en **posiciones predefinidas**, y generar una imagen final grande para enviarla a un
**bot de Telegram separado**.

Ese bot es **solo de envío, sin IA**: un canal de un solo sentido. No necesita webhook, ni
`bot_pending_actions`, ni nada de la maquinaria del bot actual — solo una función que hace `POST`.

---

## 2. Catálogo de posiciones definido

| Zona | Variantes |
|---|---|
| Pecho izquierdo | pequeño · mediano |
| Pecho derecho | pequeño · mediano |
| Pecho centrado | pequeño · mediano — cada uno con altura **arriba / medio / abajo** |
| Mangas | hombro · antebrazo |
| Espalda centrado | grande · mediano — cada uno con altura **arriba / medio / abajo** |

Orden de magnitud: **~20 combinaciones por prenda**, unas **60 en total** para las tres prendas.

> **CERRADO:** las mangas **sí** distinguen lado, pero no como se temía aquí. En vez de duplicar
> las entradas del catálogo, cada posición de manga guarda un recuadro y la pantalla pide el lado
> (izquierda · derecha · las dos). Ver `recuadrosDe()` en `src/lib/produccion/posiciones.ts`.

---

## 3. Hallazgos técnicos

### 3.1 Canvas nativo es viable, sin librería nueva

Búsqueda en todo `src/` de `canvas`, `getContext`, `toDataURL`, `toBlob`, `createImageBitmap`,
`OffscreenCanvas`: **cero resultados**. Tampoco hay **ni una sola etiqueta `<img>`** en el proyecto.
Toda la interfaz es texto, tablas y CSS; nunca se ha renderizado una imagen.

Las tres operaciones necesarias son tres llamadas de la API nativa:

| Necesidad | API |
|---|---|
| Dibujar la silueta base | `ctx.drawImage(base, 0, 0, W, H)` |
| Superponer un diseño en posición y tamaño fijos | `ctx.drawImage(diseño, x, y, ancho, alto)` |
| Exportar como PNG | `canvas.toBlob(cb, "image/png")` |

`drawImage` con seis argumentos escala en el mismo paso, que es justo lo que hace falta para
encajar un diseño en un recuadro predefinido. **Sin dependencias nuevas.**

**Dos trampas conocidas de antemano:**

- **Las imágenes deben estar cargadas antes de dibujar.** `drawImage` con una imagen a medio cargar
  pinta en blanco **sin lanzar error**. Hay que esperar el `onload`, o usar `createImageBitmap`,
  que devuelve una promesa y es más limpio.
- **El canvas se "contamina" con imágenes de otro origen.** Si un diseño se carga desde una URL sin
  CORS adecuado, `toBlob` falla con `SecurityError`. Con Supabase Storage se evita descargando el
  archivo como `Blob` (`supabase.storage.download()`) en vez de apuntar un `<img src>` a la URL.

**Alternativa considerada:** componer en **SVG** (siluetas en SVG, diseños como `<image>` dentro,
rasterizar a PNG solo al final). A favor: las coordenadas viven en el propio SVG y el marcado es
legible. En contra: rasterizar SVG con imágenes embebidas tiene sus propias trampas de CORS. La
elección condiciona cómo se guardan las siluetas, así que conviene decidirla temprano.

### 3.2 No hay ninguna imagen en el proyecto — se parte de cero

- **No existe carpeta `public/`.**
- `git ls-files` no devuelve **ni una sola** imagen versionada: cero `.svg`, `.png`, `.jpg`,
  `.webp`, `.gif`, `.ico`. Ni siquiera hay favicon.
- Búsqueda de `silueta`, `maniqui`, `maniquí`, `fashn`, `zero ai`, `zeroai`, `mateo` en `src/`,
  `supabase/`, `scripts/`, `tests/` y `README.md`: **sin resultados**, salvo tres filas de
  `migracion_pagos.sql` con *"SUELDO MATEO"* (un pago mensual en cuentas por pagar, sin relación).

**Hay que crear las tres siluetas desde cero.** Y una decisión que condiciona todo lo demás:

> Las tres siluetas deben compartir **el mismo lienzo y la misma escala** (por ejemplo
> **1000×1200**). Si camiseta y sudadera se dibujan con proporciones distintas, *"pecho centrado
> mediano"* cae en sitios diferentes en cada una, y el catálogo de posiciones habría que
> **duplicarlo por prenda** en vez de compartirlo.

Nota práctica: si las siluetas van en `public/`, Next las sirve como estáticos del **mismo origen**,
lo que evita de raíz el problema de CORS de 3.1. Si fueran a Storage, no.

### 3.3 Telegram `sendPhoto` — solo hace falta token y `chat_id`

Nada más: ni framework, ni SDK, ni dependencia nueva. El proyecto ya tiene un cliente mínimo escrito
a mano en [`src/lib/telegram.ts`](../src/lib/telegram.ts) — *"Cliente mínimo de la Bot API de
Telegram (sin dependencias)"* — con `sendMessage`, `answerCallbackQuery`, `editMessageText`,
`downloadFile` y `setChatAction`.

**Pero el helper `call()` existente manda JSON, y `sendPhoto` con binario necesita
`multipart/form-data`.** El patrón correcto:

```ts
const form = new FormData();
form.append("chat_id", chatId);
form.append("caption", "Ficha de estampado · Camiseta Negro");
form.append("photo", new Blob([buffer], { type: "image/png" }), "ficha.png");

const res = await fetch(`${BASE()}/sendPhoto`, { method: "POST", body: form });
//  ↑ SIN headers: fetch pone el Content-Type con el boundary correcto.
//    Fijarlo a mano ROMPE la petición.
```

Alternativa: si la imagen estuviera en una URL pública, bastaría
`form.append("photo", "https://…")` y Telegram la descarga. Pero **los tres buckets del proyecto son
privados**, así que implicaría una URL firmada o hacer público un bucket — probablemente no
compensa frente a mandar el binario.

**Tres límites a tener presentes:**

- **10 MB** por foto en la Bot API. Un PNG de 1000×1200 con un par de diseños cabe de sobra. Si las
  imágenes crecieran, `sendDocument` admite 50 MB, pero Telegram no lo muestra en línea.
- **Telegram recomprime las fotos.** Si la nitidez importa para el taller, `sendDocument` la
  preserva; `sendPhoto` no.
- **Un bot separado necesita variables de entorno propias.** `TELEGRAM_BOT_TOKEN` y
  `TELEGRAM_ALLOWED_CHAT_ID` están tomadas por el bot existente. Harían falta nuevas, y que existan
  tanto en `.env.local` como en Vercel.

### 3.4 El catálogo va en código; la elección de cada lote, en la base

**El catálogo de coordenadas** (x, y, ancho, alto de cada combinación posición+tamaño+prenda) son
~60 filas de datos pequeños, estables y que casi nunca cambian. La conclusión fue **guardarlo en
código**, en algo como `src/lib/produccion/posiciones.ts`, y **no** en una tabla. Razones:

- CLAUDE.md establece que **toda tabla nueva necesita RLS + política `admin_all_<tabla>`**, y en
  este proyecto olvidarlo se ha manifestado tres veces como *"no hay datos"* en vez de como error.
- Un dato en la base puede **desincronizarse del código en silencio**: si el SVG de la camiseta
  cambia de proporciones, las coordenadas de la tabla quedan mal sin que nada avise — el mismo
  patrón de fallo que tuvo el jsonb de colores. En un `.ts` viven **al lado** del dibujo.
- En código hay autocompletado, comprobación en `tsc`, y se puede escribir un test que verifique que
  ninguna posición se sale del lienzo. Una tabla no da nada de eso.

**Pero la elección que hace el usuario sí tiene que persistir**, porque es parte del registro del
lote: *"logo pequeño en pecho izquierdo, 10 unidades, tallas S y M"*. Y ahí está el obstáculo —
ver la sección 5.

---

## 4. Lo que ya existe en el proyecto y es reutilizable

### Supabase Storage: habilitado y rodado

Tres buckets privados, todos creados por migración:

| Bucket | Creado en | Quién sube | Política |
|---|---|---|---|
| `reportes` | `schema.sql:88` | servidor (`lib/snapshots.ts`) | `authenticated` todo |
| `cheques` | `schema_fase2.sql:78` | bot (webhook Telegram) | `authenticated` todo |
| `guias` | `schema_fase6.sql:132` | **navegador** (LogisticaApp) | insert: logística o admin · select: admin o dueño |

**Ya hay precedente de subida desde el navegador** — [`LogisticaApp.tsx:127`](../src/components/logistica/LogisticaApp.tsx):

```tsx
const ext = foto.name.split(".").pop()?.toLowerCase() || "jpg";
const path = `${guia.id}.${ext}`;
const { error: e2 } = await supabase.storage.from("guias").upload(path, foto, { upsert: true });
if (!e2) {
  await supabase.from("guias_transferencia").update({ foto_path: path }).eq("id", guia.id);
} else {
  avisar(`Guía guardada, pero la foto falló: ${e2.message}`);
}
```

El patrón: **primero la fila, después la foto**; si la foto falla, el registro se conserva con un
aviso. Se guarda **la ruta**, no una URL.

### Sin librerías de imagen

`package.json` tiene siete dependencias: `@anthropic-ai/sdk`, `@supabase/ssr`,
`@supabase/supabase-js`, `next`, `react`, `react-dom`, `xlsx`. **No hay `sharp`, ni
`browser-image-compression`, ni nada similar.** Las fotos de guías y cheques se suben tal cual salen
del teléfono, sin comprimir ni generar miniaturas.

### Cuota de Storage — verificar antes de diseñar

El proyecto `panorama-bt` está en plan **FREE**: **1 GB** de almacenamiento total y **50 MB** por
archivo por defecto.

**Sin verificar (hay que mirarlo en el dashboard, Settings → Usage / Storage):**

1. Cuánto de ese 1 GB ocupan ya `reportes`, `cheques` y `guias`.
2. El límite real por archivo configurado en el proyecto.

**El dato que hace esto relevante:** sin compresión, una foto de móvil pesa 3-8 MB. A 5 MB por
imagen, 1 GB da para unas **200 fotos**. Si la funcionalidad implica una imagen por diseño, ese
techo llega antes de lo que parece — y ahí entraría una librería de compresión, que hoy no existe.

---

## 5. El obstáculo estructural: `prod_lotes_estampado.disenos`

Declarado en [`schema_fase3.sql:115`](../supabase/schema_fase3.sql):

```sql
disenos jsonb not null default '[]',   -- [{ nombre, unidades }]
```

**Dos campos, nada más.** Lo que eso implica:

- **Varios diseños por lote: sí.** Es un array y el formulario tiene *"+ Agregar diseño"*.
- **Posición (adelante/atrás): no existe.** Hoy vive dentro del texto libre del nombre —
  `"Logo frontal"`, `"Espalda"`.
- **Cantidades por talla dentro de un diseño: no existe.** El lote tiene **un solo desglose de
  tallas total** (`tallas jsonb`) y, por separado, una lista de diseños con cantidades sueltas.
  **No hay ninguna relación entre ambos.**

Consecuencia concreta: un lote con `{S:8, M:12, L:5}` y diseños "Logo ×10" / "Espalda ×15" **no
puede decir** cuántas S llevan Logo. Y al retornar, la etiqueta del stock concatena todos los
nombres:

```sql
string_agg(btrim(d.value ->> 'nombre'), ', ' order by d.ord)
```

…produciendo una sola fila de stock etiquetada `"Logo frontal, Espalda"`. **Hoy el sistema no puede
representar "10 camisetas con logo y 15 con espalda"**: las funde en 25 unidades de un estampado
imaginario con los dos nombres pegados.

### Lo que hoy muestra EnvioTab al mandar a estampado

[`EnvioTab.tsx:157-193`](../src/components/produccion/EnvioTab.tsx):

- **Por color:** implícito. Toda la tarjeta es de **un solo color** (es un `prod_maquila_colores`).
  No se pueden estampar dos colores en un mismo envío: son dos tarjetas separadas.
- **Por talla:** se **ve** (`<Tallas tallas={col.tallas} />` en la cabecera) pero es **puramente
  informativo**. El formulario solo pide **nombre + cantidad total**, sin talla.

El contraste es revelador: la rama *"Ventas a locales"* **sí** pide unidades por talla, con un input
por talla y su tope. Estampado no. **De ahí sale toda la razón de ser de `fn_repartir_por_talla`:**
como el usuario nunca dice qué tallas manda al taller, el servidor **adivina** repartiendo de XS a
XXL hasta cubrir el total.

> Es decir: rediseñar `disenos` para llevar posición y tallas **haría innecesario ese reparto
> adivinado**, porque el dato real existiría.

---

## 6. Decisión pendiente — RESUELTA: efímeras

**¿Las fichas generadas son efímeras o parte del registro del lote?**

| | Efímeras | Parte del registro |
|---|---|---|
| Qué pasa | Se generan, se mandan por Telegram y no se guardan | Se guardan y se pueden volver a ver |
| Schema | **No toca nada** | Abre `disenos` y probablemente un bucket nuevo |
| Storage | No consume | Consume cuota (ver sección 4) |
| Reimprimir una ficha | Hay que rearmarla a mano | Se recupera |

**Resuelto el 2026-09-16: efímeras.** La funcionalidad quedó puramente de cliente + una llamada
a Telegram, sin migración. El rediseño de `prod_lotes_estampado.disenos` de la sección 5 **no se
hizo** y sigue pendiente para quien lo retome.

---

## 7. Lo que NO se había hecho cuando se escribió esto

- No se ha escrito código de ninguna clase.
- No se ha tocado el schema ni se ha creado ninguna migración.
- No se han creado siluetas.
- No se ha creado el bot de Telegram ni sus variables de entorno.
- No se ha verificado la cuota de Storage consumida (sección 4).
- No se ha decidido nada de la sección 6.

> Todo lo de esta sección está hecho desde el 2026-09-17, salvo **la cuota de Storage**, que
> nunca se verificó — y ya no hace falta, porque al ser efímeras las fichas no consumen nada.
