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
import { ANCHO_MINIMO_CM, calcularTendido, type Tendido } from "./corrida";

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

// ── Fase 8h · Estimación por área, contando capas y dobleces ────────

export type MetodoEstimacion = "area" | "lineal";

export interface Estimacion {
  unidades: number | null;
  metodo: MetodoEstimacion;
  /** Solo con el método por área. */
  tendido?: Tendido;
  /** m² realmente aprovechables: lo tendido, sin contar dobleces ni retazo. */
  areaUsableM2?: number;
}

/**
 * Estimación de unidades, por área cuando se puede y lineal cuando no.
 *
 * **Por área** (el método bueno) necesita las tres cosas a la vez: que la prenda
 * tenga `consumo_m2` medido, que haya una mesa con largo, y un ancho creíble.
 * Entonces cuenta cuántas capas COMPLETAS caben —descontando los 15 cm que se
 * pierden en cada doblez entre capas— y divide el área tendida entre los m² que
 * consume una prenda.
 *
 * **Lineal** es la de siempre: `metros ÷ consumo_metros`. Es la caída cuando
 * falta cualquiera de las tres, y también cuando la tela no da ni para una capa
 * completa: ahí el método por área diría 0 unidades, lo cual es cierto para esa
 * mesa pero engañoso como estimación de cuánto rinde la tela.
 *
 * Los dos consumos son fuentes INDEPENDIENTES: `consumo_metros` son metros
 * lineales (y solo valen para el ancho con el que se midieron) y `consumo_m2`
 * son metros cuadrados medidos aparte. Nunca se deriva uno del otro.
 *
 * El ancho por debajo de `ANCHO_MINIMO_CM` se descarta: aquí multiplica, y un
 * valor en metros (1.05) daría un área ridícula y una estimación de 0 unidades.
 */
export function estimar(
  prenda: Prenda | undefined,
  totalMetros: number,
  anchoCm: number,
  largoMesaM: number
): Estimacion {
  // PostgREST devuelve los `numeric` como texto, y `prendas` se castea sin
  // convertir — por eso el Number() explícito en vez de fiarse del tipo.
  const consumoM2 = Number(prenda?.consumo_m2 ?? 0);

  if (prenda && consumoM2 > 0 && largoMesaM > 0 && anchoCm >= ANCHO_MINIMO_CM) {
    const tendido = calcularTendido(totalMetros, largoMesaM);
    if (tendido.capas > 0) {
      const areaUsableM2 = tendido.metrosUsables * (anchoCm / 100);
      return {
        unidades: Math.floor(areaUsableM2 / consumoM2),
        metodo: "area",
        tendido,
        areaUsableM2,
      };
    }
  }

  return { unidades: estimarUnidades(prenda, totalMetros), metodo: "lineal" };
}
