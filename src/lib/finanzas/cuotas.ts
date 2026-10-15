/**
 * Generador y validación de pagos programados (cuotas / cheques posfechados).
 * Las reglas imitan las de la base (fn_validar_cuotas_deuda y crear_deuda):
 * la base es la que manda; esto solo avisa antes de guardar.
 */
import { aCentavos, deCentavos, sumar } from "./formato";
import { sumarDias } from "./periodos";
import type { Exigibilidad, Medio } from "./tipos";

export interface CuotaBorrador {
  monto: number;
  fecha: string;
  medio: Medio;
  numero: string;
  banco: string;
}

/** "30/60/90/120" o "30, 60, 90" → [30, 60, 90, 120]. Devuelve null si algo no es número. */
export function parsePlazos(texto: string): number[] | null {
  const partes = texto.split(/[\s,/;]+/).filter(Boolean);
  if (!partes.length) return null;
  const dias = partes.map(Number);
  if (dias.some((d) => !Number.isInteger(d) || d < 0)) return null;
  return dias;
}

/** n plazos cada `intervalo` días: plazosCada(30, 4) → [30, 60, 90, 120]. */
export function plazosCada(intervalo: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => intervalo * (i + 1));
}

/**
 * Reparte `total` en tantas cuotas como plazos, contando los días desde
 * `fechaBase`. Todas iguales en centavos; lo que sobra va a la ÚLTIMA.
 * Ej. $1.000 en 3 → 333,33 + 333,33 + 333,34.
 * Si viene `numeroInicial` numérico, numera los cheques correlativos.
 */
export function repartirCuotas(opts: {
  total: number;
  plazosDias: number[];
  fechaBase: string;
  medio?: Medio;
  numeroInicial?: string;
  banco?: string;
}): CuotaBorrador[] {
  const { total, plazosDias, fechaBase, medio = "cheque", numeroInicial = "", banco = "" } = opts;
  const n = plazosDias.length;
  if (n === 0) return [];
  const totalC = aCentavos(total);
  if (totalC <= 0) return [];
  const base = Math.floor(totalC / n);
  const ultimo = totalC - base * (n - 1);
  const numInicial = /^\d+$/.test(numeroInicial.trim()) ? Number(numeroInicial.trim()) : null;
  return plazosDias.map((dias, i) => ({
    monto: deCentavos(i === n - 1 ? ultimo : base),
    fecha: sumarDias(fechaBase, dias),
    medio,
    numero: numInicial != null ? String(numInicial + i) : i === 0 ? numeroInicial.trim() : "",
    banco,
  }));
}

/**
 * Misma regla que la base. Devuelve el problema en español simple, o null si
 * está bien. `cuotas` son las cuotas nuevas (todas pendientes).
 */
export function validarCuotas(opts: {
  monto: number;
  exigibilidad: Exigibilidad;
  esSaldoInicial: boolean;
  cuotas: { monto: number; fecha: string }[];
}): string | null {
  const { monto, exigibilidad, esSaldoInicial, cuotas } = opts;
  if (!(monto > 0)) return "El monto de la deuda debe ser mayor a 0.";
  if (exigibilidad === "firme" && !esSaldoInicial && cuotas.length === 0) {
    return "Una deuda firme nueva necesita al menos un pago programado.";
  }
  for (const c of cuotas) {
    if (!(c.monto > 0)) return "Cada pago debe tener un monto mayor a 0.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) return "Cada pago necesita fecha.";
  }
  const suma = sumar(cuotas.map((c) => c.monto));
  if (aCentavos(suma) > aCentavos(monto)) {
    return `Los pagos suman ${suma.toFixed(2)} y la deuda es ${monto.toFixed(2)}: no pueden pasarse del total.`;
  }
  if (exigibilidad === "firme" && cuotas.length > 0 && aCentavos(suma) !== aCentavos(monto)) {
    return `Los pagos suman ${suma.toFixed(2)} y la deuda es ${monto.toFixed(2)}: en una deuda firme deben sumar exacto.`;
  }
  return null;
}

// ------------------------------------------------------------
// Cheques al sábado (pedido del dueño, 2026-10-15)
// El proveedor no pide fechas exactas, solo "por esas fechas". El dueño
// prefiere SÁBADO (se deposita el lunes y le da jueves/viernes para pedir el
// dinero) y que los cheques NO se junten: si un sábado ya tiene cheques, se
// busca el sábado libre más cercano. Solo se comparte sábado si la suma no
// pasa del tope. Un cheque solo, aunque pase el tope, está bien.
// ------------------------------------------------------------

/** 0 = domingo … 6 = sábado, sin zona horaria (mediodía UTC). */
export function diaSemana(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
}

/**
 * Los sábados alrededor de una fecha, del más cercano al más lejano (hasta
 * `semanas` antes y después). Con empate gana el de después.
 */
export function sabadosCercanos(iso: string, semanas = 2): string[] {
  const hastaSabado = (6 - diaSemana(iso) + 7) % 7; // 0 si ya es sábado
  const base = sumarDias(iso, hastaSabado);
  const out: { fecha: string; dist: number }[] = [];
  for (let k = -semanas - 1; k <= semanas; k++) {
    out.push({ fecha: sumarDias(base, 7 * k), dist: Math.abs(hastaSabado + 7 * k) });
  }
  return out
    .filter((x) => x.dist <= 7 * semanas + 3)
    .sort((a, b) => a.dist - b.dist || b.fecha.localeCompare(a.fecha))
    .map((x) => x.fecha);
}

export interface CuotaAjustada extends CuotaBorrador {
  /** la fecha que daba el plazo, antes de pasarla al sábado */
  fechaPlazo: string;
  /** algo que el dueño debe saber de esa fecha, o null */
  aviso: string | null;
}

/**
 * Pasa cada cuota al sábado más cercano sin juntarla con otros cheques:
 *  1. el sábado LIBRE más cercano (ni cheques ya registrados ni de esta deuda);
 *  2. si no hay libre cerca, el más cercano donde la suma no pase del tope;
 *  3. si tampoco, el más cercano, con aviso.
 * Las cuotas quedan siempre en orden (cada una después de la anterior) y
 * nunca antes de `despuesDe` (la fecha desde la que se cuentan los días: un
 * cheque no puede ser anterior a la factura).
 * `ocupado`: cuánto suman ya los cheques pendientes de cada fecha.
 */
export function ajustarASabados(
  cuotas: CuotaBorrador[],
  opts: { ocupado: Map<string, number>; tope: number; semanas?: number; despuesDe?: string }
): CuotaAjustada[] {
  const { ocupado, tope, semanas = 2 } = opts;
  const asignado = new Map<string, number>();
  const carga = (f: string) => sumar([ocupado.get(f) ?? 0, asignado.get(f) ?? 0]);
  let anterior = opts.despuesDe ?? "";
  const out: CuotaAjustada[] = [];

  for (const c of cuotas) {
    let candidatos = sabadosCercanos(c.fecha, semanas).filter((s) => s > anterior);
    if (!candidatos.length) {
      // todo lo cercano quedó antes de la cuota anterior: el sábado siguiente a ella
      candidatos = [sumarDias(anterior, ((6 - diaSemana(anterior) + 7) % 7) || 7)];
    }
    const elegido =
      candidatos.find((s) => carga(s) === 0) ??
      candidatos.find((s) => aCentavos(carga(s) + c.monto) <= aCentavos(tope)) ??
      candidatos[0];

    const ya = carga(elegido);
    let aviso: string | null = null;
    if (ya > 0) {
      const total = sumar([ya, c.monto]);
      aviso =
        `Comparte el sábado con $${ya.toFixed(2)} en cheques (en total $${total.toFixed(2)})` +
        (aCentavos(total) > aCentavos(tope) ? ` — pasa tu tope de $${tope.toFixed(2)}` : "");
    }
    asignado.set(elegido, sumar([asignado.get(elegido) ?? 0, c.monto]));
    anterior = elegido;
    out.push({ ...c, fecha: elegido, fechaPlazo: c.fecha, aviso });
  }
  return out;
}

/** Cuánto suman los cheques pendientes de cada fecha (para no juntar cheques). */
export function chequesPorFecha(
  cheques: { fecha_cobro: string | null; monto: number; medio: string; estado: string; tipo: string }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cheques) {
    if (c.tipo !== "por_pagar" || c.estado !== "pendiente" || c.medio !== "cheque" || !c.fecha_cobro) continue;
    m.set(c.fecha_cobro, sumar([m.get(c.fecha_cobro) ?? 0, c.monto]));
  }
  return m;
}
