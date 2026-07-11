import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopProducts, { type TopProductRow } from "@/components/TopProducts";
import StockAlerts, { type StockAlertRow } from "@/components/StockAlerts";
import { money, periodo, fecha } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: snapshot } = await supabase
    .from("snapshots")
    .select("*")
    .eq("id", id)
    .single();
  if (!snapshot) notFound();

  const [{ data: sales }, { data: alerts }] = await Promise.all([
    supabase
      .from("sales_lines")
      .select("codigo, descripcion, cantidad, pvp, neto")
      .eq("snapshot_id", id)
      .order("neto", { ascending: false }),
    supabase
      .from("stock_lines")
      .select("codigo, descripcion, local, venta, exist")
      .eq("snapshot_id", id)
      .eq("es_alerta", true)
      .order("exist", { ascending: true }),
  ]);

  const salesRows: TopProductRow[] = (sales ?? []).map((s) => ({
    ...s,
    pvp: Number(s.pvp),
    neto: s.neto != null ? Number(s.neto) : null,
  }));
  const alertRows: StockAlertRow[] = alerts ?? [];

  const cards = [
    {
      label: "Unidades vendidas",
      value: snapshot.total_unidades.toLocaleString("es-EC"),
      hint: `${snapshot.num_lineas_venta} líneas en el reporte`,
    },
    {
      label: "Ingreso neto (post-comisión VATEX)",
      value: money(Number(snapshot.total_neto)),
      hint: "lo que realmente te toca a ti",
    },
    {
      label: "Alertas de stock",
      value: String(snapshot.num_alertas),
      hint: "existencia ≤ 5 con movimiento real",
    },
    {
      label: "Locales",
      value: String(snapshot.locales?.length ?? 0),
      hint: (snapshot.locales ?? []).join(", ") || "sin datos de stock",
    },
  ];

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            <Link href="/" style={{ color: "var(--accent)" }}>
              ← Todos los reportes
            </Link>
          </p>
          <h1>{periodo(snapshot.periodo_desde, snapshot.periodo_hasta)}</h1>
          <p className="sub">
            {snapshot.archivo_nombre} · cargado el {fecha(snapshot.created_at)}
          </p>
        </div>
      </header>

      {snapshot.warnings?.length > 0 && (
        <div className="warning-banner">
          {snapshot.warnings.map((w: string, i: number) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="cards">
        {cards.map((c) => (
          <div className="card" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
            <div className="hint">{c.hint}</div>
          </div>
        ))}
      </div>

      <TopProducts rows={salesRows} />
      <StockAlerts rows={alertRows} locales={snapshot.locales ?? []} />
    </div>
  );
}
