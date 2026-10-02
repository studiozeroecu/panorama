import { describe, it, expect } from "vitest";
import { estimarUnidades, estimar } from "@/lib/produccion/estimacion";
import type { Prenda } from "@/lib/produccion/types";

/** Prenda mínima: solo `consumo_metros` entra en el cálculo. */
function conM2(consumo_metros: number, consumo_m2: number | null): Prenda {
  return { ...prenda(consumo_metros), consumo_m2 };
}

function prenda(consumo_metros: number): Prenda {
  return {
    id: "p1",
    nombre: "ZZ prueba",
    consumo_metros,
    consumo_m2: null,
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

describe("estimar — por área cuando se puede, lineal cuando no", () => {
  // 90 m de tela, mesa de 9 m, ancho 150 cm, prenda de 1.5 m²
  //   capas  = 9 (no 10: los 8 dobleces no caben)
  //   usables= 81 m  →  81 × 1.50 = 121.5 m²
  //   unidades = floor(121.5 / 1.5) = 81
  it("cuenta capas y dobleces, y divide el área entre consumo_m2", () => {
    const e = estimar(conM2(1, 1.5), 90, 150, 9);
    expect(e.metodo).toBe("area");
    expect(e.tendido?.capas).toBe(9);
    expect(e.areaUsableM2).toBeCloseTo(121.5, 10);
    expect(e.unidades).toBe(81);
  });

  it("el desperdicio por dobleces cambia el resultado", () => {
    // sin descontar dobleces serían 10 capas → 90 m → 135 m² → 90 unidades
    expect(estimar(conM2(1, 1.5), 90, 150, 9).unidades).toBe(81);
  });

  it("sin consumo_m2 medido cae a la fórmula lineal", () => {
    const e = estimar(conM2(1.2, null), 90, 150, 9);
    expect(e.metodo).toBe("lineal");
    expect(e.unidades).toBe(75); // 90 / 1.2
    expect(e.tendido).toBeUndefined();
  });

  it("sin mesa configurada cae a la lineal", () => {
    expect(estimar(conM2(1.2, 1.5), 90, 150, 0).metodo).toBe("lineal");
  });

  /** El ancho aquí multiplica: un 1.05 en metros daría un área ridícula. */
  it("un ancho que parece estar en metros cae a la lineal", () => {
    expect(estimar(conM2(1.2, 1.5), 90, 1.05, 9).metodo).toBe("lineal");
  });

  /**
   * Menos tela que una capa daría 0 unidades por área: cierto para esa mesa,
   * pero engañoso como estimación de lo que rinde la tela.
   */
  it("si no da ni para una capa completa cae a la lineal", () => {
    const e = estimar(conM2(1.2, 1.5), 5, 150, 9);
    expect(e.metodo).toBe("lineal");
    expect(e.unidades).toBe(4); // 5 / 1.2
  });

  it("sin prenda no estima nada, por ninguno de los dos caminos", () => {
    expect(estimar(undefined, 90, 150, 9)).toEqual({ unidades: null, metodo: "lineal" });
  });

  it("acepta el consumo_m2 como texto, que es como llega de PostgREST", () => {
    const p = { ...conM2(1, 1.5), consumo_m2: "1.5" as unknown as number };
    expect(estimar(p, 90, 150, 9).unidades).toBe(81);
  });
});
