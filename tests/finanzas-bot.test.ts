import { describe, it, expect } from "vitest";
import { rangoUuidPorPrefijo } from "@/lib/finanzas/ids";
import { seleccionarUrgencias, etiquetaUrgencia } from "@/lib/finanzas/alertas";
import { textoAgenda, htmlAgenda, esc } from "@/lib/finanzas/textos";
import { armarAgenda } from "@/lib/finanzas/agenda";
import { quincenaDe } from "@/lib/finanzas/periodos";
import type { Cheque, Deuda } from "@/lib/finanzas/tipos";

const HOY = "2026-10-14";

function cheque(p: Partial<Cheque> & Pick<Cheque, "id" | "monto">): Cheque {
  return {
    tipo: "por_pagar",
    medio: "cheque",
    beneficiario: "X",
    banco: "",
    numero: "",
    fecha_original: p.fecha_cobro ?? null,
    fecha_cobro: null,
    reprogramado: false,
    estado: "pendiente",
    fecha_pago: null,
    cuenta_por_pagar_id: null,
    deuda_proveedor: null,
    deuda_concepto: null,
    deuda_exigibilidad: null,
    categoria_efectiva: "otros",
    ambito_efectivo: "empresa",
    alertado_hasta: null,
    notas: "",
    ...p,
  };
}

const deudaAnulada = { id: "dA", anulada: true } as Deuda;

describe("buscar cheque por id corto (la base no deja usar like sobre uuid)", () => {
  it("convierte el prefijo en un rango de uuid", () => {
    expect(rangoUuidPorPrefijo("a1b2c3d4")).toEqual({
      desde: "a1b2c3d4-0000-0000-0000-000000000000",
      hasta: "a1b2c3d4-ffff-ffff-ffff-ffffffffffff",
    });
  });

  it("acepta mayúsculas, guiones y el id completo", () => {
    expect(rangoUuidPorPrefijo("A1B2C3D4-E5")).toEqual({
      desde: "a1b2c3d4-e500-0000-0000-000000000000",
      hasta: "a1b2c3d4-e5ff-ffff-ffff-ffffffffffff",
    });
    const completo = "123e4567-e89b-42d3-a456-426614174000";
    expect(rangoUuidPorPrefijo(completo)).toEqual({ desde: completo, hasta: completo });
  });

  it("el uuid buscado queda dentro del rango (orden de texto = orden de uuid)", () => {
    const id = "a1b2c3d4-9f00-4abc-8def-0123456789ab";
    const r = rangoUuidPorPrefijo(id.slice(0, 8))!;
    expect(id >= r.desde && id <= r.hasta).toBe(true);
    expect("a1b2c3d5-0000-4000-8000-000000000000" > r.hasta).toBe(true);
  });

  it("rechaza ids muy cortos o con caracteres raros (evita traer todo)", () => {
    expect(rangoUuidPorPrefijo("a1b2")).toBeNull();
    expect(rangoUuidPorPrefijo("cheque902")).toBeNull();
    expect(rangoUuidPorPrefijo("")).toBeNull();
  });
});

describe("alerta diaria: qué se avisa", () => {
  const datos = {
    deudas: [deudaAnulada],
    chequesAbiertos: [
      cheque({ id: "venc", monto: 100, fecha_cobro: "2026-10-10" }),
      cheque({ id: "hoy", monto: 50, fecha_cobro: HOY }),
      cheque({ id: "en2", monto: 70, fecha_cobro: "2026-10-16" }),
      cheque({ id: "en3", monto: 80, fecha_cobro: "2026-10-17" }), // justo fuera: menos de 3 días
      cheque({ id: "silenciado", monto: 90, fecha_cobro: "2026-10-12", alertado_hasta: "2026-10-20" }),
      cheque({ id: "silencio_vencido", monto: 60, fecha_cobro: "2026-10-12", alertado_hasta: "2026-10-13" }),
      cheque({ id: "sinfecha", monto: 40, fecha_cobro: null }),
      cheque({ id: "rebote", monto: 250, fecha_cobro: "2026-11-01", estado: "rebotado" }),
      cheque({ id: "deAnulada", monto: 999, fecha_cobro: HOY, cuenta_por_pagar_id: "dA" }),
      cheque({ id: "cobrar", monto: 500, fecha_cobro: HOY, tipo: "por_cobrar" }),
    ],
  };

  it("avisa lo que vence en menos de 3 días o ya venció, y no está silenciado", () => {
    const u = seleccionarUrgencias(datos, HOY);
    expect(u.pagos.map((c) => c.id)).toEqual(["venc", "silencio_vencido", "hoy", "en2"]);
  });

  it("rebotados van aparte (también con silencio)", () => {
    const u = seleccionarUrgencias(datos, HOY);
    expect(u.rebotados.map((c) => c.id)).toEqual(["rebote"]);
    const silenciado = seleccionarUrgencias(
      { ...datos, chequesAbiertos: [cheque({ id: "r", monto: 1, estado: "rebotado", alertado_hasta: "2026-10-30" })] },
      HOY
    );
    expect(silenciado.rebotados).toEqual([]);
  });

  it("nunca avisa cheques por cobrar ni pagos de deudas anuladas", () => {
    const u = seleccionarUrgencias(datos, HOY);
    const ids = [...u.pagos, ...u.rebotados].map((c) => c.id);
    expect(ids).not.toContain("cobrar");
    expect(ids).not.toContain("deAnulada");
  });

  it("etiquetas", () => {
    expect(etiquetaUrgencia("2026-10-10", HOY)).toBe("🔴 VENCIDO");
    expect(etiquetaUrgencia(HOY, HOY)).toBe("🔴 vence HOY");
    expect(etiquetaUrgencia("2026-10-16", HOY)).toBe("🟠 vence pronto");
  });
});

describe("textos del bot", () => {
  const datos = {
    deudas: [],
    chequesAbiertos: [
      cheque({ id: "a", monto: 250, fecha_cobro: "2026-10-15", deuda_proveedor: "PAT <PRIMO>", numero: "902" }),
      cheque({ id: "b", monto: 100, fecha_cobro: "2026-10-12", ambito_efectivo: "personal", beneficiario: "TARJETA" }),
      cheque({ id: "r", monto: 300, fecha_cobro: "2026-10-13", estado: "rebotado", beneficiario: "REBOTE" }),
    ],
    chequesPagados: [],
    movimientos: [],
  };
  const agenda = armarAgenda(datos, quincenaDe(HOY), { hoy: HOY });

  it("texto para Claude: total del periodo sin sumar el rebotado, que va aparte", () => {
    const t = textoAgenda(agenda);
    expect(t).toContain("A PAGAR en el periodo: $350,00 en 2 pagos (empresa $250,00, personal $100,00)");
    expect(t).toContain("CHEQUES REBOTADOS (no se suman a lo de arriba; hay que resolverlos): $300,00");
    expect(t).toContain("VENCIDO");
    expect(t).toContain("#902");
  });

  it("HTML para Telegram escapa nombres con < > &", () => {
    const h = htmlAgenda(agenda, "Pagos de la quincena");
    expect(h).toContain("PAT &lt;PRIMO&gt;");
    expect(h).not.toContain("<PRIMO>");
    expect(esc("A & B")).toBe("A &amp; B");
  });
});
