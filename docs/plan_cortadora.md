# Cortadora — visión completa

> **Estado a 2026-10-02:** las **piezas 1 y 2 están construidas**. Las piezas 3–8 son **solo
> documentación**: nadie ha escrito código ni tocado schema para ellas.
>
> Este documento existe para que una sesión futura no tenga que reconstruir el razonamiento. Lo
> que ya está hecho se resume en el registro de cambios de CLAUDE.md; el código es la fuente de
> verdad.

---

## Para qué es todo esto

Hoy la cortadora no existe en el sistema. Mateo le dice de palabra qué cortar, ella corta, y lo
que vuelve se registra a mano en `CorteTab` como un corte ya consumado. El sistema solo ve el
resultado, nunca el encargo.

La visión es darle a la cortadora **entrada y salida propias**: recibe un documento con lo que
tiene que cortar, y devuelve lo que realmente salió —con sus retazos, sus capas y sus horas— sin
que Mateo tenga que transcribirlo.

Las ocho piezas van de lo que no toca nada (la 1) a lo que redefine el flujo de Maquila (la 8).

---

## Pieza 1 · Documento de corrida de corte ✅ CONSTRUIDA

**Qué es.** Un documento imprimible que Mateo arma antes de cortar y le manda a la cortadora. Por
cada tela lleva: nombre de la tela, prenda, **ancho real**, los colores con sus metros, y la
**corrida**: cuántas unidades de cada talla salen de **una capa**.

**Efímero por decisión explícita.** No se guarda en Storage ni en la base — misma decisión que la
ficha de estampado. Se arma, se imprime o se guarda como PDF desde el navegador, y se manda por
donde se mande. El sistema no lo recuerda.

**Varias telas en un documento.** Se eligen varios pedidos a la vez y cada uno sale como su propio
bloque, con su prenda, su ancho y su corrida. Una tela, un bloque.

**La corrida es por capa, no el total.** Es la proporción que se tiende una vez (XS:1 · S:2 · M:3 …).
El total sale de multiplicarla por el número de capas, y eso lo registra ella en la pieza 4.

**Qué toca:** `src/lib/produccion/corrida.ts`, `tests/corrida.test.ts`,
`components/produccion/CorridaCorteModal.tsx`, un botón en `CorteTab` y un bloque `@media print` en
`globals.css`. **Cero schema, cero SQL, cero dependencias nuevas.**

### ⚠️ El problema de datos que destapó

`prod_pedidos_tela.ancho_real` solo se escribe al confirmar la llegada (`LlegadaTab`), donde sí se
exige `> 0`. Pero los datos **migrados** llegaron mal:

- La mayoría tiene **`ancho_real` nulo** — nunca pasaron por la pantalla de Llegada.
- Las unidades están **mezcladas**: conviven `150`, `180`, `160` (centímetros, lo correcto) con
  `1.05` y `1.45` (metros). La columna está documentada en cm y `PedidosTab` pide cm.

El documento **no corrige ni convierte nada**: muestra el valor tal como está. Cuando falta el
ancho real, cae al ancho del pedido **con un aviso visible** de que es el pedido y no el confirmado
— para la cortadora el ancho es operativamente imprescindible, y dejarlo en blanco haría el
documento inútil, pero fingir que es el real sería mentir.

Convertir automáticamente los que parecen metros sería adivinar sobre datos reales. **Es una
limpieza de datos pendiente**, no un arreglo de código.

---

## Pieza 2 · Calculadora de área estimada ✅ CONSTRUIDA

Dos mesas con **largo editable en metros**, y por cada tela se elige una mesa (o ninguna: es
opcional). Muestra `área por tendida = largo × ancho real` en m², y además **cuántas tendidas daría
la tela entera** — que es lo que de verdad responde «¿una capa o varias?».

Siempre con el aviso de que es aproximado, y el aviso importa: el área bruta de la mesa no descuenta
el desperdicio entre moldes, que es lo que decide cuánto rinde una tela de verdad.

### Dónde viven los largos, y por qué

**En `localStorage`, no en la base.** La decisión se investigó antes de construir:

- **No existe ninguna tabla de configuración** en el proyecto. De las 32 tablas, ninguna es
  key-value ni ajustes. Lo más parecido es `prod_costos_fijos`, pero eso es una entidad de negocio.
- Crear una tabla —migración, política RLS, smoke test y una pantalla para editarla— por **dos
  números que se miden una vez y no cambian nunca** no se sostiene. Y CLAUDE.md avisa de que una
  tabla sin RLS se manifiesta como *"no hay datos"*, no como error.
- ⚠️ **El proyecto nunca había usado `localStorage`.** Se estrena aquí a propósito y solo para esto:
  una preferencia local de una sola persona. Si aparece en otro sitio, que sea con la misma vara.

**Lo que esto acepta:** los largos viven en **ese navegador**. Otro equipo no los ve, y la cortadora
tampoco cuando tenga su usuario (pieza 3). Mudarlos a una tabla el día que haga falta es barato —
`leerMesas()` / `guardarMesas()` son los dos únicos puntos a cambiar.

### ⚠️ El ancho sospechoso

Aquí el ancho **entra en una multiplicación**, a diferencia de la pieza 1 que solo lo muestra. Con
los datos migrados mezclando cm y metros, un `1.05` daría `0.05 m²` — una cifra absurda que podría
pasar por buena en una decisión de corte. Por debajo de **10 cm** no se calcula nada: se avisa en
pantalla de que el ancho parece estar en metros, y **la línea de mesa no sale impresa** en la hoja.

---

## Pieza 3 · Usuario propio para la cortadora ✅ ANDAMIAJE CONSTRUIDO (solo lectura)

> El rol, su función, sus políticas de LECTURA, el middleware y una pantalla de solo lectura están
> hechos en `schema_fase8i_rol_cortadora.sql`. Falta todo el lado de ESCRITURA, que depende de las
> piezas 4, 7 y 8 — sin esas tablas no hay dónde guardar capas, retazos, horas, insumos ni destino.

Lo que sigue era el análisis previo, y se cumplió tal cual:

**Obstáculo concreto, no teórico.** `user_roles` tiene un check cerrado:

```sql
rol text not null check (rol in ('admin', 'logistica'))
```

Añadir `'cortadora'` obliga a tocar ese check **y** a revisar los tres sitios que dependen de él:

1. `src/middleware.ts` — hoy enruta por un booleano: si es logística va siempre a `/logistica`, si
   no, es admin. Con un tercer rol esa lógica binaria deja de servir.
2. `fn_es_admin()` / `fn_es_logistica()` — `security definer`, usadas **dentro de las políticas
   RLS**. Haría falta una `fn_es_cortadora()` y decidir qué ve.
3. Las políticas `admin_all_<tabla>` de **todas** las tablas `prod_*`: hoy solo admin entra. La
   cortadora necesita leer pedidos y cortes, y escribir en lo suyo — políticas nuevas, por tabla.

⚠️ **CLAUDE.md avisa de la forma en que esto falla:** una tabla sin política no da error, da *"no hay
datos"*. Un rol nuevo con políticas incompletas se ve como una pantalla vacía, no como un fallo.

**Es la pieza más cara de las ocho**, y las piezas 4, 5, 7 y 8 dependen de ella.

---

## Pieza 4 · La pantalla de la cortadora ✅ CONSTRUIDA (fase 8j)

Cortes pendientes y listos, cada uno con su corrida, y donde ella registra:

- **Número de capas.** Multiplica la corrida: `unidades por talla = corrida × capas`.
- **Retazos editables por talla.** Lo que salió de más o de menos respecto a la corrida teórica.
- **Edición de cantidades con aviso de descuadre.** Si lo que teclea no cuadra con
  `corrida × capas + retazos`, se avisa pero no se bloquea — el corte real manda sobre la teoría.
- **Horas trabajadas** (insumo de la pieza 5).

**Schema, seguro.** Hoy no existe el concepto de "corte encargado": `prod_cortes` solo guarda
cortes ya consumados. Haría falta al menos una tabla de encargo con su corrida, sus capas y sus
retazos. Es el punto donde la pieza 1 dejaría de ser efímera.

⚠️ **Y choca con un hueco conocido:** `prod_cortes.metros_consumidos` es **opcional** y
`fn_registrar_corte` lo agrega de forma **parcial** — si un color trae metros y otro no, el total
suma solo los que vinieron pero `total_unidades` cuenta todos. Cualquier cálculo de rendimiento
real tiene que leer `prod_corte_colores` color por color y descartar los nulos, nunca dividir los
totales del corte.

---

## Pieza 5 · Costo de la cortadora ⏳ SOLO DOCUMENTADA

`horas × $4/hora`, **separado del costo de maquila**.

**Schema.** Hace falta dónde guardar las horas y dónde guardar la tarifa.

⚠️ **La tarifa tiene que congelarse al registrar el corte, no leerse viva.** Es exactamente el
pendiente *"Costos fijos no se congelan por mes"* ya anotado en CLAUDE.md: `ResumenTab` multiplica
los costos fijos **de hoy** por las unidades de cualquier mes, así que editarlos reescribe el pasado.
Si los $4/hora se guardan como parámetro vivo, subir la tarifa recalcularía todos los cortes
anteriores. El patrón correcto ya existe en el proyecto: `prod_maquilas.costo_unitario`, que es una
foto del momento.

**El mismo defecto afecta a `prod_prendas.consumo_metros`**, que hoy ya tiene dos lectores
(`PedidosTab` y `CorteTab`) y tampoco se fotografía.

---

## Pieza 6 · Aviso de costo de maquila desactualizado ⏳ SOLO DOCUMENTADA

Si el precio de maquila registrado no coincide con `prod_prendas.costo_maquila`, avisar a Mateo
para que decida si actualiza la prenda.

**Media pieza ya existe.** `CorteTab` manda `p_costo_maquila: prendaDe(pedidoSel)?.costo_maquila ?? 0`
a `fn_registrar_corte`, y la función lo congela en `prod_maquilas.costo_unitario`. O sea: **la foto
ya se toma**. Lo que falta es comparar la foto contra el valor vivo y avisar de la diferencia.

**Probablemente sin schema**: es una comparación entre dos valores que ya están guardados.

⚠️ **El `?? 0` es un agujero.** Si la prenda está archivada o el pedido no tiene prenda, el costo se
congela en **0** y queda así para siempre — es el bug que la fase 8e documentó al cerrar el borrado
de catálogos. Un aviso de "costo 0" debería ser parte de esta pieza.

---

## Pieza 7 · Insumos ✅ CONSTRUIDA (fase 8j) · maquilas y llegada ⏳ PENDIENTES

**Crear maquilas.** Hoy la maquila **no se crea a mano**: `fn_registrar_corte` la crea sola, una por
corte, dentro de la misma transacción. Que la cortadora cree maquilas por separado rompe esa
relación 1-a-1 y hay que decidir qué significa.

**Insumos con fecha de entrega.** Concepto **nuevo**: no hay ninguna tabla de insumos. `prod_pedidos_tela`
es solo tela. Tabla nueva, con su RLS.

**Confirmar llegada.** Ya existe para tela (`LlegadaTab`); para insumos sería el equivalente.

---

## Pieza 8 · Mateo decide el destino al pasar a maquila ⏳ SOLO DOCUMENTADA

**Es el cambio de flujo más profundo de las ocho.** Hoy el destino se decide **al final**, en Envío:

```sql
fn_procesar_lote_maquila(p_destino text)   -- 'online' | 'estampado' | 'local'
```

Se elige cuando el lote ya volvió de maquila. La pieza 8 lo mueve **al principio**: Mateo lo decide
al mandar a maquila, y la cortadora lo ve al confirmar la llegada.

**Qué implica:** el destino pasa a ser un dato del lote desde que nace, no un parámetro del último
paso. Seguramente una columna en `prod_maquila_colores`, y `EnvioTab` pasaría de *elegir* destino a
*ejecutar* el ya decidido.

**Decisión abierta:** ¿el destino decidido al principio es vinculante, o Envío puede cambiarlo? Si
es vinculante, Envío se simplifica mucho. Si no, hay dos fuentes de verdad para lo mismo.

---

## Mapa de dependencias

```
Pieza 1 ✅ (nada)
Pieza 2 ✅ (localStorage, sin schema)
Pieza 3  → user_roles + middleware + RLS de todas las prod_*   ← la cara
Pieza 4  → 3 + tabla de encargo de corte
Pieza 5  → 4 + tarifa congelada (NO viva)
Pieza 6  → casi nada; la foto ya existe
Pieza 7  → 3 + tabla de insumos
Pieza 8  → columna de destino + reescribir EnvioTab
```

**El orden barato→caro no es el orden 1→8.** La 6 es casi gratis y la 2 es solo pantalla; la 3 es
el cuello de botella de la mitad de las demás.

---

## Añadido fuera del plan · `consumo_m2` (fase 8h, 2026-10-02)

No es ninguna de las ocho piezas, pero nació de ellas: la estimación de unidades de `PedidosTab`
ahora usa `calcularTendido()` de la pieza 2 para contar capas completas y descontar los dobleces, y
divide el área tendida entre `prod_prendas.consumo_m2` — una columna nueva, nullable, con un dato
medido aparte del `consumo_metros`.

Cae a la fórmula lineal de siempre cuando falta el m², cuando no hay mesa configurada, cuando el
ancho parece estar en metros, o cuando la tela no da ni para una capa completa.

La mesa "grande" es la **mayor de las dos** de localStorage, sin preguntar cuál es.

## Lo que NO se ha hecho

- No se ha tocado el schema ni se ha creado ninguna migración para las piezas 2–8.
- No existe el rol `cortadora` ni su usuario.
- No se ha decidido si la corrida debe dejar de ser efímera (pieza 4 lo exigiría).
- No se ha limpiado el dato de `ancho_real` (nulos y unidades mezcladas) — ver pieza 1.
