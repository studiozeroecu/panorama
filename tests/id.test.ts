import { describe, it, expect } from "vitest";
import { nuevoId } from "@/lib/id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("nuevoId", () => {
  it("da un uuid v4 válido", () => {
    expect(nuevoId()).toMatch(UUID_V4);
  });

  it("sin crypto.randomUUID (http desde el teléfono) sigue dando un uuid v4", () => {
    // Propiedad propia que tapa la del prototipo, como en un contexto no seguro.
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(typeof crypto.randomUUID).toBe("undefined");
      const ids = new Set(Array.from({ length: 50 }, () => nuevoId()));
      for (const id of ids) expect(id).toMatch(UUID_V4);
      expect(ids.size).toBe(50);
    } finally {
      delete (crypto as unknown as Record<string, unknown>).randomUUID;
    }
  });
});
