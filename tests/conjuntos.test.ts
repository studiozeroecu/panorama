import { describe, it, expect } from "vitest";
import {
  nombreParte, etiquetaFila, setsPosibles, fraccionTelaSuperior, costoMaquilaLote,
} from "@/lib/produccion/conjuntos";

const EMILIA = {
  partes: [
    { parte: "superior" as const, nombre: "Blusa" },
    { parte: "inferior" as const, nombre: "Pantalón" },
  ],
};

describe("nombres de las partes", () => {
  it("usa el nombre que le pusiste a la parte", () => {
    expect(nombreParte(EMILIA, "superior")).toBe("Blusa");
    expect(etiquetaFila("Negro", "inferior", EMILIA)).toBe("Negro · Pantalón");
  });
  it("sin nombre, dice 'Parte superior'; una prenda sola es solo el color", () => {
    expect(nombreParte({ partes: [] }, "superior")).toBe("Parte superior");
    expect(etiquetaFila("Negro", null)).toBe("Negro");
  });
});

describe("setsPosibles — siempre de la misma talla", () => {
  it("EL CASO: 18 superiores y 14 inferiores → 14 sets + 4 superiores sueltas", () => {
    const r = setsPosibles({ S: 4, M: 6, L: 5, XL: 3 }, { S: 3, M: 5, L: 4, XL: 2 });
    expect(r.sets).toBe(14);
    expect(r.porTalla).toEqual({ S: 3, M: 5, L: 4, XL: 2 });
    expect(r.sobranSuperior).toEqual({ S: 1, M: 1, L: 1, XL: 1 });
    expect(r.sobranInferior).toEqual({});
  });
  it("no arma sets cruzando tallas", () => {
    const r = setsPosibles({ S: 2 }, { M: 2 });
    expect(r.sets).toBe(0);
    expect(r.sobranSuperior).toEqual({ S: 2 });
    expect(r.sobranInferior).toEqual({ M: 2 });
  });
});

describe("fraccionTelaSuperior — la tela según lo que consume cada parte", () => {
  it("con consumos: prendas × consumo", () => {
    // 10 blusas × 0.8 = 8 · 10 pantalones × 1.2 = 12 → la blusa se lleva 8/20
    expect(fraccionTelaSuperior(10, 10, 0.8, 1.2)).toBeCloseTo(0.4);
  });
  it("sin algún consumo, solo por prendas (no se inventa)", () => {
    expect(fraccionTelaSuperior(18, 14, null, 1.2)).toBeCloseTo(18 / 32);
  });
  it("sin prendas, mitad y mitad", () => {
    expect(fraccionTelaSuperior(0, 0, 1, 1)).toBe(0.5);
  });
});

describe("costoMaquilaLote — fila por fila", () => {
  it("prenda sola: igual que antes (precio × prendas)", () => {
    expect(costoMaquilaLote({ costo_unitario: "1.5", colores: [
      { unidades: 10, costo_unitario: null }, { unidades: 6, costo_unitario: null },
    ] })).toBe(24);
  });
  it("conjunto: cada parte a su precio", () => {
    expect(costoMaquilaLote({ costo_unitario: 0, colores: [
      { unidades: 18, costo_unitario: 1.2 }, { unidades: 14, costo_unitario: 1.5 },
    ] })).toBeCloseTo(42.6);
  });
});
