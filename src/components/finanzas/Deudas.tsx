"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { money, sumar } from "@/lib/finanzas/formato";
import { mesDe } from "@/lib/finanzas/periodos";
import { labelTipoDeuda } from "@/lib/finanzas/categorias";
import { cargarPagosDeDeuda } from "@/lib/finanzas/cargar";
import type { Cheque, Deuda } from "@/lib/finanzas/tipos";
import { Badge } from "@/components/ui";
import { BannerError, EtiquetaAmbito, EtiquetaExigibilidad, mensajeError, useDatosFinanzas } from "./comunes";
import FormDeuda from "./FormDeuda";
import { ModalAbonar, ModalPagar, type PagoAPagar } from "./ModalesPago";

type FiltroEstado = "pendientes" | "pagadas" | "todas";
type FiltroAmbito = "todos" | "empresa" | "personal";

export default function Deudas({ avisar }: { avisar: (m: string) => void }) {
  const rango = useMemo(() => mesDe(hoyEcuador()), []);
  const { supabase, datos, error, cargando, recargar } = useDatosFinanzas(rango);
  const [formAbierto, setFormAbierto] = useState(false);
  const [abonando, setAbonando] = useState<Deuda | null>(null);
  const [pagando, setPagando] = useState<PagoAPagar | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // fuerza recargar el detalle abierto
  const [fEstado, setFEstado] = useState<FiltroEstado>("pendientes");
  const [fAmbito, setFAmbito] = useState<FiltroAmbito>("todos");

  const vivas = (datos?.deudas ?? []).filter((d) => !d.anulada);
  const pendientes = vivas.filter((d) => d.estado_calculado === "pendiente");
  const filas = vivas
    .filter((d) =>
      fEstado === "todas" ? true : fEstado === "pendientes" ? d.estado_calculado === "pendiente" : d.estado_calculado === "pagada"
    )
    .filter((d) => fAmbito === "todos" || d.ambito === fAmbito)
    .sort((a, b) => (a.proxima_fecha ?? "9999").localeCompare(b.proxima_fecha ?? "9999") || b.saldo - a.saldo);

  const total = (f: (d: Deuda) => number, lista = pendientes) => sumar(lista.map(f));

  async function trasCambio(m: string) {
    avisar(m);
    setVersion((v) => v + 1);
    await recargar();
  }

  return (
    <section>
      <div className="section-head">
        <h2>Deudas</h2>
        <button className="btn primary" onClick={() => setFormAbierto(true)}>+ Nueva deuda</button>
      </div>

      {error ? (
        <BannerError texto={error} />
      ) : cargando && !datos ? (
        <div className="empty">Cargando…</div>
      ) : datos ? (
        <>
          <div className="cards" style={{ marginBottom: 22 }}>
            <div className="card">
              <div className="label">Total que se debe</div>
              <div className="value">{money(total((d) => d.saldo))}</div>
              <div className="hint">
                empresa {money(total((d) => d.saldo, pendientes.filter((d) => d.ambito === "empresa")))} · personal{" "}
                {money(total((d) => d.saldo, pendientes.filter((d) => d.ambito === "personal")))}
              </div>
            </div>
            <div className="card">
              <div className="label">Con fecha (en el calendario)</div>
              <div className="value">{money(total((d) => d.total_pendiente))}</div>
              <div className="hint">pagos programados pendientes</div>
            </div>
            <div className="card">
              <div className="label">Sin fecha</div>
              <div className="value">{money(total((d) => d.sin_programar))}</div>
              <div className="hint">suma a lo que se debe, no a quincena ni mes</div>
            </div>
            {total((d) => d.total_rebotado) > 0 && (
              <div className="card" style={{ borderColor: "var(--bad)" }}>
                <div className="label" style={{ color: "var(--bad)" }}>Rebotado</div>
                <div className="value" style={{ color: "var(--bad)" }}>{money(total((d) => d.total_rebotado))}</div>
                <div className="hint">hasta resolverse, fuera del calendario</div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <select className="pinput" style={{ maxWidth: 180 }} value={fEstado} onChange={(e) => setFEstado(e.target.value as FiltroEstado)}>
              <option value="pendientes">Pendientes</option>
              <option value="pagadas">Pagadas</option>
              <option value="todas">Todas</option>
            </select>
            <select className="pinput" style={{ maxWidth: 180 }} value={fAmbito} onChange={(e) => setFAmbito(e.target.value as FiltroAmbito)}>
              <option value="todos">Empresa y personal</option>
              <option value="empresa">Solo empresa</option>
              <option value="personal">Solo personal</option>
            </select>
          </div>

          {!filas.length ? (
            <div className="card empty">Sin deudas con este filtro.</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>A quién / tipo</th>
                    <th style={{ textAlign: "right" }}>Monto</th>
                    <th style={{ textAlign: "right" }}>Pagado</th>
                    <th style={{ textAlign: "right" }}>Saldo</th>
                    <th>Próximo pago</th>
                    <th style={{ textAlign: "right" }}>Sin fecha</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((d) => (
                    <Fragment key={d.id}>
                      <tr
                        style={{ cursor: "pointer", opacity: d.estado_calculado === "pagada" ? 0.55 : 1 }}
                        onClick={() => setAbierta(abierta === d.id ? null : d.id)}
                      >
                        <td>
                          <strong>{abierta === d.id ? "▾" : "▸"} {d.proveedor}</strong>{" "}
                          <EtiquetaAmbito ambito={d.ambito} /> <EtiquetaExigibilidad exigibilidad={d.exigibilidad} />
                          {d.es_saldo_inicial && <> <Badge>antes de oct</Badge></>}
                          {d.total_rebotado > 0 && <> <Badge color="rojo">rebotado</Badge></>}
                          <div className="sub" style={{ fontSize: 11.5 }}>
                            {labelTipoDeuda(d.tipo_deuda)}{d.concepto ? ` · ${d.concepto}` : ""}
                            {d.fecha_estimada ? ` · estimada ${fmtFecha(d.fecha_estimada)}` : ""}
                          </div>
                        </td>
                        <td className="num">{money(d.monto)}</td>
                        <td className="num">{money(d.total_pagado)}</td>
                        <td className="num"><strong>{money(d.saldo)}</strong></td>
                        <td style={{ fontSize: 12.5 }}>
                          {d.proxima_fecha ? `${fmtFecha(d.proxima_fecha)} (${d.cuotas_pendientes})` : "—"}
                        </td>
                        <td className="num">{d.sin_programar > 0 ? money(d.sin_programar) : "—"}</td>
                        <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          {d.sin_programar > 0 && (
                            <button className="btn" style={{ fontSize: 12 }} onClick={() => setAbonando(d)}>Abonar</button>
                          )}
                        </td>
                      </tr>
                      {abierta === d.id && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--surface-2)" }}>
                            <DetalleDeuda key={version} supabase={supabase} deuda={d} onPagar={setPagando} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <FormDeuda
        supabase={supabase}
        abierto={formAbierto}
        onCerrar={() => setFormAbierto(false)}
        onGuardado={async (m) => {
          setFormAbierto(false);
          await trasCambio(m);
        }}
      />
      <ModalAbonar
        supabase={supabase}
        deuda={abonando}
        onCerrar={() => setAbonando(null)}
        onHecho={async (m) => {
          setAbonando(null);
          await trasCambio(m);
        }}
      />
      <ModalPagar
        supabase={supabase}
        pago={pagando}
        onCerrar={() => setPagando(null)}
        onHecho={async (m) => {
          setPagando(null);
          await trasCambio(m);
        }}
      />
    </section>
  );
}

/** Todos los pagos de una deuda (se cargan al abrirla). */
function DetalleDeuda({
  supabase,
  deuda,
  onPagar,
}: {
  supabase: SupabaseClient;
  deuda: Deuda;
  onPagar: (p: PagoAPagar) => void;
}) {
  const [pagos, setPagos] = useState<Cheque[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarPagosDeDeuda(supabase, deuda.id)
      .then((p) => vivo && setPagos(p))
      .catch((e) => vivo && setErr(mensajeError(e)));
    return () => {
      vivo = false;
    };
  }, [supabase, deuda.id]);

  if (err) return <BannerError texto={err} />;
  if (!pagos) return <div className="sub">Cargando pagos…</div>;
  if (!pagos.length) {
    return (
      <div className="sub" style={{ fontSize: 12.5 }}>
        Sin pagos programados.{deuda.sin_programar > 0 ? " Usa “Abonar” para registrar lo que se pague." : ""}
        {deuda.notas && <div>Notas: {deuda.notas}</div>}
      </div>
    );
  }
  return (
    <div>
      <table style={{ fontSize: 12.5 }}>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Medio</th>
            <th style={{ textAlign: "right" }}>Monto</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pagos.map((c) => (
            <tr key={c.id}>
              <td>
                {fmtFecha(c.fecha_cobro)}
                {c.reprogramado && <span className="sub"> (antes {fmtFecha(c.fecha_original)})</span>}
              </td>
              <td>{c.medio}{c.numero ? ` #${c.numero}` : ""}{c.banco ? ` · ${c.banco}` : ""}</td>
              <td className="num">{money(c.monto)}</td>
              <td>
                {c.estado === "pagado" || c.estado === "cobrado" ? (
                  <Badge color="verde">pagado {fmtFecha(c.fecha_pago)}</Badge>
                ) : c.estado === "rebotado" ? (
                  <Badge color="rojo">rebotado</Badge>
                ) : c.estado === "anulado" ? (
                  <Badge>anulado</Badge>
                ) : (
                  <Badge color="ambar">pendiente</Badge>
                )}
              </td>
              <td style={{ textAlign: "right" }}>
                {c.estado === "pendiente" && (
                  <button
                    className="btn"
                    style={{ fontSize: 12 }}
                    onClick={() =>
                      onPagar({
                        chequeId: c.id,
                        quien: deuda.proveedor,
                        concepto: deuda.concepto,
                        monto: c.monto,
                        fecha: c.fecha_cobro,
                        medio: c.medio,
                        numero: c.numero,
                        ambito: deuda.ambito,
                      })
                    }
                  >
                    ✓ Pagar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {deuda.notas && <div className="sub" style={{ fontSize: 12, marginTop: 6 }}>Notas: {deuda.notas}</div>}
    </div>
  );
}
