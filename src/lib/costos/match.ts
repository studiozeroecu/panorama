/**
 * Asignación de costo a líneas de venta VATEX por CATEGORÍA (reglas definidas
 * una sola vez en /costos, no línea por línea):
 *  - match_keywords: TODAS deben aparecer en la descripción. Cada entrada
 *    admite alternativas con "|" (ej. "BASICA|COLOR ENTERO" = cualquiera).
 *  - match_excluir: NINGUNA debe aparecer (ej. HODDIE sin BASICA → estampada).
 *  - Si varias categorías aplican, gana la de más keywords; empate = ambigua.
 *  - Lo que no matchea cae en "sin categoría" y NO bloquea el cálculo del resto.
 * Un vínculo manual por código (costos_vinculos) sigue teniendo prioridad,
 * como corrección puntual.
 */

export interface CostoPrenda {
  id: string;
  producto: string;
  nombre_tela: string;
  costo_tela: number;
  maquila: number;
  dtf: number;
  corte: number;
  insumos: number;
  etiqueta: number;
  costo_total: number;
  pvp_vatex: number | null;
  precio_online: number | null;
  precio_mayoreo_1_2: number | null;
  precio_mayoreo_3_5: number | null;
  precio_mayoreo_6plus: number | null;
  match_keywords: string[];
  match_excluir: string[];
}

export const COMISION_VATEX = 0.612; // lo que queda tras el 38.8% de VATEX

function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Devuelve el costo que corresponde a una descripción, o null si no hay match claro. */
export function matchCosto(
  descripcion: string,
  costos: CostoPrenda[]
): CostoPrenda | null {
  const desc = norm(descripcion);
  let mejor: CostoPrenda | null = null;
  let mejorScore = 0;
  let empate = false;

  // cada keyword admite alternativas separadas por "|"
  const cumple = (k: string) => k.split("|").some((alt) => alt.trim() && desc.includes(norm(alt.trim())));

  for (const c of costos) {
    const kws = c.match_keywords ?? [];
    if (!kws.length) continue;
    if (!kws.every(cumple)) continue;
    if ((c.match_excluir ?? []).some(cumple)) continue;
    if (kws.length > mejorScore) {
      mejor = c;
      mejorScore = kws.length;
      empate = false;
    } else if (kws.length === mejorScore) {
      empate = true;
    }
  }
  return empate ? null : mejor;
}

export interface LineaVenta {
  codigo: string;
  descripcion: string;
  cantidad: number;
  neto: number | null;
}

export interface GananciaPeriodo {
  gananciaEstimada: number;
  netoConCosto: number;
  netoTotal: number;
  coberturaPct: number; // % del ingreso neto que tiene costo asignado
  lineasSinMatch: { codigo: string; descripcion: string; neto: number }[];
}

/** Ganancia estimada del periodo = Σ (neto − costo_total × cantidad) sobre líneas con costo. */
export function calcularGanancia(
  lineas: LineaVenta[],
  costos: CostoPrenda[],
  vinculos: Map<string, string> // codigo → costo_id (manual, prioridad)
): GananciaPeriodo {
  const porId = new Map(costos.map((c) => [c.id, c]));
  let ganancia = 0;
  let netoConCosto = 0;
  let netoTotal = 0;
  const sinMatch: GananciaPeriodo["lineasSinMatch"] = [];

  for (const l of lineas) {
    const neto = Number(l.neto ?? 0);
    netoTotal += neto;
    const vinculado = vinculos.get(l.codigo);
    const costo = vinculado ? (porId.get(vinculado) ?? null) : matchCosto(l.descripcion, costos);
    if (costo) {
      ganancia += neto - Number(costo.costo_total) * l.cantidad;
      netoConCosto += neto;
    } else if (neto > 0) {
      sinMatch.push({ codigo: l.codigo, descripcion: l.descripcion, neto });
    }
  }

  return {
    gananciaEstimada: ganancia,
    netoConCosto,
    netoTotal,
    coberturaPct: netoTotal > 0 ? (netoConCosto / netoTotal) * 100 : 0,
    lineasSinMatch: sinMatch.sort((a, b) => b.neto - a.neto),
  };
}
