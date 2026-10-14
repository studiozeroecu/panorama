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
