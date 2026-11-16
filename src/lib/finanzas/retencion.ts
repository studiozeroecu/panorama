/**
 * Retenciones que le hacen al dueño al cobrar una factura (VATEX u otro
 * cliente). Puro: solo calcula. Lo que se guarda como "por cobrar" es el
 * valor que de verdad va a llegar (total − retenciones); el desglose queda
 * en las notas de la factura. No se guarda en columnas aparte: es un
 * cálculo, y las retenciones no son plata que se vaya a cobrar.
 *
 * Cada valor se redondea a centavos por separado, como en el comprobante
 * de retención (no se redondea solo el resultado final).
 */
import { aCentavos } from "./formato";

/** Porcentajes comunes en Ecuador. Cuál toca lo confirma el contador. */
export const PORCENTAJES_RENTA = [1, 1.75, 2, 2.75, 3, 8, 10] as const;
export const PORCENTAJES_RET_IVA = [0, 10, 20, 30, 70, 100] as const;
export const IVA_ECUADOR = 15;

export interface Retencion {
  subtotal: number;
  iva: number;
  total: number;
  retRenta: number;
  retIva: number;
  /** lo que de verdad llega: total − retenciones */
  aRecibir: number;
}

const cent = (x: number) => aCentavos(x) / 100;

export function calcularRetencion(opts: {
  /** valor sin IVA */
  subtotal: number;
  /** % de IVA de la factura (15; 0 si no lleva IVA) */
  ivaPct: number;
  /** % de retención en la fuente (sobre el subtotal) */
  rentaPct: number;
  /** % de retención de IVA (sobre el IVA) */
  retIvaPct: number;
}): Retencion {
  const subtotal = cent(opts.subtotal);
  const iva = cent((subtotal * opts.ivaPct) / 100);
  const total = cent(subtotal + iva);
  const retRenta = cent((subtotal * opts.rentaPct) / 100);
  const retIva = cent((iva * opts.retIvaPct) / 100);
  const aRecibir = (aCentavos(total) - aCentavos(retRenta) - aCentavos(retIva)) / 100;
  return { subtotal, iva, total, retRenta, retIva, aRecibir };
}

const fmt = (n: number) => n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => n.toLocaleString("es-EC", { maximumFractionDigits: 2 });

/** Una línea para las notas de la factura, para saber de dónde salió el monto. */
export function textoRetencion(r: Retencion, rentaPct: number, retIvaPct: number): string {
  return (
    `Retención: factura $${fmt(r.total)} (subtotal $${fmt(r.subtotal)} + IVA $${fmt(r.iva)})` +
    ` − renta ${fmtPct(rentaPct)}% $${fmt(r.retRenta)} − IVA ${fmtPct(retIvaPct)}% $${fmt(r.retIva)}` +
    ` = a recibir $${fmt(r.aRecibir)}`
  );
}
