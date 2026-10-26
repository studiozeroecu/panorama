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
 * Costos fijos: van POR PRENDA (etiquetas, fundas, etiquetas colgantes…), la
 * suma de prod_costos_fijos × prendas buenas — el mismo criterio que Envío y
 * Resumen. ⚠️ Se leen con su valor de HOY: si cambia el precio de la funda,
 * cambia el costo de cortes pasados (pendiente anotado en CLAUDE.md).
 */

import { fraccionTelaSuperior, type Parte } from "./conjuntos";

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
  /** Fase 8r: precio de maquila de ESTA fila (una parte de un conjunto). null = el de la maquila. */
  costoUnitario?: number | null;
  /** Fase 8r: superior / inferior si el corte es de un conjunto; null en una prenda sola. */
  parte?: Parte | null;
}

/** Fase 8r: lo que le toca a UNA parte de un conjunto dentro del corte. */
export interface CostoParte {
  /** Prendas buenas + las que siguen en maquila. */
  unidades: number;
  tela: number;
  maquila: number;
  /** Horas de corte, insumos y estampado, repartidos por prendas. */
  compartidos: number;
  fijos: number;
  total: number;
  costoUnitario: number | null;
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
  /** Etiquetas, fundas… : suma de costos fijos por prenda × prendas buenas. */
  fijos: { porUnidad: number; valor: number };
  total: number;
  /** Fase 8r: solo en cortes de un conjunto. El set = una de cada parte. */
  partes: { superior: CostoParte; inferior: CostoParte; costoSet: number | null } | null;
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
  /** Suma de prod_costos_fijos: lo que lleva CADA prenda en etiquetas, fundas… */
  costoFijoPorUnidad?: number;
  /** Fase 8r: consumo de tela de cada parte del conjunto, para repartir la tela. */
  consumoPartes?: { superior?: number | null; inferior?: number | null };
}): CostoCorte {
  const tela = costoTela(args.corte, args.pedido, args.cortesDelPedido);

  const cu = Number(args.costoMaquilaUnitario) || 0;
  let buenas = 0, fallas = 0, faltantes = 0, cortadas = 0, aPagar = 0, esperado = 0;
  // Fase 8r: lo de cada parte de un conjunto, para el desglose de abajo.
  const porParte: Record<Parte, { unidades: number; maquila: number }> = {
    superior: { unidades: 0, maquila: 0 },
    inferior: { unidades: 0, maquila: 0 },
  };
  for (const col of args.coloresMaquila) {
    let b = 0, f = 0, x = 0;
    for (const e of col.entregas) {
      const n = Number(e.unidades);
      if (e.tipo === "entrega") b += n;
      else if (e.tipo === "falla") f += n;
      else x += n;
    }
    const pend = Math.max(0, Number(col.unidades) - b - f - x);
    // Cada fila paga a SU precio (una blusa no cobra lo mismo que un pantalón).
    const precio = col.costoUnitario != null ? Number(col.costoUnitario) : cu;
    cortadas += Number(col.unidades);
    buenas += b; fallas += f; faltantes += x;
    aPagar += precio * b;
    esperado += precio * (b + pend);
    if (col.parte) {
      porParte[col.parte].unidades += b + pend;
      porParte[col.parte].maquila += precio * (b + pend);
    }
  }
  const pendientes = Math.max(0, cortadas - buenas - fallas - faltantes);
  const maquila = {
    costoUnitario: cu,
    buenas, fallas, faltantes, pendientes,
    aPagar: r2(aPagar),
    esperado: r2(esperado),
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
  const unidades = buenas + pendientes;
  const porUnidad = Number(args.costoFijoPorUnidad) || 0;
  // Las fallas y las no entregadas no llevan etiqueta ni funda: solo las buenas
  // (y, mientras el lote siga en maquila, las que faltan por llegar).
  const fijos = { porUnidad, valor: r2(porUnidad * unidades) };
  const total = r2(tela.valor + maquila.esperado + corte.valor + insumos.valor + estampado + fijos.valor);

  const esConjunto = args.coloresMaquila.some((c) => c.parte);
  let partes: CostoCorte["partes"] = null;
  if (esConjunto) {
    // La tela se reparte según lo que consume cada parte (no rinden igual); las
    // horas, insumos y estampado, por prendas; la maquila, cada una la suya.
    const us = porParte.superior.unidades;
    const ui = porParte.inferior.unidades;
    const fs = fraccionTelaSuperior(us, ui, args.consumoPartes?.superior, args.consumoPartes?.inferior);
    const compartidos = corte.valor + insumos.valor + estampado;
    const armar = (p: Parte, fraccionTela: number): CostoParte => {
      const u = porParte[p].unidades;
      const t = tela.valor * fraccionTela;
      const c = us + ui > 0 ? (compartidos * u) / (us + ui) : 0;
      const fj = porUnidad * u;
      const tot = t + porParte[p].maquila + c + fj;
      return {
        unidades: u, tela: r2(t), maquila: r2(porParte[p].maquila), compartidos: r2(c),
        fijos: r2(fj), total: r2(tot), costoUnitario: u > 0 ? r2(tot / u) : null,
      };
    };
    const superior = armar("superior", fs);
    const inferior = armar("inferior", 1 - fs);
    partes = {
      superior,
      inferior,
      costoSet: superior.costoUnitario != null && inferior.costoUnitario != null
        ? r2(superior.costoUnitario + inferior.costoUnitario) : null,
    };
  }

  return {
    tela, maquila, corte, insumos, estampado, fijos, total, unidades,
    costoUnitario: unidades > 0 ? r2(total / unidades) : null,
    partes,
  };
}
