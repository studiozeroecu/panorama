import { describe, it, expect } from "vitest";
import { esperadoPorTalla, compararConCorrida } from "@/lib/produccion/descuadre";

const CORRIDA = { S: 1, M: 2, L: 1 }; // 4 unidades por capa

describe("esperadoPorTalla", () => {
  it("multiplica la corrida por las capas", () => {
    expect(esperadoPorTalla(CORRIDA, 5)).toEqual({ S: 5, M: 10, L: 5 });
  });

  it("sin capas o sin corrida no predice nada", () => {
    expect(esperadoPorTalla(CORRIDA, 0)).toEqual({});
    expect(esperadoPorTalla(null, 5)).toEqual({});
    expect(esperadoPorTalla({}, 5)).toEqual({});
  });

  it("las tallas en cero no entran", () => {
    expect(esperadoPorTalla({ S: 1, M: 0 }, 3)).toEqual({ S: 3 });
  });

  it("una capa fraccionaria se trunca: no se tiende media capa", () => {
    expect(esperadoPorTalla(CORRIDA, 2.9)).toEqual({ S: 2, M: 4, L: 2 });
  });
});

describe("compararConCorrida", () => {
  it("cuando cuadra exacto no dice nada", () => {
    const d = compararConCorrida(CORRIDA, 5, { S: 5, M: 10, L: 5 });
    expect(d.severidad).toBe("exacto");
    expect(d.mensaje).toBeNull();
    expect(d.esperado).toBe(20);
    expect(d.real).toBe(20);
  });

  /** El aviso sube de tono con la desviación, no es un sí/no. */
  it("una diferencia pequeña es leve y se explica como normal", () => {
    const d = compararConCorrida(CORRIDA, 5, { S: 5, M: 9, L: 5 });
    expect(d.severidad).toBe("leve");
    expect(d.diferencia).toBe(-1);
    expect(d.mensaje).toContain("1 unidad menos");
    expect(d.mensaje).toContain("normal");
  });

  it("una diferencia grande sube el tono y da el porcentaje", () => {
    const d = compararConCorrida(CORRIDA, 5, { S: 5, M: 2, L: 5 });
    expect(d.severidad).toBe("alto");
    expect(d.diferencia).toBe(-8);
    expect(d.mensaje).toContain("8 unidades menos");
    expect(d.mensaje).toContain("40%");
    expect(d.mensaje).toContain("Revisa");
  });

  it("también avisa cuando salen de MÁS", () => {
    const d = compararConCorrida(CORRIDA, 5, { S: 5, M: 20, L: 5 });
    expect(d.diferencia).toBe(10);
    expect(d.mensaje).toContain("más");
  });

  /**
   * Con cifras pequeñas el porcentaje engaña: 1 de 6 es un 17% y sonaría grave
   * sin serlo. Por eso la tolerancia absoluta convive con la relativa.
   */
  it("con totales pequeños manda la tolerancia absoluta", () => {
    const d = compararConCorrida({ M: 2 }, 3, { M: 5 }); // esperado 6, real 5
    expect(d.severidad).toBe("leve");
  });

  it("en totales grandes manda la relativa", () => {
    // esperado 400, real 395 → 5 unidades es más que la tolerancia absoluta
    // pero solo un 1.25%, así que sigue siendo leve
    const d = compararConCorrida({ M: 100 }, 4, { M: 395 });
    expect(d.severidad).toBe("leve");
  });

  it("desglosa talla por talla", () => {
    const d = compararConCorrida(CORRIDA, 5, { S: 6, M: 10, L: 3 });
    expect(d.porTalla).toEqual([
      { talla: "S", esperado: 5, real: 6, diferencia: 1 },
      { talla: "M", esperado: 10, real: 10, diferencia: 0 },
      { talla: "L", esperado: 5, real: 3, diferencia: -2 },
    ]);
  });

  it("una talla que no estaba en la corrida aparece igual en el desglose", () => {
    const d = compararConCorrida({ M: 2 }, 2, { M: 4, XL: 3 });
    expect(d.porTalla).toContainEqual({ talla: "XL", esperado: 0, real: 3, diferencia: 3 });
  });

  /**
   * La severidad mira el TOTAL, no cada talla: una de más compensada con otra de
   * menos es un reparto distinto, no una pérdida.
   */
  it("un trasvase entre tallas no es descuadre del total", () => {
    const d = compararConCorrida(CORRIDA, 5, { S: 7, M: 10, L: 3 });
    expect(d.diferencia).toBe(0);
    expect(d.severidad).toBe("exacto");
    expect(d.porTalla.find((x) => x.talla === "S")?.diferencia).toBe(2);
  });

  /** Sin con qué comparar, la pregunta no aplica — no es un descuadre de cero. */
  it("sin corrida no inventa un descuadre", () => {
    const d = compararConCorrida(null, 5, { M: 7 });
    expect(d.esperado).toBe(0);
    expect(d.real).toBe(7);
    expect(d.mensaje).toBeNull();
    expect(d.severidad).toBe("exacto");
  });
});
