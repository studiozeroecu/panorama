/**
 * Fechas para producción — todas ancladas a la zona horaria de Ecuador.
 * Bug corregido de la app vieja: parsear "YYYY-MM-DD" con new Date() lo
 * interpreta como medianoche UTC y en Ecuador (UTC-5) mostraba el día anterior.
 * Aquí las fechas-solo-día se manejan como strings, nunca via Date local.
 */

export function hoyEcuador(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
}

/** "2026-07-11" → "11/07/2026" sin pasar por Date (sin corrimiento de zona). */
export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Suma días laborables (lun-vie) a una fecha ISO; devuelve ISO. */
export function sumarDiasLaborables(iso: string, dias: number): string {
  // mediodía UTC: inmune a desplazamientos de zona al iterar días
  const d = new Date(`${iso}T12:00:00Z`);
  let sumados = 0;
  while (sumados < dias) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) sumados++;
  }
  return d.toISOString().slice(0, 10);
}

/** Días de diferencia entre hoy (Ecuador) y una fecha ISO (positivo = futuro). */
export function diasHasta(iso: string): number {
  const a = new Date(`${hoyEcuador()}T12:00:00Z`).getTime();
  const b = new Date(`${iso}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

export function mesActual(): string {
  return hoyEcuador().slice(0, 7);
}

export function enMes(iso: string | null | undefined, mes: string): boolean {
  return typeof iso === "string" && iso.startsWith(mes);
}
