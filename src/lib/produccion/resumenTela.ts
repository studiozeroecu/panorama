/**
 * Resumen de costos de UNA tela, en la etapa en que esté.
 *
 * Se va llenando a medida que la tela avanza: al pedirla solo está la tela; al
 * cortarla se suman las horas de corte y los insumos; en maquila, lo que se le
 * paga; en estampado, su costo. Nada se guarda: se calcula al abrirlo.
 *
 * Dos totales, porque responden preguntas distintas:
 *   · GASTADO HASTA AHORA — lo que ya salió o ya se debe: la tela entera (está
 *     comprada), las horas, los insumos con costo, el estampado y la maquila de
 *     lo ya ENTREGADO BIEN.
 *   · COSTO ESTIMADO FINAL — lo anterior, más la maquila de lo que aún está en
 *     maquila (como si llegara bien). Es el que se divide entre prendas.
 *
 * Las prendas:
 *   · Sin cortes todavía → se ESTIMAN con el consumo por prenda (metros ÷
 *     consumo_metros), igual que en Pedidos y Corte.
 *   · Con cortes → las buenas + las que siguen en maquila (fallas y faltantes
 *     no cuentan: se dan de baja).
 * Si la tela aún no se termina de cortar, el costo por prenda sale ALTO: la tela
 * entera se reparte entre las pocas prendas cortadas. Se avisa, no se esconde.
 *
 * Las reglas de cada corte (qué se le paga a la maquila, etc.) son las de
 * costoCorte.ts — aquí solo se suman.
 *
 * Costos fijos (etiquetas, fundas…): van POR PRENDA. En "gastado" cuentan solo
 * las prendas ya entregadas bien; en el estimado, todas las que se esperan.
 */

import { costoCorte, type ColorMaquilaCosto, type CorteCosto } from "./costoCorte";

export interface CorteResumen {
  corte: CorteCosto;
  costoMaquilaUnitario: number;
  coloresMaquila: ColorMaquilaCosto[];
  jornadas: { horas: number; tarifa_hora: number }[];
  insumos: { costo: number | null }[];
  estampado: number;
}

export interface ResumenTela {
  tela: { total: number; metros: number; valorMetro: number };
  cortes: number;
  cortadas: number;
  maquila: { buenas: number; fallas: number; faltantes: number; pendientes: number; aPagar: number; esperado: number };
  corte: { horas: number; valor: number };
  insumos: { valor: number; sinCosto: number };
  estampado: number;
  fijos: { porUnidad: number; gastado: number; estimado: number };
  gastado: number;
  estimadoFinal: number;
  unidades: number | null;
  /** true = sin cortes: las prendas salen del consumo por prenda, no de un corte. */
  unidadesEstimadas: boolean;
  costoUnitario: number | null;
  telaPorUnidad: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resumenTela(args: {
  pedido: { total_metros: number; valor_metro: number; total_pagar: number };
  /** Prendas que se estima que salen de la tela entera (null si no hay prenda o consumo). */
  unidadesEstimadas: number | null;
  cortes: CorteResumen[];
  /** Suma de prod_costos_fijos: lo que lleva CADA prenda en etiquetas, fundas… */
  costoFijoPorUnidad?: number;
}): ResumenTela {
  const tela = {
    total: r2(Number(args.pedido.total_pagar)),
    metros: Number(args.pedido.total_metros),
    valorMetro: Number(args.pedido.valor_metro),
  };

  const maquila = { buenas: 0, fallas: 0, faltantes: 0, pendientes: 0, aPagar: 0, esperado: 0 };
  const corte = { horas: 0, valor: 0 };
  const insumos = { valor: 0, sinCosto: 0 };
  let estampado = 0;
  let cortadas = 0;

  const pedidoCosto = { valor_metro: tela.valorMetro, total_pagar: tela.total };
  const todos = args.cortes.map((c) => c.corte);

  for (const c of args.cortes) {
    const k = costoCorte({
      corte: c.corte,
      pedido: pedidoCosto,
      cortesDelPedido: todos,
      costoMaquilaUnitario: c.costoMaquilaUnitario,
      coloresMaquila: c.coloresMaquila,
      jornadas: c.jornadas,
      insumos: c.insumos,
      estampado: c.estampado,
    });
    cortadas += Number(c.corte.total_unidades);
    maquila.buenas += k.maquila.buenas;
    maquila.fallas += k.maquila.fallas;
    maquila.faltantes += k.maquila.faltantes;
    maquila.pendientes += k.maquila.pendientes;
    maquila.aPagar += k.maquila.aPagar;
    maquila.esperado += k.maquila.esperado;
    corte.horas += k.corte.horas;
    corte.valor += k.corte.valor;
    insumos.valor += k.insumos.valor;
    insumos.sinCosto += k.insumos.sinCosto;
    estampado += k.estampado;
  }

  const hayCortes = args.cortes.length > 0;
  const unidades = hayCortes ? maquila.buenas + maquila.pendientes : args.unidadesEstimadas;

  const porUnidad = Number(args.costoFijoPorUnidad) || 0;
  const fijos = {
    porUnidad,
    // Gastado: solo lo que ya llegó bien. Estimado: todo lo que se espera.
    gastado: r2(porUnidad * maquila.buenas),
    estimado: r2(porUnidad * (unidades ?? 0)),
  };

  // La tela entra UNA vez y entera: está comprada aunque no se haya cortado toda.
  const comunes = tela.total + corte.valor + insumos.valor + estampado;
  const gastado = r2(comunes + maquila.aPagar + fijos.gastado);
  const estimadoFinal = r2(comunes + maquila.esperado + fijos.estimado);

  return {
    tela,
    cortes: args.cortes.length,
    cortadas,
    maquila: { ...maquila, aPagar: r2(maquila.aPagar), esperado: r2(maquila.esperado) },
    corte: { horas: corte.horas, valor: r2(corte.valor) },
    insumos: { valor: r2(insumos.valor), sinCosto: insumos.sinCosto },
    estampado: r2(estampado),
    fijos,
    gastado,
    estimadoFinal,
    unidades,
    unidadesEstimadas: !hayCortes,
    costoUnitario: unidades && unidades > 0 ? r2(estimadoFinal / unidades) : null,
    telaPorUnidad: unidades && unidades > 0 ? r2(tela.total / unidades) : null,
  };
}
