"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Modal, Campo, Fila } from "@/components/ui";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { money, aCentavos } from "@/lib/finanzas/formato";
import { MEDIOS } from "@/lib/finanzas/categorias";
import type { Deuda, Medio } from "@/lib/finanzas/tipos";
import { EtiquetaAmbito, mensajeError, nuevoId } from "./comunes";

export interface PagoAPagar {
  chequeId: string;
  quien: string;
  concepto: string;
  monto: number;
  fecha: string | null;
  medio: string;
  numero: string;
  ambito: "empresa" | "personal";
}

/**
 * Pagar un pago programado: la base lo marca pagado Y registra el gasto en
 * una sola operación (pagar_cuota). Si ya estaba pagado no duplica nada.
 */
export function ModalPagar({
  supabase,
  pago,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  pago: PagoAPagar | null;
  onCerrar: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [fecha, setFecha] = useState(hoyEcuador());
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (pago) {
      setFecha(hoyEcuador());
      setErr(null);
      setGuardando(false);
    }
  }, [pago]);

  async function confirmar() {
    if (!pago || guardando) return;
    setGuardando(true);
    setErr(null);
    const { data, error } = await supabase.rpc("pagar_cuota", {
      p_cheque_id: pago.chequeId,
      p_fecha: fecha,
      p_origen: "web",
    });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    const r = data as { resultado?: string } | null;
    onHecho(
      r?.resultado === "ya_pagado"
        ? "Ya estaba pagado — no se registró nada nuevo"
        : `Pagado ${money(pago.monto)} a ${pago.quien} y registrado como gasto (${pago.ambito})`
    );
  }

  return (
    <Modal
      titulo="Registrar pago"
      abierto={pago != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={confirmar} disabled={guardando || !fecha}>
            {guardando ? "Guardando…" : "Confirmar pago"}
          </button>
        </>
      }
    >
      {pago && (
        <>
          {err && <div className="error-banner">{err}</div>}
          <p style={{ marginTop: 0 }}>
            <strong>{pago.quien}</strong> <EtiquetaAmbito ambito={pago.ambito} />
            {pago.concepto && <span className="sub"> · {pago.concepto}</span>}
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            {pago.medio}{pago.numero ? ` #${pago.numero}` : ""} · programado para {fmtFecha(pago.fecha)}
          </p>
          <p style={{ fontSize: 22, margin: "6px 0 14px" }}>{money(pago.monto)}</p>
          <Campo label="Fecha en que se pagó" requerido>
            <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <p className="sub" style={{ fontSize: 12 }}>
            Se marca como pagado y se registra el gasto
            {pago.ambito === "personal" ? " con ámbito personal (no entra a la rentabilidad del negocio)" : ""}.
          </p>
        </>
      )}
    </Modal>
  );
}

/**
 * Abonar a una deuda sin pagos programados (flexibles, sueldo, deudas
 * anteriores informativas). El id de operación se crea al abrir: si se
 * envía dos veces, la base registra uno solo.
 */
export function ModalAbonar({
  supabase,
  deuda,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  deuda: Deuda | null;
  onCerrar: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [idOperacion, setIdOperacion] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [medio, setMedio] = useState<Medio>("efectivo");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (deuda) {
      setIdOperacion(nuevoId());
      setMonto("");
      setFecha(hoyEcuador());
      setMedio("efectivo");
      setNotas("");
      setErr(null);
      setGuardando(false);
    }
  }, [deuda]);

  async function confirmar() {
    if (!deuda || guardando) return;
    const m = parseFloat(monto);
    if (!(m > 0)) return setErr("El abono debe ser mayor a 0.");
    if (aCentavos(m) > aCentavos(deuda.sin_programar)) {
      return setErr(`El abono no puede pasar de lo que queda sin programar (${money(deuda.sin_programar)}).`);
    }
    setGuardando(true);
    setErr(null);
    const { data, error } = await supabase.rpc("abonar_deuda", {
      p_deuda_id: deuda.id,
      p_monto: m,
      p_id_operacion: idOperacion,
      p_fecha: fecha,
      p_medio: medio,
      p_origen: "web",
      p_notas: notas.trim(),
    });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    const r = data as { resultado?: string } | null;
    onHecho(
      r?.resultado === "ya_registrado"
        ? "Ese abono ya estaba registrado — no se duplicó"
        : `Abono de ${money(m)} a ${deuda.proveedor} registrado`
    );
  }

  return (
    <Modal
      titulo="Registrar abono"
      abierto={deuda != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={confirmar} disabled={guardando}>
            {guardando ? "Guardando…" : "Registrar abono"}
          </button>
        </>
      }
    >
      {deuda && (
        <>
          {err && <div className="error-banner">{err}</div>}
          <p style={{ marginTop: 0 }}>
            <strong>{deuda.proveedor}</strong> <EtiquetaAmbito ambito={deuda.ambito} />
            {deuda.concepto && <span className="sub"> · {deuda.concepto}</span>}
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            Saldo {money(deuda.saldo)} · sin programar {money(deuda.sin_programar)}
          </p>
          <Fila>
            <Campo label="Monto ($)" requerido>
              <input className="pinput" type="number" step="0.01" min="0" value={monto}
                onChange={(e) => setMonto(e.target.value)} />
            </Campo>
            <Campo label="Fecha" requerido>
              <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
            <Campo label="Medio">
              <select className="pinput" value={medio} onChange={(e) => setMedio(e.target.value as Medio)}>
                {MEDIOS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </Campo>
          </Fila>
          <Campo label="Notas">
            <input className="pinput" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Campo>
          {deuda.tipo_deuda === "sueldo" && (
            <p className="sub" style={{ fontSize: 12 }}>
              Retiro de sueldo: sale de caja, pero no cuenta como gasto nuevo en la rentabilidad.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
