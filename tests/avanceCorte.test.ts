import { describe, it, expect } from "vitest";
import { avanceCorte } from "@/lib/produccion/avanceCorte";

const PEDIDO = [
  { id: "pc-negro", color: "Negro" },
  { id: "pc-crudo", color: "Crudo" },
];

describe("avanceCorte", () => {
  it("sin cortes, la tela está pendiente", () => {
    const a = avanceCorte(100, PEDIDO, []);
    expect(a.listo).toBe(false);
    expect(a.faltan).toEqual(["Negro", "Crudo"]);
    expect(a.hayMetros).toBe(false);
  });

  it("EL FALLO: cortada entera SIN metros registrados sale de pendientes", () => {
    const a = avanceCorte(100, PEDIDO, [
      {
        metros_consumidos: null,
        colores: [
          { pedido_color_id: "pc-negro", color: "Negro" },
          { pedido_color_id: "pc-crudo", color: "Crudo" },
        ],
      },
    ]);
    expect(a.listo).toBe(true);
    // El saldo sigue en 100 porque nadie apuntó metros: es un dato, no el criterio.
    expect(a.saldo).toBe(100);
  });

  it("en varias tandas: Negro hoy, Crudo mañana — pendiente hasta tener los dos", () => {
    const negro = { metros_consumidos: null, colores: [{ pedido_color_id: "pc-negro", color: "Negro" }] };
    const crudo = { metros_consumidos: null, colores: [{ pedido_color_id: "pc-crudo", color: "Crudo" }] };

    const hoy = avanceCorte(100, PEDIDO, [negro]);
    expect(hoy.listo).toBe(false);
    expect(hoy.cortados).toEqual(["Negro"]);
    expect(hoy.faltan).toEqual(["Crudo"]);

    expect(avanceCorte(100, PEDIDO, [negro, crudo]).listo).toBe(true);
  });

  it("sin pedido_color_id empareja por nombre normalizado", () => {
    const a = avanceCorte(100, PEDIDO, [
      {
        metros_consumidos: null,
        colores: [
          { pedido_color_id: null, color: "  NEGRO " },
          { pedido_color_id: null, color: "crudo" },
        ],
      },
    ]);
    expect(a.listo).toBe(true);
  });

  it("un id de OTRO color no cuenta, aunque el nombre se parezca", () => {
    const a = avanceCorte(100, PEDIDO, [
      { metros_consumidos: null, colores: [{ pedido_color_id: "pc-otro", color: "Negro" }] },
    ]);
    // Con id presente manda el id; el nombre no se usa como respaldo.
    expect(a.cortados).toEqual([]);
  });

  it("con metros registrados y saldo <= 0.5, está lista aunque falte un color", () => {
    const a = avanceCorte(100, PEDIDO, [
      { metros_consumidos: "99.6", colores: [{ pedido_color_id: "pc-negro", color: "Negro" }] },
    ]);
    expect(a.hayMetros).toBe(true);
    expect(a.saldo).toBeCloseTo(0.4);
    expect(a.listo).toBe(true);
  });

  it("con metros registrados y saldo de sobra, falta un color: pendiente", () => {
    const a = avanceCorte(100, PEDIDO, [
      { metros_consumidos: 40, colores: [{ pedido_color_id: "pc-negro", color: "Negro" }] },
    ]);
    expect(a.listo).toBe(false);
    expect(a.saldo).toBe(60);
  });

  it("un pedido sin colores no se da por cortado por no faltar ninguno", () => {
    expect(avanceCorte(100, [], []).listo).toBe(false);
  });
});
