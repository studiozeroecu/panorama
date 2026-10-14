/**
 * Catálogo de posiciones de estampado sobre las siluetas de `public/siluetas/`.
 *
 * Vive en código y no en una tabla a propósito: las coordenadas solo tienen
 * sentido contra un dibujo concreto. Si mañana cambia la proporción de una
 * silueta, un dato guardado en la base quedaría mal en silencio — el mismo
 * patrón de fallo que tuvo el jsonb de colores. Aquí el dibujo y sus
 * coordenadas viajan juntos en el mismo commit, y `tests/posiciones.test.ts`
 * comprueba que ninguna se salga del lienzo.
 *
 * Izquierda y derecha son SIEMPRE las de quien usa la prenda. En la vista
 * frontal eso quiere decir que el pecho izquierdo se dibuja a la DERECHA del
 * lienzo. Es la convención de confección y la que usa el taller.
 */

export const LIENZO = { ancho: 1000, alto: 1200 } as const;

export type TipoPrenda = "camiseta" | "sudadera" | "buso";
export type Vista = "frente" | "espalda";
export type Lado = "izquierda" | "derecha" | "ambas";

export const TIPOS_PRENDA: { tipo: TipoPrenda; etiqueta: string }[] = [
  { tipo: "camiseta", etiqueta: "Camiseta" },
  { tipo: "sudadera", etiqueta: "Sudadera" },
  { tipo: "buso", etiqueta: "Buso" },
];

export const ACLARACION_LADOS =
  "Izquierda y derecha son las de quien usa la prenda.";

/**
 * Sugiere el tipo a partir del nombre de la prenda. Es solo una sugerencia:
 * `prod_prendas` no guarda el tipo y los nombres reales son libres y
 * desparejos ("camiseta basica", "Hoddie mujer", "Enteriso mujer blusa"), así
 * que acertar siempre no es posible. Quien arma la ficha siempre puede
 * cambiarlo.
 */
export function adivinarTipo(nombrePrenda: string): TipoPrenda {
  const n = nombrePrenda
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  // "hoddie" está escrito así en la base — es un dato real, no una errata aquí.
  if (/sudader|hoodie|hoddie|hodie|capuch/.test(n)) return "sudadera";
  if (/buso|buzo|sweater|sueter/.test(n)) return "buso";
  return "camiseta";
}

export interface Recuadro {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface Posicion {
  id: string;
  etiqueta: string;
  vista: Vista;
  /** Las mangas piden lado; el resto de zonas no. */
  esManga: boolean;
  /**
   * En las mangas, el recuadro de la manga IZQUIERDA de quien la usa (a la
   * derecha del lienzo). El de la otra manga sale por espejo — ver `espejo()`.
   */
  recuadro: Recuadro;
}

/** Ruta del archivo de silueta. Same-origin: el canvas nunca se contamina. */
export function rutaSilueta(tipo: TipoPrenda, vista: Vista): string {
  return `/siluetas/${tipo}-${vista}.svg`;
}

/**
 * Posiciones del torso. Son idénticas en las tres prendas porque las tres
 * siluetas comparten lienzo y escala de cuerpo — esa es justamente la razón
 * de haberlas dibujado así. Los recuadros caben tanto en el cuerpo de la
 * camiseta (x 288–712) como en el de sudadera y buso (x 302–698).
 */
const TORSO: Posicion[] = [
  p("pecho_izq:pequeno", "Pecho izquierdo · pequeño", "frente", 540, 320, 120),
  p("pecho_izq:mediano", "Pecho izquierdo · mediano", "frente", 495, 300, 200),
  p("pecho_der:pequeno", "Pecho derecho · pequeño", "frente", 340, 320, 120),
  p("pecho_der:mediano", "Pecho derecho · mediano", "frente", 305, 300, 200),

  p("pecho_centro:pequeno:arriba", "Pecho centrado · pequeño · arriba", "frente", 440, 300, 120),
  p("pecho_centro:pequeno:medio", "Pecho centrado · pequeño · medio", "frente", 440, 420, 120),
  p("pecho_centro:pequeno:abajo", "Pecho centrado · pequeño · abajo", "frente", 440, 540, 120),
  p("pecho_centro:mediano:arriba", "Pecho centrado · mediano · arriba", "frente", 390, 290, 220),
  p("pecho_centro:mediano:medio", "Pecho centrado · mediano · medio", "frente", 390, 430, 220),
  p("pecho_centro:mediano:abajo", "Pecho centrado · mediano · abajo", "frente", 390, 570, 220),

  p("espalda_centro:mediano:arriba", "Espalda centrada · mediana · arriba", "espalda", 370, 300, 260),
  p("espalda_centro:mediano:medio", "Espalda centrada · mediana · medio", "espalda", 370, 450, 260),
  p("espalda_centro:mediano:abajo", "Espalda centrada · mediana · abajo", "espalda", 370, 600, 260),
  p("espalda_centro:grande:arriba", "Espalda centrada · grande · arriba", "espalda", 310, 290, 380),
  p("espalda_centro:grande:medio", "Espalda centrada · grande · medio", "espalda", 310, 420, 380),
  p("espalda_centro:grande:abajo", "Espalda centrada · grande · abajo", "espalda", 310, 560, 380),
];

/**
 * Las mangas son lo único que cambia de una prenda a otra, porque es lo único
 * cuya geometría cambia de verdad: la camiseta es de manga corta y por eso NO
 * tiene antebrazo — no existe la parte de la prenda donde estamparlo.
 */
const MANGAS: Record<TipoPrenda, Posicion[]> = {
  camiseta: [manga("manga_hombro", "Manga · hombro", 715, 350, 85)],
  sudadera: [
    manga("manga_hombro", "Manga · hombro", 690, 440, 82),
    manga("manga_antebrazo", "Manga · antebrazo", 712, 640, 100),
  ],
  buso: [
    manga("manga_hombro", "Manga · hombro", 690, 440, 82),
    manga("manga_antebrazo", "Manga · antebrazo", 712, 640, 100),
  ],
};

export function posicionesDe(tipo: TipoPrenda): Posicion[] {
  const frente = TORSO.filter((x) => x.vista === "frente");
  const espalda = TORSO.filter((x) => x.vista === "espalda");
  return [...frente, ...MANGAS[tipo], ...espalda];
}

export function posicionPorId(tipo: TipoPrenda, id: string): Posicion | undefined {
  return posicionesDe(tipo).find((x) => x.id === id);
}

/** Refleja un recuadro sobre el eje vertical del lienzo. */
export function espejo(r: Recuadro): Recuadro {
  return { ...r, x: LIENZO.ancho - r.x - r.ancho };
}

/**
 * Recuadros donde hay que dibujar un diseño. Devuelve dos solo en las mangas
 * con lado "ambas".
 *
 * Lo que se refleja es el RECUADRO, nunca el dibujo: voltear la imagen dejaría
 * el texto de un logo al revés en una de las dos mangas.
 */
export function recuadrosDe(pos: Posicion, lado: Lado): Recuadro[] {
  if (!pos.esManga) return [pos.recuadro];
  if (lado === "izquierda") return [pos.recuadro];
  if (lado === "derecha") return [espejo(pos.recuadro)];
  return [pos.recuadro, espejo(pos.recuadro)];
}

/**
 * Encaja una imagen dentro del recuadro sin deformarla, centrada.
 *
 * `drawImage` con seis argumentos ESTIRA hasta llenar el destino, así que sin
 * esto un logo cuadrado metido en un recuadro ancho saldría aplastado — y en
 * una ficha que va al taller eso es un error que nadie nota hasta que la
 * prenda está estampada.
 */
export function encajar(r: Recuadro, anchoImg: number, altoImg: number): Recuadro {
  if (anchoImg <= 0 || altoImg <= 0) return r;
  const escala = Math.min(r.ancho / anchoImg, r.alto / altoImg);
  const ancho = anchoImg * escala;
  const alto = altoImg * escala;
  return {
    x: r.x + (r.ancho - ancho) / 2,
    y: r.y + (r.alto - alto) / 2,
    ancho,
    alto,
  };
}

function p(id: string, etiqueta: string, vista: Vista, x: number, y: number, lado: number): Posicion {
  return { id, etiqueta, vista, esManga: false, recuadro: { x, y, ancho: lado, alto: lado } };
}

function manga(id: string, etiqueta: string, x: number, y: number, lado: number): Posicion {
  return { id, etiqueta, vista: "frente", esManga: true, recuadro: { x, y, ancho: lado, alto: lado } };
}
