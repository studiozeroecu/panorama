import { describe, it, expect } from "vitest";
import { pendientesPorTalla, sumaTallas, etapaMaquila } from "@/lib/produccion/entregas";

const CORTADO = { S: 5, M: 5, L: 2 };

describe("pendientesPorTalla", () => {
  it("sin entregas falta todo lo cortado", () => {
    expect(pendientesPorTalla(CORTADO, [])).toEqual(CORTADO);
  });

  it("descuenta varias entregas parciales talla por talla", () => {
    const falta = pendientesPorTalla(CORTADO, [
      { tallas: { S: 3 }, unidades: 3 },
      { tallas: { S: 1, M: 5 }, unidades: 6 },
    ]);
    expect(falta).toEqual({ S: 1, L: 2 });
    expect(sumaTallas(falta)).toBe(3);
  });

  it("completo = objeto vacío", () => {
    expect(pendientesPorTalla(CORTADO, [{ tallas: CORTADO, unidades: 12 }])).toEqual({});
  });

  it("acepta cantidades que llegan como texto desde la base", () => {
    expect(
      pendientesPorTalla({ S: 5 }, [{ tallas: { S: "2" as unknown as number }, unidades: 2 }])
    ).toEqual({ S: 3 });
  });
});

describe("etapaMaquila", () => {
  it("distingue por enviar, en maquila, parcial y entregado", () => {
    expect(etapaMaquila("pendiente", [])).toBe("por_enviar");
    expect(etapaMaquila("enviado", [])).toBe("en_maquila");
    expect(etapaMaquila("enviado", [{ tallas: { S: 1 }, unidades: 1 }])).toBe("parcial");
    expect(etapaMaquila("entregado", [{ tallas: { S: 1 }, unidades: 1 }])).toBe("entregado");
  });
});
