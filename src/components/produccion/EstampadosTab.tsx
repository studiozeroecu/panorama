"use client";

import { useState } from "react";
import { useProd, type ProdData } from "./useProduccion";
import { Badge, Vacio } from "@/components/ui";
import { money, ordenarTallas, type Feria, type LoteEstampado, type OrdenEstampado } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { resumenOrden, textoParaTaller, type LoteParaOrden, type Tono } from "@/lib/produccion/ordenEstampado";
import FichaEstampadoModal from "./FichaEstampadoModal";

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

  const alternar = (id: string) =>
    setElegidos((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <section>
      <div className="section-head">
        <h2>Estampados <span className="sub" style={{ fontWeight: 400 }}>· órdenes al taller y retorno de lotes</span></h2>
      </div>

      {!data.lotesEstampado.length && (
        <Vacio titulo="Sin lotes para estampar aún" hint="Los lotes con estampado que proceses en Envío aparecen aquí." />
      )}

      {pendientes.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div className="label">Pendientes de enviar al taller ({pendientes.length}) · marca los que van juntos en una orden</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ fontSize: 12 }} onClick={() => setElegidos(pendientes.map((l) => l.id))}>Marcar todos</button>
              {seleccion.length > 0 && <button className="btn" style={{ fontSize: 12 }} onClick={() => setElegidos([])}>Quitar marcas</button>}
            </div>
          </div>
          {seleccion.length > 0 && <NuevaOrden lotes={seleccion} alCrear={() => setElegidos([])} />}
          {pendientes.map((l) => (
            <LotePendiente key={l.id} lote={l} elegido={elegidos.includes(l.id)} alElegir={() => alternar(l.id)} />
          ))}
        </>
      )}

      {enTaller.length > 0 && (
        <>
          <div className="label" style={{ margin: "18px 0 10px" }}>En taller ({enTaller.length})</div>
          {ordenesAbiertas.map((o) => (
            <OrdenEnTaller key={o.id} orden={o} lotes={enTaller.filter((l) => l.orden_id === o.id)} />
          ))}
          {sueltosEnTaller.map((l) => <LoteEnTaller key={l.id} lote={l} />)}
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

/** Fase 8v: el tono sale del color del corte (prod_corte_colores.tono). */
function coloresDelLote(data: ProdData, lote: LoteEstampado) {
  const m = data.maquilas.find((x) => x.id === lote.maquila_id);
  return (m?.colores ?? []).filter((c) => c.color === lote.color);
}

function tonoDeLote(data: ProdData, lote: LoteEstampado): Tono | null {
  const cs = coloresDelLote(data, lote);
  return cs.find((c) => c.tono)?.tono ?? null;
}

function etiquetaLote(lote: LoteEstampado, ferias: Feria[]): string {
  return `${lote.prenda_nombre} · ${lote.color} → ${textoDestino(lote, ferias)}`;
}

/** Qué estampado va en qué talla, como cuadro. Los lotes viejos no traen tallas por diseño. */
function CuadroDisenos({ lote }: { lote: LoteEstampado }) {
  const disenos = lote.disenos ?? [];
  const conTallas = disenos.length > 0 && disenos.every((d) => d.tallas);
  if (!conTallas) {
    return (
      <div className="sub" style={{ fontSize: 12.5 }}>
        {disenos.map((d) => `${d.nombre} (${d.unidades})`).join(", ")}
      </div>
    );
  }
  const tallas = ordenarTallas([...new Set(disenos.flatMap((d) => Object.keys(d.tallas ?? {})))]);
  return (
    <div className="table-scroll">
      <table style={{ width: "auto", minWidth: "60%" }}>
        <thead>
          <tr>
            <th style={{ ...CELDA, textAlign: "left" }}>Estampado</th>
            {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
            <th style={CELDA}>Total</th>
          </tr>
        </thead>
        <tbody>
          {disenos.map((d, i) => (
            <tr key={i}>
              <td style={{ ...CELDA, textAlign: "left" }}>{d.nombre}</td>
              {tallas.map((t) => <td key={t} style={CELDA} className="num">{d.tallas?.[t] || "—"}</td>)}
              <td style={{ ...CELDA, fontWeight: 600 }} className="num">{d.unidades}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Interruptor claro / oscuro del lote: cambia el tono del color en el corte. */
function TonoLote({ lote }: { lote: LoteEstampado }) {
  const { data, supabase, reload, toast } = useProd();
  const tono = tonoDeLote(data, lote);
  const colores = coloresDelLote(data, lote);
  async function cambiar(t: Tono) {
    if (!colores.length) return;
    const { error } = await supabase
      .from("prod_corte_colores")
      .update({ tono: t })
      .in("id", colores.map((c) => c.corte_color_id));
    if (error) return toast(error.message, "error");
    await reload();
  }
  if (!colores.length) return <Badge color="gris">tono sin marcar</Badge>;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
      <input type="checkbox" checked={tono === "oscuro"} onChange={(e) => cambiar(e.target.checked ? "oscuro" : "claro")}
        style={{ accentColor: "var(--accent)" }} />
      Oscuro {!tono && <span style={{ color: "var(--warn)" }}>(sin marcar: cuenta como claro)</span>}
    </label>
  );
}

function LotePendiente({ lote, elegido, alElegir }: { lote: LoteEstampado; elegido: boolean; alElegir: () => void }) {
  const [ficha, setFicha] = useState(false);
  return (
    <div className="prod-card" style={elegido ? { borderColor: "var(--accent)" } : undefined}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <input type="checkbox" checked={elegido} onChange={alElegir}
          style={{ accentColor: "var(--accent)", width: 18, height: 18, marginTop: 3 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4>{lote.prenda_nombre} <Badge color="azul">{lote.color}</Badge> <DestinoLote lote={lote} /></h4>
          <div className="prod-meta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span>{lote.total_unidades} und. · {money(Number(lote.costo_unitario))}/und. de estampado</span>
            <TonoLote lote={lote} />
          </div>
          <div style={{ marginTop: 8 }}><CuadroDisenos lote={lote} /></div>
          <div style={{ marginTop: 8 }}>
            <button className="btn" style={{ fontSize: 12 }} onClick={() => setFicha(true)}>Ficha visual</button>
          </div>
        </div>
      </div>
      <FichaEstampadoModal lote={lote} abierto={ficha} onCerrar={() => setFicha(false)} />
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
        {lotes.map((l) => <LoteEnTaller key={l.id} lote={l} />)}
      </div>
    </div>
  );
}

function LoteEnTaller({ lote }: { lote: LoteEstampado }) {
  const { data, supabase, reload, toast } = useProd();
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);
  const [ficha, setFicha] = useState(false);
  const taller = data.talleres.find((t) => t.id === lote.taller_id);

  /**
   * Fase 8a: una sola llamada a fn_retornar_lote_estampado, que suma el stock y
   * marca el lote en la misma transacción. Antes eran N sumas desde el navegador y
   * después el update: si fallaba a mitad, el lote seguía en taller y reintentar
   * duplicaba el stock. El reparto por talla vive ahora solo en fn_repartir_por_talla.
   */
  async function retornar() {
    if (!fecha) return toast("Ingresa la fecha de retorno.", "error");
    setOcupado(true);
    try {
      const { data: res, error } = await supabase.rpc("fn_retornar_lote_estampado", {
        p_lote_id: lote.id,
        p_fecha: fecha,
      });
      if (error) throw new Error(error.message);

      const r = (res ?? {}) as { ya_retornado?: boolean; unidades?: number };
      // Un reintento no es un fallo: ya estaba hecho. Se avisa en tono neutro.
      toast(
        r.ya_retornado
          ? "Este lote ya estaba retornado — no se sumó nada."
          : `${r.unidades ?? 0} unidades estampadas → ${textoDestino(lote, data.ferias)}`
      );
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="prod-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h4>{lote.prenda_nombre} <Badge color="azul">{lote.color}</Badge> <DestinoLote lote={lote} /></h4>
          <div className="prod-meta">
            {lote.total_unidades} und. · taller: {taller?.nombre ?? "—"} · enviado {fmtFecha(lote.fecha_envio)} ·
            costo {money(Number(lote.costo_total))}
          </div>
          <div style={{ marginTop: 6 }}><CuadroDisenos lote={lote} /></div>
        </div>
        <Badge color="ambar">En taller</Badge>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 150 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Fecha de retorno</div>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <button className="btn" style={{ fontSize: 12.5 }} onClick={() => setFicha(true)}>Ficha visual</button>
        <button className="btn primary" style={{ fontSize: 12.5 }} disabled={ocupado} onClick={retornar}>
          {ocupado ? "Procesando…" : "Retorno recibido ✓"}
        </button>
      </div>
      <FichaEstampadoModal lote={lote} abierto={ficha} onCerrar={() => setFicha(false)} />
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
