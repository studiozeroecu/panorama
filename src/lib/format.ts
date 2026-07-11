export function money(n: number | null | undefined): string {
  return (
    "$" +
    (n ?? 0).toLocaleString("es-EC", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function fecha(iso: string): string {
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-EC", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function periodo(desde: string, hasta: string): string {
  return `${fecha(desde)} — ${fecha(hasta)}`;
}
