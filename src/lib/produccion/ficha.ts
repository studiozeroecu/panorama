/**
 * Compositor de la ficha visual de estampado.
 *
 * Dibuja sobre un canvas la prenda de frente y de espalda con los diseños en
 * sus posiciones, y devuelve un PNG listo para mandar por Telegram. La ficha
 * es EFÍMERA: no se guarda en Storage ni en la base — el archivo de verdad
 * queda en el chat del bot, y se busca ahí por la fecha. Por eso la fecha va
 * grande en la cabecera y repetida en el texto del mensaje.
 *
 * Todo se dibuja con Canvas nativo. Las siluetas viven en `public/`, así que
 * son del mismo origen y `toBlob()` nunca falla por contaminación.
 */

import {
  LIENZO,
  encajar,
  posicionesDe,
  recuadrosDe,
  type Lado,
  type Posicion,
  type TipoPrenda,
} from "./posiciones";
import { fmtFecha } from "@/lib/fechas";

export const ANCHO_FICHA = LIENZO.ancho * 2;

const CABECERA = 190;
const PIE_LINEA = 54;
const PIE_PAD = 36;
const MARGEN = 40;

const TINTA = "#1b1f23";
const SUAVE = "#6b7280";
const ACENTO = "#0a72d6";
const TIPOGRAFIA = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface DisenoFicha {
  nombre: string;
  unidades: number;
  /** null mientras no se haya elegido archivo: se dibuja solo el recuadro. */
  imagen: HTMLImageElement | null;
  posicion: Posicion;
  lado: Lado;
}

export interface DatosFicha {
  tipo: TipoPrenda;
  prendaNombre: string;
  color: string;
  totalUnidades: number;
  tallas: Record<string, number>;
  fecha: string;
  taller: string;
  nota: string;
  siluetas: { frente: HTMLImageElement; espalda: HTMLImageElement };
  disenos: DisenoFicha[];
}

/**
 * El alto crece con la cantidad de diseños en vez de recortar la leyenda: una
 * ficha con seis diseños y solo dos visibles sería peor que una ficha larga.
 */
export function altoFicha(numDisenos: number): number {
  return CABECERA + LIENZO.alto + PIE_PAD * 2 + Math.max(1, numDisenos) * PIE_LINEA;
}

/**
 * Carga una imagen y espera a que esté lista.
 *
 * `drawImage` con una imagen a medio cargar pinta en blanco SIN lanzar error,
 * así que nunca se dibuja sin pasar por aquí. Sirve igual para las siluetas
 * (por URL) que para los archivos que sube el usuario (por Blob).
 */
export function cargarImagen(origen: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const url = typeof origen === "string" ? origen : URL.createObjectURL(origen);
    const img = new Image();
    img.onload = () => {
      if (typeof origen !== "string") URL.revokeObjectURL(url);
      resolver(img);
    };
    img.onerror = () => {
      if (typeof origen !== "string") URL.revokeObjectURL(url);
      rechazar(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

export function dibujarFicha(
  ctx: CanvasRenderingContext2D,
  d: DatosFicha,
  opciones: { guias?: boolean } = {}
): void {
  const alto = altoFicha(d.disenos.length);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ANCHO_FICHA, alto);

  cabecera(ctx, d);

  ctx.drawImage(d.siluetas.frente, 0, CABECERA, LIENZO.ancho, LIENZO.alto);
  ctx.drawImage(d.siluetas.espalda, LIENZO.ancho, CABECERA, LIENZO.ancho, LIENZO.alto);
  rotulosVista(ctx);

  if (opciones.guias) guias(ctx, d.tipo);

  d.disenos.forEach((dis, i) => dibujarDiseno(ctx, dis, i + 1));

  pie(ctx, d, alto);
  ctx.restore();
}

/** Exporta el canvas como PNG. Rechaza si el navegador no puede generarlo. */
export function aPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    canvas.toBlob(
      (blob) => (blob ? resolver(blob) : rechazar(new Error("No se pudo generar la imagen."))),
      "image/png"
    );
  });
}

/** Texto del mensaje de Telegram. La fecha va primero: es la clave de búsqueda. */
export function textoFicha(d: DatosFicha): string {
  const tallas = Object.entries(d.tallas)
    .filter(([, v]) => v > 0)
    .map(([t, v]) => `${t}:${v}`)
    .join(" ");
  const lineas = [
    `Ficha de estampado · ${fmtFecha(d.fecha)}`,
    `${d.prendaNombre} · ${d.color} · ${d.totalUnidades} und.`,
    tallas ? `Tallas: ${tallas}` : "",
    d.taller ? `Taller: ${d.taller}` : "",
    "",
    ...d.disenos.map((x, i) => `${i + 1}. ${x.nombre} — ${descripcion(x)} — ${x.unidades} u.`),
    d.nota ? `\n${d.nota}` : "",
  ];
  return lineas.filter(Boolean).join("\n");
}

/** Posición de un diseño en palabras, con el lado cuando es manga. */
export function descripcion(d: DisenoFicha): string {
  if (!d.posicion.esManga) return d.posicion.etiqueta;
  const lado = d.lado === "ambas" ? "las dos mangas" : `manga ${d.lado}`;
  return `${d.posicion.etiqueta} · ${lado}`;
}

// ── Piezas del dibujo ────────────────────────────────────────────────

function cabecera(ctx: CanvasRenderingContext2D, d: DatosFicha): void {
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = SUAVE;
  ctx.font = `600 30px ${TIPOGRAFIA}`;
  ctx.fillText("FICHA DE ESTAMPADO", MARGEN, 58);

  ctx.fillStyle = TINTA;
  ctx.font = `700 56px ${TIPOGRAFIA}`;
  ctx.fillText(recortar(ctx, `${d.prendaNombre} · ${d.color}`, 1240), MARGEN, 118);

  const tallas = Object.entries(d.tallas)
    .filter(([, v]) => v > 0)
    .map(([t, v]) => `${t}:${v}`)
    .join("  ");
  const meta = [`${d.totalUnidades} unidades`, tallas, d.taller ? `Taller: ${d.taller}` : ""]
    .filter(Boolean)
    .join("   ·   ");
  ctx.fillStyle = SUAVE;
  ctx.font = `400 32px ${TIPOGRAFIA}`;
  ctx.fillText(recortar(ctx, meta, 1240), MARGEN, 164);

  // La fecha, a la derecha y grande: es como se busca la ficha en el chat.
  ctx.textAlign = "right";
  ctx.fillStyle = TINTA;
  ctx.font = `700 52px ${TIPOGRAFIA}`;
  ctx.fillText(fmtFecha(d.fecha), ANCHO_FICHA - MARGEN, 118);
  ctx.textAlign = "left";

  linea(ctx, MARGEN, CABECERA - 16, ANCHO_FICHA - MARGEN, CABECERA - 16, "#d9dde3", 3);
}

function rotulosVista(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = SUAVE;
  ctx.font = `600 34px ${TIPOGRAFIA}`;
  ctx.textAlign = "center";
  ctx.fillText("FRENTE", LIENZO.ancho / 2, CABECERA + LIENZO.alto - 26);
  ctx.fillText("ESPALDA", LIENZO.ancho * 1.5, CABECERA + LIENZO.alto - 26);
  ctx.textAlign = "left";
  linea(ctx, LIENZO.ancho, CABECERA + 30, LIENZO.ancho, CABECERA + LIENZO.alto - 60, "#e6e9ee", 3);
}

function dibujarDiseno(ctx: CanvasRenderingContext2D, d: DisenoFicha, numero: number): void {
  const dx = d.posicion.vista === "espalda" ? LIENZO.ancho : 0;
  for (const r of recuadrosDe(d.posicion, d.lado)) {
    // Sin imagen todavía, el recuadro es lo único que comunica la posición.
    if (!d.imagen) punteado(ctx, dx + r.x, CABECERA + r.y, r.ancho, r.alto, ACENTO);
    else {
      const e = encajar(r, d.imagen.naturalWidth, d.imagen.naturalHeight);
      ctx.drawImage(d.imagen, dx + e.x, CABECERA + e.y, e.ancho, e.alto);
    }
    insignia(ctx, dx + r.x, CABECERA + r.y, numero);
  }
}

/** Todas las posiciones del catálogo, para calibrar a ojo. */
function guias(ctx: CanvasRenderingContext2D, tipo: TipoPrenda): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const pos of posicionesDe(tipo)) {
    const dx = pos.vista === "espalda" ? LIENZO.ancho : 0;
    for (const r of recuadrosDe(pos, "ambas")) {
      punteado(ctx, dx + r.x, CABECERA + r.y, r.ancho, r.alto, "#9aa3ad");
    }
  }
  ctx.restore();
}

function pie(ctx: CanvasRenderingContext2D, d: DatosFicha, alto: number): void {
  const y0 = CABECERA + LIENZO.alto;
  linea(ctx, MARGEN, y0 + 8, ANCHO_FICHA - MARGEN, y0 + 8, "#d9dde3", 3);

  if (!d.disenos.length) {
    ctx.fillStyle = SUAVE;
    ctx.font = `400 34px ${TIPOGRAFIA}`;
    ctx.fillText("Sin diseños colocados todavía.", MARGEN, y0 + PIE_PAD + 40);
    return;
  }

  d.disenos.forEach((dis, i) => {
    const y = y0 + PIE_PAD + i * PIE_LINEA + 34;
    insignia(ctx, MARGEN, y - 30, i + 1, false);
    ctx.fillStyle = TINTA;
    ctx.font = `600 34px ${TIPOGRAFIA}`;
    ctx.fillText(recortar(ctx, dis.nombre || "Sin nombre", 520), MARGEN + 64, y);
    ctx.fillStyle = SUAVE;
    ctx.font = `400 32px ${TIPOGRAFIA}`;
    ctx.fillText(
      recortar(ctx, `${descripcion(dis)}   ·   ${dis.unidades} u.`, 1280),
      MARGEN + 620,
      y
    );
  });

  if (d.nota) {
    ctx.fillStyle = SUAVE;
    ctx.font = `italic 400 30px ${TIPOGRAFIA}`;
    ctx.fillText(recortar(ctx, d.nota, ANCHO_FICHA - MARGEN * 2), MARGEN, alto - 18);
  }
}

// ── Utilidades de dibujo ─────────────────────────────────────────────

function insignia(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  numero: number,
  flotante = true
): void {
  const r = 26;
  const cx = flotante ? x - 4 : x + r;
  const cy = flotante ? y - 4 : y + r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ACENTO;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 30px ${TIPOGRAFIA}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(numero), cx, cy + 1);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function punteado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  color: string
): void {
  ctx.save();
  ctx.setLineDash([12, 9]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, ancho, alto);
  ctx.restore();
}

function linea(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  grosor: number
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = grosor;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Recorta con puntos suspensivos para que un nombre largo no invada el resto. */
function recortar(ctx: CanvasRenderingContext2D, texto: string, maxAncho: number): string {
  if (ctx.measureText(texto).width <= maxAncho) return texto;
  let t = texto;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxAncho) t = t.slice(0, -1);
  return t + "…";
}
