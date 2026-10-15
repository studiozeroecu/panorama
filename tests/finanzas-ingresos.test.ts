import { describe, it, expect } from "vitest";
import {
  resumenSueldo,
  resumenVentas,
  nombresFerias,
  clientesConocidos,
  ingresosDelPeriodo,
  repartoAbono,
} from "@/lib/finanzas/ingresos";
import { leerTodo } from "@/lib/finanzas/cargar";
import { mesDe, quincenaDe } from "@/lib/finanzas/periodos";
import type { Cobro, FacturaCobrar, PagoSueldo, RegistroSueldo, VentaDirecta } from "@/lib/finanzas/tipos";

const OCT = mesDe("2026-10-10");

function reg(p: Partial<RegistroSueldo> & Pick<RegistroSueldo, "fuente_id" | "fecha" | "prendas">): RegistroSueldo {
  const tarifa = p.en_vatex ? 2.5 : 5;
  return {
    fuente: "factura",
    descripcion: "",
    en_vatex: false,
    ganancia_por_prenda: tarifa,
    monto: p.prendas * tarifa,
    pagado: 0,
    saldo: p.prendas * tarifa,
    ...p,
  };
}

function venta(p: Partial<VentaDirecta> & Pick<VentaDirecta, "id" | "fecha" | "monto" | "prendas">): VentaDirecta {
  return { canal: "en_linea", evento: "", ganancia_por_prenda: 5, notas: "", anulada: false, ...p };
}

describe("Mi sueldo por periodo", () => {
  const registros = [
    reg({ fuente_id: "f1", fecha: "2026-10-01", prendas: 100, en_vatex: true }), // 250
    reg({ fuente_id: "f2", fecha: "2026-10-20", prendas: 40, en_vatex: true }), // 100
    reg({ fuente_id: "v1", fecha: "2026-10-12", prendas: 10, fuente: "venta" }), // 50
    reg({ fuente_id: "viejo", fecha: "2026-09-30", prendas: 8 }), // septiembre: no cuenta
  ];
  const pagos: PagoSueldo[] = [
    { id: "p1", fecha: "2026-10-15", monto: 200, medio: "transferencia", notas: "", anulado: false },
    { id: "p2", fecha: "2026-09-29", monto: 30, medio: "efectivo", notas: "", anulado: false },
    { id: "p3", fecha: "2026-10-16", monto: 999, medio: "efectivo", notas: "", anulado: true },
  ];

  it("ganado: VATEX a $2,50 y fuera a $5, solo lo del periodo", () => {
    const r = resumenSueldo(registros, pagos, OCT);
    expect(r.ganado).toBe(400);
    expect(r.ganadoVatex).toBe(350);
    expect(r.ganadoFuera).toBe(50);
    expect(r.prendasVatex).toBe(140);
    expect(r.prendasFuera).toBe(10);
  });

  it("pagado: solo los pagos del periodo y no anulados", () => {
    expect(resumenSueldo(registros, pagos, OCT).pagado).toBe(200);
  });

  it("por quincena", () => {
    const r = resumenSueldo(registros, pagos, quincenaDe("2026-10-05"));
    expect(r.ganado).toBe(300); // 250 + 50
    expect(r.pagado).toBe(200); // el pago del 15 cae en la quincena 1–15
  });
});

describe("Ventas directas", () => {
  const ventas = [
    venta({ id: "a", fecha: "2026-10-04", monto: 30, prendas: 2 }),
    venta({ id: "b", fecha: "2026-10-11", monto: 300, prendas: 10, canal: "feria", evento: "Feria Navidad" }),
    venta({ id: "c", fecha: "2026-10-12", monto: 200, prendas: 6, canal: "feria", evento: "  feria  navidad " }),
    venta({ id: "d", fecha: "2026-10-12", monto: 45, prendas: 3 }),
    venta({ id: "x", fecha: "2026-10-13", monto: 999, prendas: 9, anulada: true }),
    venta({ id: "s", fecha: "2026-09-28", monto: 80, prendas: 4, canal: "feria", evento: "Feria Septiembre" }),
  ];

  it("una feria de 2 días queda junta aunque el nombre se escriba distinto", () => {
    const r = resumenVentas(ventas, OCT);
    const feria = r.grupos.find((g) => g.canal === "feria")!;
    expect(feria.evento).toBe("Feria Navidad");
    expect(feria.ventas.map((v) => v.id)).toEqual(["b", "c"]);
    expect([feria.desde, feria.hasta, feria.total, feria.prendas]).toEqual(["2026-10-11", "2026-10-12", 500, 16]);
  });

  it("totales del periodo: en línea y ferias por separado, sin anuladas ni otros meses", () => {
    const r = resumenVentas(ventas, OCT);
    expect([r.total, r.prendas, r.cantidad]).toEqual([575, 21, 4]);
    expect(r.enLinea).toEqual({ total: 75, prendas: 5, cantidad: 2 });
    expect(r.ferias).toEqual({ total: 500, prendas: 16, cantidad: 2 });
  });

  it("nombres de ferias ya usados, sin repetir, el más reciente primero", () => {
    expect(nombresFerias(ventas)).toEqual(["feria navidad", "Feria Septiembre"]);
  });
});

describe("Clientes y dinero que entró", () => {
  const fact = (cliente: string, es_vatex = false) =>
    ({ cliente, es_vatex, cuenta: es_vatex ? "vatex" : cliente.trim().toLowerCase() }) as FacturaCobrar;

  it("clientes conocidos: uno por cuenta, sin VATEX", () => {
    expect(clientesConocidos([fact("Juan"), fact("juan "), fact("VATEX", true), fact("Ana")])).toEqual(["Ana", "Juan"]);
  });

  it("ingresos del periodo: abonos de VATEX, de otros y ventas directas", () => {
    const cobros: Cobro[] = [
      { id: "1", fecha: "2026-10-05", cliente: "VATEX", es_vatex: true, cuenta: "vatex", monto: 1000, medio: "transferencia", notas: "", anulado: false },
      { id: "2", fecha: "2026-10-06", cliente: "Ana", es_vatex: false, cuenta: "ana", monto: 50, medio: "efectivo", notas: "", anulado: false },
      { id: "3", fecha: "2026-11-01", cliente: "VATEX", es_vatex: true, cuenta: "vatex", monto: 500, medio: "transferencia", notas: "", anulado: false },
    ];
    const ventas = [venta({ id: "v", fecha: "2026-10-12", monto: 300, prendas: 10 })];
    expect(ingresosDelPeriodo(cobros, ventas, OCT)).toEqual({
      cobrosVatex: 1000,
      cobrosOtros: 50,
      ventasDirectas: 300,
      total: 1350,
    });
  });
});

describe("lectura por páginas sigue igual", () => {
  it("una página vacía termina", async () => {
    expect(await leerTodo("x", async () => ({ data: [], error: null }))).toEqual([]);
  });
});

describe("vista previa del abono (a la factura más antigua primero)", () => {
  const f = (id: string, fecha_factura: string, saldo: number, anulada = false) => ({
    id, fecha_factura, created_at: `${fecha_factura}T10:00:00Z`, saldo, anulada,
  });

  it("$1.200 a VATEX: cubre la de octubre y abona a la siguiente", () => {
    const facturas = [f("nov", "2026-11-01", 500), f("oct", "2026-10-01", 1000), f("pagada", "2026-09-01", 0)];
    expect(repartoAbono(facturas, 1200)).toEqual([
      { id: "oct", aplica: 1000, quedaDebiendo: 0 },
      { id: "nov", aplica: 200, quedaDebiendo: 300 },
    ]);
  });

  it("no toca anuladas y no se confunde con centavos", () => {
    const facturas = [f("x", "2026-09-01", 50, true), f("a", "2026-10-01", 0.1), f("b", "2026-10-02", 0.2)];
    expect(repartoAbono(facturas, 0.3)).toEqual([
      { id: "a", aplica: 0.1, quedaDebiendo: 0 },
      { id: "b", aplica: 0.2, quedaDebiendo: 0 },
    ]);
  });
});
