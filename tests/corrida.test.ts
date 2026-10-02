import { describe, it, expect } from "vitest";
import {
  anchoDocumento,
  tallasDeCorrida,
  totalCorrida,
  tallasConUnidades,
  calcularArea,
  calcularTendido,
  DESPERDICIO_DOBLEZ_M,
} from "@/lib/produccion/corrida";
import type { PedidoTela, Prenda } from "@/lib/produccion/types";

function pedido(ancho_real: number | null, ancho_pedido: number | null): PedidoTela {
  return {
    id: "p1", nombre_tela: "ZZ tela", fecha_pedido: "2026-10-01", unidad: "metros",
    rendimiento: null, ancho_pedido, ancho_real, proveedor_id: null, prenda_id: null,
    colores: [], total_metros: 50, valor_metro: 5, total_pagar: 250,
    estado: "entregado", fecha_entrega_real: "2026-10-01",
  };
}

function prenda(tallas: string[]): Prenda {
  return {
    id: "pr1", nombre: "ZZ prenda", consumo_metros: 1, costo_maquila: 1,
    precio_venta_local: 1, precio_venta_online: 1, lleva_estampado: false,
    tallas, notas: "", archivada_en: null,
  };
}

describe("anchoDocumento", () => {
  it("usa el ancho real cuando existe", () => {
    expect(anchoDocumento(pedido(148, 150))).toEqual({ cm: 148, esReal: true });
  });

  /**
   * El caso que trae la mayoría de los datos migrados: nunca pasaron por Llegada,
   * así que ancho_real es nulo. Cae al pedido PERO lo marca, porque un documento
   * sin ancho no le sirve a la cortadora y uno que miente es peor.
   */
  it("sin ancho real cae al del pedido y lo marca como NO real", () => {
    expect(anchoDocumento(pedido(null, 150))).toEqual({ cm: 150, esReal: false });
  });

  it("un ancho real en 0 o negativo no cuenta como real", () => {
    expect(anchoDocumento(pedido(0, 150))).toEqual({ cm: 150, esReal: false });
    expect(anchoDocumento(pedido(-5, 150))).toEqual({ cm: 150, esReal: false });
  });

  it("sin ningún ancho devuelve null y no inventa un número", () => {
    expect(anchoDocumento(pedido(null, null))).toEqual({ cm: null, esReal: false });
    expect(anchoDocumento(pedido(null, 0))).toEqual({ cm: null, esReal: false });
  });

  /**
   * Los datos migrados mezclan cm (150, 180) con metros (1.05, 1.45). Se muestran
   * TAL CUAL: convertir sería adivinar sobre datos reales. Este test fija esa
   * decisión para que nadie la "arregle" sin querer.
   */
  it("NO convierte unidades: un 1.05 migrado sale como 1.05", () => {
    expect(anchoDocumento(pedido(1.05, 150))).toEqual({ cm: 1.05, esReal: true });
  });
});

describe("tallasDeCorrida", () => {
  it("usa las tallas de la prenda, ordenadas XS→XXL", () => {
    expect(tallasDeCorrida(prenda(["L", "XS", "M"]))).toEqual(["XS", "M", "L"]);
  });

  it("sin prenda cae a la lista genérica completa", () => {
    expect(tallasDeCorrida(undefined)).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
  });

  it("una prenda sin tallas también cae a la genérica", () => {
    expect(tallasDeCorrida(prenda([]))).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
  });
});

describe("totalCorrida", () => {
  it("suma las unidades de una capa", () => {
    expect(totalCorrida({ XS: "1", S: "2", M: "3", L: "2" })).toBe(8);
  });

  it("los campos vacíos o basura valen 0, no rompen el total", () => {
    expect(totalCorrida({ XS: "", S: "2", M: "abc", L: "-3", XL: "0" })).toBe(2);
  });

  it("una corrida vacía da 0", () => {
    expect(totalCorrida({})).toBe(0);
  });

  it("decimales se truncan: no existe media prenda en una capa", () => {
    expect(totalCorrida({ S: "2.9" })).toBe(2);
  });
});

describe("tallasConUnidades", () => {
  it("deja fuera las tallas en cero y conserva el orden recibido", () => {
    expect(tallasConUnidades(["XS", "S", "M", "L"], { XS: "0", S: "2", M: "", L: "3" }))
      .toEqual([{ talla: "S", unidades: 2 }, { talla: "L", unidades: 3 }]);
  });

  it("sin ninguna talla con unidades devuelve una lista vacía", () => {
    expect(tallasConUnidades(["XS", "S"], { XS: "0", S: "" })).toEqual([]);
  });
});

describe("calcularArea", () => {
  it("área = largo de mesa × ancho real, en m²", () => {
    // mesa de 4 m con tela de 150 cm → 4 × 1.50
    expect(calcularArea(4, 150, 0).m2).toBeCloseTo(6, 10);
  });

  it("dice cuántas tendidas de esa mesa daría la tela entera", () => {
    // 87.4 m de tela sobre una mesa de 4 m
    expect(calcularArea(4, 150, 87.4).tendidas).toBeCloseTo(21.85, 10);
  });

  it("sin largo de mesa no calcula nada", () => {
    expect(calcularArea(0, 150, 50)).toEqual({ m2: null, tendidas: null, anchoSospechoso: false });
    expect(calcularArea(NaN, 150, 50).m2).toBeNull();
  });

  it("sin ancho tampoco", () => {
    expect(calcularArea(4, null, 50)).toEqual({ m2: null, tendidas: null, anchoSospechoso: false });
  });

  /**
   * El caso que de verdad importa: los datos migrados mezclan cm con metros.
   * Un ancho de 1.05 daría 0.042 m², una cifra absurda que podría pasar por buena
   * en una decisión de corte. Se marca y NO se calcula.
   */
  it("un ancho que parece estar en metros se marca y no se calcula", () => {
    expect(calcularArea(4, 1.05, 50)).toEqual({ m2: null, tendidas: null, anchoSospechoso: true });
    expect(calcularArea(4, 1.45, 50).anchoSospechoso).toBe(true);
  });

  it("10 cm es el límite: a partir de ahí se calcula", () => {
    expect(calcularArea(4, 9.9, 50).anchoSospechoso).toBe(true);
    expect(calcularArea(4, 10, 50).anchoSospechoso).toBe(false);
  });

  it("sin metros de tela da el área pero no las tendidas", () => {
    const r = calcularArea(4, 150, 0);
    expect(r.m2).toBeCloseTo(6, 10);
    expect(r.tendidas).toBeNull();
  });
});

describe("calcularTendido", () => {
  /**
   * EL caso que justifica todo: sin contar los dobleces saldrían 10 capas
   * (90 / 9 = 10 exacto) y la décima se quedaría a medias sobre la mesa.
   */
  it("90 m sobre una mesa de 9 m dan 9 capas, no 10", () => {
    const t = calcularTendido(90, 9);
    expect(t.capas).toBe(9);
    expect(Math.floor(90 / 9)).toBe(10); // lo que daría sin desperdicio
  });

  it("el desperdicio son (n-1) dobleces, no n", () => {
    const t = calcularTendido(90, 9);
    expect(t.desperdicioDobleces).toBeCloseTo(8 * DESPERDICIO_DOBLEZ_M, 10);
  });

  it("los metros usables NO incluyen el desperdicio de los dobleces", () => {
    const t = calcularTendido(90, 9);
    expect(t.metrosUsables).toBe(81);
  });

  it("la sobra es lo que no entró en ninguna capa ni en un doblez", () => {
    const t = calcularTendido(90, 9);
    expect(t.metrosUsables + t.desperdicioDobleces + t.sobra).toBeCloseTo(90, 10);
    expect(t.sobra).toBeCloseTo(90 - 81 - 1.2, 10);
  });

  it("una sola capa no tiene ningún doblez", () => {
    const t = calcularTendido(10, 9);
    expect(t.capas).toBe(1);
    expect(t.desperdicioDobleces).toBe(0);
    expect(t.metrosUsables).toBe(9);
  });

  it("si no alcanza ni una capa completa son 0 capas y todo es sobra", () => {
    const t = calcularTendido(5, 9);
    expect(t).toEqual({ capas: 0, metrosUsables: 0, desperdicioDobleces: 0, sobra: 5 });
  });

  it("el caso exacto no se cae a la capa anterior por redondeo", () => {
    // 2 capas de 9 m + 1 doblez = 18.15 m justos
    expect(calcularTendido(18.15, 9).capas).toBe(2);
    // un milímetro menos y ya no caben
    expect(calcularTendido(18.14, 9).capas).toBe(1);
  });

  it("sin tela o sin mesa no hay tendido", () => {
    expect(calcularTendido(0, 9).capas).toBe(0);
    expect(calcularTendido(90, 0)).toEqual({ capas: 0, metrosUsables: 0, desperdicioDobleces: 0, sobra: 90 });
  });
});
