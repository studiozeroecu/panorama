/**
 * Fase 8l · recepción de tela.
 *
 * La autoridad es `fn_recibir_tela` en la base: esto repite sus límites para dar
 * el aviso antes de mandar nada, con el MISMO texto y los MISMOS números. Si se
 * cambian aquí, se cambian allí (supabase/schema_fase8l_cortadora_recibe_tela.sql).
 */

/** Por debajo, casi seguro un ancho en metros (1.5 en vez de 150). */
export const ANCHO_MIN_CM = 10;
/** Por encima, casi seguro milímetros. Ninguna tela real pasa de ~320 cm. */
export const ANCHO_MAX_CM = 400;

/**
 * Valida el ancho tecleado. Siempre en centímetros: la base ya mezcla cm y
 * metros en datos migrados, y un `1.5` aquí entraría como dato real.
 */
export function validarAnchoCm(texto: string): { cm: number } | { error: string } {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return { error: "Escribe el ancho de la tela en centímetros." };
  const cm = Number(limpio);
  if (!Number.isFinite(cm) || cm <= 0) return { error: "El ancho tiene que ser un número." };
  if (cm < ANCHO_MIN_CM)
    return { error: `El ancho va en centímetros: ${cm} parece estar en metros (150 cm, no 1.5).` };
  if (cm > ANCHO_MAX_CM) return { error: `Un ancho de ${cm} cm no es razonable. ¿Está en milímetros?` };
  return { cm };
}

/** Lo que devuelve la RPC. `ya_recibido` es un reintento o una llegada que otra persona confirmó antes. */
export interface ResultadoRecepcion {
  ya_recibido: boolean;
  nombre_tela: string;
  ancho_real: number | string | null;
  fecha_entrega_real?: string | null;
  recibido_por_rol: "admin" | "cortadora" | null;
}

interface PedidoRecibido {
  recibido_por_rol: "admin" | "cortadora" | null;
  ancho_recibido: number | string | null;
  ancho_real: number | string | null;
}

/**
 * El indicador que ve Mateo: solo cuando la recibió la cortadora — si la
 * confirmó él mismo, no hay nada que avisarle.
 *
 * Usa la FOTO (`ancho_recibido`) y no `ancho_real`: si Mateo corrigió el ancho
 * después, decir "ancho 152" le atribuiría a ella un número que puso él. Cuando
 * difieren, se dicen los dos.
 */
export function textoRecepcionCortadora(p: PedidoRecibido): string | null {
  if (p.recibido_por_rol !== "cortadora") return null;
  const det = detalleAnchoRecibido(p);
  return det ? `Recibido por la cortadora · ${det}` : "Recibido por la cortadora";
}

/** "ancho 150 cm", o "ancho 150 cm (corregido a 152.5 cm)". null si no hay foto. */
export function detalleAnchoRecibido(p: PedidoRecibido): string | null {
  const medido = p.ancho_recibido == null ? null : Number(p.ancho_recibido);
  const actual = p.ancho_real == null ? null : Number(p.ancho_real);
  if (medido == null) return null;
  let txt = `ancho ${fmtCm(medido)} cm`;
  if (actual != null && Math.abs(actual - medido) > 0.001) txt += ` (corregido a ${fmtCm(actual)} cm)`;
  return txt;
}

function fmtCm(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
