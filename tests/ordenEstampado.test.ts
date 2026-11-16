import { describe, it, expect } from "vitest";
import { resumenOrden, textoParaTaller, type LoteParaOrden } from "@/lib/produccion/ordenEstampado";

const lote = (id: string, tono: LoteParaOrden["tono"], disenos: LoteParaOrden["disenos"]): LoteParaOrden => ({
  id, etiqueta: id, tono, disenos,
});

describe("resumenOrden", () => {
  it("4 hoodies + 4 camisetas del mismo estampado oscuro = 2 metros", () => {
    const r = resumenOrden(
      [lote("hoodie", "oscuro", [{ nombre: "Cajas", unidades: 4 }]), lote("camiseta", "oscuro", [{ nombre: "cajas ", unidades: 4 }])],
      4
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ diseno: "Cajas", tono: "oscuro", unidades: 8, metros: 2 });
    expect(r[0].detalle.map((d) => d.metros)).toEqual([1, 1]);
  });

  it("se redondea sobre el total de la orden, no lote por lote", () => {
    const r = resumenOrden(
      [lote("a", "claro", [{ nombre: "Logo", unidades: 2 }]), lote("b", "claro", [{ nombre: "Logo", unidades: 2 }]), lote("c", "claro", [{ nombre: "Logo", unidades: 3 }])],
      4
    );
    expect(r[0]).toMatchObject({ unidades: 7, metros: 2 });
    expect(r[0].detalle.map((d) => d.metros)).toEqual([0.5, 0.5, 0.75]);
  });

  it("claro y oscuro nunca comparten metro", () => {
    const r = resumenOrden(
      [lote("blanco", "claro", [{ nombre: "Cajas", unidades: 3 }]), lote("negro", "oscuro", [{ nombre: "Cajas", unidades: 3 }])],
      4
    );
    expect(r.map((l) => [l.tono, l.metros])).toEqual([["claro", 1], ["oscuro", 1]]);
  });

  it("sin tono marcado cuenta como claro", () => {
    expect(resumenOrden([lote("x", null, [{ nombre: "Oso", unidades: 5 }])], 4)[0]).toMatchObject({ tono: "claro", metros: 2 });
  });

  it("el texto para el taller", () => {
    const r = resumenOrden([lote("n", "oscuro", [{ nombre: "Cajas", unidades: 8 }])], 4);
    expect(textoParaTaller(r, 4)).toBe(
      "Orden de estampado (4 por metro)\n• Cajas — prendas OSCURAS: 2 m (8 estampados)\nTotal: 2 m"
    );
  });
});
