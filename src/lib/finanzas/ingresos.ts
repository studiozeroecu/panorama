/**
 * Cálculos de ingresos por periodo (fase 5). Puros: reciben lo ya cargado y no
 * tocan la base, así se prueban sin conexión.
 *
 * Lo que NO se calcula aquí, porque lo hace la base (v_cxc,
 * v_sueldo_dueno_registros): a qué factura va cada abono y a qué ganancia va
 * cada pago de sueldo (siempre a la más antigua). Aquí solo se agrupa y se suma.
 */
import { sumar } from "./formato";
import { contiene, type Periodo } from "./periodos";
import type { Cobro, FacturaCobrar, PagoSueldo, RegistroSueldo, VentaDirecta } from "./tipos";

export interface ResumenSueldo {
  /** lo ganado en el periodo (prendas × tarifa, por fecha de factura o venta) */
  ganado: number;
  ganadoVatex: number;
  ganadoFuera: number;
  prendasVatex: number;
  prendasFuera: number;
  /** lo que me pagué en el periodo */
  pagado: number;
  registros: RegistroSueldo[];
  pagos: PagoSueldo[];
}

export function resumenSueldo(registros: RegistroSueldo[], pagos: PagoSueldo[], periodo: Periodo): ResumenSueldo {
  const enPeriodo = registros.filter((r) => contiene(periodo, r.fecha));
  const vatex = enPeriodo.filter((r) => r.en_vatex);
  const fuera = enPeriodo.filter((r) => !r.en_vatex);
  const pagosPeriodo = pagos.filter((p) => !p.anulado && contiene(periodo, p.fecha));
  return {
    ganado: sumar(enPeriodo.map((r) => r.monto)),
    ganadoVatex: sumar(vatex.map((r) => r.monto)),
    ganadoFuera: sumar(fuera.map((r) => r.monto)),
    prendasVatex: vatex.reduce((s, r) => s + r.prendas, 0),
    prendasFuera: fuera.reduce((s, r) => s + r.prendas, 0),
    pagado: sumar(pagosPeriodo.map((p) => p.monto)),
    registros: enPeriodo,
    pagos: pagosPeriodo,
  };
}

export interface GrupoVentas {
  /** "en_linea" o "feria:<nombre normalizado>" */
  clave: string;
  canal: VentaDirecta["canal"];
  /** nombre de la feria tal como se escribió la primera vez ("" en línea) */
  evento: string;
  ventas: VentaDirecta[];
  desde: string;
  hasta: string;
  total: number;
  prendas: number;
}

export interface ResumenVentas {
  total: number;
  prendas: number;
  cantidad: number;
  enLinea: { total: number; prendas: number; cantidad: number };
  ferias: { total: number; prendas: number; cantidad: number };
  /** las ventas en línea juntas y cada feria con todos sus días */
  grupos: GrupoVentas[];
}

const normal = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function resumenVentas(ventas: VentaDirecta[], periodo: Periodo): ResumenVentas {
  const vivas = ventas.filter((v) => !v.anulada && contiene(periodo, v.fecha));
  const enLinea = vivas.filter((v) => v.canal === "en_linea");
  const ferias = vivas.filter((v) => v.canal === "feria");

  const grupos = new Map<string, VentaDirecta[]>();
  for (const v of [...vivas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const clave = v.canal === "feria" ? `feria:${normal(v.evento)}` : "en_linea";
    grupos.set(clave, [...(grupos.get(clave) ?? []), v]);
  }

  const totales = (vs: VentaDirecta[]) => ({
    total: sumar(vs.map((v) => v.monto)),
    prendas: vs.reduce((s, v) => s + v.prendas, 0),
    cantidad: vs.length,
  });

  return {
    ...totales(vivas),
    enLinea: totales(enLinea),
    ferias: totales(ferias),
    grupos: [...grupos.entries()]
      .map(([clave, vs]) => ({
        clave,
        canal: vs[0].canal,
        evento: vs[0].canal === "feria" ? vs[0].evento.trim() : "",
        ventas: vs,
        desde: vs[0].fecha,
        hasta: vs[vs.length - 1].fecha,
        total: sumar(vs.map((v) => v.monto)),
        prendas: vs.reduce((s, v) => s + v.prendas, 0),
      }))
      .sort((a, b) => b.desde.localeCompare(a.desde)),
  };
}

/** Nombres de ferias ya usados (el más reciente primero), para no escribirlos distinto. */
export function nombresFerias(ventas: VentaDirecta[]): string[] {
  const vistos = new Map<string, string>();
  for (const v of [...ventas].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    if (v.canal !== "feria" || !v.evento.trim()) continue;
    const k = normal(v.evento);
    if (!vistos.has(k)) vistos.set(k, v.evento.trim().replace(/\s+/g, " "));
  }
  return [...vistos.values()];
}

/** Clientes que no son VATEX, uno por cuenta, para elegir en vez de escribir. */
export function clientesConocidos(facturas: FacturaCobrar[]): string[] {
  const vistos = new Map<string, string>();
  for (const f of facturas) {
    if (f.es_vatex || vistos.has(f.cuenta)) continue;
    vistos.set(f.cuenta, f.cliente.trim());
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/** Dinero que ENTRÓ en el periodo: abonos de clientes y ventas directas. */
export function ingresosDelPeriodo(cobros: Cobro[], ventas: VentaDirecta[], periodo: Periodo) {
  const cob = cobros.filter((c) => !c.anulado && contiene(periodo, c.fecha));
  const ven = ventas.filter((v) => !v.anulada && contiene(periodo, v.fecha));
  const cobrosVatex = sumar(cob.filter((c) => c.es_vatex).map((c) => c.monto));
  const cobrosOtros = sumar(cob.filter((c) => !c.es_vatex).map((c) => c.monto));
  const ventasDirectas = sumar(ven.map((v) => v.monto));
  return {
    cobrosVatex,
    cobrosOtros,
    ventasDirectas,
    total: sumar([cobrosVatex, cobrosOtros, ventasDirectas]),
  };
}

/**
 * Tarifas de "Mi sueldo" SOLO para mostrar en pantalla antes de guardar.
 * La que vale es la que pone la base al crear la factura o la venta
 * (fn_ganancia_por_prenda), y queda congelada en cada registro.
 */
export const GANANCIA_POR_PRENDA = { vatex: 2.5, fuera: 5 } as const;

/**
 * Vista previa de a qué facturas irá un abono: igual que la base, a la más
 * antigua primero (por fecha de factura). Solo para mostrar; quien decide es v_cxc.
 */
export function repartoAbono(
  facturas: Pick<FacturaCobrar, "id" | "fecha_factura" | "created_at" | "saldo" | "anulada">[],
  monto: number
): { id: string; aplica: number; quedaDebiendo: number }[] {
  let resto = Math.round(monto * 100);
  const abiertas = facturas
    .filter((f) => !f.anulada && f.saldo > 0)
    .sort((a, b) => a.fecha_factura.localeCompare(b.fecha_factura) || a.created_at.localeCompare(b.created_at));
  const out: { id: string; aplica: number; quedaDebiendo: number }[] = [];
  for (const f of abiertas) {
    if (resto <= 0) break;
    const saldo = Math.round(f.saldo * 100);
    const aplica = Math.min(saldo, resto);
    resto -= aplica;
    out.push({ id: f.id, aplica: aplica / 100, quedaDebiendo: (saldo - aplica) / 100 });
  }
  return out;
}
