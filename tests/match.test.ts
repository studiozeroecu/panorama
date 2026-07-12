import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { matchCosto, calcularGanancia, type CostoPrenda } from "@/lib/costos/match";
import { parseWorkbook } from "@/lib/parser";

// Reglas por categoría (lógica del dueño): "HODDIE sin BASICA → estampada".
// Los reportes reales escriben la básica como "COLOR ENTERO" → alternativas con "|".
const base = {
  nombre_tela: "", costo_tela: 0, maquila: 0, dtf: 0, corte: 0, insumos: 0, etiqueta: 0,
  pvp_vatex: null, precio_online: null, precio_mayoreo_1_2: null,
  precio_mayoreo_3_5: null, precio_mayoreo_6plus: null,
};
const costos: CostoPrenda[] = [
  { ...base, id: "1", producto: "hoddies", costo_total: 10.32,
    match_keywords: ["HODDIE"], match_excluir: ["BASICA", "COLOR ENTERO"] },
  { ...base, id: "2", producto: "hoddie basica", costo_total: 8.02,
    match_keywords: ["HODDIE", "BASICA|COLOR ENTERO"], match_excluir: [] },
  { ...base, id: "3", producto: "camiseta", costo_total: 8.88,
    match_keywords: ["CAMISETA"], match_excluir: ["BASICA", "COLOR ENTERO"] },
  { ...base, id: "4", producto: "camiseta basica", costo_total: 6.58,
    match_keywords: ["CAMISETA", "BASICA|COLOR ENTERO"], match_excluir: [] },
  { ...base, id: "5", producto: "BLUZA (handel)", costo_total: 7.04,
    match_keywords: [], match_excluir: [] },
];

describe("matchCosto por categorías (incluye/excluye + alternativas)", () => {
  it("HODDIE sin BASICA ni COLOR ENTERO → hoddies estampadas", () => {
    expect(matchCosto("HODDIE MAS MS0168 SP BS BOLSILLO SOBREPUESTO NEGRO UNISEX", costos)?.producto)
      .toBe("hoddies");
  });

  it("HODDIE + BASICA → hoddie basica (y la exclusión saca a 'hoddies')", () => {
    expect(matchCosto("HODDIE BASICA NEGRA MUJER", costos)?.producto).toBe("hoddie basica");
  });

  it("la alternativa COLOR ENTERO también activa la básica (reportes reales)", () => {
    expect(matchCosto("CAMISETA MAS C/R COLOR ENTERO VERDE AGUA HOMBRE", costos)?.producto)
      .toBe("camiseta basica");
    expect(matchCosto("HODDIE MAS C/R COLOR ENTERO CAFE UNISEX", costos)?.producto)
      .toBe("hoddie basica");
  });

  it("CAMISETA estampada (sin básica) → camiseta", () => {
    expect(matchCosto("CAMISETA MAS MS0177 SP MD C/R CARICATURAS ROJO UNISEX", costos)?.producto)
      .toBe("camiseta");
  });

  it("sin keywords nunca matchea; producto desconocido → sin categoría", () => {
    expect(matchCosto("BLUZA HANDEL NEGRA", costos)).toBeNull();
    expect(matchCosto("GORRA MAS BASICA ESTAMPADA UNISEX", costos)).toBeNull();
  });
});

describe("calcularGanancia sobre el reporte real de junio", () => {
  const fixture = readFileSync(path.join(__dirname, "fixtures", "libro-muestra-junio.xlsx"));
  const { sales } = parseWorkbook(fixture);

  it("las líneas sin categoría no bloquean el cálculo del resto", () => {
    const r = calcularGanancia(sales, costos, new Map());
    expect(r.netoTotal).toBeCloseTo(4421.98, 1);
    expect(r.coberturaPct).toBeGreaterThan(10);
    expect(r.coberturaPct).toBeLessThan(100);
    expect(r.lineasSinMatch.length).toBeGreaterThan(0);
    expect(r.gananciaEstimada).toBeLessThan(r.netoConCosto);
  });

  it("el vínculo manual por código sigue teniendo prioridad (corrección puntual)", () => {
    const linea = sales.find((s) => s.descripcion.includes("CAMISETA"))!;
    const conVinculo = calcularGanancia([linea], costos, new Map([[linea.codigo, "5"]]));
    expect(conVinculo.gananciaEstimada).toBeCloseTo(Number(linea.neto) - 7.04 * linea.cantidad, 2);
  });
});
