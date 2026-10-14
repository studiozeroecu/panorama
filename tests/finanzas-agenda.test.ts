import { describe, it, expect } from "vitest";
import { armarAgenda } from "@/lib/finanzas/agenda";
import { quincenaDe, mesDe, siguiente } from "@/lib/finanzas/periodos";
import type { Cheque, DatosFinanzas, Deuda, Movimiento } from "@/lib/finanzas/tipos";

const HOY = "2026-10-06";

function deuda(p: Partial<Deuda> & Pick<Deuda, "id" | "proveedor" | "monto">): Deuda {
  return {
    concepto: "",
    tipo_deuda: "proveedor",
    exigibilidad: "firme",
    fecha_estimada: null,
    ambito: "empresa",
    categoria: "otros",
    monto_original: null,
    cuota_mensual: null,
    saldo_al: null,
    es_saldo_inicial: false,
    anulada: false,
    documento_tipo: null,
    documento_numero: "",
    fecha_documento: null,
    notas: "",
    total_pagado: 0,
    total_pendiente: 0,
    total_rebotado: 0,
    saldo: p.monto,
    sin_programar: 0,
    cuotas_pendientes: 0,
    proxima_fecha: null,
    estado_calculado: "pendiente",
    ...p,
  };
}

function cheque(p: Partial<Cheque> & Pick<Cheque, "id" | "monto">): Cheque {
  return {
    tipo: "por_pagar",
    medio: "cheque",
    beneficiario: "",
    banco: "",
    numero: "",
    fecha_original: p.fecha_cobro ?? null,
    alertado_hasta: null,
    fecha_cobro: null,
    reprogramado: false,
    estado: "pendiente",
    fecha_pago: null,
    cuenta_por_pagar_id: null,
    deuda_proveedor: null,
    deuda_concepto: null,
    deuda_exigibilidad: null,
    categoria_efectiva: "otros",
    ambito_efectivo: "empresa",
    notas: "",
    ...p,
  };
}

function mov(p: Partial<Movimiento> & Pick<Movimiento, "id" | "monto" | "fecha">): Movimiento {
  return {
    tipo: "gasto",
    concepto: "",
    categoria: "otros",
    ambito: "empresa",
    cheque_id: null,
    cuenta_por_pagar_id: null,
    cuenta_en_rentabilidad: true,
    ...p,
  };
}

const PAT = { cuenta_por_pagar_id: "d1", deuda_proveedor: "PAT PRIMO", deuda_exigibilidad: "firme" as const, categoria_efectiva: "maquila" };

const datos: DatosFinanzas = {
  deudas: [
    deuda({ id: "d1", proveedor: "PAT PRIMO", monto: 1000, categoria: "maquila", total_pagado: 250, total_pendiente: 500, total_rebotado: 250, saldo: 750 }),
    deuda({ id: "d2", proveedor: "PAPÁ", monto: 5000, tipo_deuda: "familia", exigibilidad: "flexible", ambito: "personal", fecha_estimada: "2026-10-12", sin_programar: 5000 }),
    deuda({ id: "d3", proveedor: "MATEO", monto: 600, tipo_deuda: "sueldo", exigibilidad: "flexible", categoria: "sueldos", total_pagado: 200, saldo: 400, sin_programar: 400 }),
    deuda({ id: "d4", proveedor: "BANCO ANTERIOR", monto: 1500, tipo_deuda: "prestamo", es_saldo_inicial: true, sin_programar: 1500 }),
    deuda({ id: "d5", proveedor: "TARJETA", monto: 80, tipo_deuda: "tarjeta", ambito: "personal", total_pendiente: 80 }),
    deuda({ id: "d6", proveedor: "ANULADA", monto: 999, anulada: true, total_pendiente: 999 }),
  ],
  chequesAbiertos: [
    cheque({ id: "c902", monto: 250, numero: "902", fecha_cobro: "2026-10-10", ...PAT }),
    cheque({ id: "c903", monto: 250, numero: "903", fecha_cobro: "2026-10-31", ...PAT }),
    cheque({ id: "c904", monto: 250, numero: "904", fecha_cobro: "2026-10-12", estado: "rebotado", ...PAT }),
    cheque({ id: "ctar", monto: 80, medio: "transferencia", fecha_cobro: "2026-10-02", cuenta_por_pagar_id: "d5",
             deuda_proveedor: "TARJETA", ambito_efectivo: "personal", deuda_exigibilidad: "firme" }),
    cheque({ id: "cvenc", monto: 100, beneficiario: "SUELTO VIEJO", fecha_cobro: "2026-09-25" }),
    cheque({ id: "csinf", monto: 50, beneficiario: "SUELTO SIN FECHA", fecha_cobro: null }),
    cheque({ id: "canul", monto: 999, fecha_cobro: "2026-10-08", cuenta_por_pagar_id: "d6", deuda_proveedor: "ANULADA" }),
  ],
  chequesPagados: [
    cheque({ id: "c901", monto: 250, numero: "901", fecha_cobro: "2026-10-03", estado: "pagado", fecha_pago: "2026-10-03", ...PAT }),
  ],
  movimientos: [
    mov({ id: "m1", monto: 250, fecha: "2026-10-03", categoria: "maquila", cheque_id: "c901" }),
    mov({ id: "m2", monto: 80, fecha: "2026-10-04", ambito: "personal", cuenta_en_rentabilidad: false }),
    mov({ id: "m3", monto: 200, fecha: "2026-10-05", categoria: "sueldos", cuenta_en_rentabilidad: false }),
    mov({ id: "m4", monto: 1000, fecha: "2026-10-05", tipo: "ingreso", cuenta_en_rentabilidad: false }),
    mov({ id: "m5", monto: 70, fecha: "2026-09-30", categoria: "corte" }),
  ],
};

describe("armarAgenda — quincena actual (1–15 oct, hoy 6 oct)", () => {
  const a = armarAgenda(datos, quincenaDe(HOY), { hoy: HOY });

  it("pagos del periodo: solo pendientes con fecha en la quincena, ordenados", () => {
    expect(a.esActual).toBe(true);
    expect(a.pagos.map((p) => p.chequeId)).toEqual(["ctar", "c902"]);
    expect(a.totalPagos).toBe(330);
    expect(a.totalPagosEmpresa).toBe(250);
    expect(a.totalPagosPersonal).toBe(80);
  });

  it("marca como vencido lo de esta quincena con fecha anterior a hoy", () => {
    expect(a.pagos.find((p) => p.chequeId === "ctar")?.vencido).toBe(true);
    expect(a.pagos.find((p) => p.chequeId === "c902")?.vencido).toBe(false);
  });

  it("vencidos de periodos anteriores van aparte", () => {
    expect(a.vencidos.map((p) => p.chequeId)).toEqual(["cvenc"]);
    expect(a.totalVencidos).toBe(100);
  });

  it("lo ya pagado en la quincena se informa aparte", () => {
    expect(a.pagados.map((p) => p.chequeId)).toEqual(["c901"]);
    expect(a.totalPagados).toBe(250);
  });

  it("rebotado: sección roja aparte y NUNCA suma a los pagos del periodo", () => {
    expect(a.rebotados.map((p) => p.chequeId)).toEqual(["c904"]);
    expect(a.totalRebotados).toBe(250);
    expect(a.pagos.some((p) => p.chequeId === "c904")).toBe(false);
  });

  it("flexible con fecha estimada: aparece como posible y NO suma", () => {
    expect(a.posibles).toEqual([
      expect.objectContaining({ deudaId: "d2", monto: 5000, fechaEstimada: "2026-10-12", pasada: false }),
    ]);
    expect(a.totalPagos).toBe(330);
  });

  it("sin fecha: saldo sin programar y pagos sin fecha; suma aparte", () => {
    expect(a.sinFecha.map((s) => [s.deudaId ?? s.chequeId, s.monto])).toEqual([
      ["d4", 1500],
      ["d3", 400],
      ["csinf", 50],
    ]);
    expect(a.totalSinFecha).toBe(1950);
  });

  it("deudas anuladas y sus pagos no aparecen en nada", () => {
    const todo = [...a.pagos, ...a.vencidos, ...a.rebotados].map((p) => p.chequeId);
    expect(todo).not.toContain("canul");
    expect(a.sinFecha.some((s) => s.deudaId === "d6")).toBe(false);
  });

  it("total adeudado: saldos de deudas vivas + pagos sueltos abiertos", () => {
    // 750 + 5000 + 400 + 1500 + 80 + (100 + 50 sueltos)
    expect(a.totalAdeudado).toBe(7880);
  });

  it("gastos: por defecto SOLO empresa; ingresos y fuera de rango no cuentan", () => {
    expect(a.gastos.ambito).toBe("empresa");
    expect(a.gastos.total).toBe(450);
    expect(a.gastos.cantidad).toBe(2);
    expect(a.gastos.totalRentabilidad).toBe(250);
    expect(a.gastos.porCategoria).toEqual([
      { categoria: "maquila", total: 250 },
      { categoria: "sueldos", total: 200 },
    ]);
  });

  it("gastos con personal solo si se pide explícitamente", () => {
    const b = armarAgenda(datos, quincenaDe(HOY), { hoy: HOY, incluirPersonalEnGastos: true });
    expect(b.gastos.ambito).toBe("todos");
    expect(b.gastos.total).toBe(530);
  });
});

describe("armarAgenda — otros periodos", () => {
  it("quincena futura: sus pagos, sin vencidos ni posibles de otras fechas; rebotados siguen visibles", () => {
    const a = armarAgenda(datos, siguiente(quincenaDe(HOY)), { hoy: HOY });
    expect(a.esActual).toBe(false);
    expect(a.pagos.map((p) => p.chequeId)).toEqual(["c903"]);
    expect(a.totalPagos).toBe(250);
    expect(a.vencidos).toEqual([]);
    expect(a.posibles).toEqual([]);
    expect(a.rebotados.map((p) => p.chequeId)).toEqual(["c904"]);
  });

  it("mes actual: junta las dos quincenas", () => {
    const a = armarAgenda(datos, mesDe(HOY), { hoy: HOY });
    expect(a.pagos.map((p) => p.chequeId)).toEqual(["ctar", "c902", "c903"]);
    expect(a.totalPagos).toBe(580);
    expect(a.vencidos.map((p) => p.chequeId)).toEqual(["cvenc"]);
  });

  it("fecha estimada que ya pasó: aparece como posible 'pasada' solo en el periodo actual", () => {
    const d: DatosFinanzas = {
      ...datos,
      deudas: datos.deudas.map((x) => (x.id === "d2" ? { ...x, fecha_estimada: "2026-09-20" } : x)),
    };
    expect(armarAgenda(d, quincenaDe(HOY), { hoy: HOY }).posibles).toEqual([
      expect.objectContaining({ deudaId: "d2", pasada: true }),
    ]);
    expect(armarAgenda(d, siguiente(quincenaDe(HOY)), { hoy: HOY }).posibles).toEqual([]);
  });

  it("sin datos: todo en cero, sin errores", () => {
    const a = armarAgenda({ deudas: [], chequesAbiertos: [], chequesPagados: [], movimientos: [] }, quincenaDe(HOY), { hoy: HOY });
    expect([a.totalPagos, a.totalVencidos, a.totalSinFecha, a.totalRebotados, a.totalAdeudado, a.gastos.total]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
