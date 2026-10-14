import { describe, it, expect } from "vitest";
import { validarHoras, costoHoras, fmtHoras, TARIFA_HORA_CORTADORA } from "@/lib/produccion/horas";

describe("validarHoras (horas enteras + minutos de la lista)", () => {
  it("vacío o 0 h 0 min = no anotó horas, no es error", () => {
    expect(validarHoras("", "0")).toEqual({ horas: null });
    expect(validarHoras("0", "0")).toEqual({ horas: null });
  });

  it("convierte a horas decimales para la base", () => {
    expect(validarHoras("2", "30")).toEqual({ horas: 2.5 });
    expect(validarHoras("3", "0")).toEqual({ horas: 3 });
    expect(validarHoras("", "45")).toEqual({ horas: 0.75 });
    expect(validarHoras("1", "15")).toEqual({ horas: 1.25 });
  });

  it("EL CASO: 2.9 no es una hora — se rechaza", () => {
    expect("error" in validarHoras("2.9", "0")).toBe(true);
  });

  it("rechaza minutos fuera de la lista, negativos, texto y cifras absurdas", () => {
    expect("error" in validarHoras("2", "20")).toBe(true);
    expect("error" in validarHoras("-2", "0")).toBe(true);
    expect("error" in validarHoras("abc", "0")).toBe(true);
    expect("error" in validarHoras("90", "0")).toBe(true);
  });
});

describe("fmtHoras", () => {
  it("se lee como reloj, no como decimal", () => {
    expect(fmtHoras(2.5)).toBe("2 h 30 min");
    expect(fmtHoras(3)).toBe("3 h");
    expect(fmtHoras(0.25)).toBe("15 min");
    expect(fmtHoras(1.75)).toBe("1 h 45 min");
  });
});

describe("costoHoras", () => {
  it("horas × tarifa, redondeado al centavo", () => {
    expect(costoHoras(3)).toBe(3 * TARIFA_HORA_CORTADORA);
    expect(costoHoras(2.5, 4)).toBe(10);
    expect(costoHoras(1 / 3, 4)).toBe(1.33);
  });
});
