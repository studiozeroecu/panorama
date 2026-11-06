/**
 * Fase 8z: vista previa de juntar pedidos de tela. Solo para mostrar antes de
 * confirmar: quien suma de verdad es fn_unir_pedidos, con el mismo criterio.
 */
import type { PedidoTela } from "./types";

export interface VistaUnion {
  colores: { color: string; metros: number }[];
  totalMetros: number;
  totalPagar: number;
  valorMetro: number;
  /** Ids de las prendas distintas. Con más de una, el dueño elige para cuál es. */
  prendaIds: string[];
  nombres: string[];
  /** Hay más de un ancho real: los tendidos no van a rendir igual. */
  anchosDistintos: boolean;
}

/** El más antiguo se queda: es el primero que espera fn_unir_pedidos. */
export function ordenParaUnir(pedidos: PedidoTela[]): PedidoTela[] {
  return [...pedidos].sort((a, b) => a.fecha_pedido.localeCompare(b.fecha_pedido));
}

export function vistaUnion(pedidos: PedidoTela[]): VistaUnion {
  const ordenados = ordenParaUnir(pedidos);
  const colores = new Map<string, { color: string; metros: number }>();
  for (const p of ordenados) {
    for (const c of p.colores ?? []) {
      // Mismo criterio que el índice único de prod_pedido_colores.
      const clave = c.color.trim().toLowerCase();
      const previo = colores.get(clave);
      if (previo) previo.metros += Number(c.metros);
      else colores.set(clave, { color: c.color.trim(), metros: Number(c.metros) });
    }
  }
  const totalMetros = ordenados.reduce((s, p) => s + Number(p.total_metros), 0);
  const totalPagar = ordenados.reduce((s, p) => s + Number(p.total_pagar), 0);
  const anchos = ordenados.map((p) => p.ancho_real).filter((a): a is number => a != null).map(Number);
  return {
    colores: [...colores.values()],
    totalMetros,
    totalPagar,
    valorMetro: totalMetros > 0 ? totalPagar / totalMetros : 0,
    prendaIds: [...new Set(ordenados.map((p) => p.prenda_id).filter((x): x is string => !!x))],
    nombres: [...new Set(ordenados.map((p) => p.nombre_tela.trim()))],
    anchosDistintos: new Set(anchos).size > 1,
  };
}
