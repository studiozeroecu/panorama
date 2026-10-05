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
