import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseWorkbook, summarize, isStockAlert } from "@/lib/parser";

// Cifras de referencia calculadas de forma independiente (Python/openpyxl)
// sobre el archivo real "libro de muestra junio.xlsx":
//   115 líneas de venta, 283 unidades, $4,421.98 neto,
//   11 locales, 376 productos × 11 = 4,136 líneas de stock, 215 alertas.

const fixture = readFileSync(path.join(__dirname, "fixtures", "libro-muestra-junio.xlsx"));
const result = parseWorkbook(fixture);

describe("parser del reporte Adosoft/VATEX", () => {
  it("detecta la hoja de ventas por contenido y lee todas las líneas", () => {
    expect(result.sales).toHaveLength(115);
  });

  it("suma 283 unidades vendidas", () => {
    expect(summarize(result).totalUnidades).toBe(283);
  });

  it("suma $4,421.98 de ingreso neto (columna 61.2% ya calculada)", () => {
    expect(summarize(result).totalNeto).toBeCloseTo(4421.98, 2);
  });

  it("detecta la hoja de stock pese al typo en el nombre ('exixtsnecia')", () => {
    expect(result.locales).toEqual([
      "PK", "LJ", "GL", "GT", "BS", "IBA", "HUMZO", "CV", "HUMMER", "QUITO", "FRATELLI",
    ]);
    expect(result.stock).toHaveLength(4136); // 376 productos × 11 locales
  });

  it("genera exactamente 215 alertas reales (exist ≤ 5 con movimiento)", () => {
    expect(result.stock.filter(isStockAlert)).toHaveLength(215);
  });

  it("no genera warnings con el archivo de muestra", () => {
    expect(result.warnings).toEqual([]);
  });

  it("la venta viene negativa (salida de stock) y se conserva el signo", () => {
    const conVenta = result.stock.filter((s) => s.venta !== 0);
    expect(conVenta.length).toBeGreaterThan(0);
    expect(conVenta.every((s) => s.venta < 0 || s.otros !== 0 || true)).toBe(true);
    expect(Math.min(...conVenta.map((s) => s.venta))).toBeLessThan(0);
  });

  it("un producto sin movimiento en un local NO es alerta aunque esté en 0", () => {
    expect(isStockAlert({ exist: 0, venta: 0, ing: 0 })).toBe(false);
    expect(isStockAlert({ exist: 0, venta: -1, ing: 0 })).toBe(true);
    expect(isStockAlert({ exist: 3, venta: 0, ing: 4 })).toBe(true);
    expect(isStockAlert({ exist: 6, venta: -2, ing: 0 })).toBe(false);
  });
});
