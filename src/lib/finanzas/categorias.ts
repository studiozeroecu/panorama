/**
 * Listas únicas de Finanzas (antes repetidas en la pantalla, el bot y el SQL).
 * Deben coincidir con las reglas fin_* de supabase/finanzas_v2_sql1_ampliar.sql.
 * "personal" como CATEGORÍA ya no se ofrece: ahora es "sueldos". El ámbito
 * empresa/personal es otra cosa y se mantiene.
 */
import type { Ambito, Exigibilidad, Medio, TipoDeuda } from "./tipos";

export const CATEGORIAS_GASTO = [
  "maquila",
  "estampado",
  "corte",
  "arriendo",
  "servicios",
  "transporte",
  "sueldos",
  "otros",
] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export const AMBITOS: { id: Ambito; label: string }[] = [
  { id: "empresa", label: "Empresa" },
  { id: "personal", label: "Personal" },
];

export const TIPOS_DEUDA: { id: TipoDeuda; label: string }[] = [
  { id: "proveedor", label: "Proveedor" },
  { id: "prestamo", label: "Préstamo" },
  { id: "tarjeta", label: "Tarjeta" },
  { id: "familia", label: "Familia" },
  { id: "sueldo", label: "Sueldo" },
  { id: "otra", label: "Otra" },
];

export const EXIGIBILIDADES: { id: Exigibilidad; label: string; ayuda: string }[] = [
  { id: "firme", label: "Firme", ayuda: "tiene fechas de pago que hay que cumplir" },
  { id: "flexible", label: "Flexible", ayuda: "se paga cuando se pueda (ej. familia)" },
];

export const MEDIOS: { id: Medio; label: string }[] = [
  { id: "cheque", label: "Cheque" },
  { id: "transferencia", label: "Transferencia" },
  { id: "efectivo", label: "Efectivo" },
];

export const DOCUMENTO_TIPOS = [
  { id: "factura", label: "Factura" },
  { id: "nota_venta", label: "Nota de venta" },
  { id: "promedio", label: "Promedio" },
  { id: "otro", label: "Otro" },
] as const;

export function labelTipoDeuda(id: string): string {
  return TIPOS_DEUDA.find((t) => t.id === id)?.label ?? id;
}
