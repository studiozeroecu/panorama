"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Campo, Fila, Badge, Vacio, Tallas } from "./ui";
import { money, ordenarTallas, type Maquila, type ColorMaquila, type Diseno } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/produccion/fechas";
import { sumarStock } from "@/lib/produccion/stock";

interface Lote {
  maquila: Maquila;
  colorIdx: number;
  col: ColorMaquila;
}

export default function EnvioTab() {
  const { data } = useProd();

  const lotes: Lote[] = [];
  for (const m of data.maquilas) {
    m.colores.forEach((col, colorIdx) => {
      if (col.estado === "entregado" && !col.procesado) lotes.push({ maquila: m, colorIdx, col });
    });
  }

  return (
    <section>
      <div className="section-head">
        <h2>Envío <span className="sub" style={{ fontWeight: 400 }}>· decide el destino de cada lote entregado por maquila</span></h2>
      </div>

      {!lotes.length ? (
        <Vacio titulo="Sin lotes por procesar" hint="Cuando marques un color como entregado en Maquila, aparecerá aquí." />
      ) : (
        lotes.map((l) => <LoteCard key={`${l.maquila.id}-${l.colorIdx}`} lote={l} />)
      )}

      <Historial />
    </section>
  );
}

function LoteCard({ lote }: { lote: Lote }) {
  const { data, supabase, reload, toast } = useProd();
  const { maquila, colorIdx, col } = lote;
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
  const [ocupado, setOcupado] = useState(false);

  const cfPorUnidad = data.costosFijos.reduce((s, c) => s + Number(c.valor), 0);
  const costoUnitario = Number(maquila.costo_unitario) + cfPorUnidad;
  const precioLocal = prenda ? Number(prenda.precio_venta_local) : 0;

  const unidadesEstampar = disenos.reduce((s, d) => s + (parseInt(d.unidades, 10) || 0), 0);
  const costoEst = parseFloat(costoEstampado) || 0;
  const unidadesLocal = Object.values(tallasLocal).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);

  async function marcarProcesado() {
    const colores = maquila.colores.map((c, i) => (i === colorIdx ? { ...c, procesado: true } : c));
    const { error } = await supabase.from("prod_maquilas").update({ colores }).eq("id", maquila.id);
    if (error) throw new Error(error.message);
  }

  async function restoAStock(usadasPorTalla: Record<string, number>, etiquetaEstampado = "") {
    // lo que no salió del lote vuelve/entra al stock online sin estampado
    for (const [talla, total] of Object.entries(col.tallas ?? {})) {
      const resto = total - (usadasPorTalla[talla] ?? 0);
      if (resto > 0) {
        const e = await sumarStock(supabase, {
          prenda_id: prenda?.id ?? null,
          prenda_nombre: prenda?.nombre ?? "",
          color: col.color,
          estampado: etiquetaEstampado,
          talla,
          unidades: resto,
        });
        if (e) throw new Error(e);
      }
    }
  }

  async function procesar() {
    setOcupado(true);
    try {
      if (destino === "estampado") {
        const lista: Diseno[] = disenos
          .map((d) => ({ nombre: d.nombre.trim(), unidades: parseInt(d.unidades, 10) || 0 }))
          .filter((d) => d.nombre && d.unidades > 0);
        if (!lista.length) throw new Error("Agrega al menos un diseño con nombre y unidades.");
        const total = lista.reduce((s, d) => s + d.unidades, 0);
        if (total > col.unidades)
          throw new Error(`Las unidades a estampar (${total}) superan las del lote (${col.unidades}).`);
        if (!(costoEst >= 0)) throw new Error("Costo de estampado inválido.");

        const { error } = await supabase.from("prod_lotes_estampado").insert({
          maquila_id: maquila.id,
          prenda_id: prenda?.id ?? null,
          prenda_nombre: prenda?.nombre ?? "",
          color: col.color,
          tallas: col.tallas,
          total_unidades: total,
          disenos: lista,
          costo_unitario: costoEst,
          costo_total: +(total * costoEst).toFixed(2),
          estado: "pendiente",
        });
        if (error) throw new Error(error.message);

        // el resto del lote (no estampado) entra al stock online — antes se perdía
        const resto = col.unidades - total;
        if (resto > 0) {
          // repartimos el resto proporcionalmente no: entra por talla lo no usado.
          // Como los diseños no van por talla, el "resto" solo es exacto si total==unidades;
          // si es parcial, dejamos el resto sin desglose de talla proporcional: se descuenta
          // de las tallas de mayor cantidad primero (aproximación transparente).
          const usadas: Record<string, number> = {};
          let porAsignar = total;
          const tallasOrd = ordenarTallas(Object.keys(col.tallas ?? {}));
          for (const t of tallasOrd) {
            const disponible = col.tallas[t] ?? 0;
            const usa = Math.min(disponible, porAsignar);
            usadas[t] = usa;
            porAsignar -= usa;
          }
          await restoAStock(usadas);
        }
        await marcarProcesado();
        toast(`Lote a estampar (${total} und.)${resto > 0 ? ` · ${resto} und. al stock online` : ""}`);
      } else if (destino === "online") {
        for (const [talla, cant] of Object.entries(col.tallas ?? {})) {
          if (cant <= 0) continue;
          const e = await sumarStock(supabase, {
            prenda_id: prenda?.id ?? null,
            prenda_nombre: prenda?.nombre ?? "",
            color: col.color,
            estampado: "",
            talla,
            unidades: cant,
          });
          if (e) throw new Error(e);
        }
        await marcarProcesado();
        toast(`Lote ingresado al stock online · ${col.unidades} unidades`);
      } else {
        // locales — con desglose por talla (antes se perdía) y vínculo VATEX opcional
        const porTalla: Record<string, number> = {};
        for (const [t, v] of Object.entries(tallasLocal)) {
          const n = parseInt(v, 10) || 0;
          if (n > (col.tallas[t] ?? 0)) throw new Error(`Talla ${t}: solo hay ${col.tallas[t]} unidades en el lote.`);
          if (n > 0) porTalla[t] = n;
        }
        const unidades = Object.values(porTalla).reduce((s, v) => s + v, 0);
        if (unidades <= 0) throw new Error("Ingresa unidades a enviar.");
        const ingreso = unidades * precioLocal;
        const costo = unidades * costoUnitario;
        const { error } = await supabase.from("prod_envios_locales").insert({
          fecha: hoyEcuador(),
          maquila_id: maquila.id,
          prenda_id: prenda?.id ?? null,
          prenda_nombre: prenda?.nombre ?? "",
          color: col.color,
          tallas: porTalla,
          unidades,
          precio_unitario: precioLocal,
          costo_unitario: costoUnitario,
          ingreso: +ingreso.toFixed(2),
          margen: +(ingreso - costo).toFixed(2),
          producto_codigo: productoCodigo.trim() || null,
        });
        if (error) throw new Error(error.message);
        await restoAStock(porTalla);
        await marcarProcesado();
        const resto = col.unidades - unidades;
        toast(`${unidades} und. a locales${resto > 0 ? ` · ${resto} und. al stock online` : ""}`);
      }
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
