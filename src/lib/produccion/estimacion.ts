/**
 * Estimación de cuántas unidades rinde una cantidad de tela.
 *
 * Vive aquí y no repetida en cada pestaña porque la usan tres pantallas
 * distintas —Pedidos, Llegada y Corte— y cada una la enseña en un momento
 * diferente del mismo recorrido: al comprar la tela, mientras viene en camino, y
 * justo antes de cortarla. Si la regla cambiara (redondeo, un margen de
 * desperdicio, un consumo congelado por corte), tres copias significarían tres
 * sitios que acordarse de tocar — y olvidar uno no rompe nada ni falla ningún
 * test: simplemente una pantalla diría un número distinto de otra.
 *
 * Es el mismo problema que la fase 7 cerró con `fn_repartir_por_talla`, cuando la
 * heurística de reparto estaba duplicada en EnvioTab y EstampadosTab.
 */

import type { Prenda } from "./types";

/**
 * Unidades que salen de `metros` de tela, según el consumo por unidad de la
 * prenda. `null` cuando no hay con qué calcular.
 *
 * Devuelve **null y no 0** a propósito: "no se puede saber" y "no sale ninguna
 * unidad" son cosas distintas. Las tres pantallas callan en el primer caso en vez
 * de mostrar un cero que se leería como un dato real.
 *
 * Los dos casos sin dato:
 *  · **Sin prenda.** `prod_pedidos_tela.prenda_id` es opcional — en PedidosTab el
 *    campo se llama "Propósito (prenda)" y admite "— Sin especificar —".
 *  · **Consumo en 0.** `prod_prendas.consumo_metros` es `not null default 0` y no
 *    tiene check, así que un insert directo que omita la columna deja un 0.
 *    PrendasTab sí exige > 0, pero el bot y el SQL manual no pasan por ahí.
 *
 * Se redondea hacia abajo: media camiseta no es una camiseta.
 */
export function estimarUnidades(prenda: Prenda | undefined, metros: number): number | null {
  if (!prenda || !(prenda.consumo_metros > 0) || !(metros > 0)) return null;
  return Math.floor(metros / prenda.consumo_metros);
}
