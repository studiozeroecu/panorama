/**
 * Fase 8u: lo que pasó en una feria.
 *
 * Lo vendido NO se guarda en ningún lado: es lo que fue menos lo que regresó
 * (a la bodega o a los locales), línea por línea y talla por talla. Las
 * ganancias las anota el dueño en Finanzas; aquí solo cuántas y a qué costo.
 *
 * Cada línea es una salida hacia la feria (prod_feria_ingresos): una entrega
 * de Envío, un lote que volvió del taller o mercadería estancada. Los regresos
 * se anotan contra su línea para que el costo sea el exacto de esa salida.
 */

import { cantidad, tallasLimpias, sumaTallas, type TallasTexto } from "./reparto";
import type { IngresoFeria } from "./types";

export interface RetornoFeria {
  id: string;
  feria_id: string;
  ingreso_id: string;
  fecha: string;
  destino: "bodega" | "local";
  tallas: Record<string, number>;
  unidades: number;
  costo_unitario: number;
}

export interface LineaFeria {
  ingreso: IngresoFeria;
  fueron: number;
  regresaron: number;
  vendidas: number;
  /** Costo de lo vendido: vendidas × costo de esa salida (con el operativo de feria). */
  costoVendido: number;
}

export function lineasFeria(ingresos: IngresoFeria[], retornos: RetornoFeria[]): LineaFeria[] {
  return ingresos.map((ingreso) => {
    const fueron = Number(ingreso.unidades);
    const regresaron = retornos
      .filter((r) => r.ingreso_id === ingreso.id)
      .reduce((s, r) => s + Number(r.unidades), 0);
    const vendidas = Math.max(0, fueron - regresaron);
    return {
      ingreso,
      fueron,
      regresaron,
      vendidas,
      costoVendido: Math.round(vendidas * Number(ingreso.costo_unitario) * 100) / 100,
    };
  });
}

export function resumenFeria(lineas: LineaFeria[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    fueron: lineas.reduce((s, l) => s + l.fueron, 0),
    regresaron: lineas.reduce((s, l) => s + l.regresaron, 0),
    vendidas: lineas.reduce((s, l) => s + l.vendidas, 0),
    costoEnviado: r2(lineas.reduce((s, l) => s + l.fueron * Number(l.ingreso.costo_unitario), 0)),
    costoVendido: r2(lineas.reduce((s, l) => s + l.costoVendido, 0)),
  };
}

/** Lo que se escribe al cerrar: por línea, cuántas regresan a bodega y a locales por talla. */
export type CierreForm = Record<string, { bodega: TallasTexto; local: TallasTexto }>;

/** Por línea y talla: lo que fue − lo que regresa. Negativo = regresa más de lo que fue. */
export function vendidasPorTalla(ingreso: IngresoFeria, form: CierreForm): Record<string, number> {
  const out: Record<string, number> = { ...ingreso.tallas };
  const f = form[ingreso.id];
  if (!f) return out;
  for (const lado of [f.bodega, f.local]) {
    for (const [t, v] of Object.entries(lado)) out[t] = (out[t] ?? 0) - cantidad(v);
  }
  return out;
}

export function problemasCierre(ingresos: IngresoFeria[], form: CierreForm): string[] {
  const out: string[] = [];
  for (const i of ingresos) {
    for (const [t, n] of Object.entries(vendidasPorTalla(i, form))) {
      if (n < 0) {
        out.push(`${i.prenda_nombre} ${i.color}${i.estampado ? ` (${i.estampado})` : ""}, talla ${t}: regresan ${-n} más de las que fueron.`);
      }
    }
  }
  return out;
}

/** Lo que espera fn_cerrar_feria: solo las líneas con algo que regresa. */
export function retornosParaBase(form: CierreForm) {
  return Object.entries(form)
    .map(([ingreso_id, f]) => ({ ingreso_id, bodega: tallasLimpias(f.bodega), local: tallasLimpias(f.local) }))
    .filter((r) => sumaTallas(r.bodega) + sumaTallas(r.local) > 0);
}
