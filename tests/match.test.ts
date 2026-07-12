import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { matchCosto, calcularGanancia, type CostoPrenda } from "@/lib/costos/match";
import { parseWorkbook } from "@/lib/parser";

// Costos con las keywords iniciales de la migración (regla del dueño:
// básica = COLOR ENTERO; estampada = el resto)
const base = {
  nombre_tela: "", costo_tela: 0, maquila: 0, dtf: 0, corte: 0, insumos: 0, etiqueta: 0,
  pvp_vatex: null, precio_online: null, precio_mayoreo_1_2: null,
  precio_mayoreo_3_5: null, precio_mayoreo_6plus: null,
};
const costos: CostoPrenda[] = [
  { ...base, id: "1", producto: "hoddies", costo_total: 10.32, match_keywords: ["HODDIE"] },
  { ...base, id: "2", producto: "hoddie basica", costo_total: 8.02, match_keywords: ["HODDIE", "COLOR ENTERO"] },
  { ...base, id: "3", producto: "camiseta", costo_total: 8.88, match_keywords: ["CAMISETA"] },
  { ...base, id: "4", producto: "camiseta basica", costo_total: 6.58, match_keywords: ["CAMISETA", "COLOR ENTERO"] },
  { ...base, id: "5", producto: "BLUZA (handel)", costo_total: 7.04, match_keywords: [] },
];

describe("matchCosto (regla básica = COLOR ENTERO)", () => {
  it("camiseta color entero → camiseta basica (match más específico gana)", () => {
    expect(matchCosto("CAMISETA MAS C/R COLOR ENTERO VERDE AGUA HOMBRE", costos)?.producto)
      .toBe("camiseta basica");
  });

  it("camiseta estampada → camiseta (estampada)", () => {
    expect(matchCosto("CAMISETA MAS MS0177 SP MD C/R CARICATURAS ROJO UNISEX", costos)?.producto)
      .toBe("camiseta");
  });

  it("hoddie con bolsillo (sin color entero) → hoddies", () => {
    expect(matchCosto("HODDIE MAS MS0168 SP BS BOLSILLO SOBREPUESTO NEGRO UNISEX", costos)?.producto)
      .toBe("hoddies");
  });

  it("sin keywords nunca matchea (ambiguos van por vínculo manual)", () => {
    expect(matchCosto("BLUZA HANDEL NEGRA", costos)).toBeNull();
  });

  it("producto desconocido → null", () => {
    expect(matchCosto("GORRA MAS BASICA ESTAMPADA UNISEX", costos)).toBeNull();
  });
});

describe("calcularGanancia sobre el reporte real de junio", () => {
  const fixture = readFileSync(path.join(__dirname, "fixtures", "libro-muestra-junio.xlsx"));
  const { sales } = parseWorkbook(fixture);

  it("calcula cobertura y ganancia solo sobre líneas con match, sin inventar", () => {
    const r = calcularGanancia(sales, costos, new Map());
    expect(r.netoTotal).toBeCloseTo(4421.98, 1);
    // camisetas y hoddies existen en el reporte real → cobertura parcial > 0
    expect(r.coberturaPct).toBeGreaterThan(10);
    expect(r.coberturaPct).toBeLessThan(100);
    expect(r.netoConCosto).toBeLessThan(r.netoTotal);
    expect(r.lineasSinMatch.length).toBeGreaterThan(0);
    // la ganancia solo puede salir de las líneas cubiertas
    expect(r.gananciaEstimada).toBeLessThan(r.netoConCosto);
  });

  it("un vínculo manual por código tiene prioridad sobre keywords", () => {
    const linea = sales.find((s) => s.descripcion.includes("CAMISETA"))!;
    const conVinculo = calcularGanancia([linea], costos, new Map([[linea.codigo, "5"]]));
    // vinculada a BLUZA (handel) costo 7.04, no al costo de camiseta
    expect(conVinculo.gananciaEstimada).toBeCloseTo(
      Number(linea.neto) - 7.04 * linea.cantidad,
      2
    );
  });
});
