import { describe, it, expect } from "vitest";
import { armarAgenda } from "@/lib/finanzas/agenda";
import { quincenaDe, mesDe } from "@/lib/finanzas/periodos";
import type { CorteTarjeta, DatosFinanzas, GastoFijo, Tarjeta } from "@/lib/finanzas/tipos";

const HOY = "2026-10-19";

const fijo = (p: Partial<GastoFijo> & Pick<GastoFijo, "id" | "nombre" | "monto" | "dias">): GastoFijo => ({
  frecuencia: "mensual", fecha_inicio: "2026-10-01", fecha_fin: null, ambito: "empresa", categoria: "otros",
  medio: "transferencia", activo: true, notas: "", ...p,
});

const corte = (p: Partial<CorteTarjeta> & Pick<CorteTarjeta, "id" | "fecha_pago" | "falta_de_lo_estimado">): CorteTarjeta => ({
  tarjeta_id: "t1", tarjeta: "Visa", banco: "Pichincha", fecha_corte: "2026-10-05", saldo_total: 1200, pago_minimo: 60,
  pago_estimado: 400, notas: "", fecha_corte_anterior: null, saldo_anterior: null, pagos_entre_cortes: 0, consumo: null,
  pagado_del_corte: 0, ...p,
});

const base: DatosFinanzas = {
  deudas: [],
  chequesAbiertos: [],
  chequesPagados: [],
  movimientos: [],
  fijos: [
    fijo({ id: "arr", nombre: "Arriendo", monto: 650, dias: [17], categoria: "arriendo" }),
    fijo({ id: "gua", nombre: "Guardería", monto: 280, dias: [10], ambito: "personal", fecha_fin: "2027-07-31" }),
    fijo({ id: "pausa", nombre: "Pausado", monto: 99, dias: [20], activo: false }),
  ],
  pagosFijos: [{ id: "p1", gasto_fijo_id: "gua", fecha_programada: "2026-10-10", fecha_pago: "2026-10-09", monto: 280 }],
  cortes: [corte({ id: "c1", fecha_pago: "2026-10-20", falta_de_lo_estimado: 400 })],
  tarjetas: [{ id: "t1", nombre: "Visa", saldo_estimado_hoy: 1200 } as Tarjeta],
  pagosTarjeta: [],
  estimados: [{ id: "e1", nombre: "Maquila", categoria: "maquila", base: 650, ambito: "empresa", activo: true, notas: "" }],
  estimadosMes: [],
  temporadas: [{ mes: 11, factor: 1.2, nota: "" }],
  historialGastos: [{ mes: "2026-10", categoria: "maquila", ambito: "empresa", total: 200 }],
};

describe("armarAgenda con gastos fijos y tarjetas (fase 6)", () => {
  it("los fijos sin pagar de la quincena suman; los pagados van a 'ya pagado'", () => {
    const a = armarAgenda(base, quincenaDe(HOY), { hoy: HOY }); // 16–31 oct
    expect(a.pagos.map((p) => [p.origen, p.quien, p.fecha])).toEqual([
      ["fijo", "Arriendo", "2026-10-17"],
      ["tarjeta", "Tarjeta Visa", "2026-10-20"],
    ]);
    expect(a.totalPagos).toBe(1050);
    expect(a.pagos[0].vencido).toBe(true); // el 17 ya pasó (hoy 19)
  });

  it("en la primera quincena: la guardería ya pagada aparece en 'ya pagado', no por pagar", () => {
    const a = armarAgenda(base, quincenaDe("2026-10-05"), { hoy: "2026-10-05" });
    expect(a.pagos.map((p) => p.quien)).toEqual([]);
    expect(a.pagados.map((p) => [p.origen, p.quien, p.monto])).toEqual([["fijo", "Guardería", 280]]);
  });

  it("los fijos pausados no aparecen; el próximo mes vuelven a salir solos", () => {
    const nov = armarAgenda(base, mesDe("2026-11-05"), { hoy: HOY });
    expect(nov.pagos.map((p) => [p.quien, p.fecha])).toEqual([
      ["Guardería", "2026-11-10"],
      ["Arriendo", "2026-11-17"],
    ]);
  });

  it("'atento: se viene' también ve los fijos de los 3 días siguientes", () => {
    const a = armarAgenda(base, quincenaDe("2026-11-05"), { hoy: "2026-11-05" }); // 1–15 nov; arriendo el 17
    expect(a.proximos.map((p) => p.quien)).toEqual(["Arriendo"]);
  });

  it("la deuda de las tarjetas suma al total que se debe", () => {
    expect(armarAgenda(base, quincenaDe(HOY), { hoy: HOY }).totalAdeudado).toBe(1200);
  });
});

describe("estimados del mes en la agenda", () => {
  it("lo pendiente = estimado − gastado − programado; no suma a los pagos", () => {
    const d = {
      ...base,
      fijos: [fijo({ id: "maq", nombre: "Maquila fija", monto: 100, dias: [28], categoria: "maquila" })],
      cortes: [],
    };
    const a = armarAgenda(d, mesDe(HOY), { hoy: HOY });
    expect(a.estimados).toEqual([
      expect.objectContaining({ nombre: "Maquila", monto: 650, fuente: "base", gastado: 200, programado: 100, pendiente: 350, pasado: 0 }),
    ]);
    expect(a.totalEstimadoPendiente).toBe(350);
    expect(a.totalPagos).toBe(100); // solo lo seguro
  });

  it("si se pasó del estimado, lo dice y no queda pendiente", () => {
    const d = { ...base, historialGastos: [{ mes: "2026-10", categoria: "maquila", ambito: "empresa" as const, total: 800 }] };
    const a = armarAgenda(d, mesDe(HOY), { hoy: HOY });
    expect(a.estimados[0]).toEqual(expect.objectContaining({ gastado: 800, pendiente: 0, pasado: 150 }));
  });

  it("noviembre: la sugerencia usa lo gastado antes × la temporada", () => {
    const a = armarAgenda(base, mesDe("2026-11-10"), { hoy: HOY });
    // octubre 200 (factor 1) → noviembre 200 × 1,2
    expect(a.estimados[0]).toEqual(expect.objectContaining({ monto: 240, fuente: "promedio" }));
  });
});
