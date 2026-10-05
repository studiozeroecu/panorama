/**
 * Un uuid v4 para las claves de idempotencia que nacen en el navegador.
 *
 * `crypto.randomUUID()` solo existe en contextos SEGUROS (https o localhost).
 * Al abrir la app desde el teléfono por la IP de la red local
 * (http://26.x.x.x:3000) no existe y la pantalla revienta con
 * "crypto.randomUUID is not a function". `crypto.getRandomValues()` sí está en
 * cualquier contexto, así que es el respaldo: mismo formato, misma aleatoriedad.
 */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
