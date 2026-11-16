"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Campo, Fila, Modal } from "@/components/ui";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { money } from "@/lib/finanzas/formato";
import { AMBITOS } from "@/lib/finanzas/categorias";
import { cuadreCaja, totalCaja } from "@/lib/finanzas/plan";
import type { Ambito, CuentaDinero, SaldoCaja } from "@/lib/finanzas/tipos";
import { BannerError, EtiquetaAmbito, mensajeError, nuevoId, usePlan } from "./comunes";
import { ModalGasto, type GastoSuelto } from "./ModalesPago";

/**
 * Caja: se anota cuánto dinero hay en cada cuenta, y la app compara con lo que
 * DEBERÍA haber (lo de la vez anterior + ingresos − gastos registrados). Si
 * falta plata, casi siempre son gastos hormiga sin anotar: un botón los
 * registra como gasto del negocio y el cuadre queda en cero.
 */
export default function Caja({ avisar }: { avisar: (m: string) => void }) {
  const { supabase, datos, error, cargando, recargar } = usePlan();
  const [anotando, setAnotando] = useState(false);
  const [cuenta, setCuenta] = useState<CuentaDinero | "nueva" | null>(null);
  const [gasto, setGasto] = useState<GastoSuelto | null>(null);

  const hecho = async (m: string) => {
    setAnotando(false);
    setCuenta(null);
    setGasto(null);
    avisar(m);
    await recargar();
  };

  if (error) return <BannerError texto={error} />;
  if (cargando && !datos) return <div className="empty">Cargando…</div>;
  if (!datos) return null;

  const hoy = hoyEcuador();
  const cuadre = cuadreCaja(datos.cuentas, datos.saldos, datos.movimientosCuadre);
  const ultimoDe = (id: string) =>
    datos.saldos.filter((s) => s.cuenta_id === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] ?? null;
  const fechas = [...new Set(datos.saldos.map((s) => s.fecha))].sort().reverse().slice(0, 8);
  const activas = datos.cuentas.filter((c) => c.activa);

  return (
    <section>
      <div className="section-head" style={{ gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Caja</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Hoy hay <strong>{money(totalCaja(datos.cuentas, datos.saldos, hoy))}</strong> según lo último anotado en cada cuenta.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setGasto({
            titulo: "Gasto hormiga", categoria: "hormiga", ambito: "empresa",
            ayuda: "Gastitos del negocio (taxi, fundas, almuerzo de trabajo…). Cuentan como gasto de la empresa.",
          })}>+ Gasto hormiga</button>
          <button className="btn" onClick={() => setCuenta("nueva")}>+ Cuenta</button>
          <button className="btn primary" disabled={!activas.length} onClick={() => setAnotando(true)}>
            Anotar cuánto hay hoy
          </button>
        </div>
      </div>

      {/* ---------------- Cuadre ---------------- */}
      {cuadre ? (
        <div className="card" style={{ marginBottom: 20, borderColor: cuadre.diferencia < 0 ? "var(--bad)" : cuadre.diferencia > 0 ? "var(--warn)" : "var(--good)" }}>
          <div className="label">Cuadre del {fmtFecha(cuadre.desde)} al {fmtFecha(cuadre.hasta)}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.9, marginTop: 6 }}>
            <Linea texto={`Había el ${fmtFecha(cuadre.desde)}`} valor={cuadre.anterior} />
            <Linea texto="+ Entró (ingresos registrados)" valor={cuadre.entradas} />
            <Linea texto="− Salió (gastos y pagos registrados)" valor={-cuadre.salidas} />
            <Linea texto="= Debería haber" valor={cuadre.esperado} fuerte />
            <Linea texto={`Hay (anotado el ${fmtFecha(cuadre.hasta)})`} valor={cuadre.real} fuerte />
          </div>
          {cuadre.diferencia === 0 ? (
            <p style={{ color: "var(--good)", margin: "8px 0 0" }}>✓ Cuadra exacto.</p>
          ) : cuadre.diferencia < 0 ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ color: "var(--bad)", margin: "0 0 8px" }}>
                Faltan <strong>{money(-cuadre.diferencia)}</strong>: gastos que no se anotaron.
              </p>
              <button
                className="btn primary"
                onClick={() =>
                  setGasto({
                    titulo: "Registrar lo que falta como gastos hormiga",
                    categoria: "hormiga",
                    ambito: "empresa",
                    monto: -cuadre.diferencia,
                    fecha: cuadre.hasta,
                    concepto: `Faltante del cuadre de caja ${fmtFecha(cuadre.desde)} – ${fmtFecha(cuadre.hasta)}`,
                    ayuda: "Queda como gasto del negocio con la fecha del cuadre, y la caja vuelve a cuadrar.",
                  })
                }
              >
                Registrar {money(-cuadre.diferencia)} como gastos hormiga
              </button>
            </div>
          ) : (
            <p style={{ color: "var(--warn)", margin: "8px 0 0" }}>
              Sobran <strong>{money(cuadre.diferencia)}</strong>: puede ser un ingreso o un cobro sin anotar, o un gasto
              anotado dos veces.
            </p>
          )}
          <p className="sub" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
            Se cuenta todo lo registrado (empresa y personal), porque sale de las mismas cuentas. Las cuentas que no
            anotaste ese día cuentan con su último saldo.
          </p>
        </div>
      ) : (
        <div className="card empty" style={{ marginBottom: 20 }}>
          {datos.saldos.length
            ? "Anota los saldos otro día para poder comparar (hace falta anotar al menos dos veces)."
            : "Agrega tus cuentas (bancos y efectivo) y anota cuánto hay hoy. La próxima vez que anotes, la app te dice si cuadra."}
        </div>
      )}

      {/* ---------------- Cuentas ---------------- */}
      <h3 style={{ marginBottom: 8 }}>Cuentas</h3>
      {datos.cuentas.length ? (
        <div className="table-scroll" style={{ marginBottom: 20 }}>
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th style={{ textAlign: "right" }}>Último saldo</th>
                <th>Anotado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {datos.cuentas.map((c) => {
                const u = ultimoDe(c.id);
                return (
                  <tr key={c.id} style={{ opacity: c.activa ? 1 : 0.55 }}>
                    <td>
                      <strong>{c.nombre}</strong> <EtiquetaAmbito ambito={c.ambito} /> {!c.activa && <Badge>cerrada</Badge>}
                      <div className="sub" style={{ fontSize: 11.5 }}>{c.tipo === "efectivo" ? "efectivo" : c.banco || "banco"}</div>
                    </td>
                    <td className="num">{u ? money(u.monto) : "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{u ? fmtFecha(u.fecha) : "nunca"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn" style={{ fontSize: 12 }} onClick={() => setCuenta(c)}>Editar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty" style={{ marginBottom: 20 }}>Sin cuentas todavía.</div>
      )}

      {fechas.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer" }}><strong>Últimas veces que anotaste</strong></summary>
          <div className="card" style={{ padding: "6px 16px", marginTop: 8 }}>
            {fechas.map((f) => (
              <div key={f} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span>{fmtFecha(f)}</span>
                <span className="num">{money(totalCaja(datos.cuentas, datos.saldos, f))}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <ModalSaldos supabase={supabase} abierto={anotando} cuentas={activas} saldos={datos.saldos}
        onCerrar={() => setAnotando(false)} onHecho={hecho} />
      <ModalCuenta supabase={supabase} cuenta={cuenta} onCerrar={() => setCuenta(null)} onHecho={hecho} />
      <ModalGasto supabase={supabase} gasto={gasto} onCerrar={() => setGasto(null)} onHecho={hecho} />
    </section>
  );
}

function Linea({ texto, valor, fuerte }: { texto: string; valor: number; fuerte?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: fuerte ? 600 : undefined }}>
      <span>{texto}</span>
      <span className="num">{money(valor)}</span>
    </div>
  );
}

// ------------------------------------------------------------
// Anotar saldos de un día (una foto por cuenta y fecha)
// ------------------------------------------------------------

function ModalSaldos({
  supabase,
  abierto,
  cuentas,
  saldos,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  cuentas: CuentaDinero[];
  saldos: SaldoCaja[];
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [fecha, setFecha] = useState(hoyEcuador());
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setFecha(hoyEcuador());
    setMontos({});
    setErr(null);
    setGuardando(false);
  }, [abierto]);

  const anterior = (id: string) =>
    saldos.filter((s) => s.cuenta_id === id && s.fecha <= fecha).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] ?? null;

  async function guardar() {
    if (guardando) return;
    if (!fecha || fecha > hoyEcuador()) return setErr("La fecha no puede ser futura.");
    const filas = cuentas
      .filter((c) => (montos[c.id] ?? "").trim() !== "")
      .map((c) => ({ id: nuevoId(), cuenta_id: c.id, fecha, monto: parseFloat(montos[c.id]) }));
    if (!filas.length) return setErr("Escribe el saldo de al menos una cuenta.");
    if (filas.some((f) => isNaN(f.monto))) return setErr("Hay un saldo que no es un número.");
    setGuardando(true);
    setErr(null);
    // una foto por cuenta y fecha: si ya se anotó ese día, se corrige
    const { error } = await supabase.from("saldos_caja").upsert(filas, { onConflict: "cuenta_id,fecha" });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(`Saldos del ${fmtFecha(fecha)} anotados (${filas.length} cuenta${filas.length !== 1 ? "s" : ""})`);
  }

  return (
    <Modal
      titulo="¿Cuánto hay en cada cuenta?"
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
      <Campo label="Fecha">
        <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      {cuentas.map((c) => {
        const a = anterior(c.id);
        return (
          <Campo key={c.id} label={c.nombre}>
            <input className="pinput" type="number" step="0.01" value={montos[c.id] ?? ""}
              placeholder={a ? `antes ${money(a.monto)} (${fmtFecha(a.fecha)})` : "sin anotar antes"}
              onChange={(e) => setMontos((m) => ({ ...m, [c.id]: e.target.value }))} />
          </Campo>
        );
      })}
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>
        Las cuentas que dejes en blanco siguen con su último saldo. Puede ser negativo (sobregiro).
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------
// Cuenta: crear / editar
// ------------------------------------------------------------

function ModalCuenta({
  supabase,
  cuenta,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  cuenta: CuentaDinero | "nueva" | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [id, setId] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"banco" | "efectivo">("banco");
  const [banco, setBanco] = useState("");
  const [ambito, setAmbito] = useState<Ambito>("empresa");
  const [activa, setActiva] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nueva = cuenta === "nueva";

  useEffect(() => {
    if (!cuenta) return;
    const c = cuenta === "nueva" ? null : cuenta;
    setId(c?.id ?? nuevoId());
    setNombre(c?.nombre ?? "");
    setTipo(c?.tipo ?? "banco");
    setBanco(c?.banco ?? "");
    setAmbito(c?.ambito ?? "empresa");
    setActiva(c?.activa ?? true);
    setErr(null);
    setGuardando(false);
  }, [cuenta]);

  async function guardar() {
    if (guardando) return;
    if (!nombre.trim()) return setErr("Falta el nombre (ej. Pichincha empresa, Efectivo).");
    setGuardando(true);
    setErr(null);
    const fila = { nombre: nombre.trim(), tipo, banco: tipo === "banco" ? banco.trim() : "", ambito, activa };
    const { error } = nueva
      ? await supabase.from("cuentas_dinero").upsert({ id, ...fila }, { onConflict: "id", ignoreDuplicates: true })
      : await supabase.from("cuentas_dinero").update(fila).eq("id", id);
    setGuardando(false);
    if (error) {
      const m = mensajeError(error);
      return setErr(/duplicate|unique/i.test(m) ? `Ya hay una cuenta llamada "${fila.nombre}".` : m);
    }
    onHecho(nueva ? `Cuenta ${fila.nombre} agregada` : `Cuenta ${fila.nombre} actualizada`);
  }

  return (
    <Modal
      titulo={nueva ? "Nueva cuenta" : "Editar cuenta"}
      abierto={cuenta != null}
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
          <input className="pinput" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Pichincha empresa" />
        </Campo>
        <Campo label="Tipo">
          <select className="pinput" value={tipo} onChange={(e) => setTipo(e.target.value as "banco" | "efectivo")}>
            <option value="banco">Banco</option>
            <option value="efectivo">Efectivo</option>
          </select>
        </Campo>
      </Fila>
      <Fila>
        {tipo === "banco" && (
          <Campo label="Banco">
            <input className="pinput" value={banco} onChange={(e) => setBanco(e.target.value)} />
          </Campo>
        )}
        <Campo label="Ámbito">
          <select className="pinput" value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)}>
            {AMBITOS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Campo>
      </Fila>
      {!nueva && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
          Activa (si la cierras, deja de contar en la caja)
        </label>
      )}
    </Modal>
  );
}
