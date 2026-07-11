import { describe, it, expect } from "vitest";
import { fmtFecha, sumarDiasLaborables, enMes } from "@/lib/produccion/fechas";

describe("fechas de producción (fix zona horaria Ecuador)", () => {
  it("formatea YYYY-MM-DD sin corrimiento de día (el bug de la app vieja)", () => {
    // new Date("2026-07-11") en Ecuador daba 10/07 — el fix evita Date por completo
    expect(fmtFecha("2026-07-11")).toBe("11/07/2026");
    expect(fmtFecha("2026-01-01")).toBe("01/01/2026");
  });

  it("tolera timestamps y valores vacíos", () => {
    expect(fmtFecha("2026-07-11T00:00:00Z")).toBe("11/07/2026");
    expect(fmtFecha(null)).toBe("—");
    expect(fmtFecha("")).toBe("—");
  });

  it("suma días laborables saltando fines de semana", () => {
    // 2026-07-10 es viernes → +1 laborable = lunes 13
    expect(sumarDiasLaborables("2026-07-10", 1)).toBe("2026-07-13");
    expect(sumarDiasLaborables("2026-07-10", 5)).toBe("2026-07-17");
  });

  it("enMes compara por prefijo de string", () => {
    expect(enMes("2026-07-11", "2026-07")).toBe(true);
    expect(enMes("2026-08-01", "2026-07")).toBe(false);
    expect(enMes(null, "2026-07")).toBe(false);
  });
});
