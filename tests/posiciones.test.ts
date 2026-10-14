import { describe, it, expect } from "vitest";
import {
  LIENZO,
  TIPOS_PRENDA,
  posicionesDe,
  posicionPorId,
  espejo,
  recuadrosDe,
  encajar,
  rutaSilueta,
  type TipoPrenda,
  type Recuadro,
} from "@/lib/produccion/posiciones";

const TIPOS = TIPOS_PRENDA.map((t) => t.tipo);

/** Un recuadro válido cabe entero dentro del lienzo. */
function dentro(r: Recuadro): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.ancho <= LIENZO.ancho && r.y + r.alto <= LIENZO.alto;
}

describe("catálogo de posiciones", () => {
  it.each(TIPOS)("ninguna posición de %s se sale del lienzo", (tipo) => {
    for (const pos of posicionesDe(tipo)) {
      // Se comprueban los dos lados: en las mangas el espejo también debe caber.
      for (const r of recuadrosDe(pos, "ambas")) {
        expect(dentro(r), `${tipo} · ${pos.id} · ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it.each(TIPOS)("%s no repite ids", (tipo) => {
    const ids = posicionesDe(tipo).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * La camiseta es de manga corta: no tiene antebrazo donde estampar. Cualquier
   * otra diferencia entre prendas sería un olvido, no una decisión — por eso el
   * test fija la lista de omisiones en vez de solo contar posiciones.
   */
  it("solo la camiseta omite el antebrazo", () => {
    const ids = (t: TipoPrenda) => new Set(posicionesDe(t).map((p) => p.id));
    const sudadera = ids("sudadera");
    expect(ids("buso")).toEqual(sudadera);

    const faltan = [...sudadera].filter((id) => !ids("camiseta").has(id));
    expect(faltan).toEqual(["manga_antebrazo"]);
  });

  it("las mangas son las únicas que piden lado", () => {
    for (const tipo of TIPOS) {
      for (const pos of posicionesDe(tipo)) {
        expect(pos.esManga).toBe(pos.id.startsWith("manga_"));
      }
    }
  });

  it("cada posición de espalda vive en la vista de espalda", () => {
    for (const tipo of TIPOS) {
      for (const pos of posicionesDe(tipo)) {
        expect(pos.vista).toBe(pos.id.startsWith("espalda_") ? "espalda" : "frente");
      }
    }
  });

  it("posicionPorId encuentra lo que existe y no inventa lo que no", () => {
    expect(posicionPorId("sudadera", "manga_antebrazo")?.esManga).toBe(true);
    expect(posicionPorId("camiseta", "manga_antebrazo")).toBeUndefined();
    expect(posicionPorId("camiseta", "no_existe")).toBeUndefined();
  });

  it("las rutas de silueta apuntan a los seis archivos reales", () => {
    const rutas = TIPOS.flatMap((t) => [rutaSilueta(t, "frente"), rutaSilueta(t, "espalda")]);
    expect(new Set(rutas).size).toBe(6);
    expect(rutas).toContain("/siluetas/camiseta-frente.svg");
  });
});

describe("espejo", () => {
  it("refleja sobre el centro del lienzo", () => {
    expect(espejo({ x: 715, y: 350, ancho: 85, alto: 85 })).toEqual({
      x: 200,
      y: 350,
      ancho: 85,
      alto: 85,
    });
  });

  it("aplicado dos veces devuelve el original", () => {
    const r = { x: 688, y: 430, ancho: 88, alto: 88 };
    expect(espejo(espejo(r))).toEqual(r);
  });
});

describe("recuadrosDe", () => {
  const mangaSud = posicionPorId("sudadera", "manga_hombro")!;
  const pecho = posicionPorId("sudadera", "pecho_izq:pequeno")!;

  it("una manga da un recuadro por lado y dos con 'ambas'", () => {
    expect(recuadrosDe(mangaSud, "izquierda")).toHaveLength(1);
    expect(recuadrosDe(mangaSud, "derecha")).toHaveLength(1);
    expect(recuadrosDe(mangaSud, "ambas")).toHaveLength(2);
  });

  it("'izquierda' es la de quien la usa: cae a la derecha del lienzo", () => {
    const [izq] = recuadrosDe(mangaSud, "izquierda");
    const [der] = recuadrosDe(mangaSud, "derecha");
    expect(izq.x).toBeGreaterThan(LIENZO.ancho / 2);
    expect(der.x).toBeLessThan(LIENZO.ancho / 2);
  });

  it("lo que no es manga ignora el lado y da siempre un recuadro", () => {
    expect(recuadrosDe(pecho, "ambas")).toEqual([pecho.recuadro]);
    expect(recuadrosDe(pecho, "derecha")).toEqual([pecho.recuadro]);
  });
});

describe("encajar", () => {
  const r = { x: 100, y: 200, ancho: 200, alto: 200 };

  it("una imagen apaisada toca los lados y se centra en vertical", () => {
    const e = encajar(r, 400, 200);
    expect(e).toEqual({ x: 100, y: 250, ancho: 200, alto: 100 });
  });

  it("una imagen vertical toca arriba y abajo y se centra en horizontal", () => {
    const e = encajar(r, 200, 400);
    expect(e).toEqual({ x: 150, y: 200, ancho: 100, alto: 200 });
  });

  it("nunca deforma: conserva la proporción de origen", () => {
    const e = encajar({ x: 0, y: 0, ancho: 300, alto: 100 }, 80, 40);
    expect(e.ancho / e.alto).toBeCloseTo(2, 10);
  });

  it("nunca se sale del recuadro", () => {
    for (const [w, h] of [[1, 1000], [1000, 1], [37, 91], [4000, 3000]]) {
      const e = encajar(r, w, h);
      expect(e.x).toBeGreaterThanOrEqual(r.x - 1e-9);
      expect(e.y).toBeGreaterThanOrEqual(r.y - 1e-9);
      expect(e.x + e.ancho).toBeLessThanOrEqual(r.x + r.ancho + 1e-9);
      expect(e.y + e.alto).toBeLessThanOrEqual(r.y + r.alto + 1e-9);
    }
  });

  it("una imagen sin dimensiones no revienta el cálculo", () => {
    expect(encajar(r, 0, 0)).toEqual(r);
  });
});
