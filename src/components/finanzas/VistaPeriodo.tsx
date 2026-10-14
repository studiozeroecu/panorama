"use client";

import { useMemo, useState } from "react";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { money } from "@/lib/finanzas/formato";
import { armarAgenda, type ItemPago, type ItemPosible } from "@/lib/finanzas/agenda";
import { anterior, periodoDe, quincenasDelMes, siguiente, type Periodo } from "@/lib/finanzas/periodos";
import { Badge } from "@/components/ui";
import { BannerError, EtiquetaAmbito, EtiquetaExigibilidad, useDatosFinanzas } from "./comunes";
import { ModalPagar, type PagoAPagar } from "./ModalesPago";

/**
 * Pantalla Quincena / Mes. Todo lo que muestra sale de armarAgenda (la única
 * función de "qué hay que pagar").
 */
export default function VistaPeriodo({
  tipo,
  avisar,
}: {
  tipo: Periodo["tipo"];
  avisar: (m: string) => void;
}) {
  const hoy = hoyEcuador();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe(tipo, hoy));
  const [conPersonal, setConPersonal] = useState(false);
  const [pagando, setPagando] = useState<PagoAPagar | null>(null);
  const { supabase, datos, error, cargando, recargar } = useDatosFinanzas(periodo);

  const agenda = useMemo(
    () => (datos ? armarAgenda(datos, periodo, { hoy, incluirPersonalEnGastos: conPersonal }) : null),
    [datos, periodo, hoy, conPersonal]
  );
  const subQuincenas = useMemo(
    () =>
      datos && tipo === "mes"
        ? quincenasDelMes(periodo).map((q) => armarAgenda(datos, q, { hoy }))
        : [],
    [datos, periodo, tipo, hoy]
  );

  const nombre = tipo === "quincena" ? "quincena" : "mes";

  return (
    <section>
      <div className="section-head" style={{ gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={() => setPeriodo(anterior(periodo))} aria-label={`${nombre} anterior`}>◀</button>
          <h2 style={{ margin: 0, minWidth: 170, textAlign: "center" }}>{periodo.etiqueta}</h2>
          <button className="btn" onClick={() => setPeriodo(siguiente(periodo))} aria-label={`${nombre} siguiente`}>▶</button>
          {!agenda?.esActual && (
            <button className="btn" onClick={() => setPeriodo(periodoDe(tipo, hoy))}>Hoy</button>
          )}
        </div>
      </div>

      {error ? (
        <BannerError texto={error} />
      ) : cargando && !agenda ? (
        <div className="empty">Cargando…</div>
      ) : agenda ? (
        <>
          {agenda.rebotados.length > 0 && (
            <div className="card" style={{ borderColor: "var(--bad)", background: "var(--bad-soft)", marginBottom: 18 }}>
              <div className="label" style={{ color: "var(--bad)" }}>
                ⚠ Cheques rebotados — {money(agenda.totalRebotados)} · no se suman al calendario hasta resolverse
              </div>
              <ListaPagos items={agenda.rebotados} />
            </div>
          )}

          <div className="cards" style={{ marginBottom: 22 }}>
            <div className="card">
              <div className="label">Pagos de {tipo === "quincena" ? "la quincena" : "el mes"}</div>
              <div className="value">{money(agenda.totalPagos)}</div>
              <div className="hint">
                {agenda.pagos.length} pago{agenda.pagos.length !== 1 ? "s" : ""}
                {agenda.totalPagosPersonal > 0 &&
                  ` · empresa ${money(agenda.totalPagosEmpresa)} · personal ${money(agenda.totalPagosPersonal)}`}
              </div>
            </div>
            {agenda.esActual && (
              <div className="card">
                <div className="label">Vencidos de antes</div>
                <div className="value" style={{ color: agenda.totalVencidos > 0 ? "var(--bad)" : undefined }}>
                  {money(agenda.totalVencidos)}
                </div>
                <div className="hint">{agenda.vencidos.length} sin pagar de periodos anteriores</div>
              </div>
            )}
            <div className="card">
              <div className="label">Ya pagado</div>
              <div className="value" style={{ color: "var(--good)" }}>{money(agenda.totalPagados)}</div>
              <div className="hint">{agenda.pagados.length} pago{agenda.pagados.length !== 1 ? "s" : ""} hecho{agenda.pagados.length !== 1 ? "s" : ""} en el periodo</div>
            </div>
            <div className="card">
              <div className="label">Gastos registrados ({conPersonal ? "empresa + personal" : "solo empresa"})</div>
              <div className="value">{money(agenda.gastos.total)}</div>
              <div className="hint">
                {agenda.gastos.cantidad} gasto{agenda.gastos.cantidad !== 1 ? "s" : ""} · cuentan para rentabilidad {money(agenda.gastos.totalRentabilidad)}
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 6 }}>
                <input type="checkbox" checked={conPersonal} onChange={(e) => setConPersonal(e.target.checked)} />
                incluir gastos personales
              </label>
            </div>
          </div>

          {tipo === "mes" && subQuincenas.length === 2 && (
            <p className="sub" style={{ marginTop: -8, marginBottom: 18 }}>
              {subQuincenas.map((q) => `${q.periodo.etiqueta}: ${money(q.totalPagos)} (${q.pagos.length})`).join(" · ")}
            </p>
          )}

          <h3 style={{ marginBottom: 8 }}>Por pagar en {tipo === "quincena" ? "esta quincena" : "este mes"}</h3>
          {agenda.pagos.length || agenda.posibles.length ? (
            <ListaPagos items={agenda.pagos} onPagar={setPagando} posibles={agenda.posibles} />
          ) : (
            <div className="card empty">Nada programado en este periodo.</div>
          )}

          {agenda.vencidos.length > 0 && (
            <>
              <h3 style={{ margin: "22px 0 8px", color: "var(--bad)" }}>
                Vencidos de periodos anteriores — {money(agenda.totalVencidos)}
              </h3>
              <ListaPagos items={agenda.vencidos} onPagar={setPagando} />
            </>
          )}

          {agenda.sinFecha.length > 0 && (
            <details style={{ marginTop: 22 }}>
              <summary style={{ cursor: "pointer" }}>
                <strong>Deudas sin fecha — {money(agenda.totalSinFecha)}</strong>{" "}
                <span className="sub">(suman a lo que se debe, no a este periodo)</span>
              </summary>
              <div className="card" style={{ padding: "6px 16px", marginTop: 8 }}>
                {agenda.sinFecha.map((s) => (
                  <div key={(s.deudaId ?? "") + (s.chequeId ?? "")} style={filaSimple}>
                    <span>
                      {s.quien} <EtiquetaAmbito ambito={s.ambito} /> <EtiquetaExigibilidad exigibilidad={s.exigibilidad} />
                      {s.concepto && <span className="sub"> · {s.concepto}</span>}
                      {s.motivo === "pago_sin_fecha" && <span className="sub"> · pago sin fecha</span>}
                    </span>
                    <span className="num">{money(s.monto)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {agenda.pagados.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer" }}>
                <strong>Ya pagado en el periodo — {money(agenda.totalPagados)}</strong>
              </summary>
              <div style={{ marginTop: 8 }}>
                <ListaPagos items={agenda.pagados} />
              </div>
            </details>
          )}

          {agenda.gastos.porCategoria.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer" }}>
                <strong>Gastos por categoría ({conPersonal ? "empresa + personal" : "solo empresa"})</strong>
              </summary>
              <div className="card" style={{ padding: "6px 16px", marginTop: 8 }}>
                {agenda.gastos.porCategoria.map((c) => (
                  <div key={c.categoria} style={filaSimple}>
                    <span>{c.categoria}</span>
                    <span className="num">{money(c.total)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="sub" style={{ marginTop: 22, fontSize: 12.5 }}>
            Total que se debe hoy (todas las deudas, empresa y personal): <strong>{money(agenda.totalAdeudado)}</strong>
          </p>
        </>
      ) : null}

      <ModalPagar
        supabase={supabase}
        pago={pagando}
        onCerrar={() => setPagando(null)}
        onHecho={async (m) => {
          setPagando(null);
          avisar(m);
          await recargar();
        }}
      />
    </section>
  );
}

const filaSimple: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid var(--border)",
  fontSize: 13,
};

function ListaPagos({
  items,
  onPagar,
  posibles = [],
}: {
  items: ItemPago[];
  onPagar?: (p: PagoAPagar) => void;
  posibles?: ItemPosible[];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>A quién / concepto</th>
            <th>Medio</th>
            <th style={{ textAlign: "right" }}>Monto</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.chequeId}>
              <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                {p.estado === "pagado" || p.estado === "cobrado" ? fmtFecha(p.fechaPago) : fmtFecha(p.fecha)}
                {p.reprogramado && (
                  <div className="sub" style={{ fontSize: 11 }}>antes {fmtFecha(p.fechaOriginal)}</div>
                )}
              </td>
              <td>
                <strong>{p.quien}</strong> <EtiquetaAmbito ambito={p.ambito} /> <EtiquetaExigibilidad exigibilidad={p.exigibilidad} />
                {p.vencido && <> <Badge color="rojo">vencido</Badge></>}
                {p.estado === "rebotado" && <> <Badge color="rojo">rebotado</Badge></>}
                {p.concepto && <div className="sub" style={{ fontSize: 11.5 }}>{p.concepto}</div>}
              </td>
              <td style={{ fontSize: 12.5 }}>
                {p.medio}{p.numero ? ` #${p.numero}` : ""}
              </td>
              <td className="num">{money(p.monto)}</td>
              <td style={{ textAlign: "right" }}>
                {onPagar && p.estado === "pendiente" ? (
                  <button
                    className="btn"
                    style={{ fontSize: 12 }}
                    onClick={() =>
                      onPagar({
                        chequeId: p.chequeId,
                        quien: p.quien,
                        concepto: p.concepto,
                        monto: p.monto,
                        fecha: p.fecha,
                        medio: p.medio,
                        numero: p.numero,
                        ambito: p.ambito,
                      })
                    }
                  >
                    ✓ Pagar
                  </button>
                ) : p.estado === "pagado" || p.estado === "cobrado" ? (
                  <Badge color="verde">pagado</Badge>
                ) : null}
              </td>
            </tr>
          ))}
          {posibles.map((x) => (
            <tr key={`posible-${x.deudaId}`} style={{ opacity: 0.55 }}>
              <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtFecha(x.fechaEstimada)}</td>
              <td>
                <strong>{x.quien}</strong> <EtiquetaAmbito ambito={x.ambito} /> <Badge>posible</Badge>
                <div className="sub" style={{ fontSize: 11.5 }}>
                  {x.concepto ? `${x.concepto} · ` : ""}fecha estimada{x.pasada ? " (ya pasó)" : ""} — no se suma
                </div>
              </td>
              <td></td>
              <td className="num">{money(x.monto)}</td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
