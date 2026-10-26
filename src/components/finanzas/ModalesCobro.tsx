"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Modal, Campo, Fila } from "@/components/ui";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { money, aCentavos } from "@/lib/finanzas/formato";
import { MEDIOS } from "@/lib/finanzas/categorias";
import { GANANCIA_POR_PRENDA, repartoAbono } from "@/lib/finanzas/ingresos";
import type { FacturaCobrar, Medio } from "@/lib/finanzas/tipos";
import { mensajeError, nuevoId } from "./comunes";

/**
 * Nueva factura por cobrar, o EDITAR una que ya existe (`factura`).
 * Nueva: se guarda con un id creado al abrir el formulario; si "Guardar" llega
 * dos veces, la base ignora la segunda (no duplica).
 * Editar: la base no deja que quede "abonado más de lo facturado" (fase 5A-2).
 * La ganancia por prenda la pone la base; aquí solo se muestra.
 */
export function FormFactura({
  supabase,
  abierto,
  esVatex: esVatexInicial,
  factura,
  clientes,
  onCerrar,
  onGuardado,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  esVatex: boolean;
  /** si viene, se edita esta factura en vez de crear una nueva */
  factura?: FacturaCobrar | null;
  /** clientes que no son VATEX, para elegir en vez de escribir */
  clientes: string[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const editando = factura != null;
  const [anular, setAnular] = useState(false);
  const [id, setId] = useState("");
  const [esVatex, setEsVatex] = useState(esVatexInicial);
  const [cliente, setCliente] = useState("");
  const [numero, setNumero] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [prendas, setPrendas] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [esperada, setEsperada] = useState("");
  const [esInicial, setEsInicial] = useState(false);
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setGuardando(false); setErr(null); setAnular(false);
    if (factura) {
      // editar: se llena con lo guardado
      setId(factura.id);
      setEsVatex(factura.es_vatex);
      setCliente(factura.es_vatex ? "" : factura.cliente);
      setNumero(factura.numero_factura); setConcepto(factura.concepto);
      setMonto(String(factura.monto)); setPrendas(factura.prendas ? String(factura.prendas) : "");
      setFecha(factura.fecha_factura); setEsperada(factura.fecha_esperada ?? "");
      setEsInicial(factura.es_saldo_inicial); setNotas(factura.notas);
      return;
    }
    setId(nuevoId());
    setEsVatex(esVatexInicial);
    setCliente(""); setNumero(""); setConcepto(""); setMonto(""); setPrendas("");
    setFecha(hoyEcuador()); setEsperada(""); setEsInicial(false); setNotas("");
  }, [abierto, esVatexInicial, factura]);

  const nPrendas = prendas.trim() === "" ? 0 : Number(prendas);
  const tarifa = esVatex ? GANANCIA_POR_PRENDA.vatex : GANANCIA_POR_PRENDA.fuera;

  async function guardar() {
    if (guardando) return;
    const m = parseFloat(monto);
    if (!esVatex && !cliente.trim()) return setErr("Falta el cliente.");
    if (!(m > 0)) return setErr("El monto debe ser mayor a 0.");
    if (!Number.isInteger(nPrendas) || nPrendas < 0) return setErr("Las prendas deben ser un número entero (0 o más).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return setErr("Falta la fecha de la factura.");
    setGuardando(true);
    setErr(null);
    const campos = {
      cliente: esVatex ? "VATEX" : cliente.trim(),
      es_vatex: esVatex,
      numero_factura: numero.trim(),
      concepto: concepto.trim(),
      monto: m,
      prendas: nPrendas,
      fecha_factura: fecha,
      fecha_vencimiento: esperada || null,
      es_saldo_inicial: esInicial,
      notas: notas.trim(),
    };
    const { error } = editando
      ? await supabase.from("cuentas_por_cobrar").update({ ...campos, anulada: anular }).eq("id", id)
      : await supabase.from("cuentas_por_cobrar").upsert({ id, ...campos }, { onConflict: "id", ignoreDuplicates: true });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    const quien = esVatex ? "VATEX" : cliente.trim();
    onGuardado(
      !editando
        ? `Factura de ${quien} por ${money(m)} registrada`
        : anular
          ? `Factura de ${quien} anulada`
          : `Factura de ${quien} actualizada${nPrendas ? ` · tu sueldo: ${nPrendas} × ${money(tarifa)}` : ""}`
    );
  }

  return (
    <Modal
      titulo={editando ? "Editar factura" : esVatex ? "Nueva factura de VATEX" : "Nueva factura por cobrar"}
      abierto={abierto}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : editando ? (anular ? "Anular factura" : "Guardar cambios") : "Guardar factura"}
          </button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      {editando && factura && factura.cobrado > 0 && (
        <p className="sub" style={{ fontSize: 12.5, marginTop: 0 }}>
          Ya te abonaron {money(factura.cobrado)} de esta factura. Si bajas el monto, ese abono pasa solo a la
          siguiente factura; lo que no se puede es que quede abonado más de lo facturado.
        </p>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={esVatex} onChange={(e) => setEsVatex(e.target.checked)} />
        Es de VATEX
      </label>
      {!esVatex && (
        <Campo label="Cliente" requerido>
          <input className="pinput" list="fin-clientes" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          <datalist id="fin-clientes">
            {clientes.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Campo>
      )}
      <Fila>
        <Campo label="Monto ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo label="Prendas vendidas">
          <input className="pinput" type="number" step="1" min="0" value={prendas} onChange={(e) => setPrendas(e.target.value)} />
        </Campo>
      </Fila>
      {nPrendas > 0 && Number.isInteger(nPrendas) && (
        <p className="sub" style={{ fontSize: 12.5, marginTop: -4 }}>
          Tu sueldo: {nPrendas} × {money(tarifa)} = <strong>{money(nPrendas * tarifa)}</strong> (se suma a lo que la empresa te debe)
        </p>
      )}
      <Fila>
        <Campo label="N.º de factura">
          <input className="pinput" value={numero} onChange={(e) => setNumero(e.target.value)} />
        </Campo>
        <Campo label="Fecha de la factura" requerido>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo label="¿Cuándo esperas cobrarla?">
          <input className="pinput" type="date" value={esperada} onChange={(e) => setEsperada(e.target.value)} />
        </Campo>
      </Fila>
      <Campo label="Concepto">
        <input className="pinput" value={concepto} onChange={(e) => setConcepto(e.target.value)}
          placeholder={esVatex ? "ej. liquidación 1–15 octubre" : ""} />
      </Campo>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "4px 0 12px" }}>
        <input type="checkbox" checked={esInicial} onChange={(e) => setEsInicial(e.target.checked)} />
        Viene de antes del 1 de octubre de 2026
      </label>
      <Campo label="Notas">
        <textarea className="pinput" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      {editando && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--bad)" }}>
          <input type="checkbox" checked={anular} onChange={(e) => setAnular(e.target.checked)} />
          Anular esta factura (se equivocó; deja de contar en lo que te deben y en tu sueldo)
        </label>
      )}
    </Modal>
  );
}

export interface CuentaAbonar {
  cliente: string;
  esVatex: boolean;
  saldo: number;
  facturas: FacturaCobrar[];
}

/**
 * Registrar un abono que me hacen. Va a la CUENTA del cliente: la base lo
 * aplica a la factura más antigua primero (aquí se muestra cómo quedará).
 * Es dinero que entra: crea su ingreso.
 */
export function ModalAbonoCobro({
  supabase,
  cuenta,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  cuenta: CuentaAbonar | null;
  onCerrar: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [id, setId] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [medio, setMedio] = useState<Medio>("transferencia");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!cuenta) return;
    setId(nuevoId());
    setMonto(""); setFecha(hoyEcuador()); setMedio("transferencia"); setNotas("");
    setGuardando(false); setErr(null);
  }, [cuenta]);

  const m = parseFloat(monto);
  const vista = useMemo(
    () => (cuenta && m > 0 ? repartoAbono(cuenta.facturas, m) : []),
    [cuenta, m]
  );
  const porId = new Map((cuenta?.facturas ?? []).map((f) => [f.id, f]));

  async function guardar() {
    if (!cuenta || guardando) return;
    if (!(m > 0)) return setErr("El abono debe ser mayor a 0.");
    if (aCentavos(m) > aCentavos(cuenta.saldo)) {
      return setErr(`El abono no puede pasar de lo que te debe ${cuenta.cliente} (${money(cuenta.saldo)}).`);
    }
    setGuardando(true);
    setErr(null);
    const { data, error } = await supabase.rpc("registrar_cobro", {
      p_id: id,
      p_cliente: cuenta.cliente,
      p_es_vatex: cuenta.esVatex,
      p_monto: m,
      p_fecha: fecha,
      p_medio: medio,
      p_notas: notas.trim(),
      p_origen: "web",
    });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    const r = data as { resultado?: string; saldo_restante?: number } | null;
    onHecho(
      r?.resultado === "ya_registrado"
        ? "Ese abono ya estaba registrado — no se duplicó"
        : `Abono de ${money(m)} de ${cuenta.cliente} registrado. Te sigue debiendo ${money(Number(r?.saldo_restante ?? 0))}`
    );
  }

  return (
    <Modal
      titulo={cuenta ? `Abono de ${cuenta.cliente}` : "Abono"}
      abierto={cuenta != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Registrar abono"}
          </button>
        </>
      }
    >
      {cuenta && (
        <>
          {err && <div className="error-banner">{err}</div>}
          <p style={{ marginTop: 0 }}>
            Te debe en total <strong>{money(cuenta.saldo)}</strong>
          </p>
          <Fila>
            <Campo label="¿Cuánto te abonó? ($)" requerido>
              <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
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
          {vista.length > 0 && (
            <div className="card" style={{ padding: "8px 14px", fontSize: 12.5 }}>
              <div className="label" style={{ marginBottom: 4 }}>Se aplica a la factura más antigua primero:</div>
              {vista.map((v) => {
                const f = porId.get(v.id);
                return (
                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
                    <span>
                      {fmtFecha(f?.fecha_factura)}{f?.numero_factura ? ` · #${f.numero_factura}` : ""}{f?.concepto ? ` · ${f.concepto}` : ""}
                    </span>
                    <span className="num">
                      {money(v.aplica)} {v.quedaDebiendo > 0 ? `(queda ${money(v.quedaDebiendo)})` : "✓ cubierta"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
