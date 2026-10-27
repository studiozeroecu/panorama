import { describe, it, expect } from "vitest";
import {
  faltaPorTalla,
  problemasReparto,
  completarConOnline,
  tallasEstampado,
  repartoParaBase,
  type RepartoForm,
  type DisenoReparto,
} from "@/lib/produccion/reparto";

const LLEGO = { S: 10, M: 15 };

const vacio = (activos: RepartoForm["activos"]): RepartoForm => ({
  activos,
  online: {},
  local: {},
  feria: {},
  disenos: [{ nombre: "", tallas: {} }],
});

describe("faltaPorTalla", () => {
  it("sin repartir falta todo lo que llegó", () => {
    expect(faltaPorTalla(LLEGO, vacio(["online"]))).toEqual(LLEGO);
  });

  it("cuadra con cuatro destinos a la vez", () => {
    const f: RepartoForm = {
      activos: ["online", "estampado", "local", "feria"],
      online: { S: "2", M: "5" },
      local: { M: "2" },
      feria: { S: "4" },
      disenos: [
        { nombre: "Logo", tallas: { S: "4", M: "4" } },
        { nombre: "Oso", tallas: { M: "4" } },
      ],
    };
    expect(faltaPorTalla(LLEGO, f)).toEqual({ S: 0, M: 0 });
    expect(problemasReparto(LLEGO, f)).toEqual([]);
  });

  it("un destino desmarcado no cuenta aunque tenga números", () => {
    const f = { ...vacio(["online"]), online: { S: "10", M: "15" }, feria: { S: "4" } };
    expect(faltaPorTalla(LLEGO, f)).toEqual({ S: 0, M: 0 });
  });

  it("una talla que no llegó aparece como sobrante", () => {
    const f = { ...vacio(["online"]), online: { S: "10", M: "15", L: "1" } };
    expect(faltaPorTalla(LLEGO, f)).toEqual({ S: 0, M: 0, L: -1 });
    expect(problemasReparto(LLEGO, f)).toEqual(["Talla L: repartiste 1 de más."]);
  });
});

describe("problemasReparto", () => {
  it("pide marcar un destino", () => {
    expect(problemasReparto(LLEGO, vacio([]))).toEqual(["Marca al menos un destino."]);
  });

  it("dice qué falta en cada talla", () => {
    const f = { ...vacio(["online"]), online: { S: "8", M: "15" } };
    expect(problemasReparto(LLEGO, f)).toEqual(["Talla S: faltan 2 por repartir."]);
  });

  it("un destino marcado sin unidades es un error", () => {
    const f = { ...vacio(["online", "feria"]), online: { S: "10", M: "15" } };
    expect(problemasReparto(LLEGO, f)).toEqual(["Feria está marcado pero no tiene unidades."]);
  });

  it("diseño sin nombre o sin unidades", () => {
    const f: RepartoForm = {
      ...vacio(["estampado"]),
      disenos: [
        { nombre: "", tallas: { S: "10" } },
        { nombre: "Oso", tallas: {} },
        { nombre: "Logo", tallas: { M: "15" } },
      ],
    };
    expect(problemasReparto(LLEGO, f)).toEqual([
      "Hay un diseño con unidades pero sin nombre.",
      'El diseño "Oso" no tiene unidades.',
    ]);
  });
});

describe("completarConOnline", () => {
  it("online = lo que no se fue a otro destino", () => {
    const f = { ...vacio(["online", "feria"]), online: { S: "1", M: "3" }, feria: { S: "4", M: "15" } };
    expect(completarConOnline(LLEGO, f)).toEqual({ S: "6" });
  });

  it("con nada repartido, todo va al online", () => {
    expect(completarConOnline(LLEGO, vacio([]))).toEqual({ S: "10", M: "15" });
  });
});

describe("repartoParaBase", () => {
  it("suma el estampado por talla y descarta filas vacías", () => {
    const disenos: DisenoReparto[] = [
      { nombre: "Logo", tallas: { S: "4", M: "4" } },
      { nombre: "Oso", tallas: { M: "4", L: "0" } },
      { nombre: " ", tallas: {} },
    ];
    expect(tallasEstampado(disenos)).toEqual({ S: 4, M: 8 });
    const r = repartoParaBase({ ...vacio(["estampado"]), disenos });
    expect(r.disenos).toEqual([
      { nombre: "Logo", tallas: { S: 4, M: 4 } },
      { nombre: "Oso", tallas: { M: 4 } },
    ]);
    expect(r.online).toBeNull();
  });
});
