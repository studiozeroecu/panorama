/**
 * Fase 8v: el resumen de una ORDEN de estampado — lo que se le pide al taller.
 *
 * El taller no recibe la tabla de tallas: recibe METROS de film por estampado
 * y tono. Un metro lleva `porMetro` estampados (casi siempre 4), y claro y
 * oscuro nunca comparten metro (la regla de src/lib/dtf/calculo.ts).
 *
 * ⚠️ Los metros se redondean sobre el TOTAL de la orden, no lote por lote:
 * 4 hoodies + 4 camisetas del mismo estampado son 2 metros; redondear cada
 * lote por separado daría lo mismo aquí, pero 2 + 2 + 3 unidades darían 3
 * metros en vez de 2. Por eso se juntan las producciones en una orden.
 * El desglose por lote (para el dueño) va en fracción de metro, sin redondear.
 */

export type Tono = "claro" | "oscuro";

export interface LoteParaOrden {
  id: string;
  /** Cómo lo reconoce el dueño: "Hoodie · Negro → feria X". */
  etiqueta: string;
  tono: Tono | null;
  disenos: { nombre: string; unidades: number }[];
}

export interface LineaTaller {
  diseno: string;
  tono: Tono;
  unidades: number;
  metros: number;
  /** Lo que aporta cada lote, en fracción de metro. */
  detalle: { loteId: string; etiqueta: string; unidades: number; metros: number }[];
}

const clave = (nombre: string) => nombre.trim().toLowerCase();

export function resumenOrden(lotes: LoteParaOrden[], porMetro: number): LineaTaller[] {
  const pm = porMetro > 0 ? porMetro : 4;
  const grupos = new Map<string, LineaTaller>();
  for (const l of lotes) {
    // Sin marcar se trata como claro: es el film más común, y la pantalla lo avisa.
    const tono: Tono = l.tono ?? "claro";
    for (const d of l.disenos) {
      const n = Number(d.unidades) || 0;
      if (n <= 0 || !d.nombre.trim()) continue;
      const k = `${clave(d.nombre)}|${tono}`;
      const g = grupos.get(k) ?? { diseno: d.nombre.trim(), tono, unidades: 0, metros: 0, detalle: [] };
      g.unidades += n;
      g.detalle.push({ loteId: l.id, etiqueta: l.etiqueta, unidades: n, metros: Math.round((n / pm) * 100) / 100 });
      grupos.set(k, g);
    }
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, metros: Math.ceil(g.unidades / pm) }))
    .sort((a, b) => a.diseno.localeCompare(b.diseno) || a.tono.localeCompare(b.tono));
}

/** El texto para copiar y mandarle al taller. */
export function textoParaTaller(lineas: LineaTaller[], porMetro: number): string {
  const total = lineas.reduce((s, l) => s + l.metros, 0);
  return [
    `Orden de estampado (${porMetro} por metro)`,
    ...lineas.map((l) => `• ${l.diseno} — prendas ${l.tono === "oscuro" ? "OSCURAS" : "CLARAS"}: ${l.metros} m (${l.unidades} estampados)`),
    `Total: ${total} m`,
  ].join("\n");
}
