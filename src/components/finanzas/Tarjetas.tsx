"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Badge, Campo, Fila, Modal } from "@/components/ui";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { money } from "@/lib/finanzas/formato";
import { cargarTarjetasYCortes } from "@/lib/finanzas/cargar";
import { cortePendiente, fechaPagoDeCorte } from "@/lib/finanzas/plan";
import type { CorteTarjeta, Tarjeta } from "@/lib/finanzas/tipos";
import { BannerError, mensajeError, nuevoId, usePlan } from "./comunes";
import { ModalPagar, type PagoAPagar } from "./ModalesPago";

/**
 * Tarjetas de crédito. Son las mismas para el dueño y el negocio: todo pago
 * cuenta como gasto de la empresa (categoría "tarjeta"), sin preguntar.
 * En cada corte se anota el saldo total, el mínimo y cuánto se piensa pagar;
 * eso último es lo que entra a Quincena/Mes en la fecha de pago.
 * El consumo de cada periodo lo calcula la base (v_tarjeta_cortes).
 */
export default function Tarjetas({ avisar }: { avisar: (m: string) => void }) {
  const { supabase, datos, error, cargando, recargar } = usePlan();
  const hoy = hoyEcuador();
  const [editando, setEditando] = useState<Tarjeta | "nueva" | null>(null);
  const [corte, setCorte] = useState<DatosCorte | null>(null);
  const [pagando, setPagando] = useState<PagoAPagar | null>(null);

  const hecho = async (m: string) => {
    setEditando(null);
    setCorte(null);
    setPagando(null);
    avisar(m);
    await recargar();
  };

  if (error) return <BannerError texto={error} />;
  if (cargando && !datos) return <div className="empty">Cargando…</div>;
  if (!datos) return null;

  const cortesDe = (id: string) =>
    datos.cortes.filter((c) => c.tarjeta_id === id).sort((a, b) => (a.fecha_corte < b.fecha_corte ? 1 : -1));
  const totalDeuda = datos.tarjetas
    .filter((t) => t.activa)
    .reduce((s, t) => s + Math.max(0, t.saldo_estimado_hoy ?? 0), 0);

  return (
    <section>
      <div className="section-head" style={{ gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Tarjetas de crédito</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Deuda estimada hoy en todas: <strong>{money(totalDeuda)}</strong> · los pagos cuentan siempre como gasto del negocio
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditando("nueva")}>+ Nueva tarjeta</button>
      </div>

      {datos.tarjetas.length === 0 && (
        <div className="card empty">
          Todavía no hay tarjetas. Agrega cada una con su día de corte y su día de pago.
        </div>
      )}

      {datos.tarjetas.map((t) => {
        const cs = cortesDe(t.id);
        const pendiente = cortePendiente(t, datos.cortes, hoy);
        const conFalta = cs.find((c) => c.falta_de_lo_estimado > 0);
        return (
          <div key={t.id} className="card" style={{ marginBottom: 16, opacity: t.activa ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <strong style={{ fontSize: 16 }}>💳 {t.nombre}</strong> {t.banco && <span className="sub">· {t.banco}</span>}{" "}
                {!t.activa && <Badge>pausada</Badge>}
                <div className="sub" style={{ fontSize: 12.5 }}>
                  Corta el {t.dia_corte} · se paga el {t.dia_pago} de cada mes
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Saldo estimado hoy</div>
                <div className="value" style={{ fontSize: 20 }}>{money(t.saldo_estimado_hoy)}</div>
                {t.ultimo_corte && (
                  <div className="sub" style={{ fontSize: 11.5 }}>
                    corte {fmtFecha(t.ultimo_corte)} {money(t.saldo_ultimo_corte)} − pagado después {money(t.pagado_despues_del_corte)}
                  </div>
                )}
              </div>
            </div>

            {pendiente && (
              <div className="card" style={{ borderColor: "var(--warn)", padding: "8px 12px", margin: "10px 0" }}>
                <span style={{ color: "var(--warn)" }}>Falta anotar el corte del {fmtFecha(pendiente.fechaCorte)}.</span>{" "}
                <button className="btn" style={{ fontSize: 12 }}
                  onClick={() => setCorte({ tarjeta: t, fechaCorte: pendiente.fechaCorte, fechaPago: pendiente.fechaPago })}>
                  Anotar corte
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
              <button className="btn" onClick={() => {
                const f = hoy;
                setCorte({ tarjeta: t, fechaCorte: f, fechaPago: fechaPagoDeCorte(f, t.dia_pago) });
              }}>
                + Corte (otra fecha)
              </button>
              <button
                className="btn"
                onClick={() =>
                  setPagando({
                    chequeId: `tarjeta-libre:${t.id}`,
                    quien: `Tarjeta ${t.nombre}`,
                    concepto: conFalta ? `corte del ${fmtFecha(conFalta.fecha_corte)}` : "abono",
                    monto: conFalta?.falta_de_lo_estimado ?? 0,
                    fecha: conFalta?.fecha_pago ?? null,
                    medio: "transferencia",
                    numero: "",
                    ambito: "empresa",
                    origen: "tarjeta",
                    tarjetaId: t.id,
                    corteId: conFalta?.id,
                  })
                }
              >
                ✓ Pagar
              </button>
              <button className="btn" onClick={() => setEditando(t)}>Editar</button>
            </div>

            {cs.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Corte</th>
                      <th>Pago</th>
                      <th style={{ textAlign: "right" }}>Saldo</th>
                      <th style={{ textAlign: "right" }}>Mínimo</th>
                      <th style={{ textAlign: "right" }}>Vas a pagar</th>
                      <th style={{ textAlign: "right" }}>Consumo del periodo</th>
                      <th style={{ textAlign: "right" }}>Pagado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cs.map((c) => (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtFecha(c.fecha_corte)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtFecha(c.fecha_pago)}</td>
                        <td className="num">{money(c.saldo_total)}</td>
                        <td className="num">{money(c.pago_minimo)}</td>
                        <td className="num">{money(c.pago_estimado)}</td>
                        <td className="num">{c.consumo == null ? <span className="sub">primer corte</span> : money(c.consumo)}</td>
                        <td className="num">
                          {money(c.pagado_del_corte)}
                          {c.falta_de_lo_estimado > 0 && (
                            <div style={{ fontSize: 11, color: "var(--warn)" }}>faltan {money(c.falta_de_lo_estimado)}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {c.falta_de_lo_estimado > 0 && (
                            <button className="btn" style={{ fontSize: 12 }}
                              onClick={() => setPagando(pagoDeCorte(t, c))}>✓ Pagar</button>
                          )}{" "}
                          <button className="btn" style={{ fontSize: 12 }}
                            onClick={() => setCorte({ tarjeta: t, fechaCorte: c.fecha_corte, fechaPago: c.fecha_pago, existente: c })}>
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="sub" style={{ fontSize: 12.5 }}>Sin cortes anotados todavía.</p>
            )}
          </div>
        );
      })}

      <ModalTarjeta supabase={supabase} tarjeta={editando} onCerrar={() => setEditando(null)} onHecho={hecho} />
      <ModalCorte supabase={supabase} datos={corte} onCerrar={() => setCorte(null)} onHecho={hecho} />
      <ModalPagar supabase={supabase} pago={pagando} onCerrar={() => setPagando(null)} onHecho={hecho} />
    </section>
  );
}

function pagoDeCorte(t: Tarjeta, c: CorteTarjeta): PagoAPagar {
  return {
    chequeId: `tarjeta:${c.id}`,
    quien: `Tarjeta ${t.nombre}`,
    concepto: `corte del ${fmtFecha(c.fecha_corte)} · mínimo ${money(c.pago_minimo)}`,
    monto: c.falta_de_lo_estimado,
    fecha: c.fecha_pago,
    medio: "transferencia",
    numero: "",
    ambito: "empresa",
    origen: "tarjeta",
    tarjetaId: t.id,
    corteId: c.id,
  };
}

// ------------------------------------------------------------
// Tarjeta: crear / editar
// ------------------------------------------------------------

function ModalTarjeta({
  supabase,
  tarjeta,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  tarjeta: Tarjeta | "nueva" | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [id, setId] = useState("");
  const [nombre, setNombre] = useState("");
  const [banco, setBanco] = useState("");
  const [diaCorte, setDiaCorte] = useState("");
  const [diaPago, setDiaPago] = useState("");
  const [activa, setActiva] = useState(true);
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nueva = tarjeta === "nueva";

  useEffect(() => {
    if (!tarjeta) return;
    const t = tarjeta === "nueva" ? null : tarjeta;
    setId(t?.id ?? nuevoId());
    setNombre(t?.nombre ?? "");
    setBanco(t?.banco ?? "");
    setDiaCorte(t ? String(t.dia_corte) : "");
    setDiaPago(t ? String(t.dia_pago) : "");
    setActiva(t?.activa ?? true);
    setNotas(t?.notas ?? "");
    setErr(null);
    setGuardando(false);
  }, [tarjeta]);

  async function guardar() {
    if (guardando) return;
    const dc = parseInt(diaCorte, 10);
    const dp = parseInt(diaPago, 10);
    if (!nombre.trim()) return setErr("Falta el nombre de la tarjeta.");
    if (!(dc >= 1 && dc <= 31) || !(dp >= 1 && dp <= 31)) return setErr("Los días de corte y de pago van del 1 al 31.");
    setGuardando(true);
    setErr(null);
    const fila = { nombre: nombre.trim(), banco: banco.trim(), dia_corte: dc, dia_pago: dp, activa, notas: notas.trim() };
    const { error } = nueva
      ? await supabase.from("tarjetas").upsert({ id, ...fila }, { onConflict: "id", ignoreDuplicates: true })
      : await supabase.from("tarjetas").update(fila).eq("id", id);
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(nueva ? `Tarjeta ${fila.nombre} agregada` : `Tarjeta ${fila.nombre} actualizada`);
  }

  return (
    <Modal
      titulo={nueva ? "Nueva tarjeta" : "Editar tarjeta"}
      abierto={tarjeta != null}
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
        <Campo label="Nombre" requerido>
          <input className="pinput" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Visa Pichincha" />
        </Campo>
        <Campo label="Banco">
          <input className="pinput" value={banco} onChange={(e) => setBanco(e.target.value)} />
        </Campo>
      </Fila>
      <Fila>
        <Campo label="Día de corte" requerido>
          <input className="pinput" type="number" min="1" max="31" value={diaCorte} onChange={(e) => setDiaCorte(e.target.value)} />
        </Campo>
        <Campo label="Día de pago" requerido>
          <input className="pinput" type="number" min="1" max="31" value={diaPago} onChange={(e) => setDiaPago(e.target.value)} />
        </Campo>
      </Fila>
      <Campo label="Notas">
        <input className="pinput" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      {!nueva && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
          Activa (si la pausas, deja de pedir el corte)
        </label>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------
// Corte: saldo total, mínimo y cuánto se va a pagar
// ------------------------------------------------------------

export interface DatosCorte {
  tarjeta: Pick<Tarjeta, "id" | "nombre" | "dia_pago">;
  fechaCorte: string;
  fechaPago: string;
  existente?: CorteTarjeta;
}

export function ModalCorte({
  supabase,
  datos,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  datos: DatosCorte | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [fechaCorte, setFechaCorte] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [saldo, setSaldo] = useState("");
  const [minimo, setMinimo] = useState("");
  const [estimado, setEstimado] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!datos) return;
    const c = datos.existente;
    setFechaCorte(datos.fechaCorte);
    setFechaPago(datos.fechaPago);
    setSaldo(c ? c.saldo_total.toFixed(2) : "");
    setMinimo(c ? c.pago_minimo.toFixed(2) : "");
    setEstimado(c ? c.pago_estimado.toFixed(2) : "");
    setNotas(c?.notas ?? "");
    setErr(null);
    setGuardando(false);
  }, [datos]);

  async function guardar() {
    if (!datos || guardando) return;
    const s = parseFloat(saldo);
    const m = minimo.trim() === "" ? 0 : parseFloat(minimo);
    const e = parseFloat(estimado);
    if (!(s >= 0) || saldo.trim() === "") return setErr("Escribe el saldo total del corte.");
    if (!(m >= 0)) return setErr("El pago mínimo no puede ser negativo.");
    if (!(e >= 0) || estimado.trim() === "") return setErr("Escribe cuánto piensas pagar (puede ser el mínimo o el total).");
    if (!fechaCorte || !fechaPago) return setErr("Faltan las fechas.");
    if (fechaPago < fechaCorte) return setErr("La fecha de pago no puede ser antes del corte.");
    setGuardando(true);
    setErr(null);
    const fila = {
      tarjeta_id: datos.tarjeta.id,
      fecha_corte: fechaCorte,
      fecha_pago: fechaPago,
      saldo_total: s,
      pago_minimo: m,
      pago_estimado: e,
      notas: notas.trim(),
    };
    // un corte por tarjeta y fecha: si ya existe, se corrige (no se duplica)
    const { error } = datos.existente
      ? await supabase.from("tarjeta_cortes").update(fila).eq("id", datos.existente.id)
      : await supabase.from("tarjeta_cortes").upsert({ id: nuevoId(), ...fila }, { onConflict: "tarjeta_id,fecha_corte" });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(`Corte de ${datos.tarjeta.nombre} anotado: vas a pagar ${money(e)} el ${fmtFecha(fechaPago)}`);
  }

  return (
    <Modal
      titulo={datos ? `Corte de ${datos.tarjeta.nombre}` : "Corte"}
      abierto={datos != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar corte"}</button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      <Fila>
        <Campo label="Fecha de corte" requerido>
          <input className="pinput" type="date" value={fechaCorte} disabled={!!datos?.existente}
            onChange={(ev) => {
              setFechaCorte(ev.target.value);
              if (datos && /^\d{4}-\d{2}-\d{2}$/.test(ev.target.value)) setFechaPago(fechaPagoDeCorte(ev.target.value, datos.tarjeta.dia_pago));
            }} />
        </Campo>
        <Campo label="Fecha de pago" requerido>
          <input className="pinput" type="date" value={fechaPago} onChange={(ev) => setFechaPago(ev.target.value)} />
        </Campo>
      </Fila>
      <Fila>
        <Campo label="Saldo total ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={saldo} autoFocus onChange={(ev) => setSaldo(ev.target.value)} />
        </Campo>
        <Campo label="Pago mínimo ($)">
          <input className="pinput" type="number" step="0.01" min="0" value={minimo} onChange={(ev) => setMinimo(ev.target.value)} />
        </Campo>
      </Fila>
      <Campo label="¿Cuánto vas a pagar? ($)" requerido>
        <input className="pinput" type="number" step="0.01" min="0" value={estimado} onChange={(ev) => setEstimado(ev.target.value)} />
      </Campo>
      <div style={{ display: "flex", gap: 6, marginTop: -6, marginBottom: 10 }}>
        <button type="button" className="btn" style={{ fontSize: 12 }} disabled={!minimo} onClick={() => setEstimado(minimo)}>= el mínimo</button>
        <button type="button" className="btn" style={{ fontSize: 12 }} disabled={!saldo} onClick={() => setEstimado(saldo)}>= el total</button>
      </div>
      <Campo label="Notas">
        <input className="pinput" value={notas} onChange={(ev) => setNotas(ev.target.value)} />
      </Campo>
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>
        Lo que vas a pagar entra a la quincena y al mes en la fecha de pago. Al pagar puedes cambiar el monto.
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------
// Aviso en la página principal: "falta anotar el corte"
// ------------------------------------------------------------

/**
 * Se muestra arriba de todas las pestañas cuando una tarjeta ya cortó y no se
 * anotó el corte. Solo aviso en la página: el bot no manda nada por esto.
 */
export function AvisoCortes({ avisar, onCambio }: { avisar: (m: string) => void; onCambio: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [pendientes, setPendientes] = useState<DatosCorte[]>([]);
  const [abierto, setAbierto] = useState<DatosCorte | null>(null);

  const cargar = useCallback(async () => {
    try {
      const { tarjetas, cortes } = await cargarTarjetasYCortes(supabase);
      const hoy = hoyEcuador();
      setPendientes(
        tarjetas.flatMap((t) => {
          const p = cortePendiente(t, cortes, hoy);
          return p ? [{ tarjeta: t, fechaCorte: p.fechaCorte, fechaPago: p.fechaPago }] : [];
        })
      );
    } catch {
      // si falla, la pestaña Tarjetas muestra el error; aquí no se inventa nada
      setPendientes([]);
    }
  }, [supabase]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!pendientes.length) return null;
  return (
    <>
      {pendientes.map((p) => (
        <div key={p.tarjeta.id} className="card"
          style={{ borderColor: "var(--warn)", padding: "10px 16px", marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>
            💳 La tarjeta <strong>{p.tarjeta.nombre}</strong> cortó el {fmtFecha(p.fechaCorte)}. Anota el saldo, el mínimo y cuánto vas a pagar.
          </span>
          <button className="btn primary" style={{ fontSize: 12 }} onClick={() => setAbierto(p)}>Anotar corte</button>
        </div>
      ))}
      <ModalCorte
        supabase={supabase}
        datos={abierto}
        onCerrar={() => setAbierto(null)}
        onHecho={async (m) => {
          setAbierto(null);
          avisar(m);
          await cargar();
          onCambio();
        }}
      />
    </>
  );
}
