"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hoyEcuador, fmtFecha, diasHasta } from "@/lib/fechas";
import { leerTodo, ErrorCarga } from "@/lib/finanzas/cargar";
import { money, sumar } from "@/lib/finanzas/formato";
import { Modal, Campo, Fila, Badge } from "@/components/ui";
import { BannerError, mensajeError } from "./comunes";

/**
 * Cuentas por cobrar — versión anterior, sin cambios de fondo. Se rediseña en
 * la fase 5 (liquidaciones de VATEX, "dinero en la calle").
 */
interface CxC {
  id: string;
  cliente: string;
  concepto: string;
  monto: number;
  fecha_factura: string;
  fecha_vencimiento: string | null;
  estado: "pendiente" | "cobrado";
  fecha_cobro: string | null;
  notas: string;
}

function Semaforo({ fecha }: { fecha: string | null }) {
  if (!fecha) return <Badge>sin fecha</Badge>;
  const d = diasHasta(fecha);
  if (d < 0) return <Badge color="rojo">vencido {-d} día{d !== -1 ? "s" : ""}</Badge>;
  if (d <= 3) return <Badge color="ambar">vence en {d === 0 ? "HOY" : `${d} día${d !== 1 ? "s" : ""}`}</Badge>;
  return <Badge color="verde">en {d} días</Badge>;
}

export default function PorCobrar({ avisar }: { avisar: (m: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [filas, setFilas] = useState<CxC[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [cobrando, setCobrando] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await leerTodo<CxC>("las cuentas por cobrar", (a, b) =>
        supabase.from("cuentas_por_cobrar").select("*").order("id").range(a, b)
      );
      setFilas(data.map((x) => ({ ...x, monto: Number(x.monto) })));
      setError(null);
    } catch (e) {
      setFilas(null);
      setError(e instanceof ErrorCarga ? e.message : mensajeError(e));
    }
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function marcarCobrado(x: CxC) {
    if (cobrando) return;
    setCobrando(x.id);
    const { error } = await supabase
      .from("cuentas_por_cobrar")
      .update({ estado: "cobrado", fecha_cobro: hoyEcuador() })
      .eq("id", x.id)
      .eq("estado", "pendiente"); // doble clic: el segundo no cambia nada
    setCobrando(null);
    if (error) return avisar(`Error: ${error.message}`);
    avisar(`Cobrado: ${money(x.monto)} de ${x.cliente}`);
    await reload();
  }

  const porFecha = (a: CxC, b: CxC) => (a.fecha_vencimiento ?? "9999").localeCompare(b.fecha_vencimiento ?? "9999");
  const pendientes = (filas ?? []).filter((x) => x.estado === "pendiente").sort(porFecha);
  const cobradas = (filas ?? [])
    .filter((x) => x.estado !== "pendiente")
    .sort((a, b) => (b.fecha_cobro ?? "").localeCompare(a.fecha_cobro ?? ""))
    .slice(0, 10);

  return (
    <section>
      <div className="section-head">
        <h2>Por cobrar</h2>
        <button className="btn primary" onClick={() => setForm(true)}>+ Nueva por cobrar</button>
      </div>
      <p className="sub" style={{ marginTop: -6, fontSize: 12.5 }}>
        Versión simple. Las liquidaciones de VATEX y el “dinero en la calle” llegan en la fase 5.
      </p>

      {error ? (
        <BannerError texto={error} />
      ) : !filas ? (
        <div className="empty">Cargando…</div>
      ) : !filas.length ? (
        <div className="card empty">Sin registros aún.</div>
      ) : (
        <>
          <p style={{ fontSize: 13 }}>
            Pendiente de cobro: <strong>{money(sumar(pendientes.map((x) => x.monto)))}</strong> ({pendientes.length})
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente / concepto</th>
                  <th style={{ textAlign: "right" }}>Monto</th>
                  <th>Factura</th>
                  <th>Vencimiento</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...pendientes, ...cobradas].map((x) => {
                  const pendiente = x.estado === "pendiente";
                  return (
                    <tr key={x.id} style={!pendiente ? { opacity: 0.5 } : undefined}>
                      <td>
                        <strong>{x.cliente}</strong>
                        {x.concepto && <div className="sub" style={{ fontSize: 11.5 }}>{x.concepto}</div>}
                        {x.notas && <div className="sub" style={{ fontSize: 11 }}>{x.notas}</div>}
                      </td>
                      <td className="num">{money(x.monto)}</td>
                      <td style={{ fontSize: 12.5 }}>{fmtFecha(x.fecha_factura)}</td>
                      <td>
                        {pendiente ? <Semaforo fecha={x.fecha_vencimiento} /> : <span className="sub" style={{ fontSize: 12 }}>{fmtFecha(x.fecha_vencimiento)}</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {pendiente ? (
                          <button className="btn" style={{ fontSize: 12 }} disabled={cobrando != null} onClick={() => marcarCobrado(x)}>
                            {cobrando === x.id ? "Guardando…" : "✓ Cobrada"}
                          </button>
                        ) : (
                          <Badge color="verde">Cobrada</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <FormCobrar
        abierto={form}
        onCerrar={() => setForm(false)}
        onGuardado={async () => {
          setForm(false);
          avisar("Factura por cobrar registrada");
          await reload();
        }}
      />
    </section>
  );
}

function FormCobrar({ abierto, onCerrar, onGuardado }: { abierto: boolean; onCerrar: () => void; onGuardado: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [cliente, setCliente] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [factura, setFactura] = useState(hoyEcuador());
  const [vence, setVence] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setCliente(""); setConcepto(""); setMonto(""); setFactura(hoyEcuador());
      setVence(""); setNotas(""); setErr(null); setGuardando(false);
    }
  }, [abierto]);

  async function guardar() {
    if (guardando) return;
    const m = parseFloat(monto);
    if (!cliente.trim()) return setErr("El cliente es requerido.");
    if (!(m > 0)) return setErr("El monto debe ser mayor a 0.");
    setGuardando(true);
    const { error } = await supabase.from("cuentas_por_cobrar").insert({
      cliente: cliente.trim(),
      concepto: concepto.trim(),
      monto: m,
      fecha_factura: factura,
      fecha_vencimiento: vence || null,
      notas: notas.trim(),
    });
    setGuardando(false);
    if (error) return setErr(error.message);
    onGuardado();
  }

  return (
    <Modal
      titulo="Nueva factura por cobrar"
      abierto={abierto}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      <Fila>
        <Campo label="Cliente" requerido>
          <input className="pinput" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </Campo>
        <Campo label="Monto ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
      </Fila>
      <Campo label="Concepto">
        <input className="pinput" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      </Campo>
      <Fila>
        <Campo label="Fecha factura" requerido>
          <input className="pinput" type="date" value={factura} onChange={(e) => setFactura(e.target.value)} />
        </Campo>
        <Campo label="Fecha vencimiento">
          <input className="pinput" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </Campo>
      </Fila>
      <Campo label="Notas">
        <textarea className="pinput" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
    </Modal>
  );
}
