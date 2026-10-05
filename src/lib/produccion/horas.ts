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

/** Horas tecleadas → número válido, o un mensaje. Vacío = no anotó horas. */
export function validarHoras(texto: string): { horas: number | null } | { error: string } {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return { horas: null };
  const h = Number(limpio);
  if (!Number.isFinite(h) || h <= 0) return { error: "Las horas tienen que ser un número mayor que 0." };
  // Un corte no ocupa más de un día de trabajo de una sola vez; más es un error
  // de tecleo (minutos en vez de horas, o un cero de más).
  if (h > 16) return { error: `${h} horas parece demasiado para un corte. ¿Son minutos?` };
  return { horas: h };
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
