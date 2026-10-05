/**
 * Costo de producción de UN corte — fase 8p.
 *
 *   tela + maquila + horas de corte + insumos + estampado = total
 *   total ÷ prendas buenas = costo unitario
 *
 * Reglas del dueño (2026-10-05):
 *   · A la maquila se le pagan SOLO las prendas entregadas bien. Las que vienen
 *     con fallas y las que no entrega se dan de baja y no se pagan.
 *   · Si el corte no tiene metros anotados, el costo de la tela del pedido se
 *     reparte entre sus cortes según cuántas prendas sacó cada uno (estimado).
 *
 * Mientras el lote siga en maquila, lo que falta por entregar se cuenta como si
 * fuera a llegar bien: así el costo sirve ANTES de que vuelva, y se ajusta solo
 * al cerrar (si llegan fallas, hay menos prendas buenas y el unitario sube).
 *
 * NO incluye los costos fijos (arriendo, etc.): eso lo reparte ResumenTab por mes.
 */

export interface PedidoCosto {
  valor_metro: number;
  total_pagar: number;
}

export interface CorteCosto {
  id: string;
  total_unidades: number;
  metros_consumidos: number | null;
}

export interface EntregaCosto {
  tipo: "entrega" | "falla" | "faltante";
  unidades: number;
}

export interface ColorMaquilaCosto {
  unidades: number; // cortadas de este color
  entregas: EntregaCosto[];
}

export interface CostoCorte {
  tela: { valor: number; estimado: boolean };
  maquila: {
    costoUnitario: number;
    buenas: number;
    fallas: number;
    faltantes: number;
    pendientes: number;
    /** Lo que hay que pagarle hoy: solo lo entregado bien. */
    aPagar: number;
    /** Lo que se le pagará si entrega bien lo que falta. Es lo que entra al total. */
    esperado: number;
  };
  corte: { horas: number; valor: number };
  insumos: { valor: number; sinCosto: number };
  estampado: number;
  total: number;
  /** Prendas buenas (más las que faltan por llegar, mientras el lote siga abierto). */
  unidades: number;
  costoUnitario: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Costo de la tela de un corte. Con metros: metros × precio del metro. Sin
 * metros: lo que queda del costo del pedido (tras los cortes que sí tienen
 * metros), repartido por prendas entre los cortes sin metros.
 */
export function costoTela(
  corte: CorteCosto,
  pedido: PedidoCosto,
  cortesDelPedido: CorteCosto[]
): { valor: number; estimado: boolean } {
  const vm = Number(pedido.valor_metro);
  if (corte.metros_consumidos != null) {
    return { valor: r2(Number(corte.metros_consumidos) * vm), estimado: false };
  }
  const conMetros = cortesDelPedido.filter((c) => c.metros_consumidos != null);
  const sinMetros = cortesDelPedido.filter((c) => c.metros_consumidos == null);
  const yaAsignado = conMetros.reduce((s, c) => s + Number(c.metros_consumidos) * vm, 0);
  const restante = Math.max(0, Number(pedido.total_pagar) - yaAsignado);
  const unidades = sinMetros.reduce((s, c) => s + Number(c.total_unidades), 0);
  if (unidades <= 0) return { valor: 0, estimado: true };
  return { valor: r2((restante * Number(corte.total_unidades)) / unidades), estimado: true };
}

export function costoCorte(args: {
  corte: CorteCosto;
  pedido: PedidoCosto;
  cortesDelPedido: CorteCosto[];
  costoMaquilaUnitario: number;
  coloresMaquila: ColorMaquilaCosto[];
  jornadas: { horas: number; tarifa_hora: number }[];
  insumos: { costo: number | null }[];
  estampado: number;
}): CostoCorte {
  const tela = costoTela(args.corte, args.pedido, args.cortesDelPedido);

  let buenas = 0, fallas = 0, faltantes = 0, cortadas = 0;
  for (const col of args.coloresMaquila) {
    cortadas += Number(col.unidades);
    for (const e of col.entregas) {
      const n = Number(e.unidades);
      if (e.tipo === "entrega") buenas += n;
      else if (e.tipo === "falla") fallas += n;
      else faltantes += n;
    }
  }
  const pendientes = Math.max(0, cortadas - buenas - fallas - faltantes);
  const cu = Number(args.costoMaquilaUnitario) || 0;
  const maquila = {
    costoUnitario: cu,
    buenas, fallas, faltantes, pendientes,
    aPagar: r2(cu * buenas),
    esperado: r2(cu * (buenas + pendientes)),
  };

  const horas = args.jornadas.reduce((s, j) => s + Number(j.horas), 0);
  const corte = {
    horas,
    valor: r2(args.jornadas.reduce((s, j) => s + Number(j.horas) * Number(j.tarifa_hora), 0)),
  };

  const insumos = {
    valor: r2(args.insumos.reduce((s, i) => s + (i.costo == null ? 0 : Number(i.costo)), 0)),
    sinCosto: args.insumos.filter((i) => i.costo == null).length,
  };

  const estampado = r2(Number(args.estampado) || 0);
  const total = r2(tela.valor + maquila.esperado + corte.valor + insumos.valor + estampado);
  const unidades = buenas + pendientes;

  return {
    tela, maquila, corte, insumos, estampado, total, unidades,
    costoUnitario: unidades > 0 ? r2(total / unidades) : null,
  };
}
