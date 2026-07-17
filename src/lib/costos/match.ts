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

export interface CategoriaCosto {
  id: string;
  nombre: string;
  prioridad: number;
  incluir: string[];
  excluir: string[];
  costo_id: string | null;
}

/**
 * Rediseño (jul 2026): categorías con PRIORIDAD explícita — se evalúan en
 * orden (menor prioridad primero) y la primera que aplica gana. Así
 * "CUELLO CHINO" (prio 10) le gana a "CAMISETA" (prio 50) aunque la
 * descripción contenga ambas. Reglas automáticas, sin intervención manual.
 */
export function matchCategoria(
  descripcion: string,
  categorias: CategoriaCosto[]
): CategoriaCosto | null {
  const desc = norm(descripcion);
  const cumple = (k: string) => k.split("|").some((alt) => alt.trim() && desc.includes(norm(alt.trim())));
  const ordenadas = [...categorias].sort((a, b) => a.prioridad - b.prioridad);
  for (const cat of ordenadas) {
    if (!cat.incluir?.length) continue;
    if (!cat.incluir.every(cumple)) continue;
    if ((cat.excluir ?? []).some(cumple)) continue;
    return cat;
  }
  return null;
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
  porCategoria: { nombre: string; neto: number; ganancia: number; unidades: number }[];
}

/**
 * Ganancia estimada del periodo = Σ (neto − costo_total × cantidad), agrupada
 * por categoría. Prioridad de resolución por línea:
 *   1. vínculo manual por código (corrección puntual)
 *   2. categorías automáticas por prioridad
 * Lo que no matchea cae en "Sin categoría" y no bloquea el resto.
 */
export function calcularGanancia(
  lineas: LineaVenta[],
  costos: CostoPrenda[],
  categorias: CategoriaCosto[],
  vinculos: Map<string, string> // codigo → costo_id (manual)
): GananciaPeriodo {
  const porId = new Map(costos.map((c) => [c.id, c]));
  let ganancia = 0;
  let netoConCosto = 0;
  let netoTotal = 0;
  const sinMatch: GananciaPeriodo["lineasSinMatch"] = [];
  const grupos = new Map<string, { neto: number; ganancia: number; unidades: number }>();

  const acumular = (nombre: string, neto: number, g: number, unidades: number) => {
    const e = grupos.get(nombre) ?? { neto: 0, ganancia: 0, unidades: 0 };
    e.neto += neto;
    e.ganancia += g;
    e.unidades += unidades;
    grupos.set(nombre, e);
  };

  for (const l of lineas) {
    const neto = Number(l.neto ?? 0);
    netoTotal += neto;

    let costo: CostoPrenda | null = null;
    let nombreCategoria = "";
    const vinculado = vinculos.get(l.codigo);
    if (vinculado) {
      costo = porId.get(vinculado) ?? null;
      nombreCategoria = costo ? `(manual) ${costo.producto}` : "";
    } else {
      const cat = matchCategoria(l.descripcion, categorias);
      if (cat?.costo_id) {
        costo = porId.get(cat.costo_id) ?? null;
        nombreCategoria = cat.nombre;
      }
    }

    if (costo) {
      const g = neto - Number(costo.costo_total) * l.cantidad;
      ganancia += g;
      netoConCosto += neto;
      acumular(nombreCategoria || costo.producto, neto, g, l.cantidad);
    } else {
      if (neto > 0) sinMatch.push({ codigo: l.codigo, descripcion: l.descripcion, neto });
      acumular("Sin categoría", neto, 0, l.cantidad);
    }
  }

  return {
    gananciaEstimada: ganancia,
    netoConCosto,
    netoTotal,
    coberturaPct: netoTotal > 0 ? (netoConCosto / netoTotal) * 100 : 0,
    lineasSinMatch: sinMatch.sort((a, b) => b.neto - a.neto),
    porCategoria: [...grupos.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.neto - a.neto),
  };
}
