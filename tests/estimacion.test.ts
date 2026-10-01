import { describe, it, expect } from "vitest";
import { estimarUnidades } from "@/lib/produccion/estimacion";
import type { Prenda } from "@/lib/produccion/types";

/** Prenda mínima: solo `consumo_metros` entra en el cálculo. */
function prenda(consumo_metros: number): Prenda {
  return {
    id: "p1",
    nombre: "ZZ prueba",
    consumo_metros,
    costo_maquila: 1,
    precio_venta_local: 10,
    precio_venta_online: 12,
    lleva_estampado: false,
    tallas: ["S", "M"],
    notas: "",
    archivada_en: null,
  };
}

describe("estimarUnidades", () => {
  it("divide los metros entre el consumo por unidad", () => {
    expect(estimarUnidades(prenda(2), 10)).toBe(5);
  });

  it("redondea hacia abajo: media prenda no es una prenda", () => {
    expect(estimarUnidades(prenda(3), 10)).toBe(3);
    expect(estimarUnidades(prenda(0.75), 50)).toBe(66); // 66.66…
  });

  /**
   * Los consumos reales de las prendas migradas. Fija los números que las tres
   * pantallas venían mostrando, para que el refactor no los mueva en silencio.
   */
  it.each([
    [0.75, 100, 133], // Camiseta cuello chino · Enteriso mujer blusa
    [1, 100, 100],    // Buzo cuello chino · camiseta basica
    [1.1, 100, 90],   // Conjunto mujer pantalón · Hoddie mujer
    [2, 100, 50],     // conjunto mujer pant y bluza
  ])("consumo %s m con %s m de tela da %s unidades", (consumo, metros, esperado) => {
    expect(estimarUnidades(prenda(consumo), metros)).toBe(esperado);
  });

  // ── Los dos casos sin dato devuelven null, nunca 0 ──
  // "No se puede saber" y "no sale ninguna unidad" son cosas distintas: las
  // pantallas usan el null para callar, y un 0 se leería como un dato real.

  it("sin prenda asignada no estima nada", () => {
    expect(estimarUnidades(undefined, 100)).toBeNull();
  });

  it("con el consumo en 0 no estima nada", () => {
    expect(estimarUnidades(prenda(0), 100)).toBeNull();
  });

  it("sin metros no estima nada", () => {
    expect(estimarUnidades(prenda(1), 0)).toBeNull();
  });

  it("valores absurdos tampoco pasan", () => {
    expect(estimarUnidades(prenda(-1), 100)).toBeNull();
    expect(estimarUnidades(prenda(1), -100)).toBeNull();
    expect(estimarUnidades(prenda(NaN), 100)).toBeNull();
    expect(estimarUnidades(prenda(1), NaN)).toBeNull();
  });

  it("menos tela que una unidad da 0, no null: ahí sí se sabe la respuesta", () => {
    expect(estimarUnidades(prenda(2), 1)).toBe(0);
  });
});
