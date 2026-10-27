import type { Parte } from "./conjuntos";

export interface Prenda {
  id: string;
  nombre: string;
  /** Metros LINEALES por unidad. Solo vale para el ancho con el que se midió. */
  consumo_metros: number;
  /**
   * Fase 8h: metros CUADRADOS por unidad. Dato medido aparte, independiente de
   * `consumo_metros` — no se deriva uno del otro. null = sin medir todavía.
   */
  consumo_m2: number | null;
  costo_maquila: number;
  precio_venta_local: number;
  precio_venta_online: number;
  lleva_estampado: boolean;
  tallas: string[];
  notas: string;
  /** Fase 8e: null = activa. Archivada no se ofrece al elegir, pero su historial sigue enlazado. */
  archivada_en: string | null;
  /** Fase 8r: conjunto de dos partes. Sus precios de venta son los del SET. */
  es_conjunto: boolean;
  /** Fase 8r: la parte superior y la inferior (vacío en una prenda sola). */
  partes: PartePrenda[];
}

/** Fase 8r: una parte de un conjunto, con su consumo, su maquila y su precio suelto. */
export interface PartePrenda {
  id: string;
  prenda_id: string;
  parte: Parte;
  nombre: string;
  consumo_metros: number | null;
  costo_maquila: number;
  precio_venta_local: number;
  precio_venta_online: number;
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
  /** Fase 8j · PLAN: unidades por talla de UNA capa. Lo define el admin, lo lee la cortadora. */
  corrida_base: Record<string, number> | null;
  /** Fase 8l: quién confirmó la llegada. null = anterior a la 8l, no se sabe. */
  recibido_por_rol: "admin" | "cortadora" | null;
  /** Fase 8l: FOTO del ancho medido al recibir. `ancho_real` puede corregirse después; este no. */
  ancho_recibido: number | null;
  /** Fase 8o: qué hacer con la tela al volver de maquila. SOLO informativo: Envío decide. */
  destino_indicado: "locales" | "estampado" | null;
}

export interface ColorCorte {
  id: string;
  pedido_color_id: string | null;
  color: string;
  /** Fase 8r: superior / inferior en un corte de conjunto; null en una prenda sola. */
  parte: Parte | null;
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
  /** Fase 8j · FOTO de la corrida con la que se cortó. No se vuelve a tocar. */
  corrida_base: Record<string, number> | null;
  /** Fase 8p: insumos anotados por la cortadora; `costo` lo pone el admin (null = sin costo). */
  insumos: InsumoCorte[];
  /** Fase 8o/8p: horas de la cortadora, con la tarifa CONGELADA de cada jornada. */
  jornadas: { horas: number; tarifa_hora: number }[];
}

export interface InsumoCorte {
  id: string;
  descripcion: string;
  cantidad: number;
  costo: number | null;
}

export type EstadoColorMaquila = "pendiente" | "enviado" | "entregado";

export interface ColorMaquila {
  id: string;                 // prod_maquila_colores.id — la fila que se actualiza
  corte_color_id: string;
  // color / tallas / unidades NO se guardan aquí: vienen por join del corte
  color: string;
  /** Fase 8r: la parte del conjunto (viene del corte). */
  parte: Parte | null;
  /** Fase 8v: claro / oscuro, para el film del estampado (viene del corte). null = sin marcar. */
  tono: "claro" | "oscuro" | null;
  /** Fase 8r: precio de maquila de ESTA fila; null = el de la maquila. */
  costo_unitario: number | null;
  tallas: Record<string, number>;
  unidades: number;
  estado: EstadoColorMaquila;
  fecha_envio: string | null;
  fecha_entrega: string | null;
  procesado: boolean; // ya se envió a estampado/online/locales desde Envío
  /** Fase 8o: lo que la maquiladora fue devolviendo. Envío procesa CADA entrega. */
  entregas: EntregaMaquila[];
}

/** Fase 8o: una entrega (completa o parcial) de un color en maquila. */
export interface EntregaMaquila {
  id: string;
  fecha: string;
  tallas: Record<string, number>;
  unidades: number;
  procesado: boolean;
  /** Fase 8p: entrega = llegó bien · falla / faltante = baja justificada, no se paga ni va a Envío. */
  tipo: "entrega" | "falla" | "faltante";
  motivo: string;
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
  /** Fase 8s: qué tallas lleva este diseño. Los lotes anteriores no la tienen. */
  tallas?: Record<string, number>;
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
  /** Fase 8t: a dónde entra al volver del taller. null = lote anterior: a la bodega. */
  destino: "bodega" | "local" | "feria" | null;
  feria_id: string | null;
  local_destino: string | null;
  /** Fase 8v: la orden con la que se mandó al taller. */
  orden_id: string | null;
  /** Fase 8y: tono de un lote SIN producción (desde bodega); los demás lo toman del corte. */
  tono: "claro" | "oscuro" | null;
  /** Fase 8y: agrupa los lotes de una misma salida desde bodega. */
  salida_id: string | null;
}

/** Fase 8w: la lista de estampados. Se elige de aquí para que el mismo se llame siempre igual. */
export interface Estampado {
  id: string;
  nombre: string;
  archivada_en: string | null;
}

/** Fase 8v: lotes que se mandaron juntos al taller. */
export interface OrdenEstampado {
  id: string;
  fecha: string;
  taller_id: string | null;
  por_metro: number;
  nota: string | null;
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

/** Fase 8s: una feria a la que sale mercadería a vender. */
export interface Feria {
  id: string;
  nombre: string;
  fecha: string;
  observaciones: string | null;
  cerrada_en: string | null;
}

/** Fase 8s: una salida de mercadería hacia una feria. */
export interface IngresoFeria {
  id: string;
  feria_id: string;
  fecha: string;
  origen: "envio" | "estampado" | "estancada";
  entrega_id: string | null;
  maquila_id: string | null;
  prenda_id: string | null;
  prenda_nombre: string;
  color: string;
  estampado: string;
  tallas: Record<string, number>;
  unidades: number;
  costo_unitario: number;
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
