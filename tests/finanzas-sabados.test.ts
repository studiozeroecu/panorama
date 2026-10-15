import { describe, it, expect } from "vitest";
import { diaSemana, sabadosCercanos, ajustarASabados, chequesPorFecha, repartirCuotas } from "@/lib/finanzas/cuotas";

describe("sábado más cercano", () => {
  it("día de la semana sin zona horaria", () => {
    expect(diaSemana("2026-10-17")).toBe(6); // sábado
    expect(diaSemana("2026-10-18")).toBe(0); // domingo
    expect(diaSemana("2026-10-14")).toBe(3); // miércoles
  });

  it("el sábado más cercano primero; si ya es sábado, ese mismo", () => {
    expect(sabadosCercanos("2026-10-17")[0]).toBe("2026-10-17");
    expect(sabadosCercanos("2026-10-14")[0]).toBe("2026-10-17"); // miércoles → sábado siguiente (3 días)
    expect(sabadosCercanos("2026-10-19")[0]).toBe("2026-10-17"); // lunes → sábado anterior (2 días)
    expect(sabadosCercanos("2026-10-14").slice(0, 3)).toEqual(["2026-10-17", "2026-10-10", "2026-10-24"]);
  });
});

describe("cheques al sábado sin juntarse", () => {
  // Pat Primo: $1.000 en 4 cheques a 30/60/90/120 días desde el 1/10/2026
  // plazos: sáb 31/10 · lun 30/11 · mié 30/12 · vie 29/01
  const cuotas = repartirCuotas({ total: 1000, plazosDias: [30, 60, 90, 120], fechaBase: "2026-10-01" });

  it("sin otros cheques: cada uno a su sábado más cercano", () => {
    const r = ajustarASabados(cuotas, { ocupado: new Map(), tope: 900 });
    expect(r.map((c) => c.fecha)).toEqual(["2026-10-31", "2026-11-28", "2027-01-02", "2027-01-30"]);
    expect(r.every((c) => diaSemana(c.fecha) === 6 && c.aviso === null)).toBe(true);
    expect(r[1].fechaPlazo).toBe("2026-11-30");
  });

  it("si el sábado ya tiene cheques, busca el libre más cercano", () => {
    const ocupado = new Map([["2026-10-31", 300], ["2026-11-28", 100]]);
    const r = ajustarASabados(cuotas, { ocupado, tope: 900 });
    // 31/10 ocupado: 24/10 y 7/11 están a 7 días; con empate gana el de después
    expect(r[0].fecha).toBe("2026-11-07");
    // 28/11 ocupado: el más cercano libre es 5/12 (a 5 días del plazo 30/11)
    expect(r[1].fecha).toBe("2026-12-05");
    expect(r.every((c) => c.aviso === null)).toBe(true);
  });

  it("si no hay sábado libre cerca, comparte solo si no pasa el tope, y lo avisa", () => {
    const lleno = new Map<string, number>();
    for (const s of sabadosCercanos("2026-10-31", 2)) lleno.set(s, s === "2026-10-24" ? 100 : 800);
    const r = ajustarASabados([cuotas[0]], { ocupado: lleno, tope: 900 });
    expect(r[0].fecha).toBe("2026-10-24"); // el único donde 100 + 250 ≤ 900
    expect(r[0].aviso).toContain("Comparte el sábado con $100.00");
    expect(r[0].aviso).not.toContain("tope");
  });

  it("si todo pasa el tope, el más cercano y avisa que pasa el tope", () => {
    const lleno = new Map<string, number>();
    for (const s of sabadosCercanos("2026-10-31", 2)) lleno.set(s, 800);
    const r = ajustarASabados([cuotas[0]], { ocupado: lleno, tope: 900 });
    expect(r[0].fecha).toBe("2026-10-31");
    expect(r[0].aviso).toContain("pasa tu tope de $900.00");
  });

  it("un cheque solo que pasa el tope está bien (sin aviso)", () => {
    const grande = repartirCuotas({ total: 2400, plazosDias: [30], fechaBase: "2026-10-01" });
    const r = ajustarASabados(grande, { ocupado: new Map(), tope: 900 });
    expect([r[0].fecha, r[0].aviso]).toEqual(["2026-10-31", null]);
  });

  it("cheques seguidos de la misma deuda: siempre en orden, en sábados distintos", () => {
    const chicos = repartirCuotas({ total: 300, plazosDias: [1, 2, 3], fechaBase: "2026-10-12" }); // mar/mié/jue
    // sin la regla, el martes 13 iría al sábado 10: ANTES de la factura del 12
    const r = ajustarASabados(chicos, { ocupado: new Map(), tope: 900, despuesDe: "2026-10-12" });
    expect(r.map((c) => c.fecha)).toEqual(["2026-10-17", "2026-10-24", "2026-10-31"]);
  });

  it("solo cuentan los cheques pendientes por pagar", () => {
    const m = chequesPorFecha([
      { fecha_cobro: "2026-10-31", monto: 100, medio: "cheque", estado: "pendiente", tipo: "por_pagar" },
      { fecha_cobro: "2026-10-31", monto: 50, medio: "cheque", estado: "pendiente", tipo: "por_pagar" },
      { fecha_cobro: "2026-10-31", monto: 999, medio: "transferencia", estado: "pendiente", tipo: "por_pagar" },
      { fecha_cobro: "2026-10-31", monto: 999, medio: "cheque", estado: "pagado", tipo: "por_pagar" },
      { fecha_cobro: "2026-10-31", monto: 999, medio: "cheque", estado: "pendiente", tipo: "por_cobrar" },
    ]);
    expect(m.get("2026-10-31")).toBe(150);
  });
});
