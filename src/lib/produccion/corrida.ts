/**
 * Corrida de corte: lo que se le manda a la cortadora antes de tender la tela.
 *
 * Una "corrida" son las unidades de cada talla que salen de UNA capa. El total
 * se obtiene multiplicándola por el número de capas, y eso lo registra la
 * cortadora — no entra aquí. Ver `docs/plan_cortadora.md`.
 *
 * El documento es EFÍMERO: no se guarda en Storage ni en la base. Se arma, se
 * imprime o se guarda como PDF desde el navegador, y el sistema no lo recuerda.
 */

import { ordenarTallas, type PedidoTela, type Prenda } from "./types";

/** Tallas por defecto cuando el pedido no tiene prenda asignada. */
const TALLAS_GENERICAS = ["XS", "S", "M", "L", "XL", "XXL"];

export interface AnchoDocumento {
  /** Centímetros según la columna. Null = no hay ningún ancho registrado. */
  cm: number | null;
  /** false = es el ancho PEDIDO, no el confirmado al recibir la tela. */
  esReal: boolean;
}

/**
 * Ancho que se imprime, y si es el real o un sustituto.
 *
 * El encargo pide el ancho REAL —el que se confirma en Llegada— porque es el que
 * manda al tender. Pero `ancho_real` solo se escribe al confirmar la entrega, y
 * los pedidos migrados en su mayoría nunca pasaron por esa pantalla: lo tienen
 * nulo.
 *
 * Por eso cae al `ancho_pedido` en vez de quedarse en blanco: para la cortadora
 * el ancho es imprescindible y un documento sin él no sirve de nada. Pero
 * `esReal` viaja con el dato para que la pantalla lo avise — pasarlo por real
 * sería mentir sobre el único número que decide cuánto rinde la tela.
 *
 * ⚠️ NO convierte unidades. Los datos migrados mezclan centímetros (150, 180) con
 * metros (1.05, 1.45); adivinar cuál es cuál sobre datos reales sería peor que
 * mostrarlos como están. Es limpieza de datos pendiente, no de código.
 */
export function anchoDocumento(pedido: PedidoTela): AnchoDocumento {
  if (pedido.ancho_real != null && pedido.ancho_real > 0) {
    return { cm: Number(pedido.ancho_real), esReal: true };
  }
  if (pedido.ancho_pedido != null && pedido.ancho_pedido > 0) {
    return { cm: Number(pedido.ancho_pedido), esReal: false };
  }
  return { cm: null, esReal: false };
}

/**
 * Tallas de la corrida, en orden XS→XXL. Sin prenda asignada (`prenda_id` es
 * opcional) cae a la lista genérica, igual que hace CorteTab al registrar.
 */
export function tallasDeCorrida(prenda: Prenda | undefined): string[] {
  return ordenarTallas(prenda?.tallas?.length ? prenda.tallas : TALLAS_GENERICAS);
}

/**
 * Unidades que salen de una capa. Ignora lo que no sea un entero positivo: el
 * formulario guarda texto y una talla vacía vale 0, no rompe el total.
 */
export function totalCorrida(corrida: Record<string, string>): number {
  return Object.values(corrida).reduce((suma, v) => {
    const n = parseInt(v, 10);
    return suma + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/** Solo las tallas con unidades, en el orden dado. Lo que se imprime. */
export function tallasConUnidades(
  tallas: string[],
  corrida: Record<string, string>
): { talla: string; unidades: number }[] {
  return tallas
    .map((talla) => ({ talla, unidades: parseInt(corrida[talla] ?? "", 10) || 0 }))
    .filter((x) => x.unidades > 0);
}

// ── Pieza 2 · Calculadora de área estimada ──────────────────────────
//
// Dos mesas de corte físicas. Los largos se miden una vez y no cambian, así que
// tenerlos que teclear en cada apertura sería absurdo — pero crear una tabla de
// configuración (con su migración, su política RLS y su pantalla de edición) por
// dos números tampoco se sostiene. El proyecto no tiene ninguna tabla de ajustes
// y nunca ha usado localStorage; aquí se estrena a propósito, para lo único que
// es: una preferencia local de una sola persona.
//
// Lo que esto acepta: los largos viven en ESE navegador. Otro equipo (o la
// cortadora cuando tenga su usuario, pieza 3) no los ve. Si algún día hacen
// falta compartidos, mudarlos a una tabla es barato.

export interface MesaCorte {
  nombre: string;
  /** Largo en metros, como texto: es lo que teclea el usuario. */
  largo: string;
}

export const MESAS_INICIALES: MesaCorte[] = [
  { nombre: "Mesa 1", largo: "" },
  { nombre: "Mesa 2", largo: "" },
];

const CLAVE_MESAS = "panorama.mesas_corte";

/**
 * Por debajo de este ancho el dato casi seguro está en metros y no en
 * centímetros. Los pedidos migrados mezclan las dos unidades (150 y 180 conviven
 * con 1.05 y 1.45), y aquí —a diferencia de la hoja, que solo muestra— el número
 * entra en una multiplicación: un 1.05 daría 0.05 m² y esa cifra absurda podría
 * pasar por buena.
 */
const ANCHO_MINIMO_CM = 10;

export interface AreaEstimada {
  /** m² de tela que caben en una tendida de la mesa. */
  m2: number | null;
  /** Cuántas tendidas de esa mesa daría la tela entera. */
  tendidas: number | null;
  /** El ancho guardado parece estar en metros: no se calcula nada. */
  anchoSospechoso: boolean;
}

/**
 * Área que cubre una tendida sobre la mesa elegida, y cuántas tendidas daría la
 * tela completa. **Es solo una guía**: el patronaje real ajusta las piezas y el
 * rendimiento cambia.
 */
export function calcularArea(
  largoMesaM: number,
  anchoCm: number | null,
  totalMetrosTela: number
): AreaEstimada {
  const vacio: AreaEstimada = { m2: null, tendidas: null, anchoSospechoso: false };
  if (!(largoMesaM > 0)) return vacio;
  if (anchoCm == null || !(anchoCm > 0)) return vacio;
  if (anchoCm < ANCHO_MINIMO_CM) return { ...vacio, anchoSospechoso: true };

  return {
    m2: largoMesaM * (anchoCm / 100),
    tendidas: totalMetrosTela > 0 ? totalMetrosTela / largoMesaM : null,
    anchoSospechoso: false,
  };
}

/** Lee los largos guardados. Nunca lanza: en modo privado localStorage puede fallar. */
export function leerMesas(): MesaCorte[] {
  if (typeof window === "undefined") return MESAS_INICIALES;
  try {
    const crudo = window.localStorage.getItem(CLAVE_MESAS);
    if (!crudo) return MESAS_INICIALES;
    const datos = JSON.parse(crudo) as unknown;
    if (!Array.isArray(datos) || datos.length !== 2) return MESAS_INICIALES;
    return datos.map((m, i) => ({
      nombre: typeof (m as MesaCorte)?.nombre === "string" ? (m as MesaCorte).nombre : MESAS_INICIALES[i].nombre,
      largo: typeof (m as MesaCorte)?.largo === "string" ? (m as MesaCorte).largo : "",
    }));
  } catch {
    return MESAS_INICIALES;
  }
}

/** Guarda los largos. Si falla, se sigue trabajando con lo que haya en pantalla. */
export function guardarMesas(mesas: MesaCorte[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE_MESAS, JSON.stringify(mesas));
  } catch {
    /* sin persistencia, pero la sesión actual sigue funcionando */
  }
}

// ── Tendido por capas ───────────────────────────────────────────────

/**
 * Metros que se pierden en CADA doblez entre una capa y la siguiente: la tela
 * gira para seguir tendiéndose en sentido contrario y ese tramo no se aprovecha.
 * Aproximado.
 */
export const DESPERDICIO_DOBLEZ_M = 0.15;

export interface Tendido {
  /** Capas completas que caben sobre la mesa. */
  capas: number;
  /** Metros de tela que quedan aprovechables: capas × largo de mesa. */
  metrosUsables: number;
  /** Metros perdidos en los dobleces. NO son área aprovechable. */
  desperdicioDobleces: number;
  /** Lo que queda sin usar al final — se va a retazos. */
  sobra: number;
}

/**
 * Cuántas capas completas salen de una pieza de tela sobre una mesa dada.
 *
 * ⚠️ **Son (n − 1) dobleces y no n**, y no es un error: el doblez es la UNIÓN
 * entre dos capas consecutivas, así que con n capas hay n−1 uniones. La primera
 * capa no viene precedida de ningún doblez y la última no va seguida de otro.
 *
 * Ejemplo con 90 m de tela sobre una mesa de 9 m:
 *   · 10 capas pedirían 10×9 + 9×0.15 = 91.35 m  → NO caben en 90
 *   ·  9 capas piden    9×9 + 8×0.15 = 82.20 m  → sí caben
 *   Resultado: 9 capas. Sin contar los dobleces habrían salido 10, y la décima
 *   se habría quedado a medias en la mesa.
 *
 * Despejando `n·L + (n−1)·d ≤ T` queda `n ≤ (T + d) / (L + d)`.
 */
export function calcularTendido(totalMetros: number, largoMesaM: number): Tendido {
  if (!(largoMesaM > 0) || !(totalMetros > 0)) {
    return {
      capas: 0,
      metrosUsables: 0,
      desperdicioDobleces: 0,
      sobra: totalMetros > 0 ? totalMetros : 0,
    };
  }

  // El épsilon evita que un caso exacto (18.15 m sobre mesa de 9 m) se caiga a la
  // capa anterior por el redondeo binario de los decimales.
  const capas = Math.floor(
    (totalMetros + DESPERDICIO_DOBLEZ_M) / (largoMesaM + DESPERDICIO_DOBLEZ_M) + 1e-9
  );
  if (capas <= 0) {
    return { capas: 0, metrosUsables: 0, desperdicioDobleces: 0, sobra: totalMetros };
  }

  const metrosUsables = capas * largoMesaM;
  const desperdicioDobleces = (capas - 1) * DESPERDICIO_DOBLEZ_M;
  return {
    capas,
    metrosUsables,
    desperdicioDobleces,
    // Nunca negativa: por construcción usables + dobleces ≤ totalMetros.
    sobra: Math.max(totalMetros - metrosUsables - desperdicioDobleces, 0),
  };
}
