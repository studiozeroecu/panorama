import { describe, it, expect } from "vitest";
import {
  basicosDestino,
  completarConBodega,
  costoSalida,
  faltaPorTalla,
  formVacio,
  problemasReparto,
  repartoParaBase,
  type RepartoForm,
  type GrupoForm,
  grupoVacio,
  formDeEntrega,
  completarGrupoConBodega,
} from "@/lib/produccion/reparto";

const LLEGO = { S: 10, M: 15 };

const con = (activos: RepartoForm["activos"], cambios: Partial<RepartoForm> = {}): RepartoForm => ({
  ...formVacio(activos),
  ...cambios,
});

describe("faltaPorTalla", () => {
  it("sin repartir falta todo lo que llegó", () => {
    expect(faltaPorTalla(LLEGO, con(["bodega"]))).toEqual(LLEGO);
  });

  it("cuadra con tres destinos", () => {
    const f = con(["bodega", "local", "feria"], {
      tallas: { bodega: { S: "3", M: "5" }, local: { M: "5" }, feria: { S: "7", M: "5" } },
    });
    expect(faltaPorTalla(LLEGO, f)).toEqual({ S: 0, M: 0 });
    expect(problemasReparto(LLEGO, f)).toEqual([]);
  });

  it("un destino desmarcado no cuenta aunque tenga números", () => {
    const f = con(["bodega"], { tallas: { bodega: { S: "10", M: "15" }, local: {}, feria: { S: "4" } } });
    expect(faltaPorTalla(LLEGO, f)).toEqual({ S: 0, M: 0 });
  });
});

describe("estampados dentro de un destino", () => {
  // El ejemplo del dueño: a la feria 10 S, 10 M, 10 L; dos estampados de 3 cada
  // uno por talla; las 4 que quedan de cada talla van básicas.
  const LLEGO_SUDADERA = { S: 10, M: 10, L: 10 };
  const feria = con(["feria"], {
    tallas: { bodega: {}, local: {}, feria: { S: "10", M: "10", L: "10" } },
    disenos: {
      bodega: [],
      local: [],
      feria: [
        { nombre: "Estampado 1", tallas: { S: "3", M: "3", L: "3" } },
        { nombre: "Estampado 2", tallas: { S: "3", M: "3", L: "3" } },
      ],
    },
  });

  it("lo que no se estampa va básico", () => {
    expect(basicosDestino(feria, "feria")).toEqual({ S: 4, M: 4, L: 4 });
    expect(problemasReparto(LLEGO_SUDADERA, feria)).toEqual([]);
  });

  it("viaja a la base como básicas + estampados", () => {
    expect(repartoParaBase(feria)).toEqual({
      feria: {
        basicos: { S: 4, M: 4, L: 4 },
        disenos: [
          { nombre: "Estampado 1", tallas: { S: 3, M: 3, L: 3 } },
          { nombre: "Estampado 2", tallas: { S: 3, M: 3, L: 3 } },
        ],
      },
    });
  });

  it("los estampados no pueden pasar de lo que va al destino", () => {
    const f = { ...feria, disenos: { ...feria.disenos, feria: [{ nombre: "Grande", tallas: { S: "12" } }] } };
    expect(problemasReparto(LLEGO_SUDADERA, f)).toEqual(["Feria, talla S: los estampados suman 2 más de las que van."]);
  });

  it("estampado sin nombre o sin unidades", () => {
    const f: RepartoForm = {
      ...feria,
      disenos: { ...feria.disenos, feria: [{ nombre: "", tallas: { S: "1" } }, { nombre: "Oso", tallas: {} }] },
    };
    expect(problemasReparto(LLEGO_SUDADERA, f)).toEqual([
      "Feria: hay un estampado con unidades pero sin nombre.",
      'Feria: el estampado "Oso" no tiene unidades.',
    ]);
  });
});

describe("problemasReparto", () => {
  it("pide marcar un destino", () => {
    expect(problemasReparto(LLEGO, con([]))).toEqual(["Marca al menos un destino."]);
  });

  it("dice qué falta y qué sobra en cada talla", () => {
    const f = con(["bodega"], { tallas: { bodega: { S: "8", M: "15", L: "1" }, local: {}, feria: {} } });
    expect(problemasReparto(LLEGO, f)).toEqual(["Talla S: faltan 2 por repartir.", "Talla L: repartiste 1 de más."]);
  });

  it("un destino marcado sin unidades es un error", () => {
    const f = con(["bodega", "feria"], { tallas: { bodega: { S: "10", M: "15" }, local: {}, feria: {} } });
    expect(problemasReparto(LLEGO, f)).toEqual(["Feria está marcado pero no tiene unidades."]);
  });
});

describe("completarConBodega", () => {
  it("bodega = lo que no se fue a otro destino", () => {
    const f = con(["bodega", "feria"], { tallas: { bodega: { S: "1" }, local: {}, feria: { S: "4", M: "15" } } });
    expect(completarConBodega(LLEGO, f)).toEqual({ S: "6" });
  });
});

describe("costoSalida", () => {
  it("producción + estampado + operativo del destino", () => {
    expect(costoSalida(6, "bodega", null)).toBe(6);
    expect(costoSalida(6, "local", null)).toBe(8.5);
    expect(costoSalida(6, "local", 2.5)).toBe(11);
    expect(costoSalida(6, "feria", 2.5)).toBe(13.5);
  });
});

describe("Envío agrupado por producción", () => {
  // Dos colores de la misma producción: cada fila es una entrega.
  const LLEGADAS = { negro: { S: 4, M: 4 }, crudo: { S: 2, M: 2 } };
  const g: GrupoForm = {
    ...grupoVacio(["bodega", "feria"]),
    tallas: {
      bodega: { negro: { S: "1" } },
      local: {},
      feria: { negro: { S: "3", M: "4" }, crudo: { S: "2" } },
    },
    estampados: {
      bodega: [],
      local: [],
      feria: [{ nombre: "Logo", tallas: { negro: { S: "2" } } }],
    },
  };

  it("cada fila sale con lo suyo, estampados incluidos", () => {
    const negro = formDeEntrega(g, "negro");
    expect(negro.tallas.feria).toEqual({ S: "3", M: "4" });
    expect(negro.disenos.feria).toEqual([{ nombre: "Logo", tallas: { S: "2" } }]);
    expect(basicosDestino(negro, "feria")).toEqual({ S: 1, M: 4 });
    expect(formDeEntrega(g, "crudo").disenos.feria).toEqual([]);
  });

  it("un estampado se escribe una vez y vale para varios colores", () => {
    const x: GrupoForm = { ...g, estampados: { ...g.estampados, feria: [{ nombre: "Cajas", tallas: { negro: { S: "1" }, crudo: { S: "2" } } }] } };
    expect(formDeEntrega(x, "negro").disenos.feria).toEqual([{ nombre: "Cajas", tallas: { S: "1" } }]);
    expect(formDeEntrega(x, "crudo").disenos.feria).toEqual([{ nombre: "Cajas", tallas: { S: "2" } }]);
  });

  it("lo que sobra → bodega, fila por fila", () => {
    expect(completarGrupoConBodega(LLEGADAS, g)).toEqual({ negro: { S: "1" }, crudo: { M: "2" } });
  });
});
