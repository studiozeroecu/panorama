import { describe, it, expect } from "vitest";
import {
  anchoDocumento,
  tallasDeCorrida,
  totalCorrida,
  tallasConUnidades,
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
