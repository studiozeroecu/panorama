import { describe, it, expect } from "vitest";
import { costoTela, costoCorte } from "@/lib/produccion/costoCorte";

const PEDIDO = { valor_metro: 5, total_pagar: 500 }; // 100 m a $5

describe("costoTela", () => {
  it("con metros anotados: metros × precio del metro", () => {
    const c = { id: "a", total_unidades: 50, metros_consumidos: 40 };
    expect(costoTela(c, PEDIDO, [c])).toEqual({ valor: 200, estimado: false });
  });

  it("sin metros: reparte el costo del pedido por prendas (estimado)", () => {
    const a = { id: "a", total_unidades: 30, metros_consumidos: null };
    const b = { id: "b", total_unidades: 70, metros_consumidos: null };
    expect(costoTela(a, PEDIDO, [a, b])).toEqual({ valor: 150, estimado: true });
    expect(costoTela(b, PEDIDO, [a, b])).toEqual({ valor: 350, estimado: true });
  });

  it("mezcla: los sin metros se reparten lo que dejaron los que sí tienen", () => {
    const a = { id: "a", total_unidades: 50, metros_consumidos: 60 }; // $300
    const b = { id: "b", total_unidades: 40, metros_consumidos: null };
    expect(costoTela(b, PEDIDO, [a, b])).toEqual({ valor: 200, estimado: true });
  });
});

describe("costoCorte", () => {
  const base = {
    corte: { id: "a", total_unidades: 100, metros_consumidos: 50 }, // tela $250
    pedido: PEDIDO,
    costoMaquilaUnitario: 1.5,
    jornadas: [{ horas: 2.5, tarifa_hora: 4 }], // $10
    insumos: [{ costo: 12 }, { costo: null }],
    estampado: 0,
  };

  it("a la maquila solo se le pagan las buenas; fallas y faltantes no", () => {
    const r = costoCorte({
      ...base,
      cortesDelPedido: [base.corte],
      coloresMaquila: [{
        unidades: 100,
        entregas: [
          { tipo: "entrega", unidades: 90 },
          { tipo: "falla", unidades: 3 },
          { tipo: "faltante", unidades: 7 },
        ],
      }],
    });
    expect(r.maquila.aPagar).toBe(135); // 90 × 1.5
    expect(r.maquila.esperado).toBe(135); // lote cerrado: nada pendiente
    expect(r.unidades).toBe(90);
    // 250 tela + 135 maquila + 10 horas + 12 insumos = 407 → 407 / 90
    expect(r.total).toBe(407);
    expect(r.costoUnitario).toBe(4.52);
    expect(r.insumos.sinCosto).toBe(1);
  });

  it("con el lote en maquila, lo que falta cuenta como si llegara bien", () => {
    const r = costoCorte({
      ...base,
      cortesDelPedido: [base.corte],
      coloresMaquila: [{ unidades: 100, entregas: [{ tipo: "entrega", unidades: 40 }] }],
    });
    expect(r.maquila.aPagar).toBe(60); // hoy: 40 entregadas
    expect(r.maquila.esperado).toBe(150); // si llegan las 60 que faltan
    expect(r.unidades).toBe(100);
  });

  it("sin prendas buenas no hay costo unitario (no divide entre cero)", () => {
    const r = costoCorte({
      ...base,
      cortesDelPedido: [base.corte],
      coloresMaquila: [{ unidades: 10, entregas: [{ tipo: "faltante", unidades: 10 }] }],
    });
    expect(r.costoUnitario).toBeNull();
  });
});

describe("costoCorte — costos fijos por prenda (etiquetas, fundas…)", () => {
  it("se cuentan por prenda buena; fallas y faltantes no llevan etiqueta ni funda", () => {
    const r = costoCorte({
      corte: { id: "a", total_unidades: 100, metros_consumidos: 50 }, // tela $250
      pedido: { valor_metro: 5, total_pagar: 500 },
      cortesDelPedido: [{ id: "a", total_unidades: 100, metros_consumidos: 50 }],
      costoMaquilaUnitario: 1.5,
      coloresMaquila: [{
        unidades: 100,
        entregas: [
          { tipo: "entrega", unidades: 90 },
          { tipo: "falla", unidades: 3 },
          { tipo: "faltante", unidades: 7 },
        ],
      }],
      jornadas: [],
      insumos: [],
      estampado: 0,
      costoFijoPorUnidad: 0.6,
    });
    expect(r.fijos).toEqual({ porUnidad: 0.6, valor: 54 }); // 90 × 0.60
    // 250 tela + 135 maquila + 54 fijos
    expect(r.total).toBe(439);
    expect(r.costoUnitario).toBe(4.88);
  });

  it("sin costo fijo indicado, no suma nada (compatibilidad)", () => {
    const r = costoCorte({
      corte: { id: "a", total_unidades: 10, metros_consumidos: 1 },
      pedido: { valor_metro: 5, total_pagar: 5 },
      cortesDelPedido: [{ id: "a", total_unidades: 10, metros_consumidos: 1 }],
      costoMaquilaUnitario: 0,
      coloresMaquila: [{ unidades: 10, entregas: [] }],
      jornadas: [], insumos: [], estampado: 0,
    });
    expect(r.fijos.valor).toBe(0);
  });
});

describe("costoCorte — conjuntos (fase 8r)", () => {
  // 18 blusas a $1.20 de maquila y 14 pantalones a $1.50; la blusa consume 0.8 m
  // y el pantalón 1.2 m. Tela $300, horas $20, sin insumos, fijos $0.50 por prenda.
  const r = costoCorte({
    corte: { id: "a", total_unidades: 32, metros_consumidos: 60 },
    pedido: { valor_metro: 5, total_pagar: 500 },
    cortesDelPedido: [{ id: "a", total_unidades: 32, metros_consumidos: 60 }],
    costoMaquilaUnitario: 0,
    coloresMaquila: [
      { unidades: 18, entregas: [], parte: "superior", costoUnitario: 1.2 },
      { unidades: 14, entregas: [], parte: "inferior", costoUnitario: 1.5 },
    ],
    jornadas: [{ horas: 5, tarifa_hora: 4 }],
    insumos: [],
    estampado: 0,
    costoFijoPorUnidad: 0.5,
    consumoPartes: { superior: 0.8, inferior: 1.2 },
  });

  it("cada parte paga la maquila a SU precio", () => {
    expect(r.maquila.esperado).toBe(42.6); // 18 × 1.20 + 14 × 1.50
    expect(r.partes?.superior.maquila).toBe(21.6);
    expect(r.partes?.inferior.maquila).toBe(21);
  });

  it("la tela se reparte según lo que consume cada parte", () => {
    // pesos: 18 × 0.8 = 14.4 · 14 × 1.2 = 16.8 → la blusa se lleva 14.4/31.2 de $300
    expect(r.partes?.superior.tela).toBe(138.46);
    expect(r.partes?.inferior.tela).toBe(161.54);
  });

  it("costo por blusa, por pantalón y del set (una de cada)", () => {
    const s = r.partes!.superior;
    const i = r.partes!.inferior;
    // las partes suman el total del corte
    expect(r2(s.total + i.total)).toBe(r.total);
    expect(r.partes?.costoSet).toBe(r2(s.costoUnitario! + i.costoUnitario!));
  });

  it("una prenda sola no trae desglose por partes", () => {
    const sola = costoCorte({
      corte: { id: "b", total_unidades: 10, metros_consumidos: 5 },
      pedido: { valor_metro: 5, total_pagar: 25 },
      cortesDelPedido: [{ id: "b", total_unidades: 10, metros_consumidos: 5 }],
      costoMaquilaUnitario: 1,
      coloresMaquila: [{ unidades: 10, entregas: [] }],
      jornadas: [], insumos: [], estampado: 0,
    });
    expect(sola.partes).toBeNull();
    expect(sola.maquila.esperado).toBe(10); // sin precio propio, usa el de la maquila
  });
});

function r2(n: number) {
  return Math.round(n * 100) / 100;
}
