import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import UploadPanel from "@/components/UploadPanel";
import LogoutButton from "@/components/LogoutButton";
import { money, periodo, fecha } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: snapshots } = await supabase
    .from("snapshots")
    .select(
      "id, created_at, periodo_desde, periodo_hasta, archivo_nombre, total_unidades, total_neto, num_alertas"
    )
    .order("periodo_desde", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <h1>Panorama — Bear &amp; Trend</h1>
          <p className="sub">Ventas, ingreso neto y stock por local. Cada carga queda guardada como snapshot.</p>
        </div>
        <LogoutButton />
      </header>

      <UploadPanel />

      <section>
        <div className="section-head">
          <h2>Historial de reportes</h2>
        </div>
        {!snapshots?.length ? (
          <div className="empty">
            Aún no has cargado ningún reporte. Sube el primero arriba — quedará guardado
            para comparar periodos más adelante.
          </div>
        ) : (
          <div className="snapshot-list">
            {snapshots.map((s) => (
              <Link key={s.id} href={`/snapshots/${s.id}`} className="snapshot-item">
                <div>
                  <div className="period">{periodo(s.periodo_desde, s.periodo_hasta)}</div>
                  <div className="meta">
                    {s.archivo_nombre} · cargado el {fecha(s.created_at)}
                  </div>
                </div>
                <div className="stats">
                  <div className="stat">
                    <div className="v">{s.total_unidades}</div>
                    <div className="k">unidades</div>
                  </div>
                  <div className="stat">
                    <div className="v">{money(Number(s.total_neto))}</div>
                    <div className="k">neto</div>
                  </div>
                  <div className="stat">
                    <div className="v" style={s.num_alertas > 0 ? { color: "var(--warn)" } : undefined}>
                      {s.num_alertas}
                    </div>
                    <div className="k">alertas</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
