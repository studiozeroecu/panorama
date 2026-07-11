import * as XLSX from "xlsx";

/**
 * Parser del reporte Adosoft/VATEX.
 * Lógica portada del prototipo HTML validado:
 *  - Detección de hojas por CONTENIDO de encabezados, no por nombre
 *    (los nombres traen typos reales, ej. "exixtsnecia por local").
 *  - Hoja de ventas: encabezado fijo en fila 1 (Codigo, Descripcion,
 *    cantidad, PVP, ..., "PRECIO TOTAL 61.2%").
 *  - Hoja de stock: doble encabezado — fila 1 nombre de local cada 4
 *    columnas, fila 2 subencabezados Ing/Venta/Otros/Exist.
 */

export interface SalesLine {
  codigo: string;
  descripcion: string;
  cantidad: number;
  pvp: number;
  /** "PRECIO TOTAL 61.2%": ingreso neto post-comisión VATEX, ya calculado en el reporte. */
  neto: number | null;
}

export interface StockLine {
  codigo: string;
  descripcion: string;
  local: string;
  ing: number;
  venta: number; // negativa = salida por venta
  otros: number;
  exist: number;
}

export interface ParseResult {
  sales: SalesLine[];
  stock: StockLine[];
  locales: string[];
  warnings: string[];
}

type Row = (string | number | null)[];

function norm(s: unknown): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function looksLikeSales(rows: Row[]): boolean {
  if (!rows.length || !rows[0]) return false;
  const h = rows[0].map(norm);
  return h.some((x) => x.includes("pvp")) && h.some((x) => x.includes("cantidad"));
}

function looksLikeStock(rows: Row[]): boolean {
  const h = (rows[1] || []).map(norm);
  return h.some((x) => x.includes("exist")) && h.some((x) => x.includes("venta"));
}

function findCol(
  headerRow: Row,
  keywords: string[],
  opts: { exclude?: string[] } = {}
): number {
  const normH = headerRow.map(norm);
  for (let i = 0; i < normH.length; i++) {
    const cell = normH[i];
    if (!cell) continue;
    const matches = keywords.every((k) => cell.includes(k));
    const excluded = (opts.exclude || []).some((k) => cell.includes(k));
    if (matches && !excluded) return i;
  }
  return -1;
}

function parseSalesSheet(rows: Row[], warnings: string[]): SalesLine[] {
  const header = rows[0];
  const idxCodigo = findCol(header, ["codigo"]);
  const idxDesc = findCol(header, ["descripcion"]);
  const idxCant = findCol(header, ["cantidad"]);
  const idxPvp = findCol(header, ["pvp"]);
  let idxNeto = findCol(header, ["61.2"]);
  if (idxNeto === -1) {
    idxNeto = findCol(header, ["precio", "total"], { exclude: ["sin iva", "61.2"] });
    if (idxNeto !== -1) {
      warnings.push(
        'La hoja de ventas no trae la columna "PRECIO TOTAL 61.2%"; se usó "PRECIO TOTAL" como aproximación del neto.'
      );
    } else {
      warnings.push(
        "No se encontró columna de ingreso neto en la hoja de ventas; el neto quedará vacío."
      );
    }
  }
  if (idxCodigo === -1 || idxCant === -1) {
    warnings.push("La hoja de ventas no tiene columnas reconocibles de código/cantidad.");
    return [];
  }

  const sales: SalesLine[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row[idxCodigo] == null || norm(row[idxCodigo]) === "") continue;
    sales.push({
      codigo: String(row[idxCodigo]).trim(),
      descripcion: String(row[idxDesc] ?? "").trim(),
      cantidad: Number(row[idxCant]) || 0,
      pvp: Number(row[idxPvp]) || 0,
      neto: idxNeto >= 0 ? Number(row[idxNeto]) || 0 : null,
    });
  }
  return sales;
}

function parseStockSheet(
  rows: Row[],
  warnings: string[]
): { stock: StockLine[]; locales: string[] } {
  const nameRow = rows[0];
  const subRow = rows[1] || [];
  const localCols: { name: string; start: number }[] = [];
  for (let i = 0; i < nameRow.length; i++) {
    const v = nameRow[i];
    if (v != null && String(v).trim()) {
      localCols.push({ name: String(v).trim(), start: i });
    }
  }
  // Verifica que cada local tenga sus 4 subcolumnas esperadas
  for (const l of localCols) {
    const sub = [subRow[l.start], subRow[l.start + 1], subRow[l.start + 2], subRow[l.start + 3]].map(norm);
    if (!sub[0].includes("ing") || !sub[1].includes("venta") || !sub[3].includes("exist")) {
      warnings.push(
        `El local "${l.name}" no tiene los subencabezados esperados (Ing/Venta/Otros/Exist); revisa el archivo.`
      );
    }
  }

  const stock: StockLine[] = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row[0] == null || norm(row[0]) === "") continue;
    const codigo = String(row[0]).trim();
    const descripcion = String(row[1] ?? "").trim();
    for (const l of localCols) {
      stock.push({
        codigo,
        descripcion,
        local: l.name,
        ing: Number(row[l.start]) || 0,
        venta: Number(row[l.start + 1]) || 0,
        otros: Number(row[l.start + 2]) || 0,
        exist: Number(row[l.start + 3]) || 0,
      });
    }
  }
  return { stock, locales: localCols.map((l) => l.name) };
}

/** Parsea el libro completo (ArrayBuffer o Buffer del .xlsx). */
export function parseWorkbook(data: ArrayBuffer | Buffer): ParseResult {
  const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(data);
  const wb = XLSX.read(data, { type: isBuffer ? "buffer" : "array", cellDates: false });
  const result: ParseResult = { sales: [], stock: [], locales: [], warnings: [] };

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null });
    if (!rows.length) continue;

    // Contenido primero; el nombre de hoja solo desempata cuando ambos podrían aplicar.
    if (!result.sales.length && looksLikeSales(rows)) {
      result.sales = parseSalesSheet(rows, result.warnings);
    } else if (!result.stock.length && looksLikeStock(rows)) {
      const { stock, locales } = parseStockSheet(rows, result.warnings);
      result.stock = stock;
      result.locales = locales;
    }
  }

  if (!result.sales.length) {
    result.warnings.push("No se detectó una hoja de ventas (resumen) en el archivo.");
  }
  if (!result.stock.length) {
    result.warnings.push("No se detectó una hoja de existencia por local en el archivo.");
  }
  return result;
}

/**
 * Alertas de stock: existencia baja (≤5) Y movimiento real en el periodo
 * (venta negativa o ingreso positivo). Este filtro es el validado en el
 * prototipo: evita las falsas alertas de productos que nunca rotaron en
 * ese local (3,256 → 215 alertas reales).
 */
export const STOCK_ALERT_THRESHOLD = 5;

export function isStockAlert(line: Pick<StockLine, "exist" | "venta" | "ing">): boolean {
  return line.exist <= STOCK_ALERT_THRESHOLD && (line.venta < 0 || line.ing > 0);
}

export interface SnapshotSummary {
  totalUnidades: number;
  totalNeto: number;
  numAlertas: number;
  numProductosVendidos: number;
}

export function summarize(result: ParseResult): SnapshotSummary {
  return {
    totalUnidades: result.sales.reduce((s, x) => s + x.cantidad, 0),
    totalNeto: result.sales.reduce((s, x) => s + (x.neto ?? 0), 0),
    numAlertas: result.stock.filter(isStockAlert).length,
    numProductosVendidos: result.sales.length,
  };
}
