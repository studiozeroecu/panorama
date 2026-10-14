import { describe, it, expect } from "vitest";
import { validarAnchoCm, textoRecepcionCortadora } from "@/lib/produccion/recepcion";

describe("validarAnchoCm", () => {
  it("acepta un ancho normal en cm, con coma o punto", () => {
    expect(validarAnchoCm("150")).toEqual({ cm: 150 });
    expect(validarAnchoCm("152,5")).toEqual({ cm: 152.5 });
    expect(validarAnchoCm(" 180.5 ")).toEqual({ cm: 180.5 });
  });

  it("rechaza un ancho en metros — el error de unidad que ya ensucia la base", () => {
    const r = validarAnchoCm("1.5");
    expect("error" in r && r.error).toMatch(/centímetros/);
  });

  it("los bordes coinciden con fn_recibir_tela: 10 y 400 entran, fuera no", () => {
    expect(validarAnchoCm("10")).toEqual({ cm: 10 });
    expect(validarAnchoCm("400")).toEqual({ cm: 400 });
    expect("error" in validarAnchoCm("9.99")).toBe(true);
    expect("error" in validarAnchoCm("1500")).toBe(true);
  });

  it("rechaza vacío y texto", () => {
    expect("error" in validarAnchoCm("")).toBe(true);
    expect("error" in validarAnchoCm("abc")).toBe(true);
  });
});

describe("textoRecepcionCortadora", () => {
  it("no dice nada si la recibió Mateo o si es anterior a la fase", () => {
    expect(textoRecepcionCortadora({ recibido_por_rol: "admin", ancho_recibido: 150, ancho_real: 150 })).toBeNull();
    expect(textoRecepcionCortadora({ recibido_por_rol: null, ancho_recibido: null, ancho_real: 150 })).toBeNull();
  });

  it("muestra el ancho que midió ella", () => {
    expect(textoRecepcionCortadora({ recibido_por_rol: "cortadora", ancho_recibido: "150.00", ancho_real: "150.00" }))
      .toBe("Recibido por la cortadora · ancho 150 cm");
  });

  it("si Mateo corrigió el ancho, no le atribuye a ella el número nuevo", () => {
    expect(textoRecepcionCortadora({ recibido_por_rol: "cortadora", ancho_recibido: 150, ancho_real: 152.5 }))
      .toBe("Recibido por la cortadora · ancho 150 cm (corregido a 152.5 cm)");
  });
});
