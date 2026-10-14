import { describe, it, expect } from "vitest";
import { resumenTela, type CorteResumen } from "@/lib/produccion/resumenTela";

const PEDIDO = { total_metros: 100, valor_metro: 5, total_pagar: 500 };

describe("resumenTela — se va llenando por etapas", () => {
  it("recién pedida: solo la tela, y las prendas se estiman por consumo", () => {
    const r = resumenTela({ pedido: PEDIDO, unidadesEstimadas: 250, cortes: [] });
    expect(r.gastado).toBe(500);
    expect(r.estimadoFinal).toBe(500);
    expect(r.unidades).toBe(250);
    expect(r.unidadesEstimadas).toBe(true);
    expect(r.telaPorUnidad).toBe(2);
    expect(r.costoUnitario).toBe(2);
  });

  it("sin prenda ni consumo: no inventa un costo por prenda", () => {
    const r = resumenTela({ pedido: PEDIDO, unidadesEstimadas: null, cortes: [] });
    expect(r.unidades).toBeNull();
    expect(r.costoUnitario).toBeNull();
  });

  const corte = (entregas: CorteResumen["coloresMaquila"][number]["entregas"]): CorteResumen => ({
    corte: { id: "a", total_unidades: 200, metros_consumidos: null },
    costoMaquilaUnitario: 1.5,
    coloresMaquila: [{ unidades: 200, entregas }],
    jornadas: [{ horas: 5, tarifa_hora: 4 }], // $20
    insumos: [{ costo: 30 }, { costo: null }],
    estampado: 0,
  });

  it("cortada y en maquila: lo gastado solo cuenta la maquila de lo entregado", () => {
    const r = resumenTela({
      pedido: PEDIDO, unidadesEstimadas: 250,
      cortes: [corte([{ tipo: "entrega", unidades: 80 }])],
    });
    // tela 500 + horas 20 + insumos 30 = 550
    expect(r.maquila.aPagar).toBe(120); // 80 × 1.5
    expect(r.maquila.esperado).toBe(300); // 200 × 1.5
    expect(r.gastado).toBe(670);
    expect(r.estimadoFinal).toBe(850);
    expect(r.unidades).toBe(200); // ya no se estima: salen del corte
    expect(r.unidadesEstimadas).toBe(false);
    expect(r.costoUnitario).toBe(4.25);
    expect(r.insumos.sinCosto).toBe(1);
  });

  it("la tela entra UNA vez, aunque haya varios cortes sin metros", () => {
    const a = corte([]);
    const b = { ...corte([]), corte: { id: "b", total_unidades: 100, metros_consumidos: null } };
    b.coloresMaquila = [{ unidades: 100, entregas: [] }];
    const r = resumenTela({ pedido: PEDIDO, unidadesEstimadas: 250, cortes: [a, b] });
    expect(r.tela.total).toBe(500);
    expect(r.cortadas).toBe(300);
    // 500 tela + 2×20 horas + 2×30 insumos + 300×1.5 maquila
    expect(r.estimadoFinal).toBe(1050);
  });

  it("fallas y faltantes no cuentan como prendas ni se pagan", () => {
    const r = resumenTela({
      pedido: PEDIDO, unidadesEstimadas: 250,
      cortes: [corte([
        { tipo: "entrega", unidades: 190 },
        { tipo: "falla", unidades: 4 },
        { tipo: "faltante", unidades: 6 },
      ])],
    });
    expect(r.unidades).toBe(190);
    expect(r.maquila.aPagar).toBe(285);
    expect(r.maquila.esperado).toBe(285);
  });
});

describe("resumenTela — costos fijos por prenda", () => {
  it("antes de cortar: costo fijo × prendas estimadas", () => {
    const r = resumenTela({ pedido: PEDIDO, unidadesEstimadas: 250, cortes: [], costoFijoPorUnidad: 0.4 });
    expect(r.fijos).toEqual({ porUnidad: 0.4, gastado: 0, estimado: 100 });
    expect(r.estimadoFinal).toBe(600); // 500 tela + 100 fijos
    expect(r.costoUnitario).toBe(2.4); // 2.00 tela + 0.40 fijos
  });

  it("en maquila: lo gastado solo lleva los fijos de lo entregado bien", () => {
    const r = resumenTela({
      pedido: PEDIDO, unidadesEstimadas: 250, costoFijoPorUnidad: 0.5,
      cortes: [{
        corte: { id: "a", total_unidades: 200, metros_consumidos: null },
        costoMaquilaUnitario: 1.5,
        coloresMaquila: [{ unidades: 200, entregas: [{ tipo: "entrega", unidades: 80 }] }],
        jornadas: [], insumos: [], estampado: 0,
      }],
    });
    expect(r.fijos.gastado).toBe(40); // 80 × 0.50
    expect(r.fijos.estimado).toBe(100); // 200 × 0.50
    expect(r.gastado).toBe(660); // 500 + 120 maquila + 40
    expect(r.estimadoFinal).toBe(900); // 500 + 300 maquila + 100
  });
});
