"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "@/components/ui";
import type { Proveedor, Catalogo } from "@/lib/produccion/types";

const FORM_VACIO = { empresa: "", contacto_nombre: "", contacto: "", dias_entrega: "" };

export default function ProveedoresTab() {
  const { data, supabase, reload, toast } = useProd();
  const [abierto, setAbierto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [err, setErr] = useState<string | null>(null);

  const activos = data.proveedores.filter((p) => !p.archivada_en);
  const archivados = data.proveedores.filter((p) => p.archivada_en);

  function abrir(p?: Proveedor) {
    setErr(null);
    if (p) {
      setEditId(p.id);
      setForm({
        empresa: p.empresa,
        contacto_nombre: p.contacto_nombre,
        contacto: p.contacto,
        dias_entrega: String(p.dias_entrega),
      });
    } else {
      setEditId(null);
      setForm(FORM_VACIO);
    }
    setAbierto(true);
  }

  async function guardar() {
    const dias = parseInt(form.dias_entrega, 10);
    if (!form.empresa.trim()) return setErr("La empresa es requerida.");
    if (!(dias >= 1)) return setErr("Los días de entrega deben ser al menos 1.");
    const fila = {
      empresa: form.empresa.trim(),
      contacto_nombre: form.contacto_nombre.trim(),
      contacto: form.contacto.trim(),
      dias_entrega: dias,
    };
    const { error } = editId
      ? await supabase.from("prod_proveedores").update(fila).eq("id", editId)
      : await supabase.from("prod_proveedores").insert(fila);
    if (error) return setErr(error.message);
    toast(editId ? "Proveedor actualizado" : "Proveedor guardado");
    setAbierto(false);
    await reload();
  }

  /**
   * Fase 8e: archivar en vez de borrar. `prod_pedidos_tela.proveedor_id` es
   * `on delete set null`, así que borrar nunca fallaba pero el pedido perdía su
   * proveedor — y con él la estimación de entrega y la vigilancia de atrasos del
   * resumen del lunes, sin ningún aviso.
   */
  async function archivar(p: Proveedor) {
    const { error } = await supabase
      .from("prod_proveedores")
      .update({ archivada_en: new Date().toISOString() })
      .eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`«${p.empresa}» archivado. Ya no aparecerá al crear pedidos; su historial se conserva intacto.`);
    await reload();
  }

  async function desarchivar(p: Proveedor) {
    const { error } = await supabase
      .from("prod_proveedores")
      .update({ archivada_en: null })
      .eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`«${p.empresa}» vuelve a estar disponible.`);
    await reload();
  }

  return (
    <section>
      <div className="section-head">
        <h2>Proveedores</h2>
        <button className="btn primary" onClick={() => abrir()}>+ Nuevo proveedor</button>
      </div>

      {!data.proveedores.length ? (
        <Vacio titulo="No hay proveedores registrados aún" />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Contacto</th>
                <th>Teléfono / Email</th>
                <th style={{ textAlign: "right" }}>Días de entrega</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...activos, ...archivados].map((p) => (
                <tr key={p.id} style={p.archivada_en ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{p.empresa}</strong>
                    {p.archivada_en && <Badge>Archivado</Badge>}
                  </td>
                  <td>{p.contacto_nombre || "—"}</td>
                  <td className="code">{p.contacto || "—"}</td>
                  <td className="num">{p.dias_entrega} laborables</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ padding: "4px 9px", marginRight: 6 }} onClick={() => abrir(p)}>✏</button>
                    {p.archivada_en ? (
                      <button className="btn" style={{ padding: "4px 9px", fontSize: 12 }}
                        onClick={() => desarchivar(p)}>↩ Desarchivar</button>
                    ) : (
                      <button className="btn" style={{ padding: "4px 9px", fontSize: 12 }}
                        onClick={() => archivar(p)}>📦 Archivar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 26 }}>
        <CatalogoCard tabla="prod_maquiladoras" titulo="Maquiladoras" items={data.maquiladoras}
          hint="Se eligen al registrar cortes y maquilas" />
        <CatalogoCard tabla="prod_talleres" titulo="Talleres de estampado" items={data.talleres}
          hint="Se eligen al enviar lotes a estampar" />
      </div>

      <Modal
        titulo={editId ? "Editar proveedor" : "Nuevo proveedor"}
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        pie={
          <>
            <button className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary" onClick={guardar}>Guardar</button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        <Fila>
          <Campo label="Empresa" requerido>
            <input className="pinput" value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} />
          </Campo>
          <Campo label="Nombre de contacto">
            <input className="pinput" value={form.contacto_nombre} onChange={(e) => setForm({ ...form, contacto_nombre: e.target.value })} />
          </Campo>
        </Fila>
        <Fila>
          <Campo label="Teléfono / Email">
            <input className="pinput" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
          </Campo>
          <Campo label="Días de entrega (laborables)" requerido>
            <input className="pinput" type="number" min="1" step="1" value={form.dias_entrega}
              onChange={(e) => setForm({ ...form, dias_entrega: e.target.value })} />
          </Campo>
        </Fila>
      </Modal>

    </section>
  );
}

function CatalogoCard({
  tabla,
  titulo,
  items,
  hint,
}: {
  tabla: string;
  titulo: string;
  items: Catalogo[];
  hint: string;
}) {
  const { supabase, reload, toast } = useProd();
  const [nuevo, setNuevo] = useState("");

  async function agregar() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    const { error } = await supabase.from(tabla).insert({ nombre });
    if (error) {
      // El índice único de `nombre` no distingue activos de archivados: un nombre
      // archivado sigue ocupando el sitio aunque no se vea en la lista activa.
      toast(
        error.message.includes("duplicate")
          ? "Ya existe con ese nombre — puede estar archivado. Búscalo en la lista y desarchívalo."
          : error.message,
        "error"
      );
      return;
    }
    setNuevo("");
    toast(`"${nombre}" agregado`);
    await reload();
  }

  async function alternarArchivo(item: Catalogo) {
    const { error } = await supabase
      .from(tabla)
      .update({ archivada_en: item.archivada_en ? null : new Date().toISOString() })
      .eq("id", item.id);
    if (error) return toast(error.message, "error");
    toast(item.archivada_en ? `«${item.nombre}» reactivado` : `«${item.nombre}» archivado`);
    await reload();
  }

  return (
    <div className="card">
      <div className="label">{titulo}</div>
      <div className="hint" style={{ marginBottom: 12 }}>{hint}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {!items.length && <span className="sub" style={{ fontSize: 13 }}>Sin registros.</span>}
        {[...items.filter((i) => !i.archivada_en), ...items.filter((i) => i.archivada_en)].map((i) => (
          <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, opacity: i.archivada_en ? 0.55 : 1 }}>
            <span>{i.nombre}</span>
            <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }}
              title={i.archivada_en ? "Desarchivar" : "Archivar"}
              onClick={() => alternarArchivo(i)}>{i.archivada_en ? "↩" : "📦"}</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="pinput" placeholder="Nombre…" value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <button className="btn" onClick={agregar}>+</button>
      </div>
    </div>
  );
}
