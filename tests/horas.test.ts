import { describe, it, expect } from "vitest";
import { validarHoras, costoHoras, TARIFA_HORA_CORTADORA } from "@/lib/produccion/horas";

describe("validarHoras", () => {
  it("vacío = no anotó horas, no es error", () => {
    expect(validarHoras("")).toEqual({ horas: null });
    expect(validarHoras("  ")).toEqual({ horas: null });
  });

  it("acepta decimales con coma o punto", () => {
    expect(validarHoras("2.5")).toEqual({ horas: 2.5 });
    expect(validarHoras("3,5")).toEqual({ horas: 3.5 });
  });

  it("rechaza 0, negativos, texto y cifras absurdas (minutos)", () => {
    expect("error" in validarHoras("0")).toBe(true);
    expect("error" in validarHoras("-2")).toBe(true);
    expect("error" in validarHoras("abc")).toBe(true);
    expect("error" in validarHoras("90")).toBe(true);
  });
});

describe("costoHoras", () => {
  it("horas × tarifa, redondeado al centavo", () => {
    expect(costoHoras(3)).toBe(3 * TARIFA_HORA_CORTADORA);
    expect(costoHoras(2.5, 4)).toBe(10);
    expect(costoHoras(1 / 3, 4)).toBe(1.33);
  });
});
