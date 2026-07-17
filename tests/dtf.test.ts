import { describe, it, expect } from "vitest";
import { calcularLoteDtf } from "@/lib/dtf/calculo";

describe("cálculo de lotes DTF (ceil separado claros/oscuros)", () => {
  it("el ejemplo del dueño: 20 claras + 20 oscuras, 4/metro a $8 = 10 m, $80", () => {
    const r = calcularLoteDtf({ unidades_claras: 20, unidades_oscuras: 20, por_metro: 4, precio_metro: 8 });
    expect(r.metros_claros).toBe(5);
    expect(r.metros_oscuros).toBe(5);
    expect(r.metros).toBe(10);
    expect(r.valor_total).toBe(80);
    expect(r.valor_unitario).toBe(2);
    expect(r.capacidad).toBe(40);
  });

  it("el ceil es por separado: 5 claras + 5 oscuras a 4/metro = 2+2 = 4 m (no 3)", () => {
    const r = calcularLoteDtf({ unidades_claras: 5, unidades_oscuras: 5, por_metro: 4, precio_metro: 8 });
    expect(r.metros_claros).toBe(2);
    expect(r.metros_oscuros).toBe(2);
    expect(r.metros).toBe(4); // ceil(10/4)=3 sería incorrecto: no comparten metro
  });

  it("solo un lado: 7 oscuras a 3/metro = 3 m oscuros, 0 claros", () => {
    const r = calcularLoteDtf({ unidades_claras: 0, unidades_oscuras: 7, por_metro: 3, precio_metro: 6.5 });
    expect(r.metros_claros).toBe(0);
    expect(r.metros_oscuros).toBe(3);
    expect(r.valor_total).toBe(19.5);
  });

  it("entradas inválidas no rompen", () => {
    expect(calcularLoteDtf({ unidades_claras: 0, unidades_oscuras: 0, por_metro: 4, precio_metro: 8 }).metros).toBe(0);
    expect(calcularLoteDtf({ unidades_claras: 10, unidades_oscuras: 0, por_metro: 0, precio_metro: 8 }).metros).toBe(0);
  });
});
