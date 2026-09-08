"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Campo, Fila, Badge, Vacio, Tallas } from "@/components/ui";
import { money, ordenarTallas, type Maquila, type ColorMaquila } from "@/lib/produccion/types";
import { fmtFecha, diasHasta } from "@/lib/fechas";
import { LOCALES, type Guia } from "@/lib/locales";
import { useEffect } from "react";

interface Lote {
  maquila: Maquila;
  col: ColorMaquila;
}

export default function EnvioTab() {
  const { data } = useProd();

  const lotes: Lote[] = [];
  for (const m of data.maquilas) {
    for (const col of m.colores) {
      if (col.estado === "entregado" && !col.procesado) lotes.push({ maquila: m, col });
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Envío <span className="sub" style={{ fontWeight: 400 }}>· decide el destino de cada lote entregado por maquila</span></h2>
      </div>

      {!lotes.length ? (
        <Vacio titulo="Sin lotes por procesar" hint="Cuando marques un color como entregado en Maquila, aparecerá aquí." />
      ) : (
        lotes.map((l) => <LoteCard key={l.col.id} lote={l} />)
      )}

      <Historial />
      <GuiasLogistica />
    </section>
  );
}

function LoteCard({ lote }: { lote: Lote }) {
  const { data, supabase, reload, toast } = useProd();
  const { maquila, col } = lote;
  const corte = data.cortes.find((c) => c.id === maquila.corte_id);
  const pedido = corte ? data.pedidos.find((p) => p.id === corte.pedido_id) : null;
  const prenda = pedido ? data.prendas.find((x) => x.id === pedido.prenda_id) : null;

  const [destino, setDestino] = useState<"online" | "estampado" | "local">("online");
  const [disenos, setDisenos] = useState<{ nombre: string; unidades: string }[]>([{ nombre: "", unidades: "" }]);
  const [costoEstampado, setCostoEstampado] = useState("2");
  const [tallasLocal, setTallasLocal] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [t, v] of Object.entries(col.tallas ?? {})) if (v > 0) init[t] = String(v);
    return init;
  });
  const [productoCodigo, setProductoCodigo] = useState("");
  const [localDestino, setLocalDestino] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cfPorUnidad = data.costosFijos.reduce((s, c) => s + Number(c.valor), 0);
  const costoUnitario = Number(maquila.costo_unitario) + cfPorUnidad;
  const precioLocal = prenda ? Number(prenda.precio_venta_local) : 0;

  const unidadesEstampar = disenos.reduce((s, d) => s + (parseInt(d.unidades, 10) || 0), 0);
  const costoEst = parseFloat(costoEstampado) || 0;
  const unidadesLocal = Object.values(tallasLocal).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);

  /**
   * Fase 7: una sola llamada a fn_procesar_lote_maquila. Antes esto eran, desde el
   * navegador y sin transacción, un insert + N sumas de stock + marcar procesado; si
   * algo fallaba a mitad el color NO quedaba procesado, seguía en la lista, y volver
   * a pulsar creaba un segundo lote y duplicaba el stock. Ahora la función bloquea
   * la fila del color y rechaza el reproceso.
   * Las reglas (unidades del lote, diseños, tallas disponibles) viven allí.
   */
  async function procesar() {
    setOcupado(true);
    try {
      const tallasLocalNum: Record<string, number> = {};
      for (const [t, v] of Object.entries(tallasLocal)) {
        const n = parseInt(v, 10) || 0;
        if (n > 0) tallasLocalNum[t] = n;
      }

      const { data: res, error } = await supabase.rpc("fn_procesar_lote_maquila", {
        p_maquila_color_id: col.id,
        p_destino: destino,
        p_disenos:
          destino === "estampado"
            ? disenos
                .map((d) => ({ nombre: d.nombre.trim(), unidades: parseInt(d.unidades, 10) || 0 }))
                .filter((d) => d.nombre && d.unidades > 0)
            : [],
        p_costo_estampado: costoEst,
        p_tallas_local: destino === "local" ? tallasLocalNum : {},
        p_local_destino: localDestino || null,
        p_producto_codigo: productoCodigo.trim() || null,
        p_precio_local: precioLocal,
        p_costo_unitario: costoUnitario,
      });
      if (error) throw new Error(error.message);

      const r = (res ?? {}) as { unidades?: number; resto?: number };
      const und = r.unidades ?? 0;
      const resto = r.resto ?? 0;
      const cola = resto > 0 ? ` · ${resto} und. al stock online` : "";
      toast(
        destino === "online"
          ? `Lote ingresado al stock online · ${und} unidades`
          : destino === "estampado"
            ? `Lote a estampar (${und} und.)${cola}`
            : `${und} und. a locales${cola}`
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h4>
            {pedido?.nombre_tela ?? "(pedido eliminado)"} <Badge color="azul">{col.color}</Badge>
          </h4>
          <div className="prod-meta">
            {col.unidades} unidades{prenda ? ` · ${prenda.nombre}` : ""}
            {col.fecha_entrega ? ` · recibido ${fmtFecha(col.fecha_entrega)}` : ""}
          </div>
          <div style={{ marginTop: 6 }}><Tallas tallas={col.tallas} /></div>
        </div>
      </div>

      <div style={{ margin: "14px 0 10px" }}>
        <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Destino</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {([
            ["online", "Stock online"],
            ["estampado", "Enviar a estampado"],
            ["local", "Ventas a locales"],
          ] as const).map(([v, label]) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
              <input type="radio" checked={destino === v} onChange={() => setDestino(v)}
                style={{ accentColor: "var(--accent)" }} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {destino === "estampado" && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Diseños a estampar</div>
          {disenos.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input className="pinput" style={{ flex: 2 }} placeholder="Ej: Logo frontal" value={d.nombre}
                onChange={(e) => setDisenos(disenos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
              <input className="pinput" style={{ flex: 1 }} type="number" min="0" max={col.unidades} placeholder="und."
                value={d.unidades}
                onChange={(e) => setDisenos(disenos.map((x, j) => (j === i ? { ...x, unidades: e.target.value } : x)))} />
              <button className="btn" style={{ padding: "4px 10px" }}
                onClick={() => setDisenos(disenos.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn" style={{ fontSize: 12, marginBottom: 10 }}
            onClick={() => setDisenos([...disenos, { nombre: "", unidades: "" }])}>+ Agregar diseño</button>
          <Fila>
            <Campo label="Costo por unidad estampada ($)">
              <input className="pinput" type="number" step="0.01" min="0" value={costoEstampado}
                onChange={(e) => setCostoEstampado(e.target.value)} />
            </Campo>
            <div style={{ flex: 2, alignSelf: "flex-end", fontSize: 12.5, paddingBottom: 14 }}
              className={unidadesEstampar > col.unidades ? "" : "sub"}>
              {unidadesEstampar > col.unidades ? (
                <span style={{ color: "var(--bad)" }}>
                  ⚠ {unidadesEstampar} und. superan las {col.unidades} del lote
                </span>
              ) : (
                <>Total: <b>{unidadesEstampar}</b> und. · costo {money(unidadesEstampar * costoEst)}
                  {unidadesEstampar < col.unidades && unidadesEstampar > 0 &&
                    <> · las {col.unidades - unidadesEstampar} restantes van al stock online</>}
                </>
              )}
            </div>
          </Fila>
        </div>
      )}

      {destino === "local" && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Unidades por talla a enviar</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {ordenarTallas(Object.keys(col.tallas ?? {})).filter((t) => (col.tallas[t] ?? 0) > 0).map((t) => (
              <div key={t} style={{ textAlign: "center" }}>
                <div className="sub" style={{ fontSize: 11 }}>{t} <span style={{ opacity: 0.6 }}>/ {col.tallas[t]}</span></div>
                <input className="pinput" type="number" min="0" max={col.tallas[t]}
                  style={{ width: 62, textAlign: "center" }}
                  value={tallasLocal[t] ?? ""}
                  onChange={(e) => setTallasLocal({ ...tallasLocal, [t]: e.target.value })} />
              </div>
            ))}
          </div>
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
          <div style={{ fontSize: 12.5, display: "grid", gridTemplateColumns: "auto auto", gap: "3px 16px", width: "fit-content" }}>
            <span className="sub">Precio local:</span><span className="num">{money(precioLocal)}</span>
            <span className="sub">Costo por unidad (maquila + fijos):</span><span className="num">{money(costoUnitario)}</span>
            <span className="sub">Ingreso ({unidadesLocal} und.):</span><span className="num">{money(unidadesLocal * precioLocal)}</span>
            <span className="sub">Margen:</span>
            <span className="num" style={{ color: unidadesLocal * (precioLocal - costoUnitario) >= 0 ? "var(--good)" : "var(--bad)" }}>
              {money(unidadesLocal * (precioLocal - costoUnitario))}
            </span>
          </div>
        </div>
      )}

      <div style={{ textAlign: "right" }}>
        <button className="btn primary" style={{ fontSize: 13 }} disabled={ocupado} onClick={procesar}>
          {ocupado ? "Procesando…" : "Procesar lote"}
        </button>
      </div>
    </div>
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
