"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hoyEcuador, fmtFecha } from "@/lib/produccion/fechas";
import { LOCALES, type Guia } from "@/lib/locales";
import LogoutButton from "@/components/LogoutButton";

const money = (n: number) =>
  "$" + Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ItemForm {
  codigo: string;
  descripcion: string;
  cantidad: string;
  precio: string;
}

const ITEM_VACIO: ItemForm = { codigo: "", descripcion: "", cantidad: "", precio: "" };

export default function LogisticaApp() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [guias, setGuias] = useState<Guia[]>([]);
  const [productos, setProductos] = useState<{ codigo: string; descripcion: string }[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // formulario
  const [fecha, setFecha] = useState(hoyEcuador());
  const [local, setLocal] = useState<string>("");
  const [items, setItems] = useState<ItemForm[]>([{ ...ITEM_VACIO }]);
  const [recibidoPor, setRecibidoPor] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errForm, setErrForm] = useState<string | null>(null);

  const avisar = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const reload = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setUserId(uid);
    const [rolR, guiasR, prodR] = await Promise.all([
      supabase.from("user_roles").select("rol").eq("user_id", uid).maybeSingle(),
      supabase.from("guias_transferencia").select("*").order("fecha", { ascending: false }).limit(50),
      supabase.from("products").select("codigo, descripcion").order("codigo").limit(1000),
    ]);
    if (guiasR.error) {
      setError(
        guiasR.error.message.includes("does not exist") || guiasR.error.message.includes("schema cache")
          ? "Faltan las tablas de Fase 6. Ejecuta supabase/schema_fase6.sql."
          : guiasR.error.message
      );
      setCargando(false);
      return;
    }
    setEsAdmin(rolR.data?.rol === "admin");
    setGuias((guiasR.data ?? []) as Guia[]);
    setProductos(prodR.data ?? []);
    setError(null);
    setCargando(false);
  }, [supabase]);

  useEffect(() => { reload(); }, [reload]);

  function setItem(i: number, cambios: Partial<ItemForm>) {
    setItems(items.map((x, j) => {
      if (j !== i) return x;
      const nuevo = { ...x, ...cambios };
      // autocompleta descripción si el código existe en el catálogo
      if (cambios.codigo !== undefined) {
        const p = productos.find((pr) => pr.codigo === cambios.codigo!.trim().toUpperCase());
        if (p) nuevo.descripcion = p.descripcion;
      }
      return nuevo;
    }));
  }

  const totalUnidades = items.reduce((s, x) => s + (parseInt(x.cantidad, 10) || 0), 0);
  const totalValor = items.reduce(
    (s, x) => s + (parseInt(x.cantidad, 10) || 0) * (parseFloat(x.precio) || 0),
    0
  );

  async function guardar() {
    setErrForm(null);
    if (!local) return setErrForm("Selecciona el local destino.");
    const filas = items
      .map((x) => ({
        codigo: x.codigo.trim().toUpperCase(),
        descripcion: x.descripcion.trim(),
        cantidad: parseInt(x.cantidad, 10) || 0,
        precio_unitario: parseFloat(x.precio) || 0,
      }))
      .filter((x) => x.codigo || x.descripcion || x.cantidad > 0);
    if (!filas.length) return setErrForm("Agrega al menos un producto.");
    if (filas.some((x) => (!x.codigo && !x.descripcion) || x.cantidad <= 0))
      return setErrForm("Cada línea necesita producto y cantidad mayor a 0.");
    if (!userId) return setErrForm("Sesión inválida — vuelve a entrar.");

    setGuardando(true);
    try {
      const { data: guia, error: e1 } = await supabase
        .from("guias_transferencia")
        .insert({
          fecha,
          local_destino: local,
          items: filas,
          total_unidades: filas.reduce((s, x) => s + x.cantidad, 0),
          total_valor: +filas.reduce((s, x) => s + x.cantidad * x.precio_unitario, 0).toFixed(2),
          recibido_por: recibidoPor.trim(),
          subido_por: userId,
        })
        .select("id")
        .single();
      if (e1 || !guia) throw new Error(e1?.message ?? "Error al guardar");

      if (foto) {
        const ext = foto.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${guia.id}.${ext}`;
        const { error: e2 } = await supabase.storage.from("guias").upload(path, foto, { upsert: true });
        if (!e2) {
          await supabase.from("guias_transferencia").update({ foto_path: path }).eq("id", guia.id);
        } else {
          avisar(`Guía guardada, pero la foto falló: ${e2.message}`);
        }
      }

      avisar(`Guía a ${local} guardada · ${filas.reduce((s, x) => s + x.cantidad, 0)} unidades`);
      setFecha(hoyEcuador());
      setLocal("");
      setItems([{ ...ITEM_VACIO }]);
      setRecibidoPor("");
      setFoto(null);
      await reload();
    } catch (e) {
      setErrForm(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <h1>Guías de transferencia</h1>
          <p className="sub">Registra cada despacho a los locales VATEX.</p>
        </div>
        <LogoutButton />
      </header>

      {error ? (
        <div className="error-banner">{error}</div>
      ) : cargando ? (
        <div className="empty">Cargando…</div>
      ) : (
        <>
          <section>
            <div className="section-head"><h2>Nueva guía</h2></div>
            <div className="card">
              {errForm && <div className="error-banner">{errForm}</div>}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                <div className="field" style={{ minWidth: 150 }}>
                  <label>Fecha</label>
                  <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                </div>
                <div className="field" style={{ minWidth: 150 }}>
                  <label>Local destino *</label>
                  <select className="pinput" value={local} onChange={(e) => setLocal(e.target.value)}>
                    <option value="">— Elegir —</option>
                    {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label>Recibido por (opcional)</label>
                  <input className="pinput" placeholder="Quién recibió en el local"
                    value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} />
                </div>
              </div>

              <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Productos</div>
              {items.map((x, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <input className="pinput" style={{ flex: 1, minWidth: 110 }} placeholder="Código"
                    list="lista-productos" value={x.codigo}
                    onChange={(e) => setItem(i, { codigo: e.target.value })} />
                  <input className="pinput" style={{ flex: 2, minWidth: 160 }} placeholder="Descripción"
                    value={x.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
                  <input className="pinput" style={{ width: 84 }} type="number" min="1" placeholder="Cant."
                    value={x.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} />
                  <input className="pinput" style={{ width: 100 }} type="number" step="0.01" min="0" placeholder="Precio $"
                    value={x.precio} onChange={(e) => setItem(i, { precio: e.target.value })} />
                  <button className="btn" style={{ padding: "4px 10px" }}
                    onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <datalist id="lista-productos">
                {productos.map((p) => <option key={p.codigo} value={p.codigo}>{p.descripcion}</option>)}
              </datalist>
              <button className="btn" style={{ fontSize: 12, marginBottom: 14 }}
                onClick={() => setItems([...items, { ...ITEM_VACIO }])}>+ Agregar producto</button>

              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <label className="btn" style={{ fontSize: 12.5, cursor: "pointer" }}>
                  📷 {foto ? foto.name : "Foto de la guía física (opcional)"}
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
                </label>
                <span className="sub" style={{ fontSize: 13, marginLeft: "auto" }}>
                  Total: <b>{totalUnidades}</b> unidades · <b>{money(totalValor)}</b>
                </span>
                <button className="btn primary" disabled={guardando} onClick={guardar}>
                  {guardando ? "Guardando…" : "Guardar guía"}
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2>Historial {esAdmin && <span className="sub" style={{ fontWeight: 400 }}>· todas las guías (admin)</span>}</h2>
            </div>
            {!guias.length ? (
              <div className="card empty">Aún no hay guías registradas.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Local</th>
                      <th>Productos</th>
                      <th style={{ textAlign: "right" }}>Unidades</th>
                      <th style={{ textAlign: "right" }}>Valor</th>
                      <th>Recibido por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guias.map((g) => (
                      <tr key={g.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtFecha(g.fecha)}</td>
                        <td><span className="local-tag">{g.local_destino}</span></td>
                        <td style={{ maxWidth: 340, fontSize: 12.5 }}>
                          {(g.items ?? []).map((it) => `${it.codigo || it.descripcion} ×${it.cantidad}`).join(", ")}
                          {g.foto_path && <span className="sub"> · 📷</span>}
                        </td>
                        <td className="num">{g.total_unidades}</td>
                        <td className="num">{money(Number(g.total_valor))}</td>
                        <td style={{ fontSize: 12.5 }}>{g.recibido_por || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {toast && <div className="prod-toast">✓ {toast}</div>}
    </div>
  );
}
