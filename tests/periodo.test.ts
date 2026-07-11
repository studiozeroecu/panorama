import { describe, it, expect } from "vitest";
import { parsePeriodo } from "@/lib/bot/periodo";

const now = new Date("2026-07-11T12:00:00");

describe("parsePeriodo (caption del Excel por Telegram)", () => {
  it("entiende 'd/m al d/m' con año implícito", () => {
    expect(parsePeriodo("1/6 al 30/6", now)).toEqual({ desde: "2026-06-01", hasta: "2026-06-30" });
  });

  it("entiende fechas completas con guion", () => {
    expect(parsePeriodo("01/06/2026 - 15/06/2026", now)).toEqual({
      desde: "2026-06-01",
      hasta: "2026-06-15",
    });
  });

  it("entiende 'del 1/7 a 15/7' con texto alrededor", () => {
    expect(parsePeriodo("reporte del 1/7 a 15/7 quincena", now)).toEqual({
      desde: "2026-07-01",
      hasta: "2026-07-15",
    });
  });

  it("entiende años de dos dígitos", () => {
    expect(parsePeriodo("1/6/26 al 30/6/26", now)).toEqual({
      desde: "2026-06-01",
      hasta: "2026-06-30",
    });
  });

  it("rechaza captions sin rango", () => {
    expect(parsePeriodo("reporte de junio", now)).toBeNull();
    expect(parsePeriodo("", now)).toBeNull();
  });

  it("rechaza rangos invertidos o meses inválidos", () => {
    expect(parsePeriodo("30/6 al 1/6", now)).toBeNull();
    expect(parsePeriodo("1/13 al 30/13", now)).toBeNull();
  });
});
