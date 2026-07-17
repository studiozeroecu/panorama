import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  matchCategoria,
  calcularGanancia,
  type CostoPrenda,
  type CategoriaCosto,
} from "@/lib/costos/match";
import { parseWorkbook } from "@/lib/parser";

const base = {
  nombre_tela: "", costo_tela: 0, maquila: 0, dtf: 0, corte: 0, insumos: 0, etiqueta: 0,
  pvp_vatex: null, precio_online: null, precio_mayoreo_1_2: null,
  precio_mayoreo_3_5: null, precio_mayoreo_6plus: null,
  match_keywords: [] as string[], match_excluir: [] as string[],
};
const costos: CostoPrenda[] = [
  { ...base, id: "c-hoddies", producto: "hoddies", costo_total: 10.32 },
  { ...base, id: "c-hoddie-b", producto: "hoddie basica", costo_total: 8.02 },
  { ...base, id: "c-camiseta", producto: "camiseta", costo_total: 8.88 },
  { ...base, id: "c-camiseta-b", producto: "camiseta basica", costo_total: 6.58 },
  { ...base, id: "c-cuello", producto: "cuello chino", costo_total: 7.42 },
  { ...base, id: "c-mujer", producto: "pant mujer", costo_total: 8.6 },
];

// Las 6 reglas del dueño, con prioridad explícita (menor = primero)
const categorias: CategoriaCosto[] = [
  { id: "1", nombre: "Cuello chino / Buzo", prioridad: 10, incluir: ["CUELLO CHINO|BUZO"], excluir: [], costo_id: "c-cuello" },
  { id: "2", nombre: "Sudadera básica", prioridad: 20, incluir: ["HODDIE|SUDADERA", "BASICA|COLOR ENTERO"], excluir: [], costo_id: "c-hoddie-b" },
  { id: "3", nombre: "Sudadera estampada", prioridad: 30, incluir: ["HODDIE|SUDADERA"], excluir: ["BASICA", "COLOR ENTERO"], costo_id: "c-hoddies" },
  { id: "4", nombre: "Camiseta básica", prioridad: 40, incluir: ["CAMISETA", "BASICA|COLOR ENTERO"], excluir: [], costo_id: "c-camiseta-b" },
  { id: "5", nombre: "Camiseta estampada", prioridad: 50, incluir: ["CAMISETA"], excluir: ["BASICA", "COLOR ENTERO"], costo_id: "c-camiseta" },
  { id: "6", nombre: "Ropa mujer", prioridad: 60, incluir: ["MUJER|CONJUNTO|PANTALON|BLUZA|BLUSA"], excluir: [], costo_id: "c-mujer" },
];

const cat = (desc: string) => matchCategoria(desc, categorias)?.nombre ?? null;

describe("matchCategoria — las reglas exactas del dueño", () => {
  it("HODDIE sin básica → Sudadera estampada; SUDADERA también activa", () => {
    expect(cat("HODDIE MAS MS0168 SP BS BOLSILLO SOBREPUESTO NEGRO UNISEX")).toBe("Sudadera estampada");
    expect(cat("SUDADERA CAPUCHA ESTAMPADO ROJO")).toBe("Sudadera estampada");
  });

  it("HODDIE + BASICA o COLOR ENTERO → Sudadera básica", () => {
    expect(cat("HODDIE BASICA NEGRA")).toBe("Sudadera básica");
    expect(cat("HODDIE MAS C/R COLOR ENTERO CAFE UNISEX")).toBe("Sudadera básica");
  });

  it("CAMISETA estampada vs básica", () => {
    expect(cat("CAMISETA MAS MS0177 SP MD C/R CARICATURAS ROJO UNISEX")).toBe("Camiseta estampada");
    expect(cat("CAMISETA MAS C/R COLOR ENTERO VERDE AGUA HOMBRE")).toBe("Camiseta básica");
  });

  it("PRIORIDAD: CUELLO CHINO le gana a CAMISETA aunque contenga ambas", () => {
    expect(cat("CAMISETA CUELLO CHINO NEGRA HOMBRE")).toBe("Cuello chino / Buzo");
    expect(cat("BUZO MAS FLEECE GRIS")).toBe("Cuello chino / Buzo");
  });

  it("Ropa mujer: MUJER, CONJUNTO, PANTALON o BLUZA", () => {
    expect(cat("PALAZZO MAS PINZAS MOSTAZA MUJER")).toBe("Ropa mujer");
    expect(cat("CONJUNTO PANTALON NAYARA BEIGE")).toBe("Ropa mujer");
    expect(cat("BLUSA MANGA LARGA CREMA")).toBe("Ropa mujer");
  });

  it("matiz: CAMISETA ... MUJER es Camiseta (prioridad 50 < 60), no Ropa mujer", () => {
    expect(cat("CAMISETA ESTAMPADA ROSA MUJER")).toBe("Camiseta estampada");
  });

  it("todo lo demás → Sin categoría (null)", () => {
    expect(cat("GORRA MAS BASICA ESTAMPADA UNISEX")).toBeNull();
    expect(cat("BUCKET HAT MAS TIE DYE UNISEX")).toBeNull();
  });
});

describe("calcularGanancia por categorías sobre el reporte real de junio", () => {
  const fixture = readFileSync(path.join(__dirname, "fixtures", "libro-muestra-junio.xlsx"));
  const { sales } = parseWorkbook(fixture);

  it("automático, agrupado por categoría, sin bloquear por lo no clasificado", () => {
    const r = calcularGanancia(sales, costos, categorias, new Map());
    expect(r.netoTotal).toBeCloseTo(4421.98, 1);
    expect(r.coberturaPct).toBeGreaterThan(30); // hoddies+camisetas+mujer cubren buena parte
    expect(r.coberturaPct).toBeLessThan(100); // gorras, bucket hats, etc. quedan fuera
    const nombres = r.porCategoria.map((g) => g.nombre);
    expect(nombres).toContain("Sin categoría");
    expect(nombres.some((n) => n.startsWith("Camiseta") || n.startsWith("Sudadera"))).toBe(true);
    // la suma por grupos cuadra con el total
    const sumaNeto = r.porCategoria.reduce((s, g) => s + g.neto, 0);
    expect(sumaNeto).toBeCloseTo(r.netoTotal, 1);
  });

  it("el vínculo manual por código sigue teniendo prioridad", () => {
    const linea = sales.find((s) => s.descripcion.includes("CAMISETA"))!;
    const r = calcularGanancia([linea], costos, categorias, new Map([[linea.codigo, "c-cuello"]]));
    expect(r.gananciaEstimada).toBeCloseTo(Number(linea.neto) - 7.42 * linea.cantidad, 2);
    expect(r.porCategoria[0].nombre).toBe("(manual) cuello chino");
  });
});
