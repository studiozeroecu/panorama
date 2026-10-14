/**
 * Formato de dinero de Finanzas: UNA sola versión (antes había una por archivo).
 * Vacío o no numérico → "—" (nunca "$0,00" disfrazando un dato que falta).
 */
export function money(n: number | string | null | undefined): string {
  if (n == null || n === "" || isNaN(Number(n))) return "—";
  return "$" + Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Redondeo a centavos sin errores de coma flotante acumulados. */
export function aCentavos(n: number): number {
  return Math.round(Number(n) * 100);
}

export function deCentavos(c: number): number {
  return c / 100;
}

/** Suma montos en centavos y devuelve dólares exactos. */
export function sumar(montos: Iterable<number>): number {
  let c = 0;
  for (const m of montos) c += aCentavos(m);
  return deCentavos(c);
}
