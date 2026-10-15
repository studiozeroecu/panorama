import { describe, it, expect } from "vitest";
import { repartirCuotas, parsePlazos, plazosCada, validarCuotas } from "@/lib/finanzas/cuotas";
import { leerTodo, ErrorCarga } from "@/lib/finanzas/cargar";

describe("reparto de cuotas", () => {
  it("Pat Primo: $1.000 en 4 cheques a 30/60/90/120 días desde la factura", () => {
    const c = repartirCuotas({ total: 1000, plazosDias: [30, 60, 90, 120], fechaBase: "2026-10-01", numeroInicial: "901" });
    expect(c.map((x) => x.monto)).toEqual([250, 250, 250, 250]);
    expect(c.map((x) => x.fecha)).toEqual(["2026-10-31", "2026-11-30", "2026-12-30", "2027-01-29"]);
    expect(c.map((x) => x.numero)).toEqual(["901", "902", "903", "904"]);
    expect(c.every((x) => x.medio === "cheque")).toBe(true);
  });

  it("los centavos que sobran van a la ÚLTIMA cuota", () => {
    expect(repartirCuotas({ total: 1000, plazosDias: [30, 60, 90], fechaBase: "2026-10-01" }).map((x) => x.monto))
      .toEqual([333.33, 333.33, 333.34]);
    expect(repartirCuotas({ total: 100, plazosDias: [1, 2, 3, 4, 5, 6], fechaBase: "2026-10-01" }).map((x) => x.monto))
      .toEqual([16.66, 16.66, 16.66, 16.66, 16.66, 16.7]);
    expect(repartirCuotas({ total: 0.05, plazosDias: [1, 2], fechaBase: "2026-10-01" }).map((x) => x.monto))
      .toEqual([0.02, 0.03]);
  });

  it("siempre suma exacto al total", () => {
    for (const total of [1, 99.99, 685.71, 1234.56, 10000.01]) {
      for (let n = 1; n <= 12; n++) {
        const c = repartirCuotas({ total, plazosDias: plazosCada(30, n), fechaBase: "2026-10-01" });
        const cent = c.reduce((s, x) => s + Math.round(x.monto * 100), 0);
        expect(cent).toBe(Math.round(total * 100));
      }
    }
  });

  it("número de cheque no numérico: solo en la primera", () => {
    const c = repartirCuotas({ total: 100, plazosDias: [30, 60], fechaBase: "2026-10-01", numeroInicial: "A-1" });
    expect(c.map((x) => x.numero)).toEqual(["A-1", ""]);
  });

  it("sin plazos o total en cero no genera nada", () => {
    expect(repartirCuotas({ total: 100, plazosDias: [], fechaBase: "2026-10-01" })).toEqual([]);
    expect(repartirCuotas({ total: 0, plazosDias: [30], fechaBase: "2026-10-01" })).toEqual([]);
  });

  it("lee los plazos escritos de varias formas", () => {
    expect(parsePlazos("30/60/90/120")).toEqual([30, 60, 90, 120]);
    expect(parsePlazos("30, 60 ,90")).toEqual([30, 60, 90]);
    expect(parsePlazos("0")).toEqual([0]);
    expect(parsePlazos("30/abc")).toBeNull();
    expect(parsePlazos("")).toBeNull();
    expect(plazosCada(15, 3)).toEqual([15, 30, 45]);
  });
});

describe("validación igual que la base", () => {
  const c =(montos: number[]) => montos.map((monto) => ({ monto, fecha: "2026-11-01" }));

  it("firme: deben sumar exacto", () => {
    expect(validarCuotas({ monto: 1000, exigibilidad: "firme", esSaldoInicial: false, cuotas: c([250, 250, 250, 250]) })).toBeNull();
    expect(validarCuotas({ monto: 1000, exigibilidad: "firme", esSaldoInicial: false, cuotas: c([250, 250, 250, 249]) }))
      .toMatch(/sumar exacto/);
  });

  it("nunca pueden pasarse del total", () => {
    expect(validarCuotas({ monto: 100, exigibilidad: "flexible", esSaldoInicial: false, cuotas: c([60, 50]) }))
      .toMatch(/pasarse del total/);
  });

  it("flexible puede quedar por debajo", () => {
    expect(validarCuotas({ monto: 5000, exigibilidad: "flexible", esSaldoInicial: false, cuotas: c([200]) })).toBeNull();
    expect(validarCuotas({ monto: 5000, exigibilidad: "flexible", esSaldoInicial: false, cuotas: [] })).toBeNull();
  });

  it("firme nueva sin pagos no; firme anterior a octubre sin pagos sí (informativa)", () => {
    expect(validarCuotas({ monto: 300, exigibilidad: "firme", esSaldoInicial: false, cuotas: [] })).toMatch(/al menos un pago/);
    expect(validarCuotas({ monto: 300, exigibilidad: "firme", esSaldoInicial: true, cuotas: [] })).toBeNull();
  });

  it("cada pago necesita monto y fecha", () => {
    expect(validarCuotas({ monto: 100, exigibilidad: "firme", esSaldoInicial: false, cuotas: [{ monto: 100, fecha: "" }] }))
      .toMatch(/fecha/);
    expect(validarCuotas({ monto: 100, exigibilidad: "firme", esSaldoInicial: false, cuotas: [{ monto: 0, fecha: "2026-11-01" }] }))
      .toMatch(/mayor a 0/);
  });

  it("no se confunde con decimales (0.1 + 0.2)", () => {
    expect(validarCuotas({ monto: 0.3, exigibilidad: "firme", esSaldoInicial: false, cuotas: c([0.1, 0.2]) })).toBeNull();
  });
});

describe("lectura por páginas", () => {
  const filas = Array.from({ length: 2345 }, (_, i) => ({ i }));

  it("trae todo aunque haya más de 1000 filas", async () => {
    const r = await leerTodo("x", async (a, b) => ({ data: filas.slice(a, b + 1), error: null }));
    expect(r).toHaveLength(2345);
  });

  it("no se salta filas si el servidor devuelve menos de lo pedido por página", async () => {
    const r = await leerTodo("x", async (a, b) => ({ data: filas.slice(a, Math.min(b + 1, a + 500)), error: null }));
    expect(r).toHaveLength(2345);
    expect(r[1999]).toEqual({ i: 1999 });
  });

  it("si una página falla, lanza error con mensaje para la pantalla", async () => {
    let llamadas = 0;
    await expect(
      leerTodo("las deudas", async (a, b) => {
        llamadas++;
        return llamadas === 2 ? { data: null, error: { message: "timeout" } } : { data: filas.slice(a, b + 1), error: null };
      })
    ).rejects.toThrow(ErrorCarga);
    await expect(
      leerTodo("las deudas", async () => ({ data: null, error: { message: "timeout" } }))
    ).rejects.toThrow("No se pudo cargar las deudas (timeout) — los totales no son confiables.");
  });
});
