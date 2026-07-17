"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  calcularGanancia,
  COMISION_VATEX,
  type CostoPrenda,
  type CategoriaCosto,
  type LineaVenta,
} from "@/lib/costos/match";

const money = (n: number | null | undefined) =>
  n == null || isNaN(Number(n))
    ? "—"
    : "$" + Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CAMPOS_COSTO = [
  ["costo_tela", "Tela"],
  ["maquila", "Maquila"],
  ["dtf", "DTF"],
  ["corte", "Corte"],
  ["insumos", "Insumos"],
  ["etiqueta", "Etiqueta"],
] as const;

const CAMPOS_PRECIO = [
  ["pvp_vatex", "PVP VATEX"],
  ["precio_online", "P. online"],
  ["precio_mayoreo_1_2", "Mayoreo 1-2"],
  ["precio_mayoreo_3_5", "Mayoreo 3-5"],
  ["precio_mayoreo_6plus", "Mayoreo 6+"],
] as const;

type CampoNum = (typeof CAMPOS_COSTO)[number][0] | (typeof CAMPOS_PRECIO)[number][0];

export default function CostosApp() {
  const supabase = useMemo(() => createClient(), []);
  const [costos, setCostos] = useState<CostoPrenda[]>([]);
  const [categorias, setCategorias] = useState<CategoriaCosto[]>([]);
  const [vinculos, setVinculos] = useState<Map<string, string>>(new Map());
  const [ventas, setVentas] = useState<LineaVenta[]>([]);
  const [periodo, setPeriodo] = useState<string>("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const reload = useCallback(async () => {
    const [c, cat, v, snap] = await Promise.all([
      supabase.from("costos_prendas").select("*").order("producto"),
      supabase.from("costos_categorias").select("*").order("prioridad"),
      supabase.from("costos_vinculos").select("codigo, costo_id"),
      supabase
        .from("snapshots")
        .select("id, periodo_desde, periodo_hasta")
        .order("periodo_hasta", { ascending: false })
        .limit(1),
    ]);
    if (c.error) {
      setError(
        c.error.message.includes("does not exist") || c.error.message.includes("schema cache")
          ? "Falta la tabla de costos. Ejecuta supabase/schema_fase4.sql y migracion_costos.sql."
          : c.error.message
      );
      setCargando(false);
      return;
    }
    setCostos((c.data ?? []) as CostoPrenda[]);
    setCategorias((cat.data ?? []) as CategoriaCosto[]);
    setVinculos(new Map((v.data ?? []).map((x) => [x.codigo, x.costo_id])));
    const s = snap.data?.[0];
    if (s) {
      setPeriodo(`${s.periodo_desde} a ${s.periodo_hasta}`);
      const { data: lineas } = await supabase
        .from("sales_lines")
        .select("codigo, descripcion, cantidad, neto")
        .eq("snapshot_id", s.id);
      setVentas((lineas ?? []) as LineaVenta[]);
    }
    setError(null);
    setCargando(false);
  }, [supabase]);

  useEffect(() => {
    reload();
    // las filas de categorías (componentes hijos) piden recarga con este evento
    const h = () => reload();
    window.addEventListener("costos-reload", h);
    return () => window.removeEventListener("costos-reload", h);
  }, [reload]);

  async function guardarCampo(c: CostoPrenda, campo: CampoNum, valor: string) {
    const n = valor === "" ? null : parseFloat(valor);
    const esCosto = CAMPOS_COSTO.some(([k]) => k === campo);
    if (esCosto && (n == null || n < 0)) return;
    const actual = c[campo];
    if (n === actual || (n != null && Math.abs(n - Number(actual ?? NaN)) < 1e-9)) return;
    const { error } = await supabase
      .from("costos_prendas")
      .update({ [campo]: esCosto ? (n ?? 0) : n, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) avisar(`Error: ${error.message}`);
    else {
      avisar("Guardado");
      await reload();
    }
  }


  async function vincular(codigo: string, costoId: string) {
    const { error } = costoId
      ? await supabase.from("costos_vinculos").upsert({ codigo, costo_id: costoId })
      : await supabase.from("costos_vinculos").delete().eq("codigo", codigo);
    if (error) avisar(`Error: ${error.message}`);
    else {
      avisar(costoId ? "Vinculado" : "Vínculo quitado");
      await reload();
    }
  }

  const resumen = useMemo(
    () => calcularGanancia(ventas, costos, categorias, vinculos),
    [ventas, costos, categorias, vinculos]
  );

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            <Link href="/" style={{ color: "var(--accent)" }}>← Panorama</Link>
          </p>
          <h1>Costos y margen</h1>
          <p className="sub">
            Edita costos y precios; ganancias y márgenes se recalculan al instante. VATEX retiene 38.8%.
          </p>
        </div>
      </header>

      {error ? (
        <div className="error-banner">{error}</div>
      ) : cargando ? (
        <div className="empty">Cargando costos…</div>
      ) : (
        <>
          {ventas.length > 0 && (
            <div className="cards" style={{ marginBottom: 26 }}>
              <div className="card">
                <div className="label">Ganancia estimada del periodo</div>
                <div className="value" style={{ color: resumen.gananciaEstimada >= 0 ? "var(--good)" : "var(--bad)" }}>
                  {money(resumen.gananciaEstimada)}
                </div>
                <div className="hint">reporte {periodo}</div>
              </div>
              <div className="card">
                <div className="label">Cobertura de costos</div>
                <div className="value">{resumen.coberturaPct.toFixed(0)}%</div>
                <div className="hint">del ingreso neto tiene costo asignado</div>
              </div>
              <div className="card">
                <div className="label">Sin costo asignado</div>
                <div className="value">{resumen.lineasSinMatch.length}</div>
                <div className="hint">productos por vincular (abajo)</div>
              </div>
            </div>
          )}

          <section>
            <div className="section-head">
              <h2>Costos por prenda</h2>
              <button className="btn primary" onClick={() => setNuevaAbierta(true)}>+ Nueva prenda</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    {CAMPOS_COSTO.map(([k, l]) => <th key={k} style={{ textAlign: "right" }}>{l}</th>)}
                    <th style={{ textAlign: "right" }}>Costo total</th>
                    {CAMPOS_PRECIO.slice(0, 2).map(([k, l]) => <th key={k} style={{ textAlign: "right" }}>{l}</th>)}
                    <th style={{ textAlign: "right" }}>Neto VATEX</th>
                    <th style={{ textAlign: "right" }}>Ganancia</th>
                    <th style={{ textAlign: "right" }}>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {costos.map((c) => {
                    const neto = c.pvp_vatex != null ? Number(c.pvp_vatex) * COMISION_VATEX : null;
                    const ganancia = neto != null ? neto - Number(c.costo_total) : null;
                    const margen = neto ? (ganancia! / neto) * 100 : null;
                    return (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.producto}</strong>
                          <div className="sub" style={{ fontSize: 11 }}>{c.nombre_tela}</div>
                        </td>
                        {CAMPOS_COSTO.map(([k]) => (
                          <td key={k} className="num">
                            <input className="pinput" type="number" step="0.01" min="0"
                              style={{ width: 68, textAlign: "right", padding: "4px 6px" }}
                              defaultValue={Number(c[k])}
                              onBlur={(e) => guardarCampo(c, k, e.target.value)} />
                          </td>
                        ))}
                        <td className="num" style={{ fontWeight: 600 }}>{money(Number(c.costo_total))}</td>
                        {CAMPOS_PRECIO.slice(0, 2).map(([k]) => (
                          <td key={k} className="num">
                            <input className="pinput" type="number" step="0.01" min="0"
                              style={{ width: 74, textAlign: "right", padding: "4px 6px" }}
                              defaultValue={c[k] == null ? "" : Number(c[k])}
                              onBlur={(e) => guardarCampo(c, k, e.target.value)} />
                          </td>
                        ))}
                        <td className="num">{money(neto)}</td>
                        <td className="num" style={{ color: ganancia != null && ganancia < 0 ? "var(--bad)" : "var(--good)" }}>
                          {money(ganancia)}
                        </td>
                        <td className="num">{margen != null ? `${margen.toFixed(1)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="sub" style={{ fontSize: 12, marginTop: 10 }}>
              Neto VATEX = PVP × 0.612 (post-comisión) · Ganancia = neto − costo total. Los precios de
              mayoreo se editan igual pero no se muestran aquí para no saturar; pídelos si los necesitas.
            </p>
          </section>

          {resumen.porCategoria.length > 0 && (
            <section>
              <div className="section-head">
                <h2>Desglose por categoría <span className="sub" style={{ fontWeight: 400 }}>· reporte {periodo}</span></h2>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Categoría</th>
                      <th style={{ textAlign: "right" }}>Unidades</th>
                      <th style={{ textAlign: "right" }}>Ingreso neto</th>
                      <th style={{ textAlign: "right" }}>Ganancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.porCategoria.map((g) => (
                      <tr key={g.nombre} style={g.nombre === "Sin categoría" ? { opacity: 0.6 } : undefined}>
                        <td><strong>{g.nombre}</strong></td>
                        <td className="num">{g.unidades}</td>
                        <td className="num">{money(g.neto)}</td>
                        <td className="num" style={{ color: g.nombre === "Sin categoría" ? "var(--muted)" : g.ganancia >= 0 ? "var(--good)" : "var(--bad)" }}>
                          {g.nombre === "Sin categoría" ? "—" : money(g.ganancia)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <div className="section-head">
              <h2>Reglas de categorías <span className="sub" style={{ fontWeight: 400 }}>· automáticas en cada reporte; la primera que aplica gana (menor prioridad primero)</span></h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Prio.</th>
                    <th>Categoría</th>
                    <th>Debe contener (todas; “|” = cualquiera)</th>
                    <th>NO debe contener</th>
                    <th>Costo aplicado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {categorias.map((cat) => (
                    <FilaCategoria key={cat.id} cat={cat} costos={costos} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sub" style={{ fontSize: 12, marginTop: 10 }}>
              Ejemplo: “Cuello chino / Buzo” con prioridad 10 le gana a “Camiseta estampada” (50) aunque la
              descripción contenga CAMISETA. Lo que no cae en ninguna regla queda en “Sin categoría” y no
              bloquea el cálculo del resto.
            </p>
            <NuevaCategoria costos={costos} />
          </section>

          {resumen.lineasSinMatch.length > 0 && (
            <section>
              <div className="section-head">
                <h2>Sin categoría <span className="sub" style={{ fontWeight: 400 }}>· {resumen.lineasSinMatch.length} productos · {money(resumen.lineasSinMatch.reduce((s, l) => s + l.neto, 0))} del reporte {periodo}</span></h2>
              </div>
              <p className="sub" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>
                Estas líneas no bloquean nada — la ganancia estimada se calcula sin ellas. Para cubrirlas,
                ajusta las reglas de arriba (lo normal) o vincula un código puntual aquí (la excepción).
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Código</th><th>Descripción</th><th style={{ textAlign: "right" }}>Neto</th><th>Vincular a</th></tr>
                  </thead>
                  <tbody>
                    {resumen.lineasSinMatch.slice(0, 30).map((l) => (
                      <tr key={l.codigo}>
                        <td className="code">{l.codigo}</td>
                        <td>{l.descripcion}</td>
                        <td className="num">{money(l.neto)}</td>
                        <td>
                          <select value={vinculos.get(l.codigo) ?? ""} onChange={(e) => vincular(l.codigo, e.target.value)}>
                            <option value="">— Elegir prenda —</option>
                            {costos.map((c) => <option key={c.id} value={c.id}>{c.producto}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="sub" style={{ fontSize: 12, marginTop: 10 }}>
                El vínculo manual por código tiene prioridad sobre las keywords y vale para todos los
                reportes futuros. {vinculos.size > 0 && `Vínculos activos: ${vinculos.size}.`}
              </p>
            </section>
          )}
        </>
      )}

      <NuevaPrendaModal
        abierto={nuevaAbierta}
        onCerrar={() => setNuevaAbierta(false)}
        onGuardada={async () => {
          setNuevaAbierta(false);
          avisar("Prenda agregada");
          await reload();
        }}
      />

      {toast && <div className="prod-toast">✓ {toast}</div>}
    </div>
  );
}

function FilaCategoria({ cat, costos }: { cat: CategoriaCosto; costos: CostoPrenda[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [msg, setMsg] = useState<string | null>(null);

  async function guardar(campo: string, valor: unknown) {
    const { error } = await supabase.from("costos_categorias").update({ [campo]: valor }).eq("id", cat.id);
    setMsg(error ? error.message : null);
    if (!error) window.dispatchEvent(new Event("costos-reload"));
  }
  const lista = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

  async function eliminar() {
    const { error } = await supabase.from("costos_categorias").delete().eq("id", cat.id);
    if (!error) window.dispatchEvent(new Event("costos-reload"));
  }

  return (
    <tr>
      <td>
        <input className="pinput" type="number" style={{ width: 58, textAlign: "center", padding: "4px 4px" }}
          defaultValue={cat.prioridad}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (n && n !== cat.prioridad) guardar("prioridad", n);
          }} />
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <input className="pinput" style={{ minWidth: 140 }} defaultValue={cat.nombre}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== cat.nombre && guardar("nombre", e.target.value.trim())} />
      </td>
      <td>
        <input className="pinput" style={{ minWidth: 220 }} defaultValue={(cat.incluir ?? []).join(", ")}
          onBlur={(e) => e.target.value.trim() !== (cat.incluir ?? []).join(", ").trim() && guardar("incluir", lista(e.target.value))} />
      </td>
      <td>
        <input className="pinput" style={{ minWidth: 150 }} defaultValue={(cat.excluir ?? []).join(", ")} placeholder="—"
          onBlur={(e) => e.target.value.trim() !== (cat.excluir ?? []).join(", ").trim() && guardar("excluir", lista(e.target.value))} />
      </td>
      <td>
        <select className="pinput" value={cat.costo_id ?? ""} onChange={(e) => guardar("costo_id", e.target.value || null)}>
          <option value="">— sin costo —</option>
          {costos.map((c) => <option key={c.id} value={c.id}>{c.producto} ({money(Number(c.costo_total))})</option>)}
        </select>
        {msg && <div style={{ color: "var(--bad)", fontSize: 11 }}>{msg}</div>}
      </td>
      <td>
        <button className="btn danger" style={{ padding: "4px 9px" }} onClick={eliminar}>🗑</button>
      </td>
    </tr>
  );
}

function NuevaCategoria({ costos }: { costos: CostoPrenda[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [nombre, setNombre] = useState("");
  const [incluir, setIncluir] = useState("");
  const [costoId, setCostoId] = useState("");

  async function agregar() {
    if (!nombre.trim() || !incluir.trim()) return;
    const { error } = await supabase.from("costos_categorias").insert({
      nombre: nombre.trim(),
      prioridad: 100,
      incluir: incluir.split(",").map((s) => s.trim()).filter(Boolean),
      excluir: [],
      costo_id: costoId || null,
    });
    if (!error) {
      setNombre(""); setIncluir(""); setCostoId("");
      window.dispatchEvent(new Event("costos-reload"));
    }
  }

  return (
    <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
      <input className="pinput" style={{ flex: 1, minWidth: 140 }} placeholder="Nueva categoría…"
        value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <input className="pinput" style={{ flex: 2, minWidth: 180 }} placeholder="Debe contener (ej: GORRA|BUCKET)"
        value={incluir} onChange={(e) => setIncluir(e.target.value)} />
      <select className="pinput" style={{ flex: 1, minWidth: 150 }} value={costoId} onChange={(e) => setCostoId(e.target.value)}>
        <option value="">— costo —</option>
        {costos.map((c) => <option key={c.id} value={c.id}>{c.producto}</option>)}
      </select>
      <button className="btn primary" onClick={agregar}>+ Agregar</button>
    </div>
  );
}

function NuevaPrendaModal({
  abierto, onCerrar, onGuardada,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [f, setF] = useState({
    producto: "", nombre_tela: "", costo_tela: "", maquila: "", dtf: "", corte: "",
    insumos: "", etiqueta: "", pvp_vatex: "", precio_online: "", keywords: "", excluir: "",
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setF({ producto: "", nombre_tela: "", costo_tela: "", maquila: "", dtf: "", corte: "",
        insumos: "", etiqueta: "", pvp_vatex: "", precio_online: "", keywords: "", excluir: "" });
      setErr(null);
    }
  }, [abierto]);

  const n = (v: string, def = 0) => (v === "" ? def : parseFloat(v));
  const lista = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

  async function guardar() {
    if (!f.producto.trim()) return setErr("El nombre del producto es requerido.");
    if (!(n(f.costo_tela) >= 0)) return setErr("Costo de tela inválido.");
    const { error } = await supabase.from("costos_prendas").insert({
      producto: f.producto.trim(),
      nombre_tela: f.nombre_tela.trim(),
      costo_tela: n(f.costo_tela), maquila: n(f.maquila), dtf: n(f.dtf),
      corte: n(f.corte), insumos: n(f.insumos), etiqueta: n(f.etiqueta),
      pvp_vatex: f.pvp_vatex === "" ? null : n(f.pvp_vatex),
      precio_online: f.precio_online === "" ? null : n(f.precio_online),
      match_keywords: lista(f.keywords),
      match_excluir: lista(f.excluir),
    });
    if (error) {
      return setErr(error.message.includes("duplicate") ? "Ya existe una prenda con ese nombre." : error.message);
    }
    onGuardada();
  }

  if (!abierto) return null;
  const campo = (label: string, key: keyof typeof f, props: Record<string, unknown> = {}) => (
    <div className="field" style={{ flex: 1, minWidth: 130, marginBottom: 12 }}>
      <label>{label}</label>
      <input className="pinput" value={f[key]} {...props}
        onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialog" style={{ maxWidth: 640, maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Nueva prenda</h3>
        {err && <div className="error-banner">{err}</div>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {campo("Producto *", "producto", { placeholder: "Ej: gorra estampada" })}
          {campo("Tela", "nombre_tela", { placeholder: "Ej: topper" })}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {campo("Costo tela $", "costo_tela", { type: "number", step: "0.01", min: "0" })}
          {campo("Maquila $", "maquila", { type: "number", step: "0.01", min: "0" })}
          {campo("DTF $", "dtf", { type: "number", step: "0.01", min: "0" })}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {campo("Corte $", "corte", { type: "number", step: "0.01", min: "0" })}
          {campo("Insumos $", "insumos", { type: "number", step: "0.01", min: "0" })}
          {campo("Etiqueta $", "etiqueta", { type: "number", step: "0.01", min: "0" })}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {campo("PVP VATEX $", "pvp_vatex", { type: "number", step: "0.01", min: "0" })}
          {campo("Precio online $", "precio_online", { type: "number", step: "0.01", min: "0" })}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {campo("Debe contener (comas, | para alternativas)", "keywords", { placeholder: "Ej: GORRA" })}
          {campo("NO debe contener", "excluir", { placeholder: "Ej: BASICA" })}
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" onClick={guardar}>Agregar prenda</button>
        </div>
      </div>
    </div>
  );
}
