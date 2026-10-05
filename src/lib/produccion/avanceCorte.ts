/**
 * ¿Ya se cortó esta tela? — criterio de la pantalla de la cortadora.
 *
 * Antes era solo el saldo de metros (`total_metros − Σ metros_consumidos`). Pero
 * los metros usados son OPCIONALES al registrar un corte: si se dejan en blanco,
 * `metros_consumidos` queda null, cuenta 0, el saldo no baja nunca y la tela se
 * queda para siempre en "Por cortar" aunque ya esté cortada.
 *
 * Ahora una tela está cortada si se cumple CUALQUIERA de las dos:
 *   · todos los colores del pedido aparecen en algún corte, o
 *   · hay metros registrados y el saldo es <= 0.5 m.
 *
 * Una tela se puede cortar en varias tandas (Negro hoy, Crudo mañana): sigue
 * pendiente hasta que estén todos sus colores. El saldo se sigue mostrando, como
 * dato, pero ya no es el único criterio.
 */

/** Margen del saldo: por debajo de medio metro ya no da para nada. */
export const SALDO_MINIMO_M = 0.5;

export interface ColorDePedido {
  id?: string | null;
  color: string;
}

export interface ColorDeCorte {
  pedido_color_id?: string | null;
  color: string;
}

export interface CorteParaAvance {
  metros_consumidos: number | string | null;
  colores: ColorDeCorte[] | null;
}

export interface AvanceCorte {
  /** Colores del pedido que ya salieron en algún corte. */
  cortados: string[];
  /** Colores del pedido que todavía no se han cortado. */
  faltan: string[];
  /** Algún corte trae metros: solo entonces el saldo significa algo. */
  hayMetros: boolean;
  /** total − Σ metros registrados. Con `hayMetros` falso es el total entero. */
  saldo: number;
  listo: boolean;
}

/** Mismo criterio que el índice único de prod_pedido_colores: lower(btrim(color)). */
export function normalizarColor(c: string): string {
  return c.trim().toLowerCase();
}

export function avanceCorte(
  totalMetros: number | string,
  coloresPedido: ColorDePedido[],
  cortes: CorteParaAvance[]
): AvanceCorte {
  const ids = new Set<string>();
  const nombres = new Set<string>();
  let consumido = 0;
  let hayMetros = false;

  for (const c of cortes) {
    if (c.metros_consumidos != null) {
      hayMetros = true;
      consumido += Number(c.metros_consumidos);
    }
    for (const col of c.colores ?? []) {
      // El id es la referencia fuerte; el nombre, el respaldo para los cortes
      // cuyo color no se pudo enlazar (pedido_color_id null, p. ej. migrados).
      if (col.pedido_color_id) ids.add(col.pedido_color_id);
      else nombres.add(normalizarColor(col.color));
    }
  }

  const cortados: string[] = [];
  const faltan: string[] = [];
  for (const pc of coloresPedido) {
    const hecho = (pc.id != null && ids.has(pc.id)) || nombres.has(normalizarColor(pc.color));
    (hecho ? cortados : faltan).push(pc.color);
  }

  const saldo = Number(totalMetros) - consumido;
  // Un pedido sin colores no puede darse por cortado "porque no falta ninguno".
  const todosLosColores = coloresPedido.length > 0 && faltan.length === 0;
  const listo = todosLosColores || (hayMetros && saldo <= SALDO_MINIMO_M);

  return { cortados, faltan, hayMetros, saldo, listo };
}
