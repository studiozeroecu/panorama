import { describe, it, expect } from "vitest";
import {
  lineasFeria,
  resumenFeria,
  problemasCierre,
  retornosParaBase,
  vendidasPorTalla,
  type RetornoFeria,
} from "@/lib/produccion/ferias";
import type { IngresoFeria } from "@/lib/produccion/types";

const ingreso = (id: string, tallas: Record<string, number>, costo: number, extra: Partial<IngresoFeria> = {}): IngresoFeria => ({
  id,
  feria_id: "f",
  fecha: "2026-10-27",
  origen: "envio",
  entrega_id: null,
  maquila_id: null,
  prenda_id: null,
  prenda_nombre: "Camiseta",
  color: "Negro",
  estampado: "",
  tallas,
  unidades: Object.values(tallas).reduce((s, n) => s + n, 0),
  costo_unitario: costo,
  ...extra,
});

const BASICA = ingreso("a", { S: 4, M: 2 }, 11);
const ESTANCADA = ingreso("b", { M: 3 }, 12, { origen: "estancada", prenda_nombre: "Jean viejo", color: "Azul" });

describe("lo vendido sale de restar", () => {
  const retornos: RetornoFeria[] = [
    { id: "r1", feria_id: "f", ingreso_id: "a", fecha: "", destino: "bodega", tallas: { S: 1 }, unidades: 1, costo_unitario: 6 },
    { id: "r2", feria_id: "f", ingreso_id: "a", fecha: "", destino: "local", tallas: { M: 2 }, unidades: 2, costo_unitario: 8.5 },
  ];

  it("por línea: fueron − regresaron, y su costo", () => {
    const [a, b] = lineasFeria([BASICA, ESTANCADA], retornos);
    expect(a).toMatchObject({ fueron: 6, regresaron: 3, vendidas: 3, costoVendido: 33 });
    expect(b).toMatchObject({ fueron: 3, regresaron: 0, vendidas: 3, costoVendido: 36 });
  });

  it("el resumen de la feria", () => {
    expect(resumenFeria(lineasFeria([BASICA, ESTANCADA], retornos))).toEqual({
      fueron: 9,
      regresaron: 3,
      vendidas: 6,
      costoEnviado: 102,
      costoVendido: 69,
    });
  });
});

describe("cierre", () => {
  it("vendidas por talla y sin problemas si cuadra", () => {
    const form = { a: { bodega: { S: "1" }, local: { M: "2" } } };
    expect(vendidasPorTalla(BASICA, form)).toEqual({ S: 3, M: 0 });
    expect(problemasCierre([BASICA, ESTANCADA], form)).toEqual([]);
  });

  it("no puede regresar más de lo que fue", () => {
    const form = { a: { bodega: { S: "3" }, local: { S: "2" } } };
    expect(problemasCierre([BASICA], form)).toEqual(["Camiseta Negro, talla S: regresan 1 más de las que fueron."]);
  });

  it("solo viajan las líneas que tienen regresos", () => {
    const form = { a: { bodega: { S: "1", M: "" }, local: {} }, b: { bodega: {}, local: { M: "0" } } };
    expect(retornosParaBase(form)).toEqual([{ ingreso_id: "a", bodega: { S: 1 }, local: {} }]);
  });
});
