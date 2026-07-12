/** Locales VATEX — misma lista que valida guias_transferencia en la base. */
export const LOCALES = [
  "PK", "LJ", "GL", "GT", "BS", "IBA", "HUMZO", "CV", "HUMMER", "QUITO", "FRATELLI",
] as const;

export interface GuiaItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
}

export interface Guia {
  id: string;
  created_at: string;
  fecha: string;
  local_destino: string;
  items: GuiaItem[];
  total_unidades: number;
  total_valor: number;
  recibido_por: string;
  foto_path: string | null;
  subido_por: string;
}
