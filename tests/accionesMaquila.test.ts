import { describe, it, expect } from "vitest";
import { planTodoEnviado, planTodoRecibido, type ColorLote } from "@/lib/produccion/accionesMaquila";

const LOTE: ColorLote[] = [
  { id: "negro", estado: "pendiente", tallas: { S: 4, M: 6 }, entregas: [] },
  { id: "crudo", estado: "enviado", tallas: { S: 5 }, entregas: [{ tallas: { S: 2 }, unidades: 2 }] },
  { id: "vino", estado: "entregado", tallas: { M: 3 }, entregas: [{ tallas: { M: 3 }, unidades: 3 }] },
];

describe("Todo enviado", () => {
  it("solo los colores que todavía no salieron", () => {
    expect(planTodoEnviado(LOTE)).toEqual(["negro"]);
  });
});

describe("Todo recibido", () => {
  it("lo que falta de cada color; los completos no entran", () => {
    expect(planTodoRecibido(LOTE)).toEqual([
      { id: "negro", tallas: { S: 4, M: 6 }, unidades: 10 },
      { id: "crudo", tallas: { S: 3 }, unidades: 3 }, // ya llegaron 2 de 5
    ]);
  });

  it("respeta las bajas ya justificadas (no las vuelve a pedir)", () => {
    const conBaja: ColorLote[] = [
      { id: "x", estado: "enviado", tallas: { S: 5 }, entregas: [{ tallas: { S: 1 }, unidades: 1 }] },
    ];
    expect(planTodoRecibido(conBaja)).toEqual([{ id: "x", tallas: { S: 4 }, unidades: 4 }]);
  });

  it("si todo está completo, no hay nada que hacer", () => {
    expect(planTodoRecibido([LOTE[2]])).toEqual([]);
  });
});
