"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { money } from "@/lib/finanzas/formato";
import { GANANCIA_POR_PRENDA, nombresFerias, resumenVentas } from "@/lib/finanzas/ingresos";
import { mesDe, sumarDias, type Periodo } from "@/lib/finanzas/periodos";
import type { VentaDirecta } from "@/lib/finanzas/tipos";
import { Modal, Campo, Fila, Badge } from "@/components/ui";
import { BannerError, NavPeriodo, mensajeError, nuevoId, useIngresos } from "./comunes";

/**
 * Ventas directas (en línea y ferias). La plata ya está en mano: cada venta es
 * ingreso del día. Una feria de varios días = un registro por día, con el mismo
 * nombre de feria (se muestran juntos). Cada prenda suma $5 a "Mi sueldo".
 */
export default function VentasDirectas({ avisar }: { avisar: (m: string) => void }) {
  const hoy = hoyEcuador();
  const [periodo, setPeriodo] = useState<Periodo>(() => mesDe(hoy));
  const [form, setForm] = useState<"en_linea" | "feria" | null>(null);
  const { supabase, datos, error, cargando, recargar } = useIngresos();

  const resumen = useMemo(() => (datos ? resumenVentas(datos.ventas, periodo) : null), [datos, periodo]);

  return (
    <section>
      <div className="section-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <NavPeriodo periodo={periodo} onCambiar={setPeriodo} hoy={hoy} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => setForm("feria")}>+ Día de feria</button>
          <button className="btn" onClick={() => setForm("en_linea")}>+ Venta en línea</button>
        </div>
      </div>

      {error ? (
        <BannerError texto={error} />
      ) : cargando && !datos ? (
        <div className="empty">Cargando…</div>
      ) : resumen ? (
        <>
          <div className="cards" style={{ marginBottom: 22 }}>
            <div className="card">
              <div className="label">Vendido en el mes</div>
              <div className="value" style={{ color: "var(--good)" }}>{money(resumen.total)}</div>
              <div className="hint">{resumen.prendas} prenda{resumen.prendas !== 1 ? "s" : ""} · dinero que ya entró</div>
            </div>
            <div className="card">
              <div className="label">Ferias</div>
              <div className="value">{money(resumen.ferias.total)}</div>
              <div className="hint">{resumen.ferias.prendas} prendas en {resumen.ferias.cantidad} día{resumen.ferias.cantidad !== 1 ? "s" : ""}</div>
            </div>
            <div className="card">
              <div className="label">En línea</div>
              <div className="value">{money(resumen.enLinea.total)}</div>
              <div className="hint">{resumen.enLinea.prendas} prendas · {resumen.enLinea.cantidad} registro{resumen.enLinea.cantidad !== 1 ? "s" : ""}</div>
            </div>
            <div className="card">
              <div className="label">Tu sueldo por estas ventas</div>
              <div className="value">{money(resumen.prendas * GANANCIA_POR_PRENDA.fuera)}</div>
              <div className="hint">{resumen.prendas} × {money(GANANCIA_POR_PRENDA.fuera)} (se ve en "Mi sueldo")</div>
            </div>
          </div>

          {!resumen.grupos.length ? (
            <div className="card empty">Sin ventas directas en este mes.</div>
          ) : (
            resumen.grupos.map((g) => (
              <div key={g.clave} className="card" style={{ marginBottom: 12, padding: "10px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <strong>
                    {g.canal === "feria" ? `🎪 ${g.evento}` : "🛒 En línea"}{" "}
                    <span className="sub" style={{ fontWeight: 400 }}>
                      {g.desde === g.hasta ? fmtFecha(g.desde) : `${fmtFecha(g.desde)} – ${fmtFecha(g.hasta)}`}
                    </span>
                  </strong>
                  <span className="num">
                    <strong>{money(g.total)}</strong> · {g.prendas} prenda{g.prendas !== 1 ? "s" : ""}
                  </span>
                </div>
                {g.ventas.map((v: VentaDirecta) => (
                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0",
                    borderTop: "1px solid var(--border)", fontSize: 12.5, marginTop: 6 }}>
                    <span>{fmtFecha(v.fecha)}{v.notas ? ` · ${v.notas}` : ""}</span>
                    <span className="num">{money(v.monto)} · {v.prendas} prenda{v.prendas !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </>
      ) : null}

      <FormVenta
        supabase={supabase}
        canal={form}
        ferias={nombresFerias(datos?.ventas ?? [])}
        onCerrar={() => setForm(null)}
        onGuardado={async (m, seguir) => {
          if (!seguir) setForm(null);
          avisar(m);
          await recargar();
        }}
      />
    </section>
  );
}

function FormVenta({
  supabase,
  canal: canalInicial,
  ferias,
  onCerrar,
  onGuardado,
}: {
  supabase: SupabaseClient;
  canal: "en_linea" | "feria" | null;
  ferias: string[];
  onCerrar: () => void;
  /** seguir = true: queda abierto para el siguiente día de la misma feria */
  onGuardado: (mensaje: string, seguir: boolean) => void;
}) {
  const [id, setId] = useState("");
  const [canal, setCanal] = useState<"en_linea" | "feria">("feria");
  const [evento, setEvento] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [monto, setMonto] = useState("");
  const [prendas, setPrendas] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diasGuardados, setDiasGuardados] = useState(0);

  useEffect(() => {
    if (!canalInicial) return;
    setId(nuevoId());
    setCanal(canalInicial);
    setEvento(""); setFecha(hoyEcuador()); setMonto(""); setPrendas(""); setNotas("");
    setGuardando(false); setErr(null); setDiasGuardados(0);
  }, [canalInicial]);

  const nPrendas = prendas.trim() === "" ? 0 : Number(prendas);

  async function guardar(seguir: boolean) {
    if (guardando) return;
    const m = parseFloat(monto);
    if (canal === "feria" && !evento.trim()) return setErr("Falta el nombre de la feria.");
    if (!(m > 0)) return setErr("El monto vendido debe ser mayor a 0.");
    if (!Number.isInteger(nPrendas) || nPrendas < 0) return setErr("Las prendas deben ser un número entero (0 o más).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return setErr("Falta la fecha.");
    setGuardando(true);
    setErr(null);
    const { data, error } = await supabase.rpc("registrar_venta_directa", {
      p_id: id,
      p_canal: canal,
      p_monto: m,
      p_prendas: nPrendas,
      p_fecha: fecha,
      p_evento: canal === "feria" ? evento.trim() : "",
      p_notas: notas.trim(),
      p_origen: "web",
    });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    const r = data as { resultado?: string } | null;
    const nombre = canal === "feria" ? `feria ${evento.trim()}` : "venta en línea";
    onGuardado(
      r?.resultado === "ya_registrado" ? "Esa venta ya estaba registrada — no se duplicó" : `Registrado: ${nombre}, ${money(m)} (${nPrendas} prendas)`,
      seguir
    );
    if (seguir) {
      // siguiente día de la misma feria: nuevo id, misma feria, día siguiente
      setId(nuevoId());
      setFecha(sumarDias(fecha, 1));
      setMonto(""); setPrendas(""); setNotas("");
      setDiasGuardados((d) => d + 1);
    }
  }

  return (
    <Modal
      titulo={canal === "feria" ? "Día de feria" : "Venta en línea"}
      abierto={canalInicial != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>{diasGuardados ? "Listo" : "Cancelar"}</button>
          {canal === "feria" && (
            <button className="btn" onClick={() => guardar(true)} disabled={guardando}>Guardar y agregar otro día</button>
          )}
          <button className="btn primary" onClick={() => guardar(false)} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      {diasGuardados > 0 && (
        <p style={{ marginTop: 0 }}><Badge color="verde">{diasGuardados} día{diasGuardados !== 1 ? "s" : ""} guardado{diasGuardados !== 1 ? "s" : ""}</Badge> — sigue con el siguiente.</p>
      )}
      <Fila>
        <Campo label="Dónde">
          <select className="pinput" value={canal} onChange={(e) => setCanal(e.target.value as "en_linea" | "feria")} disabled={diasGuardados > 0}>
            <option value="feria">Feria</option>
            <option value="en_linea">En línea</option>
          </select>
        </Campo>
        {canal === "feria" && (
          <Campo label="Nombre de la feria" requerido>
            <input className="pinput" list="fin-ferias" value={evento} onChange={(e) => setEvento(e.target.value)} disabled={diasGuardados > 0} />
            <datalist id="fin-ferias">
              {ferias.map((f) => <option key={f} value={f} />)}
            </datalist>
          </Campo>
        )}
      </Fila>
      <Fila>
        <Campo label="Fecha" requerido>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo label="Vendido ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo label="Prendas">
          <input className="pinput" type="number" step="1" min="0" value={prendas} onChange={(e) => setPrendas(e.target.value)} />
        </Campo>
      </Fila>
      {nPrendas > 0 && Number.isInteger(nPrendas) && (
        <p className="sub" style={{ fontSize: 12.5, marginTop: -4 }}>
          Tu sueldo: {nPrendas} × {money(GANANCIA_POR_PRENDA.fuera)} = <strong>{money(nPrendas * GANANCIA_POR_PRENDA.fuera)}</strong>
        </p>
      )}
      <Campo label="Notas">
        <input className="pinput" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
    </Modal>
  );
}
