"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Campo, Fila, Modal } from "@/components/ui";
import { fmtFecha, hoyEcuador, sumarDias } from "@/lib/fechas";
import { money } from "@/lib/finanzas/formato";
import { AMBITOS, CATEGORIAS_GASTO, MEDIOS } from "@/lib/finanzas/categorias";
import { fechasDeFijo, valorEstimado } from "@/lib/finanzas/plan";
import type { Ambito, EstimadoGasto, GastoFijo, Medio, Temporada } from "@/lib/finanzas/tipos";
import { BannerError, EtiquetaAmbito, mensajeError, nuevoId, usePlan } from "./comunes";
import { ModalGasto, type GastoSuelto } from "./ModalesPago";

/** Para fijos y estimados también vale "hormiga" (gastitos del negocio). */
const CATEGORIAS_PLAN = [...CATEGORIAS_GASTO, "hormiga"] as const;

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "YYYY-MM" del mes de `hoy` más `k` meses. */
function mesMas(hoy: string, k: number): string {
  let y = Number(hoy.slice(0, 4));
  let m = Number(hoy.slice(5, 7)) + k;
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

const FUENTE_CORTA: Record<string, string> = {
  a_mano: "a mano",
  mismo_mes_anio_pasado: "año pasado",
  promedio: "promedio",
  base: "base",
};

/**
 * Gastos fijos (guardería, arriendo…) y estimados del mes (maquila, DTF…).
 * Los fijos se registran una vez y salen solos en cada quincena/mes; los
 * estimados se sugieren solos y se pueden fijar a mano para un mes.
 */
export default function FijosEstimados({ avisar }: { avisar: (m: string) => void }) {
  const { supabase, datos, error, cargando, recargar } = usePlan();
  const hoy = hoyEcuador();
  const [fijo, setFijo] = useState<GastoFijo | "nuevo" | null>(null);
  const [estimado, setEstimado] = useState<EstimadoGasto | "nuevo" | null>(null);
  const [aMano, setAMano] = useState<{ est: EstimadoGasto; mes: string; actual: number | null } | null>(null);
  const [gasto, setGasto] = useState<GastoSuelto | null>(null);
  const [verTemporadas, setVerTemporadas] = useState(false);

  const hecho = async (m: string) => {
    setFijo(null);
    setEstimado(null);
    setAMano(null);
    setGasto(null);
    setVerTemporadas(false);
    avisar(m);
    await recargar();
  };

  if (error) return <BannerError texto={error} />;
  if (cargando && !datos) return <div className="empty">Cargando…</div>;
  if (!datos) return null;

  const meses = [0, 1, 2].map((k) => mesMas(hoy, k));
  const proxima = (f: GastoFijo) => {
    const pagadas = new Set(datos.pagosFijos.filter((p) => p.gasto_fijo_id === f.id).map((p) => p.fecha_programada));
    return fechasDeFijo(f, sumarDias(hoy, -62), sumarDias(hoy, 400)).find((x) => !pagadas.has(x)) ?? null;
  };
  const totalMensual = datos.fijos
    .filter((f) => f.activo && (!f.fecha_fin || f.fecha_fin >= hoy))
    .reduce((s, f) => s + f.monto * f.dias.length, 0);

  async function pausar(f: GastoFijo) {
    const { error } = await supabase.from("gastos_fijos").update({ activo: !f.activo }).eq("id", f.id);
    if (error) return avisar(`No se pudo: ${mensajeError(error)}`);
    await hecho(f.activo ? `${f.nombre} pausado` : `${f.nombre} reactivado`);
  }

  async function pausarEstimado(e: EstimadoGasto) {
    const { error } = await supabase.from("estimados_gasto").update({ activo: !e.activo }).eq("id", e.id);
    if (error) return avisar(`No se pudo: ${mensajeError(error)}`);
    await hecho(e.activo ? `${e.nombre} pausado` : `${e.nombre} reactivado`);
  }

  return (
    <section>
      {/* ---------------- Gastos fijos ---------------- */}
      <div className="section-head" style={{ gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Gastos fijos</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Se registran una vez y aparecen solos en cada quincena y mes, con su botón de pagar. Hoy suman{" "}
            <strong>{money(totalMensual)}</strong> al mes.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setGasto({
            titulo: "Gasto hormiga", categoria: "hormiga", ambito: "empresa",
            ayuda: "Gastitos del negocio (taxi, fundas, almuerzo de trabajo…). Cuentan como gasto de la empresa.",
          })}>+ Gasto hormiga</button>
          <button className="btn primary" onClick={() => setFijo("nuevo")}>+ Gasto fijo</button>
        </div>
      </div>

      {datos.fijos.length ? (
        <div className="table-scroll" style={{ marginBottom: 26 }}>
          <table>
            <thead>
              <tr>
                <th>Gasto</th>
                <th>Cuándo</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th>Próximo pago</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {datos.fijos
                .slice()
                .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre))
                .map((f) => {
                  const terminado = f.fecha_fin != null && f.fecha_fin < hoy;
                  const prox = f.activo && !terminado ? proxima(f) : null;
                  return (
                    <tr key={f.id} style={{ opacity: f.activo && !terminado ? 1 : 0.55 }}>
                      <td>
                        <strong>{f.nombre}</strong> <EtiquetaAmbito ambito={f.ambito} />
                        {!f.activo && <Badge>pausado</Badge>}
                        {terminado && <Badge>terminó</Badge>}
                        <div className="sub" style={{ fontSize: 11.5 }}>{f.categoria} · {f.medio}</div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {f.frecuencia === "mensual" ? `cada mes el ${f.dias[0]}` : `cada quincena: ${f.dias.join(" y ")}`}
                        <div className="sub" style={{ fontSize: 11 }}>
                          desde {fmtFecha(f.fecha_inicio)}{f.fecha_fin ? ` hasta ${fmtFecha(f.fecha_fin)}` : " · sin fin"}
                        </div>
                      </td>
                      <td className="num">{money(f.monto)}</td>
                      <td style={{ fontSize: 12.5 }}>{prox ? fmtFecha(prox) : "—"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn" style={{ fontSize: 12 }} onClick={() => setFijo(f)}>Editar</button>{" "}
                        <button className="btn" style={{ fontSize: 12 }} onClick={() => pausar(f)}>{f.activo ? "Pausar" : "Reactivar"}</button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty" style={{ marginBottom: 26 }}>
          Sin gastos fijos. Agrega la guardería, el arriendo, el internet…
        </div>
      )}

      {/* ---------------- Estimados ---------------- */}
      <div className="section-head" style={{ gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Estimados del mes</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Lo que se calcula gastar en maquila, DTF… La app lo sugiere sola: el mismo mes del año pasado, o el promedio
            de los meses anteriores ajustado por temporada. Lo puedes fijar a mano para un mes.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setVerTemporadas(true)}>Temporadas</button>
          <button className="btn primary" onClick={() => setEstimado("nuevo")}>+ Estimado</button>
        </div>
      </div>

      {datos.estimados.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Estimado</th>
                {meses.map((m) => (
                  <th key={m} style={{ textAlign: "right" }}>{MESES[Number(m.slice(5, 7)) - 1]}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {datos.estimados.map((e) => (
                <tr key={e.id} style={{ opacity: e.activo ? 1 : 0.55 }}>
                  <td>
                    <strong>{e.nombre}</strong> <EtiquetaAmbito ambito={e.ambito} /> {!e.activo && <Badge>pausado</Badge>}
                    <div className="sub" style={{ fontSize: 11.5 }}>{e.categoria} · base {money(e.base)}</div>
                  </td>
                  {meses.map((m) => {
                    const v = valorEstimado(e, m, datos.estimadosMes, datos.historialGastos, datos.temporadas);
                    const fijado = datos.estimadosMes.find((x) => x.estimado_id === e.id && x.mes.slice(0, 7) === m);
                    return (
                      <td key={m} className="num">
                        <button className="btn" style={{ fontSize: 12.5, padding: "3px 8px" }} title="Fijar a mano para este mes"
                          onClick={() => setAMano({ est: e, mes: m, actual: fijado ? fijado.monto : null })}>
                          {money(v.monto)}
                        </button>
                        <div className="sub" style={{ fontSize: 10.5 }}>{FUENTE_CORTA[v.fuente]}</div>
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ fontSize: 12 }} onClick={() => setGasto({
                      titulo: `Pago de ${e.nombre}`, categoria: e.categoria, ambito: e.ambito, concepto: e.nombre,
                      ayuda: "Se registra como gasto y se descuenta del estimado del mes.",
                    })}>+ Pago</button>{" "}
                    <button className="btn" style={{ fontSize: 12 }} onClick={() => setEstimado(e)}>Editar</button>{" "}
                    <button className="btn" style={{ fontSize: 12 }} onClick={() => pausarEstimado(e)}>{e.activo ? "Pausar" : "Reactivar"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">Sin estimados. Agrega maquila, DTF… con un valor base.</div>
      )}

      <ModalFijo supabase={supabase} fijo={fijo} onCerrar={() => setFijo(null)} onHecho={hecho} />
      <ModalEstimado supabase={supabase} estimado={estimado} onCerrar={() => setEstimado(null)} onHecho={hecho} />
      <ModalAMano supabase={supabase} datos={aMano} onCerrar={() => setAMano(null)} onHecho={hecho} />
      <ModalTemporadas supabase={supabase} abierto={verTemporadas} temporadas={datos.temporadas}
        onCerrar={() => setVerTemporadas(false)} onHecho={hecho} />
      <ModalGasto supabase={supabase} gasto={gasto} onCerrar={() => setGasto(null)} onHecho={hecho} />
    </section>
  );
}

// ------------------------------------------------------------
// Gasto fijo: crear / editar
// ------------------------------------------------------------

function ModalFijo({
  supabase,
  fijo,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  fijo: GastoFijo | "nuevo" | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [id, setId] = useState("");
  const [nombre, setNombre] = useState("");
  const [monto, setMonto] = useState("");
  const [frecuencia, setFrecuencia] = useState<"mensual" | "quincenal">("mensual");
  const [dia1, setDia1] = useState("");
  const [dia2, setDia2] = useState("");
  const [inicio, setInicio] = useState(hoyEcuador());
  const [conFin, setConFin] = useState(false);
  const [fin, setFin] = useState("");
  const [ambito, setAmbito] = useState<Ambito>("empresa");
  const [categoria, setCategoria] = useState("otros");
  const [medio, setMedio] = useState<Medio>("transferencia");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nuevo = fijo === "nuevo";
  const original = fijo && fijo !== "nuevo" ? fijo : null;

  useEffect(() => {
    if (!fijo) return;
    const f = fijo === "nuevo" ? null : fijo;
    setId(f?.id ?? nuevoId());
    setNombre(f?.nombre ?? "");
    setMonto(f ? f.monto.toFixed(2) : "");
    setFrecuencia(f?.frecuencia ?? "mensual");
    setDia1(f ? String(f.dias[0]) : "");
    setDia2(f && f.dias[1] != null ? String(f.dias[1]) : "");
    setInicio(f?.fecha_inicio ?? `${hoyEcuador().slice(0, 7)}-01`);
    setConFin(!!f?.fecha_fin);
    setFin(f?.fecha_fin ?? "");
    setAmbito(f?.ambito ?? "empresa");
    setCategoria(f?.categoria ?? "otros");
    setMedio((f?.medio as Medio) ?? "transferencia");
    setNotas(f?.notas ?? "");
    setErr(null);
    setGuardando(false);
  }, [fijo]);

  async function guardar() {
    if (guardando) return;
    const m = parseFloat(monto);
    const d1 = parseInt(dia1, 10);
    const d2 = parseInt(dia2, 10);
    if (!nombre.trim()) return setErr("Falta el nombre (ej. Guardería).");
    if (!(m > 0)) return setErr("El monto debe ser mayor a 0.");
    if (!(d1 >= 1 && d1 <= 31)) return setErr("El día de pago va del 1 al 31.");
    if (frecuencia === "quincenal" && !(d2 >= 1 && d2 <= 31 && d2 !== d1)) return setErr("Para quincenal pon los dos días (ej. 15 y 30).");
    if (!inicio) return setErr("Falta desde cuándo.");
    if (conFin && (!fin || fin < inicio)) return setErr("La fecha de fin tiene que ser después del inicio.");
    setGuardando(true);
    setErr(null);
    const fila = {
      nombre: nombre.trim(),
      monto: m,
      frecuencia,
      dias: frecuencia === "mensual" ? [d1] : [d1, d2].sort((a, b) => a - b),
      fecha_inicio: inicio,
      fecha_fin: conFin ? fin : null,
      ambito,
      categoria,
      medio,
      notas: notas.trim(),
    };
    const { error } = nuevo
      ? await supabase.from("gastos_fijos").upsert({ id, ...fila }, { onConflict: "id", ignoreDuplicates: true })
      : await supabase.from("gastos_fijos").update(fila).eq("id", id);
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(nuevo ? `${fila.nombre} agregado: ${money(m)} ${frecuencia === "mensual" ? "cada mes" : "cada quincena"}` : `${fila.nombre} actualizado`);
  }

  const cambiaDias =
    original != null &&
    (original.frecuencia !== frecuencia || String(original.dias[0]) !== dia1 || String(original.dias[1] ?? "") !== dia2);

  return (
    <Modal
      titulo={nuevo ? "Nuevo gasto fijo" : "Editar gasto fijo"}
      abierto={fijo != null}
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
          <input className="pinput" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Guardería" />
        </Campo>
        <Campo label="Monto de cada pago ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
      </Fila>
      <Fila>
        <Campo label="Cada cuánto">
          <select className="pinput" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as "mensual" | "quincenal")}>
            <option value="mensual">Mensual (un pago al mes)</option>
            <option value="quincenal">Quincenal (dos pagos al mes)</option>
          </select>
        </Campo>
        <Campo label={frecuencia === "mensual" ? "Día del mes" : "Primer día"} requerido>
          <input className="pinput" type="number" min="1" max="31" value={dia1} onChange={(e) => setDia1(e.target.value)} />
        </Campo>
        {frecuencia === "quincenal" && (
          <Campo label="Segundo día" requerido>
            <input className="pinput" type="number" min="1" max="31" value={dia2} onChange={(e) => setDia2(e.target.value)} />
          </Campo>
        )}
      </Fila>
      <Fila>
        <Campo label="Desde" requerido>
          <input className="pinput" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </Campo>
        <Campo label="Hasta">
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
            <input type="checkbox" checked={conFin} onChange={(e) => setConFin(e.target.checked)} />
            tiene fecha de fin
          </label>
          {conFin && <input className="pinput" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />}
        </Campo>
      </Fila>
      <Fila>
        <Campo label="Ámbito">
          <select className="pinput" value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)}>
            {AMBITOS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Campo>
        <Campo label="Categoría">
          <select className="pinput" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS_PLAN.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>
        Si el día no existe en un mes (31 en febrero), se paga el último día del mes.
      </p>
      {cambiaDias && (
        <p style={{ fontSize: 12, color: "var(--warn)", marginBottom: 0 }}>
          Ojo: si cambias el día, un mes que ya pagaste con el día viejo puede volver a aparecer por pagar. Si el cambio
          es desde ahora, mejor pon fecha de fin a este y crea uno nuevo.
        </p>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------
// Estimado: crear / editar
// ------------------------------------------------------------

function ModalEstimado({
  supabase,
  estimado,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  estimado: EstimadoGasto | "nuevo" | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [id, setId] = useState("");
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("maquila");
  const [base, setBase] = useState("");
  const [ambito, setAmbito] = useState<Ambito>("empresa");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nuevo = estimado === "nuevo";

  useEffect(() => {
    if (!estimado) return;
    const e = estimado === "nuevo" ? null : estimado;
    setId(e?.id ?? nuevoId());
    setNombre(e?.nombre ?? "");
    setCategoria(e?.categoria ?? "maquila");
    setBase(e ? e.base.toFixed(2) : "");
    setAmbito(e?.ambito ?? "empresa");
    setNotas(e?.notas ?? "");
    setErr(null);
    setGuardando(false);
  }, [estimado]);

  async function guardar() {
    if (guardando) return;
    const b = parseFloat(base);
    if (!nombre.trim()) return setErr("Falta el nombre (ej. Maquila).");
    if (!(b > 0)) return setErr("El valor base debe ser mayor a 0.");
    setGuardando(true);
    setErr(null);
    const fila = { nombre: nombre.trim(), categoria, base: b, ambito, notas: notas.trim() };
    const { error } = nuevo
      ? await supabase.from("estimados_gasto").upsert({ id, ...fila }, { onConflict: "id", ignoreDuplicates: true })
      : await supabase.from("estimados_gasto").update(fila).eq("id", id);
    setGuardando(false);
    if (error) {
      const m = mensajeError(error);
      return setErr(/duplicate|unique/i.test(m) ? `Ya hay un estimado activo para la categoría ${categoria}.` : m);
    }
    onHecho(nuevo ? `Estimado ${fila.nombre} agregado` : `Estimado ${fila.nombre} actualizado`);
  }

  return (
    <Modal
      titulo={nuevo ? "Nuevo estimado" : "Editar estimado"}
      abierto={estimado != null}
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
          <input className="pinput" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Maquila" />
        </Campo>
        <Campo label="Categoría">
          <select className="pinput" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS_PLAN.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
      </Fila>
      <Fila>
        <Campo label="Valor base al mes ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={base} onChange={(e) => setBase(e.target.value)} />
        </Campo>
        <Campo label="Ámbito">
          <select className="pinput" value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)}>
            {AMBITOS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Campo>
      </Fila>
      <Campo label="Notas">
        <input className="pinput" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>
        La base solo se usa mientras no haya gastos reales de esa categoría. Después la sugerencia sale de lo que de
        verdad se gastó: así sube o baja sola si gastas más o menos.
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------
// Valor a mano para un mes
// ------------------------------------------------------------

function ModalAMano({
  supabase,
  datos,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  datos: { est: EstimadoGasto; mes: string; actual: number | null } | null;
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!datos) return;
    setMonto(datos.actual != null ? datos.actual.toFixed(2) : "");
    setErr(null);
    setGuardando(false);
  }, [datos]);

  const nombreMes = datos ? `${MESES[Number(datos.mes.slice(5, 7)) - 1]} ${datos.mes.slice(0, 4)}` : "";

  async function guardar() {
    if (!datos || guardando) return;
    const m = parseFloat(monto);
    if (!(m >= 0) || monto.trim() === "") return setErr("Escribe el valor (puede ser 0).");
    setGuardando(true);
    const { error } = await supabase
      .from("estimados_mes")
      .upsert({ estimado_id: datos.est.id, mes: `${datos.mes}-01`, monto: m }, { onConflict: "estimado_id,mes" });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(`${datos.est.nombre} de ${nombreMes}: ${money(m)}`);
  }

  async function quitar() {
    if (!datos || guardando) return;
    setGuardando(true);
    const { error } = await supabase.from("estimados_mes").delete().eq("estimado_id", datos.est.id).eq("mes", `${datos.mes}-01`);
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho(`${datos.est.nombre} de ${nombreMes}: vuelve a la sugerencia automática`);
  }

  return (
    <Modal
      titulo={datos ? `${datos.est.nombre} · ${nombreMes}` : ""}
      abierto={datos != null}
      onCerrar={guardando ? () => {} : onCerrar}
      pie={
        <>
          {datos?.actual != null && (
            <button className="btn" onClick={quitar} disabled={guardando}>Volver a la sugerencia</button>
          )}
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Fijar"}</button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      <Campo label="Valor para este mes ($)">
        <input className="pinput" type="number" step="0.01" min="0" value={monto} autoFocus onChange={(e) => setMonto(e.target.value)} />
      </Campo>
      <p className="sub" style={{ fontSize: 12, margin: 0 }}>Este valor manda sobre la sugerencia automática solo en este mes.</p>
    </Modal>
  );
}

// ------------------------------------------------------------
// Temporadas: factor por mes (Navidad, fiestas de Cuenca…)
// ------------------------------------------------------------

function ModalTemporadas({
  supabase,
  abierto,
  temporadas,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  temporadas: Temporada[];
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const [filas, setFilas] = useState<{ factor: string; nota: string }[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setFilas(
      MESES.map((_, i) => {
        const t = temporadas.find((x) => x.mes === i + 1);
        return { factor: String(t?.factor ?? 1), nota: t?.nota ?? "" };
      })
    );
    setErr(null);
    setGuardando(false);
  }, [abierto, temporadas]);

  async function guardar() {
    if (guardando) return;
    const rows = filas.map((f, i) => ({ mes: i + 1, factor: parseFloat(f.factor), nota: f.nota.trim() }));
    if (rows.some((r) => !(r.factor > 0))) return setErr("Cada factor tiene que ser mayor a 0 (1 = mes normal).");
    setGuardando(true);
    const { error } = await supabase.from("temporadas_mes").upsert(rows, { onConflict: "mes" });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onHecho("Temporadas guardadas");
  }

  return (
    <Modal
      titulo="Temporadas"
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
      <p className="sub" style={{ fontSize: 12.5, marginTop: 0 }}>
        1 = mes normal. 1,5 = se gasta un 50% más (Navidad). Se usa para sugerir los estimados.
      </p>
      {filas.map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ width: 92, fontSize: 13 }}>{MESES[i]}</span>
          <input className="pinput" style={{ maxWidth: 80 }} type="number" step="0.05" min="0" value={f.factor}
            onChange={(e) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} />
          <input className="pinput" placeholder="nota (ej. fiestas de Cuenca)" value={f.nota}
            onChange={(e) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, nota: e.target.value } : x)))} />
        </div>
      ))}
    </Modal>
  );
}
