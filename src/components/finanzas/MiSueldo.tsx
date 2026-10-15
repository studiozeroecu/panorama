"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { aCentavos, money } from "@/lib/finanzas/formato";
import { MEDIOS } from "@/lib/finanzas/categorias";
import { GANANCIA_POR_PRENDA, repartoAbono, resumenSueldo } from "@/lib/finanzas/ingresos";
import { mesDe, type Periodo } from "@/lib/finanzas/periodos";
import type { Medio, RegistroSueldo } from "@/lib/finanzas/tipos";
import { Modal, Campo, Fila, Badge } from "@/components/ui";
import { BannerError, NavPeriodo, mensajeError, nuevoId, useIngresos } from "./comunes";

/**
 * Mi sueldo: cada prenda vendida te genera ganancia (VATEX $2,50, fuera $5).
 * Eso es una deuda de la empresa contigo; te pagas por partes y cada pago se
 * descuenta del registro más antiguo (lo calcula la base). Cuenta como gasto
 * del negocio UNA vez, al ganarse; tus pagos no se vuelven a contar.
 */
export default function MiSueldo({ avisar }: { avisar: (m: string) => void }) {
  const hoy = hoyEcuador();
  const [periodo, setPeriodo] = useState<Periodo>(() => mesDe(hoy));
  const [pagando, setPagando] = useState(false);
  const { supabase, datos, error, cargando, recargar } = useIngresos();

  const resumen = useMemo(
    () => (datos ? resumenSueldo(datos.registrosSueldo, datos.pagosSueldo, periodo) : null),
    [datos, periodo]
  );
  const pendientes = (datos?.registrosSueldo ?? []).filter((r) => r.saldo > 0);

  return (
    <section>
      <div className="section-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <NavPeriodo periodo={periodo} onCambiar={setPeriodo} hoy={hoy} />
        {datos && datos.sueldo.saldo > 0 && (
          <button className="btn primary" onClick={() => setPagando(true)}>Pagarme</button>
        )}
      </div>

      {error ? (
        <BannerError texto={error} />
      ) : cargando && !datos ? (
        <div className="empty">Cargando…</div>
      ) : datos && resumen ? (
        <>
          <div className="cards" style={{ marginBottom: 22 }}>
            <div className="card">
              <div className="label">La empresa te debe</div>
              <div className="value" style={{ color: datos.sueldo.saldo > 0 ? "var(--warn)" : undefined }}>
                {money(datos.sueldo.saldo)}
              </div>
              <div className="hint">ganado {money(datos.sueldo.ganado)} · pagado {money(datos.sueldo.pagado)} (desde el inicio)</div>
            </div>
            <div className="card">
              <div className="label">Ganado en {periodo.etiqueta}</div>
              <div className="value">{money(resumen.ganado)}</div>
              <div className="hint">
                VATEX {resumen.prendasVatex} × {money(GANANCIA_POR_PRENDA.vatex)} = {money(resumen.ganadoVatex)} · fuera{" "}
                {resumen.prendasFuera} × {money(GANANCIA_POR_PRENDA.fuera)} = {money(resumen.ganadoFuera)}
              </div>
            </div>
            <div className="card">
              <div className="label">Te pagaste en {periodo.etiqueta}</div>
              <div className="value" style={{ color: "var(--good)" }}>{money(resumen.pagado)}</div>
              <div className="hint">{resumen.pagos.length} pago{resumen.pagos.length !== 1 ? "s" : ""}</div>
            </div>
          </div>

          <h3 style={{ marginBottom: 8 }}>Pendiente de pagarte (el más antiguo primero)</h3>
          {pendientes.length ? (
            <TablaRegistros registros={pendientes} />
          ) : (
            <div className="card empty">No te deben nada de sueldo.</div>
          )}

          <details style={{ marginTop: 18 }}>
            <summary style={{ cursor: "pointer" }}>
              <strong>Lo ganado en {periodo.etiqueta} ({resumen.registros.length})</strong>
            </summary>
            <div style={{ marginTop: 8 }}>
              {resumen.registros.length ? <TablaRegistros registros={resumen.registros} /> : <div className="card empty">Nada en este periodo.</div>}
            </div>
          </details>

          {resumen.pagos.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer" }}>
                <strong>Tus pagos en {periodo.etiqueta} — {money(resumen.pagado)}</strong>
              </summary>
              <div className="card" style={{ padding: "6px 14px", marginTop: 8 }}>
                {[...resumen.pagos].reverse().map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0",
                    borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                    <span>{fmtFecha(p.fecha)} · {p.medio}{p.notas ? ` · ${p.notas}` : ""}</span>
                    <span className="num">{money(p.monto)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="sub" style={{ marginTop: 22, fontSize: 12.5 }}>
            Tu sueldo cuenta como gasto del negocio cuando lo ganas (al registrar la factura o la venta). Cuando te
            pagas, el dinero sale de caja pero no se vuelve a contar como gasto.
          </p>
        </>
      ) : null}

      <ModalPagarme
        supabase={supabase}
        abierto={pagando}
        saldo={datos?.sueldo.saldo ?? 0}
        pendientes={pendientes}
        onCerrar={() => setPagando(false)}
        onHecho={async (m) => {
          setPagando(false);
          avisar(m);
          await recargar();
        }}
      />
    </section>
  );
}

function TablaRegistros({ registros }: { registros: RegistroSueldo[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>De dónde</th>
            <th style={{ textAlign: "right" }}>Prendas</th>
            <th style={{ textAlign: "right" }}>Ganado</th>
            <th style={{ textAlign: "right" }}>Pagado</th>
            <th style={{ textAlign: "right" }}>Falta</th>
          </tr>
        </thead>
        <tbody>
          {registros.map((r) => (
            <tr key={`${r.fuente}-${r.fuente_id}`} style={r.saldo <= 0 ? { opacity: 0.55 } : undefined}>
              <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
              <td>
                {r.descripcion} {r.en_vatex ? <Badge color="azul">VATEX</Badge> : <Badge>fuera</Badge>}
              </td>
              <td className="num">{r.prendas} × {money(r.ganancia_por_prenda)}</td>
              <td className="num">{money(r.monto)}</td>
              <td className="num">{money(r.pagado)}</td>
              <td className="num"><strong>{money(r.saldo)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModalPagarme({
  supabase,
  abierto,
  saldo,
  pendientes,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  saldo: number;
  pendientes: RegistroSueldo[];
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
    if (!abierto) return;
    setId(nuevoId());
    setMonto(""); setFecha(hoyEcuador()); setMedio("transferencia"); setNotas("");
    setGuardando(false); setErr(null);
  }, [abierto]);

  const m = parseFloat(monto);
  // misma regla que la base: al registro más antiguo primero
  const vista = useMemo(
    () =>
      m > 0
        ? repartoAbono(
            pendientes.map((r) => ({ id: `${r.fuente}-${r.fuente_id}`, fecha_factura: r.fecha, created_at: "", saldo: r.saldo, anulada: false })),
            m
          )
        : [],
    [pendientes, m]
  );
  const porId = new Map(pendientes.map((r) => [`${r.fuente}-${r.fuente_id}`, r]));

  async function guardar() {
    if (guardando) return;
    if (!(m > 0)) return setErr("El pago debe ser mayor a 0.");
    if (aCentavos(m) > aCentavos(saldo)) return setErr(`No puedes pagarte más de lo que te deben (${money(saldo)}).`);
    setGuardando(true);
    setErr(null);
    const { data, error } = await supabase.rpc("pagar_mi_sueldo", {
      p_id: id,
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
        ? "Ese pago ya estaba registrado — no se duplicó"
        : `Te pagaste ${money(m)}. La empresa te sigue debiendo ${money(Number(r?.saldo_restante ?? 0))}`
    );
  }

  return (
    <Modal
      titulo="Pagarme sueldo"
      abierto={abierto}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Registrar pago"}
          </button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      <p style={{ marginTop: 0 }}>La empresa te debe <strong>{money(saldo)}</strong></p>
      <Fila>
        <Campo label="¿Cuánto te pagas? ($)" requerido>
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
          <div className="label" style={{ marginBottom: 4 }}>Se descuenta del más antiguo primero:</div>
          {vista.map((v) => {
            const r = porId.get(v.id);
            return (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
                <span>{fmtFecha(r?.fecha)} · {r?.descripcion}</span>
                <span className="num">{money(v.aplica)} {v.quedaDebiendo > 0 ? `(queda ${money(v.quedaDebiendo)})` : "✓"}</span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
