/**
 * El bot muestra los cheques con los primeros 8 caracteres de su id. La base
 * NO permite buscar un uuid con "like" (por eso actualizar_cheque fallaba
 * siempre). En su lugar se busca por RANGO: todos los uuid que empiezan con
 * ese prefijo están entre "prefijo000…" y "prefijofff…".
 */
export function rangoUuidPorPrefijo(prefijo: string): { desde: string; hasta: string } | null {
  const hex = prefijo.trim().toLowerCase().replace(/-/g, "");
  if (hex.length < 6 || hex.length > 32 || !/^[0-9a-f]+$/.test(hex)) return null;
  const formato = (h: string) =>
    `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  return {
    desde: formato(hex.padEnd(32, "0")),
    hasta: formato(hex.padEnd(32, "f")),
  };
}
