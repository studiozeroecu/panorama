import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador } from "@/lib/fechas";
import { nuevoId } from "@/lib/id";

/**
 * Horas de la cortadora por corte — fase 8o (pieza 5 de docs/plan_cortadora.md).
 *
 * Las horas viven en prod_jornadas (fase 8j), enlazadas al corte por
 * prod_jornada_cortes. Ahora se anotan al registrar cada corte, y con "+ Horas"
 * se suman más si el corte ocupó otro día.
 *
 * ⚠️ La tarifa NO la pone la pantalla: la congela la base en cada jornada
 * (trigger trg_congelar_tarifa_jornada, con fn_tarifa_hora_cortadora). Este
 * valor es SOLO para mostrar el cálculo antes de guardar. Si se cambia la tarifa
 * en la base, cámbiese aquí también — si no, la pantalla enseñaría un costo que
 * no es el que se guarda.
 */
export const TARIFA_HORA_CORTADORA = 4;

/**
 * Los minutos se eligen de esta lista, no se teclean. Con un número decimal libre
 * "2.9" no es nada que alguien mida en un reloj (¿2 h 9 min? ¿2 h 54 min?), y el
 * costo saldría de una cifra que nadie quiso decir. Cuartos de hora bastan.
 */
export const MINUTOS_PERMITIDOS = [0, 15, 30, 45] as const;

/**
 * Horas ENTERAS + minutos de la lista → horas decimales para la base
 * (2 h 30 min → 2.5), o un mensaje. Las dos cosas vacías o en cero = no anotó horas.
 */
export function validarHoras(
  horasTexto: string,
  minutosTexto: string
): { horas: number | null } | { error: string } {
  const ht = horasTexto.trim();
  const h = ht === "" ? 0 : Number(ht);
  if (!Number.isInteger(h) || h < 0)
    return { error: "Las horas van en número entero (2, 3…). Los minutos se eligen al lado." };
  const m = Number(minutosTexto || "0");
  if (!(MINUTOS_PERMITIDOS as readonly number[]).includes(m))
    return { error: "Elige los minutos de la lista (0, 15, 30 o 45)." };
  if (h === 0 && m === 0) return { horas: null };
  // Un corte no ocupa más de un día de trabajo de una sola vez; más es un error
  // de tecleo (minutos escritos como horas, o un cero de más).
  if (h > 16) return { error: `${h} horas parece demasiado para un corte. ¿Son minutos?` };
  return { horas: h + m / 60 };
}

/** 2.5 → "2 h 30 min", 3 → "3 h", 0.25 → "15 min". */
export function fmtHoras(horas: number): string {
  const totalMin = Math.round(horas * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function costoHoras(horas: number, tarifa: number = TARIFA_HORA_CORTADORA): number {
  return Math.round(horas * tarifa * 100) / 100;
}

/**
 * Guarda una jornada de `horas` enlazada a un corte.
 *
 * El id se genera aquí para no depender de `returning` (y para que, si el enlace
 * fallara, el mensaje pueda decir que las horas sí quedaron guardadas).
 */
export async function guardarHorasCorte(
  supabase: SupabaseClient,
  corteId: string,
  horas: number,
  nota: string
): Promise<void> {
  const id = nuevoId();
  const { error } = await supabase
    .from("prod_jornadas")
    .insert({ id, fecha: hoyEcuador(), horas, nota: nota.trim() });
  if (error) throw new Error(`No se guardaron las horas: ${error.message}`);

  const { error: e2 } = await supabase
    .from("prod_jornada_cortes")
    .insert({ jornada_id: id, corte_id: corteId });
  if (e2) throw new Error(`Las horas se guardaron, pero no se enlazaron al corte: ${e2.message}`);
}
