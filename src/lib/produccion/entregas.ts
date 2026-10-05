/**
 * Entregas de maquila — fase 8o.
 *
 * Lo que falta por entregar de un color = lo cortado − Σ entregas, talla por
 * talla. Es el mismo cálculo que fn_tallas_pendientes_maquila en la base; la
 * base es la autoridad (rechaza un exceso), esto es para enseñarlo y precargar
 * el formulario.
 */

export type Tallas = Record<string, number>;

export interface EntregaBreve {
  tallas: Tallas | null;
  unidades: number;
}

/** Solo tallas con algo pendiente; {} = entregado completo. */
export function pendientesPorTalla(cortado: Tallas, entregas: EntregaBreve[]): Tallas {
  const entregado: Tallas = {};
  for (const e of entregas) {
    for (const [t, n] of Object.entries(e.tallas ?? {})) {
      entregado[t] = (entregado[t] ?? 0) + Number(n);
    }
  }
  const out: Tallas = {};
  for (const [t, n] of Object.entries(cortado)) {
    const falta = Number(n) - (entregado[t] ?? 0);
    if (falta > 0) out[t] = falta;
  }
  return out;
}

export function sumaTallas(t: Tallas): number {
  return Object.values(t).reduce((s, n) => s + Number(n), 0);
}

export type EtapaMaquila = "por_enviar" | "en_maquila" | "parcial" | "entregado";

/**
 * Dónde está el lote, en palabras de la cortadora. "parcial" no se guarda en la
 * base: es un color enviado que ya tiene entregas pero no está completo.
 */
export function etapaMaquila(
  estado: "pendiente" | "enviado" | "entregado",
  entregas: EntregaBreve[]
): EtapaMaquila {
  if (estado === "entregado") return "entregado";
  if (entregas.length > 0) return "parcial";
  return estado === "enviado" ? "en_maquila" : "por_enviar";
}

export const TEXTO_ETAPA: Record<EtapaMaquila, string> = {
  por_enviar: "Por enviar",
  en_maquila: "En maquila",
  parcial: "Entrega parcial",
  entregado: "Entregado",
};
