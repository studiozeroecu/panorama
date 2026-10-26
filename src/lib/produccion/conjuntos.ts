/**
 * Conjuntos (sets) de dos partes — fase 8r.
 *
 * Un conjunto sale de UNA tela y UN corte, pero cada color lleva dos filas: la
 * parte superior y la inferior, que no salen en la misma cantidad (18 blusas y
 * 14 pantalones, por ejemplo). Se marca en la prenda (`es_conjunto`), nunca se
 * deduce del nombre.
 *
 * Un set es siempre de la MISMA talla en las dos partes (decisión del dueño),
 * así que los sets posibles se CALCULAN: el mínimo de las dos partes por talla.
 * No se guardan.
 */

export const PARTES = ["superior", "inferior"] as const;
export type Parte = (typeof PARTES)[number];

export type Tallas = Record<string, number>;

export const NOMBRE_PARTE_GENERICO: Record<Parte, string> = {
  superior: "Parte superior",
  inferior: "Parte inferior",
};

interface ConPartes {
  partes?: { parte: Parte; nombre: string }[] | null;
}

/** "Blusa" si la prenda le puso nombre a la parte; si no, "Parte superior". */
export function nombreParte(prenda: ConPartes | null | undefined, parte: Parte): string {
  const p = prenda?.partes?.find((x) => x.parte === parte);
  return p?.nombre?.trim() || NOMBRE_PARTE_GENERICO[parte];
}

/** "Negro" para una prenda sola; "Negro · Blusa" para una parte de un conjunto. */
export function etiquetaFila(
  color: string,
  parte: Parte | null | undefined,
  prenda?: ConPartes | null
): string {
  return parte ? `${color} · ${nombreParte(prenda, parte)}` : color;
}

/**
 * Sets que se pueden armar con lo que salió de cada parte, talla por talla, y
 * lo que sobra suelto de cada una.
 */
export function setsPosibles(superior: Tallas, inferior: Tallas) {
  const tallas = [...new Set([...Object.keys(superior), ...Object.keys(inferior)])];
  const porTalla: Tallas = {};
  const sobranSuperior: Tallas = {};
  const sobranInferior: Tallas = {};
  let sets = 0;
  for (const t of tallas) {
    const s = Number(superior[t] ?? 0);
    const i = Number(inferior[t] ?? 0);
    const n = Math.min(s, i);
    if (n > 0) porTalla[t] = n;
    if (s - n > 0) sobranSuperior[t] = s - n;
    if (i - n > 0) sobranInferior[t] = i - n;
    sets += n;
  }
  return { sets, porTalla, sobranSuperior, sobranInferior };
}

/**
 * Qué parte de la tela le toca a cada parte del conjunto: según las prendas que
 * salieron × lo que consume cada una (decisión del dueño: "no rinden igual").
 * Si falta el consumo de alguna, se reparte solo por prendas — no se inventa.
 * Devuelve la fracción de la superior (la inferior es 1 − eso).
 */
export function fraccionTelaSuperior(
  unidadesSuperior: number,
  unidadesInferior: number,
  consumoSuperior: number | null | undefined,
  consumoInferior: number | null | undefined
): number {
  const conConsumo = Number(consumoSuperior) > 0 && Number(consumoInferior) > 0;
  const ps = unidadesSuperior * (conConsumo ? Number(consumoSuperior) : 1);
  const pi = unidadesInferior * (conConsumo ? Number(consumoInferior) : 1);
  return ps + pi > 0 ? ps / (ps + pi) : 0.5;
}

/**
 * Lo que cuesta la maquila de un lote entero, fila por fila: cada parte de un
 * conjunto con su precio, y la prenda sola con el de la maquila. Multiplicar un
 * solo precio por el total de prendas daría mal en cuanto hay un conjunto.
 */
export function costoMaquilaLote(m: {
  costo_unitario: number | string;
  colores: { unidades: number; costo_unitario: number | null }[];
}): number {
  return m.colores.reduce(
    (s, c) => s + (c.costo_unitario != null ? Number(c.costo_unitario) : Number(m.costo_unitario)) * Number(c.unidades),
    0
  );
}
