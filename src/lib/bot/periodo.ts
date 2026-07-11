/**
 * Interpreta el periodo escrito en el caption del Excel enviado por Telegram.
 * Acepta formatos como: "1/6 al 30/6", "01/06/2026 - 30/06/2026",
 * "1-6 a 30-6", "del 1/6 al 15/6".
 */
export function parsePeriodo(
  caption: string,
  now: Date = new Date()
): { desde: string; hasta: string } | null {
  const re =
    /(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\s*(?:al?|hasta|—|–|-)\s*(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/i;
  const m = caption.match(re);
  if (!m) return null;

  const year = now.getFullYear();
  const norm = (y?: string) => {
    if (!y) return year;
    const n = Number(y);
    return n < 100 ? 2000 + n : n;
  };
  const d1 = Number(m[1]), mo1 = Number(m[2]), y1 = norm(m[3]);
  const d2 = Number(m[4]), mo2 = Number(m[5]), y2 = norm(m[6]);

  if (mo1 < 1 || mo1 > 12 || mo2 < 1 || mo2 > 12 || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const desde = `${y1}-${pad(mo1)}-${pad(d1)}`;
  const hasta = `${y2}-${pad(mo2)}-${pad(d2)}`;
  if (desde > hasta) return null;
  return { desde, hasta };
}
