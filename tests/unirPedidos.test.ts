import { describe, expect, it } from "vitest";
import { ordenParaUnir, vistaUnion } from "@/lib/produccion/unirPedidos";
import type { PedidoTela } from "@/lib/produccion/types";

const pedido = (p: Partial<PedidoTela>): PedidoTela =>
  ({
    id: "x", nombre_tela: "Monaco", fecha_pedido: "2026-10-01", ancho_real: 150, prenda_id: "hoodie",
    colores: [], total_metros: 0, total_pagar: 0, ...p,
  }) as PedidoTela;

const a = pedido({
  id: "a", fecha_pedido: "2026-10-01", total_metros: 100, total_pagar: 500,
  colores: [{ color: "Negro", metros: 60 }, { color: "Crudo", metros: 40 }] as PedidoTela["colores"],
});
const b = pedido({
  id: "b", fecha_pedido: "2026-10-20", total_metros: 50, total_pagar: 400,
  colores: [{ color: " negro ", metros: 30 }, { color: "Vino", metros: 20 }] as PedidoTela["colores"],
});

describe("vistaUnion", () => {
  it("suma los metros de un mismo color aunque esté escrito distinto", () => {
    expect(vistaUnion([a, b]).colores).toEqual([
      { color: "Negro", metros: 90 },
      { color: "Crudo", metros: 40 },
      { color: "Vino", metros: 20 },
    ]);
  });

  it("deja el dinero exacto y el metro en el promedio", () => {
    const v = vistaUnion([a, b]);
    expect(v.totalMetros).toBe(150);
    expect(v.totalPagar).toBe(900);
    expect(v.valorMetro).toBe(6);
  });

  it("nota las prendas distintas, para preguntar", () => {
    expect(vistaUnion([a, b]).prendaIds).toEqual(["hoodie"]);
    expect(vistaUnion([a, { ...b, prenda_id: "hoodie-mujer" }]).prendaIds).toEqual(["hoodie", "hoodie-mujer"]);
  });

  it("da los anchos de menor a mayor, sin repetir", () => {
    expect(vistaUnion([a, b]).anchos).toEqual([150]);
    expect(vistaUnion([a, { ...b, ancho_real: 145 }]).anchos).toEqual([145, 150]);
  });

  it("no cuenta un ancho migrado en metros ni uno vacío", () => {
    expect(vistaUnion([a, { ...b, ancho_real: 1.45 }]).anchos).toEqual([150]);
    expect(vistaUnion([a, { ...b, ancho_real: null }]).anchos).toEqual([150]);
  });
});

describe("ordenParaUnir", () => {
  it("pone primero el pedido más antiguo, sin importar cómo se marcaron", () => {
    expect(ordenParaUnir([b, a]).map((p) => p.id)).toEqual(["a", "b"]);
  });
});
