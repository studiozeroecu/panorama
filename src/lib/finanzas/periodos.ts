/**
 * Quincenas (1–15 y 16–fin de mes) y meses, en fechas ISO "YYYY-MM-DD".
 * Todo con strings y aritmética UTC a mediodía: nunca con la hora local del
 * navegador ni del servidor. "Hoy" siempre es hoy en Ecuador.
 */
import { hoyEcuador } from "@/lib/fechas";

export interface Periodo {
  tipo: "quincena" | "mes";
  desde: string;
  hasta: string;
  etiqueta: string;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const pad = (n: number) => String(n).padStart(2, "0");

function partes(iso: string): [number, number, number] {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Fecha inválida: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function ultimoDiaDelMes(anio: number, mes: number): number {
  // día 0 del mes siguiente = último día de este mes
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Suma (o resta) días a una fecha ISO. */
export function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = partes(iso);
  const f = new Date(Date.UTC(y, m - 1, d, 12));
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

/** Días entre dos fechas ISO (b − a). */
export function diasEntre(a: string, b: string): number {
  const [y1, m1, d1] = partes(a);
  const [y2, m2, d2] = partes(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function quincenaDe(iso: string = hoyEcuador()): Periodo {
  const [y, m, d] = partes(iso);
  const fin = ultimoDiaDelMes(y, m);
  const primera = d <= 15;
  const desde = `${y}-${pad(m)}-${primera ? "01" : "16"}`;
  const hasta = `${y}-${pad(m)}-${primera ? "15" : pad(fin)}`;
  const etiqueta = `${primera ? 1 : 16}–${primera ? 15 : fin} ${MESES[m - 1]} ${y}`;
  return { tipo: "quincena", desde, hasta, etiqueta };
}

export function mesDe(iso: string = hoyEcuador()): Periodo {
  const [y, m] = partes(iso);
  const fin = ultimoDiaDelMes(y, m);
  return {
    tipo: "mes",
    desde: `${y}-${pad(m)}-01`,
    hasta: `${y}-${pad(m)}-${pad(fin)}`,
    etiqueta: `${MESES_LARGOS[m - 1]} ${y}`,
  };
}

export function periodoDe(tipo: Periodo["tipo"], iso: string = hoyEcuador()): Periodo {
  return tipo === "quincena" ? quincenaDe(iso) : mesDe(iso);
}

export function siguiente(p: Periodo): Periodo {
  return periodoDe(p.tipo, sumarDias(p.hasta, 1));
}

export function anterior(p: Periodo): Periodo {
  return periodoDe(p.tipo, sumarDias(p.desde, -1));
}

export function contiene(p: Periodo, iso: string | null | undefined): boolean {
  return typeof iso === "string" && iso >= p.desde && iso <= p.hasta;
}

/** Las dos quincenas de un mes. */
export function quincenasDelMes(mes: Periodo): [Periodo, Periodo] {
  return [quincenaDe(mes.desde), quincenaDe(mes.hasta)];
}
