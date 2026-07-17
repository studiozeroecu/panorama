/**
 * Cálculo de lotes de estampado DTF (lógica transplantada de TEXTIL CONTROL):
 * los metros de film para colores claros y oscuros se redondean hacia arriba
 * POR SEPARADO y luego se suman — un metro nunca mezcla tintas de claro y
 * oscuro. Ej.: 20 claras + 20 oscuras a 4/metro = ceil(5) + ceil(5) = 10 m.
 */

export interface LoteDtf {
  unidades_claras: number;
  unidades_oscuras: number;
  por_metro: number;
  precio_metro: number;
}

export interface CalculoDtf {
  total_unidades: number;
  metros_claros: number;
  metros_oscuros: number;
  metros: number;
  valor_total: number;
  valor_unitario: number;
  capacidad: number; // estampados que caben en los metros pedidos
}

export function calcularLoteDtf(l: LoteDtf): CalculoDtf {
  const claras = Math.max(0, Math.round(l.unidades_claras || 0));
  const oscuras = Math.max(0, Math.round(l.unidades_oscuras || 0));
  const porMetro = l.por_metro > 0 ? Math.round(l.por_metro) : 0;
  const total = claras + oscuras;
  if (porMetro <= 0 || total <= 0) {
    return { total_unidades: total, metros_claros: 0, metros_oscuros: 0, metros: 0, valor_total: 0, valor_unitario: 0, capacidad: 0 };
  }
  const metrosClaros = Math.ceil(claras / porMetro);
  const metrosOscuros = Math.ceil(oscuras / porMetro);
  const metros = metrosClaros + metrosOscuros;
  const valorTotal = +(metros * (l.precio_metro || 0)).toFixed(2);
  return {
    total_unidades: total,
    metros_claros: metrosClaros,
    metros_oscuros: metrosOscuros,
    metros,
    valor_total: valorTotal,
    valor_unitario: total > 0 ? +(valorTotal / total).toFixed(4) : 0,
    capacidad: metros * porMetro,
  };
}
