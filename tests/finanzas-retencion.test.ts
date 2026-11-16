import { describe, it, expect } from "vitest";
import { calcularRetencion, textoRetencion } from "@/lib/finanzas/retencion";

describe("retenciones al cobrar una factura", () => {
  it("$1.000 + IVA 15%, renta 1,75% e IVA 30%", () => {
    const r = calcularRetencion({ subtotal: 1000, ivaPct: 15, rentaPct: 1.75, retIvaPct: 30 });
    expect(r).toEqual({ subtotal: 1000, iva: 150, total: 1150, retRenta: 17.5, retIva: 45, aRecibir: 1087.5 });
  });

  it("cada valor se redondea a centavos por separado", () => {
    const r = calcularRetencion({ subtotal: 333.33, ivaPct: 15, rentaPct: 1.75, retIvaPct: 30 });
    expect(r.iva).toBe(50); // 49,9995
    expect(r.retRenta).toBe(5.83); // 5,833
    expect(r.retIva).toBe(15);
    expect(r.aRecibir).toBe(362.5); // 383,33 − 5,83 − 15
  });

  it("sin IVA y sin retención de IVA", () => {
    const r = calcularRetencion({ subtotal: 500, ivaPct: 0, rentaPct: 2, retIvaPct: 0 });
    expect([r.total, r.retRenta, r.retIva, r.aRecibir]).toEqual([500, 10, 0, 490]);
  });

  it("el texto para las notas lleva todo el desglose", () => {
    const r = calcularRetencion({ subtotal: 1000, ivaPct: 15, rentaPct: 1.75, retIvaPct: 30 });
    expect(textoRetencion(r, 1.75, 30)).toBe(
      "Retención: factura $1.150,00 (subtotal $1.000,00 + IVA $150,00) − renta 1,75% $17,50 − IVA 30% $45,00 = a recibir $1.087,50"
    );
  });
});
