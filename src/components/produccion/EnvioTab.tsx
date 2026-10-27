"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import NombreTela from "./ResumenTela";
import { Campo, Fila, Badge, Vacio, Tallas } from "@/components/ui";
import { money, ordenarTallas, type Maquila, type ColorMaquila, type EntregaMaquila } from "@/lib/produccion/types";
import { fmtFecha, diasHasta, hoyEcuador } from "@/lib/fechas";
import { etiquetaFila } from "@/lib/produccion/conjuntos";
import { LOCALES, type Guia } from "@/lib/locales";
import {
  COSTO_ESTAMPADO_DEFECTO,
  COSTO_OPERATIVO,
  DESTINOS,
  basicosDestino,
  cantidad,
  completarConBodega,
  costoSalida,
  faltaPorTalla,
  formVacio,
  problemasReparto,
  repartoParaBase,
  sumaTallas,
  tallasDestino,
  tallasEstampado,
  type DestinoEnvio,
  type DisenoReparto,
  type RepartoForm,
} from "@/lib/produccion/reparto";
import { costoProduccionUnitario } from "./costoDeCorte";
import { useEffect } from "react";

/**
 * Fase 8o: lo que se procesa es una ENTREGA, no el color entero. La maquiladora
 * puede devolver un color en partes, y cada parte ya puede salir a locales,
 * estampado u online sin esperar el resto.
 */
interface Lote {
  maquila: Maquila;
  col: ColorMaquila;
  entrega: EntregaMaquila;
}

export default function EnvioTab() {
  const { data } = useProd();

  const lotes: Lote[] = [];
  for (const m of data.maquilas) {
    for (const col of m.colores) {
      for (const entrega of col.entregas) {
        if (!entrega.procesado) lotes.push({ maquila: m, col, entrega });
      }
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Envío <span className="sub" style={{ fontWeight: 400 }}>· reparte cada entrega de maquila, talla por talla, entre sus destinos</span></h2>
      </div>

      {!lotes.length ? (
        <Vacio titulo="Sin entregas por procesar" hint="Aparecen aquí cuando un color vuelve de maquila, entero o en partes." />
      ) : (
        lotes.map((l) => <LoteCard key={l.entrega.id} lote={l} />)
      )}

      <Historial />
      <GuiasLogistica />
    </section>
  );
}

function LoteCard({ lote }: { lote: Lote }) {
  const { data, supabase, reload, toast } = useProd();
  const { maquila, col, entrega } = lote;
  // Todo lo que antes salía del color entero sale ahora de ESTA entrega.
  const tallasLote = entrega.tallas;
  const unidadesLote = entrega.unidades;
  const parcial = col.estado !== "entregado" || col.entregas.length > 1;
  const corte = data.cortes.find((c) => c.id === maquila.corte_id);
  const pedido = corte ? data.pedidos.find((p) => p.id === corte.pedido_id) : null;
  const prenda = pedido ? data.prendas.find((x) => x.id === pedido.prenda_id) : null;
  const tallas = ordenarTallas(Object.keys(tallasLote ?? {})).filter((t) => (tallasLote[t] ?? 0) > 0);

  // Fase 8t: arranca como antes —todo a la bodega— y cada destino que se marca
  // se lleva su parte talla por talla.
  const [form, setForm] = useState<RepartoForm>(() => {
    const f = formVacio(["bodega"]);
    f.tallas.bodega = Object.fromEntries(tallas.map((t) => [t, String(tallasLote[t])]));
    return f;
  });
  const [costoEstampado, setCostoEstampado] = useState(String(COSTO_ESTAMPADO_DEFECTO));
  const [productoCodigo, setProductoCodigo] = useState("");
  const [localDestino, setLocalDestino] = useState("");
  const [feriaId, setFeriaId] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // Costo COMPLETO de producción por prenda (tela, maquila, horas, insumos,
  // fijos), el mismo número que el panel de costo del corte, sin estampado.
  const produccion = corte ? costoProduccionUnitario(data, corte, col.parte) : null;
  const cp = produccion ?? 0;
  const costoEst = parseFloat(costoEstampado) || 0;
  const precioLocal = prenda ? Number(prenda.precio_venta_local) : 0;

  const activo = (d: DestinoEnvio) => form.activos.includes(d);
  const hayEstampados = form.activos.some((d) => form.disenos[d].length > 0);
  const falta = faltaPorTalla(tallasLote, form);
  const problemas = problemasReparto(tallasLote, form);
  if (activo("feria") && !feriaId) problemas.push("Elige a qué feria va la mercadería.");

  // Los destinos marcados se muestran siempre en el orden de DESTINOS, no en el que se marcaron.
  const alternar = (d: DestinoEnvio) =>
    setForm((f) => ({
      ...f,
      activos: DESTINOS.map((x) => x.id).filter((x) => (x === d ? !f.activos.includes(d) : f.activos.includes(x))),
    }));
  const escribir = (d: DestinoEnvio, talla: string, v: string) =>
    setForm((f) => ({ ...f, tallas: { ...f.tallas, [d]: { ...f.tallas[d], [talla]: v } } }));

  /**
   * Fase 8t: fn_repartir_entrega_maquila. Una sola llamada reparte la entrega:
   * las básicas llegan ya a su destino y las estampadas se van al taller con
   * el destino anotado. La base congela el costo y suma el operativo.
   */
  async function procesar() {
    if (problemas.length) return;
    setOcupado(true);
    try {
      const r = repartoParaBase(form);
      const { data: res, error } = await supabase.rpc("fn_repartir_entrega_maquila", {
        p_entrega_id: entrega.id,
        p_reparto: {
          costo_produccion: cp,
          costo_estampado: costoEst,
          bodega: r.bodega ?? null,
          local: r.local
            ? {
                ...r.local,
                local_destino: localDestino || null,
                producto_codigo: productoCodigo.trim() || null,
                precio: precioLocal,
              }
            : null,
          feria: r.feria ? { ...r.feria, feria_id: feriaId } : null,
        },
      });
      if (error) throw new Error(error.message);

      const n = (res ?? {}) as Partial<Record<DestinoEnvio, { basicos: number; estampadas: number }>>;
      const partes = DESTINOS.filter((d) => n[d.id]).map(({ id, etiqueta }) => {
        const x = n[id]!;
        return `${x.basicos + x.estampadas} a ${etiqueta.toLowerCase()}${x.estampadas ? ` (${x.estampadas} al taller)` : ""}`;
      });
      toast(`Entrega procesada · ${partes.join(" · ")}`);
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="prod-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h4>
            <NombreTela pedido={pedido} /> <Badge color="azul">{etiquetaFila(col.color, col.parte, prenda)}</Badge>
            {parcial && <Badge color="ambar">Entrega parcial</Badge>}
          </h4>
          <div className="prod-meta">
            {unidadesLote} unidades{prenda ? ` · ${prenda.nombre}` : ""}
            {` · recibido ${fmtFecha(entrega.fecha)}`}
            {parcial && ` · del color se cortaron ${col.unidades}`}
          </div>
          {pedido?.destino_indicado && (
            <div className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
              👉 Indicación al pedir la tela: <b>{pedido.destino_indicado === "locales" ? "directo a locales" : "bodega de estampados"}</b>
            </div>
          )}
          <div style={{ marginTop: 6 }}><Tallas tallas={tallasLote} /></div>
          <div className="sub" style={{ fontSize: 12.5, marginTop: 6 }}>
            Costo de producción:{" "}
            {produccion != null ? (
              <b className="num">{money(produccion)} c/u</b>
            ) : (
              <span style={{ color: "var(--warn)" }}>no se pudo calcular (se guardará en $0)</span>
            )}
            <span> · tela, maquila, corte, insumos y fijos</span>
          </div>
        </div>
      </div>

      <div style={{ margin: "14px 0 10px" }}>
        <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Destinos · marca uno o varios</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {DESTINOS.map(({ id, etiqueta }) => (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={activo(id)} onChange={() => alternar(id)}
                style={{ accentColor: "var(--accent)" }} />
              {etiqueta}
            </label>
          ))}
        </div>
      </div>

      {form.activos.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 12 }}>
          <table style={{ width: "auto", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={CELDA}>Talla</th>
                <th style={CELDA}>Llegó</th>
                {DESTINOS.filter((d) => activo(d.id)).map((d) => <th key={d.id} style={CELDA}>{d.etiqueta}</th>)}
                <th style={CELDA}>Falta</th>
              </tr>
            </thead>
            <tbody>
              {tallas.map((t) => {
                const f = falta[t] ?? 0;
                return (
                  <tr key={t}>
                    <td style={{ ...CELDA, fontWeight: 600 }}>{t}</td>
                    <td style={CELDA} className="num">{tallasLote[t]}</td>
                    {DESTINOS.filter((d) => activo(d.id)).map((d) => (
                      <td key={d.id} style={CELDA}>
                        <InputTalla valor={form.tallas[d.id][t]} max={tallasLote[t]} onChange={(v) => escribir(d.id, t, v)} />
                      </td>
                    ))}
                    <td style={{ ...CELDA, fontWeight: 600, color: f === 0 ? "var(--good)" : "var(--bad)" }}>
                      {f === 0 ? "✓" : f > 0 ? f : `+${-f}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activo("bodega") && form.activos.length > 1 && (
        <button className="btn" style={{ fontSize: 12, marginBottom: 12 }}
          onClick={() => setForm((f) => ({ ...f, tallas: { ...f.tallas, bodega: completarConBodega(tallasLote, f) } }))}>
          Lo que sobra → bodega
        </button>
      )}

      {DESTINOS.filter((d) => activo(d.id)).map(({ id }) => (
        <DestinoPanel key={id} destino={id} form={form} setForm={setForm} tallas={tallas}
          costoProduccion={cp} costoEstampado={costoEst} precioLocal={precioLocal}>
          {id === "local" && (
            <Fila>
              <Campo label="Local destino (para cruzar con las guías de logística)">
                <select className="pinput" value={localDestino} onChange={(e) => setLocalDestino(e.target.value)}>
                  <option value="">— Sin especificar —</option>
                  {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Campo>
              <Campo label="Producto VATEX (opcional — para cruzar con ventas)">
                <input className="pinput" list="productos-vatex" placeholder="Código, ej: MS0164I"
                  value={productoCodigo} onChange={(e) => setProductoCodigo(e.target.value)} />
                <datalist id="productos-vatex">
                  {data.productosVatex.slice(0, 500).map((p) => (
                    <option key={p.codigo} value={p.codigo}>{p.descripcion}</option>
                  ))}
                </datalist>
              </Campo>
            </Fila>
          )}
          {id === "feria" && <ElegirFeria feriaId={feriaId} setFeriaId={setFeriaId} />}
        </DestinoPanel>
      ))}

      {hayEstampados && (
        <Fila>
          <Campo label="Costo de estampado por prenda ($)">
            <input className="pinput" type="number" step="0.01" min="0" value={costoEstampado}
              onChange={(e) => setCostoEstampado(e.target.value)} />
          </Campo>
          <div className="sub" style={{ flex: 2, alignSelf: "flex-end", fontSize: 12.5, paddingBottom: 14 }}>
            Las estampadas se van al taller y, cuando las registres de vuelta en Estampados, entran solas a su destino.
          </div>
        </Fila>
      )}

      {problemas.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 10 }}>
          {problemas.map((p) => <div key={p}>⚠ {p}</div>)}
        </div>
      )}

      <div style={{ textAlign: "right" }}>
        <button className="btn primary" style={{ fontSize: 13 }} disabled={ocupado || problemas.length > 0} onClick={procesar}>
          {ocupado ? "Procesando…" : "Procesar entrega"}
        </button>
      </div>
    </div>
  );
}

const CELDA = { padding: "6px 8px", textAlign: "center" as const };

function InputTalla({ valor, max, onChange }: { valor: string | undefined; max: number; onChange: (v: string) => void }) {
  return (
    <input className="pinput" type="number" min="0" max={max} inputMode="numeric"
      style={{ width: 58, textAlign: "center", padding: "6px 4px" }}
      value={valor ?? ""} onChange={(e) => onChange(e.target.value)} />
  );
}

/**
 * Fase 8t: lo que va a UN destino. Se dice cuántas van con cada estampado,
 * talla por talla; lo que queda va básico. Abajo, lo que cuesta cada prenda
 * al llegar ahí: producción + estampado + operativo del destino.
 */
function DestinoPanel({
  destino,
  form,
  setForm,
  tallas,
  costoProduccion,
  costoEstampado,
  precioLocal,
  children,
}: {
  destino: DestinoEnvio;
  form: RepartoForm;
  setForm: React.Dispatch<React.SetStateAction<RepartoForm>>;
  tallas: string[];
  costoProduccion: number;
  costoEstampado: number;
  precioLocal: number;
  children?: React.ReactNode;
}) {
  const etiqueta = DESTINOS.find((d) => d.id === destino)!.etiqueta;
  const van = tallasDestino(form, destino);
  const disenos = form.disenos[destino];
  const basicos = basicosDestino(form, destino);
  const nVan = sumaTallas(van);
  const nEst = sumaTallas(tallasEstampado(disenos));
  const nBas = nVan - nEst;
  const operativo = COSTO_OPERATIVO[destino];
  const cBasica = costoSalida(costoProduccion, destino, null);
  const cEstampada = costoSalida(costoProduccion, destino, costoEstampado);
  const total = nBas * cBasica + nEst * cEstampada;
  const tallasDelDestino = tallas.filter((t) => (van[t] ?? 0) > 0);

  const cambiarDisenos = (fn: (d: DisenoReparto[]) => DisenoReparto[]) =>
    setForm((f) => ({ ...f, disenos: { ...f.disenos, [destino]: fn(f.disenos[destino]) } }));
  const escribirDiseno = (i: number, cambio: Partial<DisenoReparto>) =>
    cambiarDisenos((ds) => ds.map((d, j) => (j === i ? { ...d, ...cambio } : d)));

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="label" style={{ fontSize: 10.5 }}>{etiqueta} · {nVan} und.</div>
        {nVan > 0 && (
          <span className="sub" style={{ fontSize: 12 }}>
            {nBas} básicas{nEst > 0 ? ` · ${nEst} estampadas` : ""}
          </span>
        )}
      </div>

      {children}

      {nVan > 0 && disenos.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 8 }}>
          <table style={{ width: "auto", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...CELDA, textAlign: "left" }}>Estampado</th>
                {tallasDelDestino.map((t) => <th key={t} style={CELDA}>{t} <span style={{ opacity: 0.6 }}>/ {van[t]}</span></th>)}
                <th style={CELDA}>Total</th>
                <th style={CELDA}></th>
              </tr>
            </thead>
            <tbody>
              {disenos.map((d, i) => (
                <tr key={i}>
                  <td style={{ ...CELDA, textAlign: "left" }}>
                    <input className="pinput" style={{ minWidth: 130 }} placeholder="Ej: Logo frontal" value={d.nombre}
                      onChange={(e) => escribirDiseno(i, { nombre: e.target.value })} />
                  </td>
                  {tallasDelDestino.map((t) => (
                    <td key={t} style={CELDA}>
                      <InputTalla valor={d.tallas[t]} max={van[t]}
                        onChange={(v) => escribirDiseno(i, { tallas: { ...d.tallas, [t]: v } })} />
                    </td>
                  ))}
                  <td style={CELDA} className="num">{Object.values(d.tallas).reduce((s, v) => s + cantidad(v), 0)}</td>
                  <td style={CELDA}>
                    <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => cambiarDisenos((ds) => ds.filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ ...CELDA, textAlign: "left", fontWeight: 600 }}>Básicas</td>
                {tallasDelDestino.map((t) => {
                  const n = basicos[t] ?? 0;
                  return (
                    <td key={t} style={{ ...CELDA, fontWeight: 600, color: n < 0 ? "var(--bad)" : undefined }} className="num">{n}</td>
                  );
                })}
                <td style={{ ...CELDA, fontWeight: 600 }} className="num">{nBas}</td>
                <td style={CELDA}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {nVan > 0 && (
        <button className="btn" style={{ fontSize: 12, marginBottom: 10 }}
          onClick={() => cambiarDisenos((ds) => [...ds, { nombre: "", tallas: {} }])}>
          + Agregar estampado
        </button>
      )}

      {nVan > 0 && (
        <div style={{ fontSize: 12.5, display: "grid", gridTemplateColumns: "auto auto", gap: "3px 16px", width: "fit-content" }}>
          <span className="sub">Básica:</span>
          <span className="num">
            {money(cBasica)} c/u <span className="sub">(producción {money(costoProduccion)}{operativo ? ` + operativo ${money(operativo)}` : ""})</span>
          </span>
          {nEst > 0 && (
            <>
              <span className="sub">Estampada:</span>
              <span className="num">
                {money(cEstampada)} c/u <span className="sub">(+ estampado {money(costoEstampado)})</span>
              </span>
            </>
          )}
          <span className="sub">Costo total ({nVan} und.):</span><span className="num">{money(total)}</span>
          {destino === "local" && (
            <>
              <span className="sub">Precio local:</span><span className="num">{money(precioLocal)} c/u</span>
              <span className="sub">Margen:</span>
              <span className="num" style={{ color: nVan * precioLocal - total >= 0 ? "var(--good)" : "var(--bad)" }}>
                {money(nVan * precioLocal - total)}
              </span>
            </>
          )}
          {destino === "bodega" && (
            <span className="sub" style={{ gridColumn: "1 / -1" }}>
              El operativo de la venta en línea ({money(COSTO_OPERATIVO.online)}) se suma cuando sale de la bodega.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Fase 8s: a qué feria va la mercadería. Se elige una abierta o se crea ahí
 * mismo. Lo que se gana en la feria se anota a mano en Finanzas; aquí solo
 * queda qué salió y cuánto costó.
 */
function ElegirFeria({ feriaId, setFeriaId }: { feriaId: string; setFeriaId: (id: string) => void }) {
  const { data, supabase, reload, toast } = useProd();
  const abiertas = data.ferias.filter((f) => !f.cerrada_en);
  const [creando, setCreando] = useState(abiertas.length === 0);
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    if (!nombre.trim() || ocupado) return;
    setOcupado(true);
    const { data: nueva, error } = await supabase
      .from("prod_ferias")
      .insert({ nombre: nombre.trim(), fecha })
      .select("id")
      .single();
    setOcupado(false);
    if (error) return toast(error.message, "error");
    await reload();
    setFeriaId(nueva.id);
    setCreando(false);
    setNombre("");
  }

  return creando ? (
    <Fila>
      <Campo label="Nombre de la feria">
        <input className="pinput" placeholder="Ej: Feria Navideña CCI" value={nombre}
          onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo label="Fecha">
        <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      <div style={{ alignSelf: "flex-end", paddingBottom: 14, display: "flex", gap: 8 }}>
        <button className="btn primary" disabled={!nombre.trim() || ocupado} onClick={crear}>
          {ocupado ? "Creando…" : "Crear feria"}
        </button>
        {abiertas.length > 0 && <button className="btn" onClick={() => setCreando(false)}>Cancelar</button>}
      </div>
    </Fila>
  ) : (
    <Fila>
      <Campo label="¿A qué feria va?">
        <select className="pinput" value={feriaId} onChange={(e) => setFeriaId(e.target.value)}>
          <option value="">— Elige una feria —</option>
          {abiertas.map((f) => <option key={f.id} value={f.id}>{f.nombre} · {fmtFecha(f.fecha)}</option>)}
        </select>
      </Campo>
      <div style={{ alignSelf: "flex-end", paddingBottom: 14 }}>
        <button className="btn" onClick={() => setCreando(true)}>+ Nueva feria</button>
      </div>
    </Fila>
  );
}

/**
 * Cruce guías (logística) ↔ envíos a locales (producción).
 * Una guía "cuadra" si existe un envío al mismo local con fecha a ±3 días
 * y las unidades coinciden; si no, se marca la discrepancia.
 */
function GuiasLogistica() {
  const { data, supabase } = useProd();
  const [guias, setGuias] = useState<Guia[] | null>(null);

  useEffect(() => {
    supabase
      .from("guias_transferencia")
      .select("*")
      .order("fecha", { ascending: false })
      .limit(20)
      .then(({ data: g }) => setGuias((g ?? []) as Guia[]));
  }, [supabase]);

  if (!guias?.length) return null;

  return (
    <div style={{ marginTop: 26 }}>
      <div className="label" style={{ marginBottom: 10 }}>
        Guías de logística · cruce con producción
      </div>
      <div className="card" style={{ padding: "6px 16px" }}>
        {guias.map((g) => {
          const candidatos = data.enviosLocales.filter(
            (e) =>
              e.local_destino === g.local_destino &&
              Math.abs(diasHasta(e.fecha) - diasHasta(g.fecha)) <= 3
          );
          const unidadesProd = candidatos.reduce((s, e) => s + e.unidades, 0);
          const sinDato = !candidatos.length;
          const cuadra = !sinDato && unidadesProd === g.total_unidades;
          return (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5, flexWrap: "wrap" }}>
              <span>
                {fmtFecha(g.fecha)} · <span className="local-tag">{g.local_destino}</span> · {g.total_unidades} und.
                {g.recibido_por && <span className="sub"> · recibió {g.recibido_por}</span>}
              </span>
              {cuadra ? (
                <Badge color="verde">✓ cuadra con producción</Badge>
              ) : sinDato ? (
                <Badge color="ambar">sin envío de producción registrado (±3 días)</Badge>
              ) : (
                <Badge color="rojo">⚠ producción registró {unidadesProd} und.</Badge>
              )}
            </div>
          );
        })}
      </div>
      <p className="sub" style={{ fontSize: 12, marginTop: 8 }}>
        Para que el cruce funcione, elige el local destino al procesar lotes a locales.
      </p>
    </div>
  );
}

function Historial() {
  const { data } = useProd();
  const items = [
    ...data.lotesEstampado.map((l) => ({
      key: `e-${l.id}`,
      fecha: l.fecha_envio ?? "",
      texto: `${l.prenda_nombre} · ${l.color} · ${l.total_unidades} und. a estampar (${(l.disenos ?? []).map((d) => d.nombre).join(", ")})`,
      badge: <Badge color="ambar">Estampado</Badge>,
    })),
    ...data.enviosLocales.map((v) => ({
      key: `l-${v.id}`,
      fecha: v.fecha,
      texto: `${v.prenda_nombre} · ${v.color} · ${v.unidades} und. a locales · margen ${money(Number(v.margen))}${v.producto_codigo ? ` · ${v.producto_codigo}` : ""}`,
      badge: <Badge color="azul">Locales</Badge>,
    })),
    ...data.feriaIngresos.map((f) => ({
      key: `f-${f.id}`,
      fecha: f.fecha,
      texto: `${f.prenda_nombre} · ${f.color}${f.estampado ? ` · ${f.estampado}` : ""} · ${f.unidades} und. a ${data.ferias.find((x) => x.id === f.feria_id)?.nombre ?? "feria"} · ${money(Number(f.costo_unitario))} c/u`,
      badge: <Badge color="verde">Feria</Badge>,
    })),
  ].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  if (!items.length) return null;
  return (
    <div style={{ marginTop: 26 }}>
      <div className="label" style={{ marginBottom: 10 }}>Historial de salidas</div>
      <div className="card" style={{ padding: "6px 16px" }}>
        {items.slice(0, 25).map((i) => (
          <div key={i.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
            <span>{i.texto}</span>
            <span style={{ whiteSpace: "nowrap" }}>{i.badge} <span className="sub" style={{ fontSize: 11.5 }}>{fmtFecha(i.fecha)}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
