/**
 * Corrida de corte: lo que se le manda a la cortadora antes de tender la tela.
 *
 * Una "corrida" son las unidades de cada talla que salen de UNA capa. El total
 * se obtiene multiplicándola por el número de capas, y eso lo registra la
 * cortadora — no entra aquí. Ver `docs/plan_cortadora.md`.
 *
 * El documento es EFÍMERO: no se guarda en Storage ni en la base. Se arma, se
 * imprime o se guarda como PDF desde el navegador, y el sistema no lo recuerda.
 */

import { ordenarTallas, type PedidoTela, type Prenda } from "./types";

/** Tallas por defecto cuando el pedido no tiene prenda asignada. */
const TALLAS_GENERICAS = ["XS", "S", "M", "L", "XL", "XXL"];

export interface AnchoDocumento {
  /** Centímetros según la columna. Null = no hay ningún ancho registrado. */
  cm: number | null;
  /** false = es el ancho PEDIDO, no el confirmado al recibir la tela. */
  esReal: boolean;
}

/**
 * Ancho que se imprime, y si es el real o un sustituto.
 *
 * El encargo pide el ancho REAL —el que se confirma en Llegada— porque es el que
 * manda al tender. Pero `ancho_real` solo se escribe al confirmar la entrega, y
 * los pedidos migrados en su mayoría nunca pasaron por esa pantalla: lo tienen
 * nulo.
 *
 * Por eso cae al `ancho_pedido` en vez de quedarse en blanco: para la cortadora
 * el ancho es imprescindible y un documento sin él no sirve de nada. Pero
 * `esReal` viaja con el dato para que la pantalla lo avise — pasarlo por real
 * sería mentir sobre el único número que decide cuánto rinde la tela.
 *
 * ⚠️ NO convierte unidades. Los datos migrados mezclan centímetros (150, 180) con
 * metros (1.05, 1.45); adivinar cuál es cuál sobre datos reales sería peor que
 * mostrarlos como están. Es limpieza de datos pendiente, no de código.
 */
export function anchoDocumento(pedido: PedidoTela): AnchoDocumento {
  if (pedido.ancho_real != null && pedido.ancho_real > 0) {
    return { cm: Number(pedido.ancho_real), esReal: true };
  }
  if (pedido.ancho_pedido != null && pedido.ancho_pedido > 0) {
    return { cm: Number(pedido.ancho_pedido), esReal: false };
  }
  return { cm: null, esReal: false };
}

/**
 * Tallas de la corrida, en orden XS→XXL. Sin prenda asignada (`prenda_id` es
 * opcional) cae a la lista genérica, igual que hace CorteTab al registrar.
 */
export function tallasDeCorrida(prenda: Prenda | undefined): string[] {
  return ordenarTallas(prenda?.tallas?.length ? prenda.tallas : TALLAS_GENERICAS);
}

/**
 * Unidades que salen de una capa. Ignora lo que no sea un entero positivo: el
 * formulario guarda texto y una talla vacía vale 0, no rompe el total.
 */
export function totalCorrida(corrida: Record<string, string>): number {
  return Object.values(corrida).reduce((suma, v) => {
    const n = parseInt(v, 10);
    return suma + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/** Solo las tallas con unidades, en el orden dado. Lo que se imprime. */
export function tallasConUnidades(
  tallas: string[],
  corrida: Record<string, string>
): { talla: string; unidades: number }[] {
  return tallas
    .map((talla) => ({ talla, unidades: parseInt(corrida[talla] ?? "", 10) || 0 }))
    .filter((x) => x.unidades > 0);
}
