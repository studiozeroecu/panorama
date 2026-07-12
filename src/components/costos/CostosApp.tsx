"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  calcularGanancia,
  matchCosto,
  COMISION_VATEX,
  type CostoPrenda,
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
  const [vinculos, setVinculos] = useState<Map<string, string>>(new Map());
  const [ventas, setVentas] = useState<LineaVenta[]>([]);
  const [periodo, setPeriodo] = useState<string>("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const reload = useCallback(async () => {
    const [c, v, snap] = await Promise.all([
      supabase.from("costos_prendas").select("*").order("producto"),
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

  async function guardarKeywords(c: CostoPrenda, texto: string) {
    const kws = texto.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from("costos_prendas")
      .update({ match_keywords: kws, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) avisar(`Error: ${error.message}`);
    else {
      avisar("Keywords guardadas");
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
    () => calcularGanancia(ventas, costos, vinculos),
    [ventas, costos, vinculos]
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
            <div className="section-head"><h2>Costos por prenda</h2></div>
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

          <section>
            <div className="section-head">
              <h2>Keywords de asignación <span className="sub" style={{ fontWeight: 400 }}>· separadas por coma; todas deben aparecer en la descripción</span></h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Producto</th><th>Keywords</th></tr></thead>
                <tbody>
                  {costos.map((c) => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: "nowrap" }}><strong>{c.producto}</strong></td>
                      <td>
                        <input className="pinput" style={{ maxWidth: 420 }}
                          defaultValue={(c.match_keywords ?? []).join(", ")}
                          placeholder="sin keywords = solo vínculo manual"
                          onBlur={(e) => {
                            const nuevo = e.target.value;
                            if (nuevo.trim() !== (c.match_keywords ?? []).join(", ").trim()) guardarKeywords(c, nuevo);
                          }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {resumen.lineasSinMatch.length > 0 && (
            <section>
              <div className="section-head">
                <h2>Sin costo asignado <span className="sub" style={{ fontWeight: 400 }}>· del reporte {periodo}, por ingreso</span></h2>
              </div>
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

      {toast && <div className="prod-toast">✓ {toast}</div>}
    </div>
  );
}
