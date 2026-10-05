/**
 * Comparación entre lo que la corrida predice y lo que la cortadora dice que
 * salió de verdad — fase 8j, pieza 4 de docs/plan_cortadora.md.
 *
 * Es **informativo, nunca bloqueante**: el corte real manda sobre la teoría. Una
 * manga mal cortada, una falla de la tela o una capa que no se pudo tender son
 * razones legítimas para que no cuadre, y el sistema no está para discutirlas.
 *
 * Todo esto es cálculo puro y vive en el cliente a propósito: no hay nada que
 * proteger de la concurrencia. Lo que acaba guardándose son las cantidades ya
 * ajustadas, que `fn_registrar_corte` valida como siempre contra el saldo de
 * tela. Lo único que necesita la base es recordar `capas` y `corrida_base` en el
 * corte, para poder reconstruir esta comparación meses después.
 */

export type Severidad = "exacto" | "leve" | "alto";

export interface DescuadreTalla {
  talla: string;
  esperado: number;
  real: number;
  diferencia: number;
}

export interface Descuadre {
  esperado: number;
  real: number;
  diferencia: number;
  severidad: Severidad;
  /** null cuando cuadra exacto: no hay nada que decir. */
  mensaje: string | null;
  porTalla: DescuadreTalla[];
}

/**
 * Hasta aquí se considera desviación normal del tendido. Por encima, el aviso
 * sube de tono: no es un error, pero merece una segunda mirada antes de guardar.
 */
const TOLERANCIA_RELATIVA = 0.05;
/** Con cifras pequeñas el porcentaje engaña: 1 de 6 ya es un 17%. */
const TOLERANCIA_ABSOLUTA = 2;

/** Unidades que la corrida predice para una talla con `capas` capas. */
export function esperadoPorTalla(
  corrida: Record<string, number> | null | undefined,
  capas: number
): Record<string, number> {
  if (!corrida || !(capas > 0)) return {};
  const out: Record<string, number> = {};
  for (const [talla, porCapa] of Object.entries(corrida)) {
    const n = Number(porCapa);
    if (n > 0) out[talla] = n * Math.floor(capas);
  }
  return out;
}

/**
 * Compara lo esperado contra lo real, talla por talla y en total.
 *
 * La severidad mira el total y no cada talla: a la cortadora le importa si el
 * corte entero se desvió, y una talla de más compensada con otra de menos es un
 * reparto distinto, no una pérdida.
 */
export function compararConCorrida(
  corrida: Record<string, number> | null | undefined,
  capas: number,
  real: Record<string, number>
): Descuadre {
  const esperadoMap = esperadoPorTalla(corrida, capas);
  const tallas = [...new Set([...Object.keys(esperadoMap), ...Object.keys(real)])];

  const porTalla = tallas
    .map((talla) => {
      const esperado = esperadoMap[talla] ?? 0;
      const r = Number(real[talla] ?? 0);
      return { talla, esperado, real: r, diferencia: r - esperado };
    })
    .filter((x) => x.esperado > 0 || x.real > 0);

  const esperado = porTalla.reduce((s, x) => s + x.esperado, 0);
  const realTotal = porTalla.reduce((s, x) => s + x.real, 0);
  const diferencia = realTotal - esperado;

  // Sin corrida o sin capas no hay nada contra qué comparar: no es un descuadre
  // de cero, es que la pregunta no aplica.
  if (esperado === 0) {
    return {
      esperado: 0, real: realTotal, diferencia: 0,
      severidad: "exacto", mensaje: null, porTalla,
    };
  }

  const absoluta = Math.abs(diferencia);
  const severidad: Severidad =
    diferencia === 0
      ? "exacto"
      : absoluta <= TOLERANCIA_ABSOLUTA || absoluta / esperado <= TOLERANCIA_RELATIVA
        ? "leve"
        : "alto";

  return {
    esperado, real: realTotal, diferencia, severidad,
    mensaje: mensajeDe(severidad, diferencia, esperado),
    porTalla,
  };
}

/** El aviso sube de tono con la desviación, en vez de ser un sí/no. */
function mensajeDe(severidad: Severidad, diferencia: number, esperado: number): string | null {
  if (severidad === "exacto") return null;
  const n = Math.abs(diferencia);
  const unidades = `${n} unidad${n === 1 ? "" : "es"}`;
  const pct = Math.round((n / esperado) * 100);
  const signo = diferencia > 0 ? "más" : "menos";

  return severidad === "leve"
    ? `Salieron ${unidades} ${signo} de lo esperado. Diferencia normal del tendido.`
    : `Salieron ${unidades} ${signo} de lo esperado (${pct}% del total). Revisa las cantidades antes de guardar.`;
}

// ── Por color ───────────────────────────────────────────────────────

export interface DescuadreColor extends Descuadre {
  color: string;
  capas: number;
}

export interface DescuadreCorte {
  /** Uno por color: es donde está la señal accionable. */
  porColor: DescuadreColor[];
  /** Suma de todos los colores. Solo resumen — ver la nota de abajo. */
  totalEsperado: number;
  totalReal: number;
}

/**
 * Compara color por color. La corrida es UNA para toda la tela, pero las capas
 * son de cada color: las telas no llegan con el metraje exacto por color y uno
 * puede dar más tendidos que otro.
 *
 * ⚠️ **El aviso útil es el de cada color, no el total.** Un total que sume todos
 * los colores puede salir en cero teniendo dos tendidos mal: Negro con 8 de más
 * y Crudo con 8 de menos se compensan y el corte parecería exacto. El descuadre
 * lo causa algo físico en el tendido de UN color concreto, y promediarlo entre
 * colores borra justo el dato que hace falta para ir a mirar.
 *
 * Por eso `porColor` lleva su propio mensaje y el total se queda en cifras, sin
 * severidad ni aviso.
 */
export function compararCorte(
  corrida: Record<string, number> | null | undefined,
  colores: { color: string; capas: number; real: Record<string, number> }[]
): DescuadreCorte {
  const porColor = colores.map((c) => ({
    color: c.color,
    capas: c.capas,
    ...compararConCorrida(corrida, c.capas, c.real),
  }));

  return {
    porColor,
    totalEsperado: porColor.reduce((s, c) => s + c.esperado, 0),
    totalReal: porColor.reduce((s, c) => s + c.real, 0),
  };
}
