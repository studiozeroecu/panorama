import { describe, it, expect } from "vitest";
import { resumenSueldoVatex, type TarifaSueldoVatex } from "@/lib/finanzas/sueldoVatex";

const t = (desde: string, monto: number, dia_pago = 30): TarifaSueldoVatex => ({ id: desde, desde, monto, dia_pago, notas: "" });
const p = (fecha: string, monto: number) => ({ id: fecha + monto, fecha, monto, notas: "" });

describe("sueldo de VATEX (personal)", () => {
  it("$300 desde agosto, sin pagos: debe agosto, septiembre y octubre; noviembre aún no llega", () => {
    const r = resumenSueldoVatex([t("2026-08-01", 300)], [], "2026-11-16");
    expect(r.meses.map((m) => [m.mes, m.fechaPago, m.falta])).toEqual([
      ["2026-08", "2026-08-30", 300],
      ["2026-09", "2026-09-30", 300],
      ["2026-10", "2026-10-30", 300],
    ]);
    expect(r.teDebe).toBe(900);
    expect(r.proximo).toEqual({ mes: "2026-11", fechaPago: "2026-11-30", monto: 300 });
  });

  it("el día 31 cae el último del mes, y el mes de hoy cuenta cuando llega su día", () => {
    const r = resumenSueldoVatex([t("2027-02-01", 300, 31)], [], "2027-02-28");
    expect(r.meses.map((m) => m.fechaPago)).toEqual(["2027-02-28"]);
  });

  it("los pagos van al mes más antiguo primero", () => {
    const r = resumenSueldoVatex([t("2026-08-01", 300)], [p("2026-11-01", 450)], "2026-11-16");
    expect(r.meses.map((m) => [m.mes, m.pagado, m.falta])).toEqual([
      ["2026-08", 300, 0],
      ["2026-09", 150, 150],
      ["2026-10", 0, 300],
    ]);
    expect(r.teDebe).toBe(450);
    expect(r.totalPagado).toBe(450);
  });

  it("si cambia el valor, los meses de antes no se tocan; 0 = ya no hay sueldo", () => {
    const r = resumenSueldoVatex(
      [t("2026-08-01", 300), t("2026-10-01", 350), t("2026-12-01", 0)],
      [],
      "2027-01-31"
    );
    expect(r.meses.map((m) => [m.mes, m.sueldo])).toEqual([
      ["2026-08", 300],
      ["2026-09", 300],
      ["2026-10", 350],
      ["2026-11", 350],
    ]);
    expect(r.proximo).toBeNull();
  });

  it("pagado de más queda a favor y no da deuda negativa", () => {
    const r = resumenSueldoVatex([t("2026-10-01", 300)], [p("2026-10-30", 400)], "2026-11-16");
    expect([r.teDebe, r.aFavor]).toEqual([0, 100]);
  });

  it("sin sueldo configurado no debe nada", () => {
    const r = resumenSueldoVatex([], [], "2026-11-16");
    expect([r.meses.length, r.teDebe, r.proximo]).toEqual([0, 0, null]);
  });
});
