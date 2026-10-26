"use client";

import { Fragment, useMemo, useState } from "react";
import { fmtFecha } from "@/lib/fechas";
import { money, sumar } from "@/lib/finanzas/formato";
import { clientesConocidos } from "@/lib/finanzas/ingresos";
import type { Cobro, FacturaCobrar } from "@/lib/finanzas/tipos";
import { Badge } from "@/components/ui";
import { BannerError, useIngresos } from "./comunes";
import { FormFactura, ModalAbonoCobro, type CuentaAbonar } from "./ModalesCobro";

/**
 * Por cobrar (fase 5). VATEX va aparte como UNA sola cuenta: los abonos se
 * restan de todo lo que debe y la base los aplica a la factura más antigua.
 * Los demás clientes, cada uno con su cuenta. Lo que está por cobrar NO es
 * dinero todavía; solo lo es cada abono que entra.
 */
export default function PorCobrar({ avisar }: { avisar: (m: string) => void }) {
  const { supabase, datos, error, cargando, recargar } = useIngresos();
  const [form, setForm] = useState<{ esVatex: boolean; factura?: FacturaCobrar } | null>(null);
  const editar = (f: FacturaCobrar) => setForm({ esVatex: f.es_vatex, factura: f });
  const [abonando, setAbonando] = useState<CuentaAbonar | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const facturas = useMemo(() => (datos?.facturas ?? []).filter((f) => !f.anulada), [datos]);
  const porCuenta = (cuenta: string) => facturas.filter((f) => f.cuenta === cuenta);
  const vatex = datos?.cuentas.find((c) => c.es_vatex);
  const otros = (datos?.cuentas ?? []).filter((c) => !c.es_vatex).sort((a, b) => b.saldo - a.saldo);
  const cobrosDe = (cuenta: string) => (datos?.cobros ?? []).filter((c) => c.cuenta === cuenta).reverse();
  const totalOtros = sumar(otros.map((c) => c.saldo));

  const abrirAbono = (cliente: string, esVatex: boolean, cuenta: string, saldo: number) =>
    setAbonando({ cliente, esVatex, saldo, facturas: porCuenta(cuenta) });

  async function trasCambio(m: string) {
    avisar(m);
    await recargar();
  }

  return (
    <section>
      <div className="section-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>Por cobrar</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => setForm({ esVatex: true })}>+ Factura VATEX</button>
          <button className="btn" onClick={() => setForm({ esVatex: false })}>+ Factura otro cliente</button>
        </div>
      </div>

      {error ? (
        <BannerError texto={error} />
      ) : cargando && !datos ? (
        <div className="empty">Cargando…</div>
      ) : datos ? (
        <>
          {/* ---------------- VATEX ---------------- */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div className="label">VATEX te debe</div>
                <div className="value">{money(vatex?.saldo ?? 0)}</div>
                <div className="hint">
                  {vatex && vatex.facturas_abiertas > 0
                    ? `${vatex.facturas_abiertas} factura${vatex.facturas_abiertas !== 1 ? "s" : ""} abierta${vatex.facturas_abiertas !== 1 ? "s" : ""} · la más antigua del ${fmtFecha(vatex.factura_abierta_mas_antigua)}`
                    : "nada pendiente"}
                  {vatex && vatex.dias_atraso_max > 0 && (
                    <> · <Badge color="rojo">atraso de hasta {vatex.dias_atraso_max} día{vatex.dias_atraso_max !== 1 ? "s" : ""}</Badge></>
                  )}
                </div>
              </div>
              {vatex && vatex.saldo > 0 && (
                <button className="btn primary" onClick={() => abrirAbono("VATEX", true, "vatex", vatex.saldo)}>
                  Registrar abono de VATEX
                </button>
              )}
            </div>
          </div>
          <TablaFacturas facturas={porCuenta("vatex")} onEditar={editar} />
          <ListaAbonos cobros={cobrosDe("vatex")} titulo="Abonos de VATEX" />

          {/* ---------------- Otros clientes ---------------- */}
          <h3 style={{ margin: "28px 0 8px" }}>
            Otros clientes {totalOtros > 0 && <span className="sub">— te deben {money(totalOtros)}</span>}
          </h3>
          {!otros.length ? (
            <div className="card empty">Sin facturas de otros clientes.</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th style={{ textAlign: "right" }}>Facturado</th>
                    <th style={{ textAlign: "right" }}>Cobrado</th>
                    <th style={{ textAlign: "right" }}>Te debe</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {otros.map((c) => (
                    <Fragment key={c.cuenta}>
                      <tr style={{ cursor: "pointer", opacity: c.saldo > 0 ? 1 : 0.55 }}
                        onClick={() => setAbierta(abierta === c.cuenta ? null : c.cuenta)}>
                        <td>
                          <strong>{abierta === c.cuenta ? "▾" : "▸"} {c.cliente}</strong>
                          {c.dias_atraso_max > 0 && <> <Badge color="rojo">atraso {c.dias_atraso_max} d</Badge></>}
                          <div className="sub" style={{ fontSize: 11.5 }}>
                            {c.facturas_abiertas} abierta{c.facturas_abiertas !== 1 ? "s" : ""}
                          </div>
                        </td>
                        <td className="num">{money(c.total_facturado)}</td>
                        <td className="num">{money(c.total_cobrado)}</td>
                        <td className="num"><strong>{money(c.saldo)}</strong></td>
                        <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          {c.saldo > 0 && (
                            <button className="btn" style={{ fontSize: 12 }}
                              onClick={() => abrirAbono(c.cliente, false, c.cuenta, c.saldo)}>Abonar</button>
                          )}
                        </td>
                      </tr>
                      {abierta === c.cuenta && (
                        <tr>
                          <td colSpan={5} style={{ background: "var(--surface-2)" }}>
                            <TablaFacturas facturas={porCuenta(c.cuenta)} compacta onEditar={editar} />
                            <ListaAbonos cobros={cobrosDe(c.cuenta)} titulo="Abonos" />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="sub" style={{ marginTop: 22, fontSize: 12.5 }}>
            Total por cobrar: <strong>{money(sumar([vatex?.saldo ?? 0, totalOtros]))}</strong> — no es dinero hasta que te
            abonan; cada abono sí entra como ingreso del día.
          </p>
        </>
      ) : null}

      <FormFactura
        supabase={supabase}
        abierto={form != null}
        esVatex={form?.esVatex ?? true}
        factura={form?.factura ?? null}
        clientes={clientesConocidos(datos?.facturas ?? [])}
        onCerrar={() => setForm(null)}
        onGuardado={async (m) => {
          setForm(null);
          await trasCambio(m);
        }}
      />
      <ModalAbonoCobro
        supabase={supabase}
        cuenta={abonando}
        onCerrar={() => setAbonando(null)}
        onHecho={async (m) => {
          setAbonando(null);
          await trasCambio(m);
        }}
      />
    </section>
  );
}

function EstadoFactura({ f }: { f: FacturaCobrar }) {
  if (f.estado_calculado === "cobrada") return <Badge color="verde">cobrada</Badge>;
  if (f.dias_atraso > 0) return <Badge color="rojo">atrasada {f.dias_atraso} d</Badge>;
  if (f.estado_calculado === "abonada") return <Badge color="ambar">abonada</Badge>;
  return <Badge>pendiente</Badge>;
}

function TablaFacturas({
  facturas,
  compacta = false,
  onEditar,
}: {
  facturas: FacturaCobrar[];
  compacta?: boolean;
  onEditar: (f: FacturaCobrar) => void;
}) {
  const abiertas = facturas.filter((f) => f.saldo > 0);
  const cobradas = facturas.filter((f) => f.saldo <= 0).slice(-10).reverse();
  if (!facturas.length) return <div className="card empty">Sin facturas.</div>;

  const filas = (lista: FacturaCobrar[]) =>
    lista.map((f) => (
      <tr key={f.id} style={f.saldo <= 0 ? { opacity: 0.55 } : undefined}>
        <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtFecha(f.fecha_factura)}</td>
        <td>
          {f.numero_factura ? `#${f.numero_factura}` : "—"}
          {f.es_saldo_inicial && <> <Badge>antes de oct</Badge></>}
          {f.concepto && <div className="sub" style={{ fontSize: 11.5 }}>{f.concepto}</div>}
        </td>
        <td className="num">{f.prendas || "—"}</td>
        <td className="num">{money(f.monto)}</td>
        <td className="num">{money(f.cobrado)}</td>
        <td className="num"><strong>{money(f.saldo)}</strong></td>
        <td style={{ fontSize: 12.5 }}>
          <EstadoFactura f={f} />
          {f.fecha_esperada && f.saldo > 0 && <div className="sub" style={{ fontSize: 11 }}>esperada {fmtFecha(f.fecha_esperada)}</div>}
        </td>
        <td style={{ textAlign: "right" }}>
          <button className="btn" style={{ fontSize: 12, padding: "4px 9px" }} onClick={() => onEditar(f)}
            aria-label="Editar factura" title="Editar factura">✏️</button>
        </td>
      </tr>
    ));

  return (
    <div className="table-scroll" style={{ marginBottom: compacta ? 8 : 12 }}>
      <table style={compacta ? { fontSize: 12.5 } : undefined}>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Factura</th>
            <th style={{ textAlign: "right" }}>Prendas</th>
            <th style={{ textAlign: "right" }}>Monto</th>
            <th style={{ textAlign: "right" }}>Cobrado</th>
            <th style={{ textAlign: "right" }}>Saldo</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filas(abiertas)}
          {filas(cobradas)}
        </tbody>
      </table>
    </div>
  );
}

function ListaAbonos({ cobros, titulo }: { cobros: Cobro[]; titulo: string }) {
  if (!cobros.length) return null;
  return (
    <details style={{ marginBottom: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>
        {titulo} ({cobros.length}) — {money(sumar(cobros.map((c) => c.monto)))}
      </summary>
      <div className="card" style={{ padding: "6px 14px", marginTop: 6 }}>
        {cobros.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0",
            borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
            <span>{fmtFecha(c.fecha)} · {c.medio}{c.notas ? ` · ${c.notas}` : ""}</span>
            <span className="num" style={{ color: "var(--good)" }}>{money(c.monto)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
