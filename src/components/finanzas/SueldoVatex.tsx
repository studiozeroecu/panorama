"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Campo, Fila, Modal } from "@/components/ui";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { money } from "@/lib/finanzas/formato";
import { cargarSueldoVatex, ErrorCarga } from "@/lib/finanzas/cargar";
import {
  resumenSueldoVatex,
  type PagoSueldoVatex,
  type TarifaSueldoVatex,
} from "@/lib/finanzas/sueldoVatex";
import { BannerError, mensajeError, nuevoId } from "./comunes";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

/**
 * Sueldo PERSONAL que VATEX le paga al dueño ($300 al mes). No es de Bear &
 * Trend: no toca caja, gastos ni rentabilidad. Carga por su cuenta, así un
 * fallo aquí no tapa "Mi sueldo" por prendas.
 */
export default function SueldoVatex({ avisar }: { avisar: (m: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const hoy = hoyEcuador();
  const [tarifas, setTarifas] = useState<TarifaSueldoVatex[] | null>(null);
  const [pagos, setPagos] = useState<PagoSueldoVatex[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [borrando, setBorrando] = useState<PagoSueldoVatex | null>(null);

  const recargar = useCallback(async () => {
    try {
      const d = await cargarSueldoVatex(supabase);
      setTarifas(d.tarifas);
      setPagos(d.pagos);
      setError(null);
    } catch (e) {
      setTarifas(null);
      setError(e instanceof ErrorCarga ? e.message : `No se pudo cargar el sueldo de VATEX. (${mensajeError(e)})`);
    }
  }, [supabase]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const hecho = async (m: string) => {
    setCobrando(false);
    setCambiando(false);
    setBorrando(null);
    avisar(m);
    await recargar();
  };

  const r = useMemo(() => (tarifas ? resumenSueldoVatex(tarifas, pagos, hoy) : null), [tarifas, pagos, hoy]);
  const vigente = tarifas?.length ? tarifas[tarifas.length - 1] : null;

  return (
    <div style={{ marginTop: 34, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div className="section-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Sueldo de VATEX (personal)</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Lo que VATEX te paga a ti. No es de Bear & Trend: no entra a la caja ni a los gastos.
          </p>
        </div>
        {r && tarifas && tarifas.length > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setCambiando(true)}>Cambiar sueldo</button>
            <button className="btn primary" onClick={() => setCobrando(true)}>Me pagaron</button>
          </div>
        )}
      </div>

      {error ? (
        <BannerError texto={error} />
      ) : !r || !tarifas ? (
        <div className="empty">Cargando…</div>
      ) : tarifas.length === 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <p style={{ marginTop: 0 }}>Todavía no está configurado. Dime cuánto te paga VATEX y desde qué mes te debe.</p>
          <button className="btn primary" onClick={() => setCambiando(true)}>Configurar sueldo de VATEX</button>
        </div>
      ) : (
        <>
          <div className="cards" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="label">VATEX te debe</div>
              <div className="value" style={{ color: r.teDebe > 0 ? "var(--warn)" : "var(--good)" }}>{money(r.teDebe)}</div>
              <div className="hint">
                {r.meses.filter((m) => m.falta > 0).length} mes(es) sin pagar completo
                {r.aFavor > 0 && ` · adelantado ${money(r.aFavor)}`}
              </div>
            </div>
            <div className="card">
              <div className="label">Sueldo actual</div>
              <div className="value">{money(vigente?.monto ?? 0)}</div>
              <div className="hint">
                {r.proximo ? `el próximo: ${nombreMes(r.proximo.mes)}, el ${fmtFecha(r.proximo.fechaPago)}` : "sin sueldo vigente"}
              </div>
            </div>
            <div className="card">
              <div className="label">Desde el inicio</div>
              <div className="value" style={{ fontSize: 20 }}>{money(r.totalSueldo)}</div>
              <div className="hint">te han pagado {money(r.totalPagado)}</div>
            </div>
          </div>

          {r.meses.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th style={{ textAlign: "right" }}>Sueldo</th>
                    <th style={{ textAlign: "right" }}>Pagado</th>
                    <th style={{ textAlign: "right" }}>Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.meses].reverse().map((m) => (
                    <tr key={m.mes}>
                      <td style={{ textTransform: "capitalize" }}>
                        {nombreMes(m.mes)}
                        <div className="sub" style={{ fontSize: 11, textTransform: "none" }}>tocaba el {fmtFecha(m.fechaPago)}</div>
                      </td>
                      <td className="num">{money(m.sueldo)}</td>
                      <td className="num">{money(m.pagado)}</td>
                      <td className="num" style={{ color: m.falta > 0 ? "var(--warn)" : "var(--good)" }}>
                        {m.falta > 0 ? money(m.falta) : "✓"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card empty">Todavía no llega el primer día de pago.</div>
          )}

          {pagos.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer" }}><strong>Pagos recibidos ({pagos.length})</strong></summary>
              <div className="card" style={{ padding: "6px 16px", marginTop: 8 }}>
                {[...pagos].reverse().map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <span>
                      {fmtFecha(p.fecha)}
                      {p.notas && <span className="sub"> · {p.notas}</span>}
                    </span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="num">{money(p.monto)}</span>
                      <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setBorrando(p)}>Borrar</button>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <p className="sub" style={{ fontSize: 12, marginTop: 12 }}>
            Cada pago se aplica primero al mes más antiguo.
          </p>
        </>
      )}

      <ModalCobro supabase={supabase} abierto={cobrando} sugerido={r?.teDebe ?? 0} unMes={vigente?.monto ?? 0} onCerrar={() => setCobrando(false)} onHecho={hecho} />
      <ModalTarifa supabase={supabase} abierto={cambiando} primera={!tarifas?.length} vigente={vigente}
        onCerrar={() => setCambiando(false)} onHecho={hecho} />
      <ModalBorrarPago supabase={supabase} pago={borrando} onCerrar={() => setBorrando(null)} onHecho={hecho} />
    </div>
  );
}

// ------------------------------------------------------------
// "Me pagaron"
// ------------------------------------------------------------

function ModalCobro({
  supabase,
  abierto,
  sugerido,
  unMes,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  sugerido: number;
  unMes: number;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [id, setId] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setId(nuevoId());
    setMonto("");
    setFecha(hoyEcuador());
    setNotas("");
    setErr(null);
    setGuardando(false);
  }, [abierto]);

  async function guardar() {
    if (guardando) return;
    const m = parseFloat(monto);
    if (!(m > 0)) return setErr("El monto debe ser mayor a 0.");
    if (!fecha || fecha > hoyEcuador()) return setErr("La fecha no puede ser futura.");
    setGuardando(true);
    setErr(null);
    // el id se creó al abrir: si "Guardar" llega dos veces, no se duplica
    const { error } = await supabase
      .from("sueldo_vatex_pagos")
      .upsert({ id, monto: m, fecha, notas: notas.trim() }, { onConflict: "id", ignoreDuplicates: true });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(`Pago de VATEX por ${money(m)} anotado`);
  }

  return (
    <Modal
      titulo="VATEX me pagó"
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
        <Campo label="Cuánto te pagaron ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} autoFocus onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo label="Fecha" requerido>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
      </Fila>
      {sugerido > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: -6, marginBottom: 10 }}>
          {unMes > 0 && (
            <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => setMonto(unMes.toFixed(2))}>
              {money(unMes)} (un mes)
            </button>
          )}
          <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => setMonto(sugerido.toFixed(2))}>
            Todo lo que debe ({money(sugerido)})
          </button>
        </div>
      )}
      <Campo label="Notas">
        <input className="pinput" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="ej. transferencia" />
      </Campo>
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>
        Es plata tuya: no se registra como ingreso de Bear & Trend.
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------
// Configurar / cambiar el sueldo (desde un mes en adelante)
// ------------------------------------------------------------

function ModalTarifa({
  supabase,
  abierto,
  primera,
  vigente,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  primera: boolean;
  vigente: TarifaSueldoVatex | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [mes, setMes] = useState("");
  const [monto, setMonto] = useState("300");
  const [dia, setDia] = useState("30");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setMes(hoyEcuador().slice(0, 7));
    setMonto(vigente ? String(vigente.monto) : "300");
    setDia(vigente ? String(vigente.dia_pago) : "30");
    setErr(null);
    setGuardando(false);
  }, [abierto, vigente]);

  async function guardar() {
    if (guardando) return;
    const m = parseFloat(monto);
    const d = parseInt(dia, 10);
    if (!/^\d{4}-\d{2}$/.test(mes)) return setErr("Elige el mes.");
    if (!(m >= 0) || monto.trim() === "") return setErr("Escribe el sueldo (0 si VATEX ya no te paga sueldo).");
    if (!(d >= 1 && d <= 31)) return setErr("El día de pago va del 1 al 31.");
    setGuardando(true);
    setErr(null);
    // un valor por mes: si ya había uno ese mes, se corrige
    const { error } = await supabase
      .from("sueldo_vatex_tarifas")
      .upsert({ id: nuevoId(), desde: `${mes}-01`, monto: m, dia_pago: d }, { onConflict: "desde" });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(m > 0 ? `Sueldo de VATEX: ${money(m)} desde ${nombreMes(mes)}` : `Sin sueldo de VATEX desde ${nombreMes(mes)}`);
  }

  return (
    <Modal
      titulo={primera ? "Configurar sueldo de VATEX" : "Cambiar sueldo de VATEX"}
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
        <Campo label={primera ? "¿Desde qué mes te debe?" : "Desde el mes"} requerido>
          <input className="pinput" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </Campo>
        <Campo label="Sueldo al mes ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo label="Día en que te toca">
          <input className="pinput" type="number" min="1" max="31" value={dia} onChange={(e) => setDia(e.target.value)} />
        </Campo>
      </Fila>
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>
        {primera
          ? "Pon el primer mes que VATEX no te pagó (o el primero que quieras llevar). Si alguno ya te lo pagaron, después lo anotas con \"Me pagaron\"."
          : "Los meses de antes se quedan con el valor que tenían. Pon 0 si VATEX deja de pagarte sueldo."}
        {" "}Si el día no existe en el mes (31 en febrero), cuenta el último día.
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------
// Borrar un pago anotado por error
// ------------------------------------------------------------

function ModalBorrarPago({
  supabase,
  pago,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  pago: PagoSueldoVatex | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (pago) {
      setErr(null);
      setGuardando(false);
    }
  }, [pago]);

  async function borrar() {
    if (!pago || guardando) return;
    setGuardando(true);
    const { error } = await supabase.from("sueldo_vatex_pagos").delete().eq("id", pago.id);
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(`Pago de ${money(pago.monto)} borrado`);
  }

  return (
    <Modal
      titulo="Borrar pago"
      abierto={pago != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={borrar} disabled={guardando}>{guardando ? "Borrando…" : "Sí, borrar"}</button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      {pago && (
        <p style={{ margin: 0 }}>
          ¿Borrar el pago de <strong>{money(pago.monto)}</strong> del {fmtFecha(pago.fecha)}? Lo que VATEX te debe vuelve a
          subir en ese valor.
        </p>
      )}
    </Modal>
  );
}
