export interface Prenda {
  id: string;
  nombre: string;
  consumo_metros: number;
  costo_maquila: number;
  precio_venta_local: number;
  precio_venta_online: number;
  lleva_estampado: boolean;
  tallas: string[];
  notas: string;
  /** Fase 8e: null = activa. Archivada no se ofrece al elegir, pero su historial sigue enlazado. */
  archivada_en: string | null;
}

export interface Proveedor {
  id: string;
  empresa: string;
  contacto_nombre: string;
  contacto: string;
  dias_entrega: number;
  archivada_en: string | null;
}

export interface CostoFijo {
  id: string;
  nombre: string;
  valor: number;
}

export interface Catalogo {
  id: string;
  nombre: string;
  archivada_en: string | null;
}

// Fase 7: los colores viven en tablas propias (prod_pedido_colores,
// prod_corte_colores + prod_corte_color_tallas, prod_maquila_colores).
// useProduccion los aplana a estas formas — `tallas` sigue siendo un
// Record<talla, unidades> para que los componentes no cambien.
export interface ColorPedido {
  id: string;
  color: string;
  metros: number;
  kilos: number | null;
  orden: number;
}

export type EstadoPedido = "pendiente" | "en_camino" | "entregado";

export interface PedidoTela {
  id: string;
  nombre_tela: string;
  fecha_pedido: string;
  unidad: "metros" | "kilos";
  rendimiento: number | null;
  ancho_pedido: number | null;
  ancho_real: number | null;
  proveedor_id: string | null;
  prenda_id: string | null;
  colores: ColorPedido[];
  total_metros: number;
  valor_metro: number;
  total_pagar: number;
  estado: EstadoPedido;
  fecha_entrega_real: string | null;
}

export interface ColorCorte {
  id: string;
  pedido_color_id: string | null;
  color: string;
  tallas: Record<string, number>;
  unidades: number;
  metros_usados: number | null;
  orden: number;
}

export interface Corte {
  id: string;
  pedido_id: string;
  fecha: string;
  maquiladora_id: string | null;
  colores: ColorCorte[];
  total_unidades: number;
  metros_consumidos: number | null;
  observaciones: string;
}

export type EstadoColorMaquila = "pendiente" | "enviado" | "entregado";

export interface ColorMaquila {
  id: string;                 // prod_maquila_colores.id — la fila que se actualiza
  corte_color_id: string;
  // color / tallas / unidades NO se guardan aquí: vienen por join del corte
  color: string;
  tallas: Record<string, number>;
  unidades: number;
  estado: EstadoColorMaquila;
  fecha_envio: string | null;
  fecha_entrega: string | null;
  procesado: boolean; // ya se envió a estampado/online/locales desde Envío
}

export interface Maquila {
  id: string;
  corte_id: string;
  maquiladora_id: string | null;
  costo_unitario: number;
  colores: ColorMaquila[];
  total_unidades: number;
}

export interface Diseno {
  nombre: string;
  unidades: number;
}

export interface LoteEstampado {
  id: string;
  maquila_id: string | null;
  prenda_id: string | null;
  prenda_nombre: string;
  color: string;
  tallas: Record<string, number>;
  total_unidades: number;
  disenos: Diseno[];
  costo_unitario: number;
  costo_total: number;
  taller_id: string | null;
  fecha_envio: string | null;
  fecha_retorno: string | null;
  estado: "pendiente" | "en_taller" | "retornado";
}

export interface StockOnline {
  id: string;
  prenda_id: string | null;
  prenda_nombre: string;
  color: string;
  estampado: string;
  talla: string;
  disponibles: number;
  vendidas: number;
}

export interface VentaOnline {
  id: string;
  fecha: string;
  prenda_nombre: string;
  color: string;
  estampado: string;
  talla: string;
  cantidad: number;
  precio_unitario: number;
  total: number;
}

export interface EnvioLocal {
  id: string;
  fecha: string;
  maquila_id: string | null;
  prenda_id: string | null;
  prenda_nombre: string;
  color: string;
  tallas: Record<string, number>;
  unidades: number;
  precio_unitario: number;
  costo_unitario: number;
  ingreso: number;
  margen: number;
  producto_codigo: string | null;
  local_destino: string | null;
}

export const TALLA_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

export function ordenarTallas(tallas: string[]): string[] {
  return [...tallas].sort(
    (a, b) =>
      (TALLA_ORDER.indexOf(a) + 1 || 99) - (TALLA_ORDER.indexOf(b) + 1 || 99)
  );
}

export function money(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
