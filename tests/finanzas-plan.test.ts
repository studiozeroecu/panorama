import { describe, it, expect } from "vitest";
import {
  fechasDeFijo,
  fechasPeriodicas,
  valorEstimado,
  gastosPorMes,
  cortePendiente,
  fechaPagoDeCorte,
  cuadreCaja,
  totalCaja,
} from "@/lib/finanzas/plan";
import type { CuentaDinero, GastoMes, SaldoCaja, Temporada } from "@/lib/finanzas/tipos";

describe("gastos fijos: fechas de cada mes", () => {
  it("guardería el 10 de cada mes, de septiembre a julio (fin de clases)", () => {
    const g = { dias: [10], fecha_inicio: "2026-09-01", fecha_fin: "2027-07-31" };
    expect(fechasDeFijo(g, "2026-10-01", "2026-12-31")).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(fechasDeFijo(g, "2027-07-01", "2027-09-30")).toEqual(["2027-07-10"]); // ya terminó en agosto
    expect(fechasDeFijo(g, "2026-08-01", "2026-08-31")).toEqual([]); // antes del inicio
  });

  it("arriendo sin fin; el día 31 cae el último día en meses cortos", () => {
    const g = { dias: [31], fecha_inicio: "2026-01-01", fecha_fin: null };
    expect(fechasDeFijo(g, "2027-01-01", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("quincenal: dos fechas por mes", () => {
    expect(fechasDeFijo({ dias: [15, 30], fecha_inicio: "2026-01-01", fecha_fin: null }, "2027-02-01", "2027-02-28"))
      .toEqual(["2027-02-15", "2027-02-28"]);
  });
});

describe("cuotas de préstamo: mensual o quincenal", () => {
  it("mensual: el mismo día cada mes (el 31 se ajusta)", () => {
    expect(fechasPeriodicas("2026-10-10", 3, "mensual")).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(fechasPeriodicas("2026-12-31", 3, "mensual")).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
  });

  it("quincenal: el 15 y el fin de cada mes", () => {
    expect(fechasPeriodicas("2026-10-05", 4, "quincenal")).toEqual(["2026-10-15", "2026-10-31", "2026-11-15", "2026-11-30"]);
    expect(fechasPeriodicas("2026-10-20", 3, "quincenal")).toEqual(["2026-10-31", "2026-11-15", "2026-11-30"]);
  });
});

describe("estimados del mes", () => {
  const maquila = { id: "e1", categoria: "maquila", base: 650, ambito: "empresa" as const };
  const temporadas: Temporada[] = [
    { mes: 11, factor: 1.2, nota: "fiestas de Cuenca" },
    { mes: 12, factor: 1.5, nota: "Navidad" },
  ];
  const h = (mes: string, total: number): GastoMes => ({ mes, categoria: "maquila", ambito: "empresa", total });

  it("sin historia: la base × la temporada", () => {
    expect(valorEstimado(maquila, "2026-10", [], [], temporadas)).toEqual({ monto: 650, fuente: "base" });
    expect(valorEstimado(maquila, "2026-12", [], [], temporadas)).toEqual({ monto: 975, fuente: "base" });
  });

  it("con meses anteriores: su promedio sin temporada × la temporada del mes", () => {
    // oct 700 (factor 1) y nov 960 (factor 1,2 → 800 sin temporada): promedio 750 → diciembre 750 × 1,5
    const r = valorEstimado(maquila, "2026-12", [], [h("2026-10", 700), h("2026-11", 960)], temporadas);
    expect(r).toEqual({ monto: 1125, fuente: "promedio" });
  });

  it("el mismo mes del año pasado manda (ya trae su temporada)", () => {
    const r = valorEstimado(maquila, "2027-12", [], [h("2026-12", 1100), h("2027-11", 900)], temporadas);
    expect(r).toEqual({ monto: 1100, fuente: "mismo_mes_anio_pasado" });
  });

  it("lo fijado a mano gana a todo", () => {
    const r = valorEstimado(maquila, "2026-12", [{ estimado_id: "e1", mes: "2026-12-01", monto: 900 }], [h("2025-12", 2000)], temporadas);
    expect(r).toEqual({ monto: 900, fuente: "a_mano" });
  });

  it("solo cuenta la categoría y el ámbito del estimado", () => {
    const otros: GastoMes[] = [
      { mes: "2026-10", categoria: "estampado", ambito: "empresa", total: 5000 },
      { mes: "2026-10", categoria: "maquila", ambito: "personal", total: 5000 },
    ];
    expect(valorEstimado(maquila, "2026-11", [], otros, temporadas).fuente).toBe("base");
  });

  it("gasto real por mes y categoría desde los movimientos", () => {
    const g = gastosPorMes([
      { fecha: "2026-10-03", tipo: "gasto", categoria: "maquila", ambito: "empresa", monto: 200 },
      { fecha: "2026-10-20", tipo: "gasto", categoria: "maquila", ambito: "empresa", monto: 300.5 },
      { fecha: "2026-10-21", tipo: "ingreso", categoria: "ventas", ambito: "empresa", monto: 999 },
      { fecha: "2026-11-01", tipo: "gasto", categoria: "maquila", ambito: "empresa", monto: 50 },
    ]);
    expect(g.find((x) => x.mes === "2026-10" && x.categoria === "maquila")?.total).toBe(500.5);
    expect(g.some((x) => x.categoria === "ventas")).toBe(false);
  });
});

describe("tarjetas: corte que falta anotar", () => {
  const visa = { id: "t1", dia_corte: 5, dia_pago: 20, activa: true };

  it("si ya pasó el día de corte y no se anotó, lo pide", () => {
    expect(cortePendiente(visa, [], "2026-10-19")).toEqual({ fechaCorte: "2026-10-05", fechaPago: "2026-10-20" });
  });

  it("antes del día de corte pide el del mes pasado (si falta)", () => {
    expect(cortePendiente(visa, [], "2026-10-03")).toEqual({ fechaCorte: "2026-09-05", fechaPago: "2026-09-20" });
  });

  it("si ya se anotó, no pide nada; tarjeta pausada tampoco", () => {
    expect(cortePendiente(visa, [{ tarjeta_id: "t1", fecha_corte: "2026-10-05" }], "2026-10-19")).toBeNull();
    expect(cortePendiente({ ...visa, activa: false }, [], "2026-10-19")).toBeNull();
  });

  it("el pago cae al mes siguiente si el día de pago es antes del de corte", () => {
    expect(fechaPagoDeCorte("2026-10-25", 10)).toBe("2026-11-10");
    expect(fechaPagoDeCorte("2026-12-28", 5)).toBe("2027-01-05");
    expect(fechaPagoDeCorte("2026-01-31", 31)).toBe("2026-02-28");
  });
});

describe("cuadre de caja", () => {
  const cuentas: CuentaDinero[] = [
    { id: "pi", nombre: "Pichincha", tipo: "banco", banco: "Pichincha", ambito: "empresa", activa: true },
    { id: "ef", nombre: "Efectivo", tipo: "efectivo", banco: "", ambito: "empresa", activa: true },
    { id: "vieja", nombre: "Cerrada", tipo: "banco", banco: "", ambito: "empresa", activa: false },
  ];
  const s = (cuenta_id: string, fecha: string, monto: number): SaldoCaja => ({ id: `${cuenta_id}${fecha}`, cuenta_id, fecha, monto, notas: "" });
  const saldos = [
    s("pi", "2026-10-01", 1000), s("ef", "2026-10-01", 200), s("vieja", "2026-10-01", 9999),
    s("pi", "2026-10-15", 900), s("ef", "2026-10-15", 150),
  ];
  const movs = [
    { fecha: "2026-10-05", tipo: "ingreso" as const, monto: 300 },
    { fecha: "2026-10-10", tipo: "gasto" as const, monto: 400 },
    { fecha: "2026-10-01", tipo: "gasto" as const, monto: 50 }, // el mismo día de la foto anterior: ya estaba
    { fecha: "2026-10-16", tipo: "gasto" as const, monto: 70 }, // después: no cuenta
  ];

  it("lo que había + lo que entró − lo que salió, contra lo que hay", () => {
    const c = cuadreCaja(cuentas, saldos, movs)!;
    expect([c.desde, c.hasta, c.anterior, c.entradas, c.salidas]).toEqual(["2026-10-01", "2026-10-15", 1200, 300, 400]);
    expect(c.esperado).toBe(1100);
    expect(c.real).toBe(1050);
    expect(c.diferencia).toBe(-50); // faltan $50: gastos hormiga sin anotar
  });

  it("una cuenta sin foto nueva cuenta con su última foto", () => {
    expect(totalCaja(cuentas, [...saldos, s("pi", "2026-10-20", 950)], "2026-10-20")).toBe(1100);
  });

  it("con una sola fecha de saldos todavía no hay con qué comparar", () => {
    expect(cuadreCaja(cuentas, saldos.filter((x) => x.fecha === "2026-10-01"), movs)).toBeNull();
  });
});
