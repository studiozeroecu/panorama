import { describe, it, expect } from "vitest";
import {
  quincenaDe,
  mesDe,
  siguiente,
  anterior,
  sumarDias,
  diasEntre,
  contiene,
  quincenasDelMes,
  ultimoDiaDelMes,
} from "@/lib/finanzas/periodos";

describe("quincenas", () => {
  it("1 al 15 es la primera quincena", () => {
    expect(quincenaDe("2026-10-01")).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-15" });
    expect(quincenaDe("2026-10-15")).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-15" });
  });

  it("16 a fin de mes es la segunda, con el último día real del mes", () => {
    expect(quincenaDe("2026-10-16")).toMatchObject({ desde: "2026-10-16", hasta: "2026-10-31" });
    expect(quincenaDe("2026-11-20")).toMatchObject({ desde: "2026-11-16", hasta: "2026-11-30" });
    expect(quincenaDe("2027-02-28")).toMatchObject({ desde: "2027-02-16", hasta: "2027-02-28" });
    expect(quincenaDe("2028-02-29")).toMatchObject({ desde: "2028-02-16", hasta: "2028-02-29" }); // bisiesto
  });

  it("etiqueta legible", () => {
    expect(quincenaDe("2026-10-03").etiqueta).toBe("1–15 oct 2026");
    expect(quincenaDe("2026-10-20").etiqueta).toBe("16–31 oct 2026");
  });

  it("siguiente y anterior cruzan meses y años", () => {
    expect(siguiente(quincenaDe("2026-10-05")).desde).toBe("2026-10-16");
    expect(siguiente(quincenaDe("2026-10-20")).desde).toBe("2026-11-01");
    expect(siguiente(quincenaDe("2026-12-20"))).toMatchObject({ desde: "2027-01-01", hasta: "2027-01-15" });
    expect(anterior(quincenaDe("2027-01-05"))).toMatchObject({ desde: "2026-12-16", hasta: "2026-12-31" });
    expect(anterior(quincenaDe("2026-03-10"))).toMatchObject({ desde: "2026-02-16", hasta: "2026-02-28" });
  });
});

describe("meses", () => {
  it("de 1 al último día", () => {
    expect(mesDe("2026-10-06")).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "octubre 2026" });
    expect(mesDe("2027-02-10")).toMatchObject({ desde: "2027-02-01", hasta: "2027-02-28" });
  });

  it("siguiente y anterior", () => {
    expect(siguiente(mesDe("2026-12-31")).desde).toBe("2027-01-01");
    expect(anterior(mesDe("2026-01-01")).hasta).toBe("2025-12-31");
  });

  it("un mes son sus dos quincenas", () => {
    const [q1, q2] = quincenasDelMes(mesDe("2026-11-07"));
    expect(q1).toMatchObject({ desde: "2026-11-01", hasta: "2026-11-15" });
    expect(q2).toMatchObject({ desde: "2026-11-16", hasta: "2026-11-30" });
  });

  it("último día del mes", () => {
    expect(ultimoDiaDelMes(2026, 2)).toBe(28);
    expect(ultimoDiaDelMes(2028, 2)).toBe(29);
    expect(ultimoDiaDelMes(2026, 4)).toBe(30);
    expect(ultimoDiaDelMes(2026, 12)).toBe(31);
  });
});

describe("aritmética de fechas sin zona horaria", () => {
  it("sumar días cruza fin de mes y de año", () => {
    expect(sumarDias("2026-10-01", 30)).toBe("2026-10-31");
    expect(sumarDias("2026-10-01", 120)).toBe("2027-01-29");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("días entre fechas", () => {
    expect(diasEntre("2026-10-01", "2026-10-31")).toBe(30);
    expect(diasEntre("2026-10-31", "2026-10-01")).toBe(-30);
  });

  it("contiene incluye los extremos e ignora vacíos", () => {
    const q = quincenaDe("2026-10-10");
    expect(contiene(q, "2026-10-01")).toBe(true);
    expect(contiene(q, "2026-10-15")).toBe(true);
    expect(contiene(q, "2026-10-16")).toBe(false);
    expect(contiene(q, null)).toBe(false);
  });
});
