"use client";

import { useState } from "react";
import { useProd, type ProdData } from "./useProduccion";
import { Badge, Vacio } from "@/components/ui";
import { money, ordenarTallas, type Feria, type LoteEstampado, type OrdenEstampado } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { resumenOrden, textoParaTaller, type LoteParaOrden, type Tono } from "@/lib/produccion/ordenEstampado";
import FichaEstampadoModal from "./FichaEstampadoModal";
import ElegirEstampado from "./ElegirEstampado";

/**
 * Estampados — fase 8v. Los lotes pendientes se juntan en una ORDEN (pueden
 * ser de distintas producciones y destinos) y se mandan juntos al taller. Al
 * taller se le pasan METROS por estampado y tono; al dueño, el desglose por
 * lote. Cada lote vuelve por separado y entra solo a su destino (fase 8t).
 */
export default function EstampadosTab() {
  const { data } = useProd();
  const [elegidos, setElegidos] = useState<string[]>([]);
  const pendientes = data.lotesEstampado.filter((l) => l.estado === "pendiente");
  const enTaller = data.lotesEstampado.filter((l) => l.estado === "en_taller");
  const retornados = data.lotesEstampado.filter((l) => l.estado === "retornado");
  // Solo los que siguen pendientes: tras recargar, los ya mandados se caen solos.
  const seleccion = pendientes.filter((l) => elegidos.includes(l.id));
  const ordenesAbiertas = data.ordenesEstampado.filter((o) => enTaller.some((l) => l.orden_id === o.id));
  const sueltosEnTaller = enTaller.filter((l) => !l.orden_id || !data.ordenesEstampado.some((o) => o.id === l.orden_id));

  const elegir = (ids: string[], marcar: boolean) =>
    setElegidos((x) => (marcar ? [...new Set([...x, ...ids])] : x.filter((y) => !ids.includes(y))));
  const porProduccion = porProduccionDe(pendientes);

  return (
    <section>
      <div className="section-head">
        <h2>Estampados <span className="sub" style={{ fontWeight: 400 }}>· órdenes al taller y retorno de lotes</span></h2>
      </div>

      <ListaEstampados />

      {!data.lotesEstampado.length && (
        <Vacio titulo="Sin lotes para estampar aún" hint="Los lotes con estampado que proceses en Envío aparecen aquí." />
      )}

      {pendientes.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div className="label">Pendientes de enviar al taller · marca las producciones que van juntas en una orden</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ fontSize: 12 }} onClick={() => setElegidos(pendientes.map((l) => l.id))}>Marcar todos</button>
              {seleccion.length > 0 && <button className="btn" style={{ fontSize: 12 }} onClick={() => setElegidos([])}>Quitar marcas</button>}
            </div>
          </div>
          {seleccion.length > 0 && <NuevaOrden lotes={seleccion} alCrear={() => setElegidos([])} />}
          {porProduccion.map((ls) => (
            <ProduccionPendiente key={ls[0].maquila_id ?? ls[0].id} lotes={ls} elegidos={elegidos} alElegir={elegir} />
          ))}
        </>
      )}

      {enTaller.length > 0 && (
        <>
          <div className="label" style={{ margin: "18px 0 10px" }}>En taller ({enTaller.length})</div>
          {ordenesAbiertas.map((o) => (
            <OrdenEnTaller key={o.id} orden={o} lotes={enTaller.filter((l) => l.orden_id === o.id)} />
          ))}
          {porProduccionDe(sueltosEnTaller).map((ls) => (
            <ProduccionPendiente key={ls[0].maquila_id ?? ls[0].id} lotes={ls} enTaller />
          ))}
        </>
      )}
      {retornados.length > 0 && (
        <>
          <div className="label" style={{ margin: "18px 0 10px" }}>Retornados ({retornados.length})</div>
          {retornados.slice(0, 30).map((l) => (
            <div className="prod-card" key={l.id} style={{ opacity: 0.75 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <h4>{l.prenda_nombre} <Badge color="azul">{l.color}</Badge> <DestinoLote lote={l} /></h4>
                  <div className="prod-meta">
                    {l.total_unidades} und. · {(l.disenos ?? []).map((d) => `${d.nombre} (${d.unidades})`).join(", ")} ·
                    costo {money(Number(l.costo_total))} · retornado {fmtFecha(l.fecha_retorno)}
                  </div>
                </div>
                <Badge color="verde">Retornado</Badge>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

const CELDA = { padding: "5px 8px", textAlign: "center" as const };

/** Fase 8w: una tarjeta por producción (maquila); los lotes sin producción, cada uno aparte. */
function porProduccionDe(lotes: LoteEstampado[]): LoteEstampado[][] {
  return Object.values(
    lotes.reduce<Record<string, LoteEstampado[]>>((acc, l) => {
      const k = l.maquila_id ?? l.salida_id ?? `lote-${l.id}`;
      (acc[k] ??= []).push(l);
      return acc;
    }, {})
  );
}

/** Fase 8v: el tono sale del color del corte (prod_corte_colores.tono). */
function coloresDelLote(data: ProdData, lote: LoteEstampado) {
  const m = data.maquilas.find((x) => x.id === lote.maquila_id);
  return (m?.colores ?? []).filter((c) => c.color === lote.color);
}

function tonoDeLote(data: ProdData, lote: LoteEstampado): Tono | null {
  // Fase 8y: un lote desde bodega no tiene corte; guarda su tono él mismo.
  if (lote.tono) return lote.tono;
  const cs = coloresDelLote(data, lote);
  return cs.find((c) => c.tono)?.tono ?? null;
}

function etiquetaLote(lote: LoteEstampado, ferias: Feria[]): string {
  return `${lote.prenda_nombre} · ${lote.color} → ${textoDestino(lote, ferias)}`;
}

/** Interruptor claro / oscuro del lote: cambia el tono del color en el corte. */
function TonoLote({ lote, compacto }: { lote: LoteEstampado; compacto?: boolean }) {
  const { data, supabase, reload, toast } = useProd();
  const tono = tonoDeLote(data, lote);
  const colores = coloresDelLote(data, lote);
  async function cambiar(t: Tono) {
    // Sin corte (desde bodega): el tono vive en el lote.
    const { error } = colores.length
      ? await supabase.from("prod_corte_colores").update({ tono: t }).in("id", colores.map((c) => c.corte_color_id))
      : await supabase.from("prod_lotes_estampado").update({ tono: t }).eq("id", lote.id);
    if (error) return toast(error.message, "error");
    await reload();
  }
  if (compacto) {
    return (
      <input type="checkbox" checked={tono === "oscuro"} title={tono ? "" : "Sin marcar: cuenta como claro"}
        onChange={(e) => cambiar(e.target.checked ? "oscuro" : "claro")}
        style={{ accentColor: "var(--accent)", width: 16, height: 16, outline: tono ? undefined : "1px dashed var(--warn)" }} />
    );
  }
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
      <input type="checkbox" checked={tono === "oscuro"} onChange={(e) => cambiar(e.target.checked ? "oscuro" : "claro")}
        style={{ accentColor: "var(--accent)" }} />
      Oscuro {!tono && <span style={{ color: "var(--warn)" }}>(sin marcar: cuenta como claro)</span>}
    </label>
  );
}

/**
 * Fase 8w: los lotes pendientes se ven POR PRODUCCIÓN (pedido del dueño): una
 * tarjeta por corte con una tabla ordenada por estampado y color, en vez de
 * una tarjeta por color. Se marca la producción entera para la orden.
 */
function ProduccionPendiente({
  lotes,
  elegidos = [],
  alElegir,
  enTaller = false,
}: {
  lotes: LoteEstampado[];
  elegidos?: string[];
  alElegir?: (ids: string[], marcar: boolean) => void;
  /** En el taller: sin casilla de orden, y con el retorno de cada lote. */
  enTaller?: boolean;
}) {
  const { data, supabase, reload, toast } = useProd();
  const [ficha, setFicha] = useState<LoteEstampado | null>(null);
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [fechaRetorno, setFechaRetorno] = useState(hoyEcuador());
  const [retornando, setRetornando] = useState(false);
  const m = data.maquilas.find((x) => x.id === lotes[0].maquila_id);
  const corte = m ? data.cortes.find((c) => c.id === m.corte_id) : undefined;
  const pedido = corte ? data.pedidos.find((p) => p.id === corte.pedido_id) : undefined;
  const prenda = pedido ? data.prendas.find((p) => p.id === pedido.prenda_id) : undefined;
  const ids = lotes.map((l) => l.id);
  const todos = ids.every((id) => elegidos.includes(id));
  const algunos = ids.some((id) => elegidos.includes(id));
  const total = lotes.reduce((s, l) => s + Number(l.total_unidades), 0);

  // Una fila por estampado de cada lote, ordenadas por estampado y luego color.
  const filas = lotes
    .flatMap((l) =>
      (l.disenos ?? []).map((d) => ({
        lote: l,
        nombre: d.nombre,
        unidades: Number(d.unidades),
        // Los lotes viejos no traen tallas por diseño; con uno solo, son las del lote.
        tallas: d.tallas ?? ((l.disenos ?? []).length === 1 ? l.tallas : null),
      }))
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.lote.color.localeCompare(b.lote.color));
  const tallas = ordenarTallas([...new Set(filas.flatMap((f) => Object.keys(f.tallas ?? {})))]);

  /**
   * Fase 8a/8t: una llamada a fn_retornar_lote_estampado por lote; cada lote
   * entra solo a su destino. Un reintento no es error (`ya_retornado`).
   */
  async function retornar(cuales: LoteEstampado[]) {
    if (!fechaRetorno || retornando) return;
    setRetornando(true);
    let und = 0;
    try {
      for (const l of cuales) {
        const { data: res, error } = await supabase.rpc("fn_retornar_lote_estampado", { p_lote_id: l.id, p_fecha: fechaRetorno });
        if (error) throw new Error(`${l.color}: ${error.message}`);
        und += (res as { unidades?: number } | null)?.unidades ?? 0;
      }
      toast(`${und} estampadas recibidas · cada una entró a su destino`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setRetornando(false);
      await reload();
    }
  }

  async function renombrar(viejo: string, nuevo: string) {
    setRenombrando(null);
    if (!nuevo || nuevo === viejo) return;
    const { error } = await supabase.rpc("fn_renombrar_estampado", { p_viejo: viejo, p_nuevo: nuevo, p_lote_ids: ids });
    if (error) return toast(error.message, "error");
    toast(`"${viejo}" ahora es "${nuevo}" en esta producción`);
    await reload();
  }

  return (
    <div className="prod-card" style={algunos ? { borderColor: "var(--accent)" } : undefined}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {!enTaller && (
          <input type="checkbox" checked={todos} onChange={() => alElegir?.(ids, !todos)}
            title="Marcar esta producción para la orden"
            style={{ accentColor: "var(--accent)", width: 18, height: 18, marginTop: 3 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4>
            {pedido?.nombre_tela ?? (lotes[0].salida_id ? "Desde bodega" : "Sin producción")}
            {(prenda?.nombre ?? lotes[0].prenda_nombre) && (
              <span className="sub" style={{ fontWeight: 400 }}> · {prenda?.nombre ?? lotes[0].prenda_nombre}</span>
            )}
          </h4>
          <div className="prod-meta">
            {total} und. {enTaller ? "en el taller" : "para estampar"} · {lotes.length} {lotes.length === 1 ? "lote" : "lotes"}
            {enTaller && lotes[0].fecha_envio && ` · enviado ${fmtFecha(lotes[0].fecha_envio)}`}
          </div>

          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table style={{ width: "auto", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...CELDA, textAlign: "left" }}>Estampado</th>
                  <th style={{ ...CELDA, textAlign: "left" }}>Color</th>
                  <th style={CELDA}>Oscuro</th>
                  <th style={{ ...CELDA, textAlign: "left" }}>Va a</th>
                  {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
                  <th style={CELDA}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const clave = `${f.lote.id}|${f.nombre}`;
                  const enLista = data.estampados.some((e) => e.nombre === f.nombre);
                  return (
                    <tr key={clave + i}>
                      <td style={{ ...CELDA, textAlign: "left" }}>
                        {renombrando === clave ? (
                          <ElegirEstampado valor={f.nombre} ancho={150} onChange={(n) => renombrar(f.nombre, n)} />
                        ) : (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <b>{f.nombre}</b>
                            {!enLista && <span style={{ color: "var(--warn)", fontSize: 11 }}>no está en la lista</span>}
                            <button className="btn" title="Cambiar el nombre en esta producción"
                              style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => setRenombrando(clave)}>✏️</button>
                          </span>
                        )}
                      </td>
                      <td style={{ ...CELDA, textAlign: "left" }}>{f.lote.color}</td>
                      <td style={CELDA}><TonoLote lote={f.lote} compacto /></td>
                      <td style={{ ...CELDA, textAlign: "left" }}><DestinoLote lote={f.lote} /></td>
                      {tallas.map((t) => <td key={t} style={CELDA} className="num">{f.tallas?.[t] || "—"}</td>)}
                      <td style={{ ...CELDA, fontWeight: 600 }} className="num">{f.unidades}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {enTaller && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
              <div style={{ minWidth: 140 }}>
                <div className="label" style={{ fontSize: 10.5 }}>Fecha de retorno</div>
                <input className="pinput" type="date" value={fechaRetorno} onChange={(e) => setFechaRetorno(e.target.value)} />
              </div>
              {lotes.length > 1 && lotes.map((l) => (
                <button key={l.id} className="btn" style={{ fontSize: 12 }} disabled={retornando} onClick={() => retornar([l])}>
                  ✓ {l.color} → {textoDestino(l, data.ferias)}
                </button>
              ))}
              <button className="btn primary" style={{ fontSize: 12.5 }} disabled={retornando || !fechaRetorno} onClick={() => retornar(lotes)}>
                {retornando ? "Procesando…" : lotes.length > 1 ? "✓ Todo recibido" : "✓ Retorno recibido"}
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <span className="sub" style={{ fontSize: 12 }}>Ficha visual:</span>
            {lotes.map((l) => (
              <button key={l.id} className="btn" style={{ fontSize: 11.5, padding: "3px 8px" }} onClick={() => setFicha(l)}>
                {l.color}{l.destino ? ` → ${l.destino === "local" ? "locales" : l.destino}` : ""}
              </button>
            ))}
          </div>
        </div>
      </div>
      {ficha && <FichaEstampadoModal lote={ficha} abierto onCerrar={() => setFicha(null)} />}
    </div>
  );
}

/**
 * Fase 8w: la lista de estampados. Renombrar aquí cambia el nombre en la lista
 * y en todos los lotes que aún no vuelven del taller; si el nombre nuevo ya
 * existe, los dos se funden en uno.
 */
function ListaEstampados() {
  const { data, supabase, reload, toast } = useProd();
  const [abierta, setAbierta] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [nuevo, setNuevo] = useState("");
  const activos = data.estampados.filter((e) => !e.archivada_en);

  async function agregar() {
    const n = nuevo.trim();
    if (!n) return;
    const { error } = await supabase.from("prod_estampados").insert({ nombre: n });
    if (error) return toast(error.message.includes("uq_estampados") ? `"${n}" ya está en la lista.` : error.message, "error");
    setNuevo("");
    await reload();
  }

  async function guardar(viejo: string) {
    const n = texto.trim();
    setEditando(null);
    if (!n || n === viejo) return;
    const { data: res, error } = await supabase.rpc("fn_renombrar_estampado", { p_viejo: viejo, p_nuevo: n, p_lote_ids: null });
    if (error) return toast(error.message, "error");
    const lotes = (res as { lotes?: number } | null)?.lotes ?? 0;
    toast(`"${viejo}" ahora es "${n}"${lotes ? ` · ${lotes} ${lotes === 1 ? "lote" : "lotes"} actualizados` : ""}`);
    await reload();
  }

  return (
    <div className="card" style={{ padding: "10px 14px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13 }}><b>Lista de estampados</b> <span className="sub">· {activos.length}</span></span>
        <button className="btn" style={{ fontSize: 12 }} onClick={() => setAbierta(!abierta)}>{abierta ? "Ocultar" : "Ver y editar"}</button>
      </div>
      {abierta && (
        <div style={{ marginTop: 10 }}>
          {activos.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
              {editando === e.id ? (
                <>
                  <input className="pinput" autoFocus style={{ flex: 1 }} value={texto} onChange={(ev) => setTexto(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && guardar(e.nombre)} />
                  <button className="btn primary" style={{ fontSize: 12 }} onClick={() => guardar(e.nombre)}>Guardar</button>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => setEditando(null)}>✕</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13 }}>{e.nombre}</span>
                  <button className="btn" style={{ fontSize: 11.5, padding: "2px 8px" }}
                    onClick={() => { setEditando(e.id); setTexto(e.nombre); }}>✏️ Renombrar</button>
                </>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input className="pinput" style={{ flex: 1 }} placeholder="Agregar estampado, ej: Cajas" value={nuevo}
              onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} />
            <button className="btn primary" style={{ fontSize: 12 }} disabled={!nuevo.trim()} onClick={agregar}>Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** El resumen de una orden: metros para el taller y el desglose por lote para el dueño. */
function ResumenOrden({ lotes, porMetro }: { lotes: LoteEstampado[]; porMetro: number }) {
  const { data, toast } = useProd();
  const paraOrden: LoteParaOrden[] = lotes.map((l) => ({
    id: l.id,
    etiqueta: etiquetaLote(l, data.ferias),
    tono: tonoDeLote(data, l),
    disenos: (l.disenos ?? []).map((d) => ({ nombre: d.nombre, unidades: Number(d.unidades) })),
  }));
  const lineas = resumenOrden(paraOrden, porMetro);
  const total = lineas.reduce((s, l) => s + l.metros, 0);
  const sinTono = paraOrden.filter((l) => !l.tono).length;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoParaTaller(lineas, porMetro));
      toast("Resumen copiado: pégalo en el chat del taller");
    } catch {
      toast("No se pudo copiar; selecciona el texto a mano.", "error");
    }
  }

  return (
    <div>
      <div className="label" style={{ fontSize: 10.5, margin: "4px 0 6px" }}>Para el taller · {total} m en total</div>
      <div className="table-scroll" style={{ marginBottom: 8 }}>
        <table style={{ width: "auto", minWidth: "60%" }}>
          <thead>
            <tr>
              <th style={{ ...CELDA, textAlign: "left" }}>Estampado</th>
              <th style={CELDA}>Prendas</th>
              <th style={CELDA}>Estampados</th>
              <th style={CELDA}>Metros</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={`${l.diseno}|${l.tono}`}>
                <td style={{ ...CELDA, textAlign: "left" }}>{l.diseno}</td>
                <td style={CELDA}><Badge color={l.tono === "oscuro" ? "gris" : "azul"}>{l.tono === "oscuro" ? "Oscuras" : "Claras"}</Badge></td>
                <td style={CELDA} className="num">{l.unidades}</td>
                <td style={{ ...CELDA, fontWeight: 700 }} className="num">{l.metros} m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sinTono > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 6 }}>
          ⚠ {sinTono} {sinTono === 1 ? "lote no tiene" : "lotes no tienen"} el tono marcado y cuentan como claros.
        </div>
      )}
      <button className="btn" style={{ fontSize: 12, marginBottom: 10 }} onClick={copiar}>📋 Copiar resumen para el taller</button>

      <div className="label" style={{ fontSize: 10.5, margin: "6px 0 6px" }}>Para ti · de dónde sale cada metro</div>
      <div style={{ fontSize: 12.5 }}>
        {lineas.map((l) => (
          <div key={`${l.diseno}|${l.tono}`} style={{ marginBottom: 6 }}>
            <b>{l.diseno}</b> <span className="sub">({l.tono === "oscuro" ? "oscuras" : "claras"}) · {l.metros} m</span>
            {l.detalle.map((d) => (
              <div key={d.loteId} className="sub" style={{ paddingLeft: 12 }}>
                {d.metros} m · {d.etiqueta} ({d.unidades} und.)
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NuevaOrden({ lotes, alCrear }: { lotes: LoteEstampado[]; alCrear: () => void }) {
  const { data, supabase, reload, toast } = useProd();
  const [tallerId, setTallerId] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [porMetro, setPorMetro] = useState("4");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const pm = parseInt(porMetro, 10) || 0;

  async function crear() {
    if (ocupado || pm <= 0 || !fecha) return;
    setOcupado(true);
    const { error } = await supabase.rpc("fn_crear_orden_estampado", {
      p_lote_ids: lotes.map((l) => l.id),
      p_taller_id: tallerId || null,
      p_fecha: fecha,
      p_por_metro: pm,
      p_nota: nota.trim() || null,
    });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    toast(`Orden enviada al taller · ${lotes.length} ${lotes.length === 1 ? "lote" : "lotes"}`);
    alCrear();
    await reload();
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14, borderColor: "var(--accent)" }}>
      <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>
        Nueva orden de estampado · {lotes.length} {lotes.length === 1 ? "lote" : "lotes"} juntos
      </div>
      <ResumenOrden lotes={lotes} porMetro={pm > 0 ? pm : 4} />
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Taller</div>
          <select className="pinput" value={tallerId} onChange={(e) => setTallerId(e.target.value)}>
            <option value="">— Sin asignar —</option>
            {/* Fase 8e: aquí se ELIGE, así que los archivados no se ofrecen. */}
            {data.talleres.filter((t) => !t.archivada_en).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Fecha de envío</div>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div style={{ width: 120 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Estampados por metro</div>
          <input className="pinput" type="number" min="1" value={porMetro} onChange={(e) => setPorMetro(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Nota (opcional)</div>
          <input className="pinput" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
        <button className="btn primary" style={{ fontSize: 12.5 }} disabled={ocupado || pm <= 0 || !fecha} onClick={crear}>
          {ocupado ? "Enviando…" : "Crear orden y enviar al taller →"}
        </button>
      </div>
    </div>
  );
}

function OrdenEnTaller({ orden, lotes }: { orden: OrdenEstampado; lotes: LoteEstampado[] }) {
  const { data } = useProd();
  const [ver, setVer] = useState(false);
  const taller = data.talleres.find((t) => t.id === orden.taller_id);
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 13 }}>
          <b>Orden del {fmtFecha(orden.fecha)}</b>
          <span className="sub"> · {taller?.nombre ?? "taller sin asignar"} · {lotes.length} {lotes.length === 1 ? "lote" : "lotes"} en el taller{orden.nota ? ` · ${orden.nota}` : ""}</span>
        </div>
        <button className="btn" style={{ fontSize: 12 }} onClick={() => setVer(!ver)}>{ver ? "Ocultar resumen" : "Ver resumen"}</button>
      </div>
      {ver && <div style={{ marginTop: 10 }}><ResumenOrden lotes={lotes} porMetro={orden.por_metro} /></div>}
      <div style={{ marginTop: 10 }}>
        {porProduccionDe(lotes).map((ls) => (
          <ProduccionPendiente key={ls[0].maquila_id ?? ls[0].id} lotes={ls} enTaller />
        ))}
      </div>
    </div>
  );
}

/** Fase 8t: a dónde entra el lote al volver del taller. Los anteriores, a la bodega. */
function textoDestino(lote: LoteEstampado, ferias: Feria[]): string {
  if (lote.destino === "feria") return `feria ${ferias.find((f) => f.id === lote.feria_id)?.nombre ?? ""}`.trim();
  if (lote.destino === "local") return lote.local_destino ? `local ${lote.local_destino}` : "locales";
  return "bodega";
}

function DestinoLote({ lote }: { lote: LoteEstampado }) {
  const { data } = useProd();
  return <Badge color={lote.destino === "feria" ? "verde" : lote.destino === "local" ? "ambar" : "gris"}>→ {textoDestino(lote, data.ferias)}</Badge>;
}
