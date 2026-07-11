"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "./ui";
import { money, TALLA_ORDER, type Prenda } from "@/lib/produccion/types";

const FORM_VACIO = {
  nombre: "",
  consumo_metros: "",
  costo_maquila: "",
  precio_venta_local: "",
  precio_venta_online: "",
  lleva_estampado: false,
  tallas: [] as string[],
  notas: "",
};

export default function PrendasTab() {
  const { data, supabase, reload, toast } = useProd();
  const [abierto, setAbierto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [err, setErr] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Prenda | null>(null);

  function abrir(p?: Prenda) {
    setErr(null);
    if (p) {
      setEditId(p.id);
      setForm({
        nombre: p.nombre,
        consumo_metros: String(p.consumo_metros),
        costo_maquila: String(p.costo_maquila),
        precio_venta_local: String(p.precio_venta_local),
        precio_venta_online: String(p.precio_venta_online),
        lleva_estampado: p.lleva_estampado,
        tallas: p.tallas ?? [],
        notas: p.notas ?? "",
      });
    } else {
      setEditId(null);
      setForm(FORM_VACIO);
    }
    setAbierto(true);
  }

  async function guardar() {
    const consumo = parseFloat(form.consumo_metros);
    const costo = parseFloat(form.costo_maquila);
    const pl = parseFloat(form.precio_venta_local);
    const po = parseFloat(form.precio_venta_online);
    if (!form.nombre.trim()) return setErr("El nombre es requerido.");
    if (!(consumo > 0)) return setErr("El consumo de tela debe ser mayor a 0.");
    if (!(costo > 0)) return setErr("El costo de maquila debe ser mayor a 0.");
    if (!(pl > 0) || !(po > 0)) return setErr("Los precios deben ser mayores a 0.");
    if (!form.tallas.length) return setErr("Selecciona al menos una talla.");

    const fila = {
      nombre: form.nombre.trim(),
      consumo_metros: consumo,
      costo_maquila: costo,
      precio_venta_local: pl,
      precio_venta_online: po,
      lleva_estampado: form.lleva_estampado,
      tallas: form.tallas,
      notas: form.notas.trim(),
    };
    const { error } = editId
      ? await supabase.from("prod_prendas").update(fila).eq("id", editId)
      : await supabase.from("prod_prendas").insert(fila);
    if (error) return setErr(error.message);
    toast(editId ? "Prenda actualizada" : "Prenda guardada");
    setAbierto(false);
    await reload();
  }

  async function eliminar() {
    if (!borrar) return;
    const { error } = await supabase.from("prod_prendas").delete().eq("id", borrar.id);
    if (error) {
      toast("No se pudo eliminar: tiene registros vinculados.", "error");
    } else {
      toast(`"${borrar.nombre}" eliminada`);
      await reload();
    }
    setBorrar(null);
  }

  return (
    <section>
      <div className="section-head">
        <h2>Prendas <span className="sub" style={{ fontWeight: 400 }}>· consumos, costos y precios</span></h2>
        <button className="btn primary" onClick={() => abrir()}>+ Nueva prenda</button>
      </div>

      {!data.prendas.length ? (
        <Vacio titulo="No hay prendas registradas aún" hint="Comienza agregando tu primera prenda" />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th style={{ textAlign: "right" }}>Consumo</th>
                <th style={{ textAlign: "right" }}>Maquila</th>
                <th style={{ textAlign: "right" }}>P. local</th>
                <th style={{ textAlign: "right" }}>P. online</th>
                <th>Estampado</th>
                <th>Tallas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.prendas.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.nombre}</strong>
                    {p.notas && <div className="sub" style={{ fontSize: 11.5 }}>{p.notas}</div>}
                  </td>
                  <td className="num">{p.consumo_metros} m</td>
                  <td className="num">{money(p.costo_maquila)}</td>
                  <td className="num">{money(p.precio_venta_local)}</td>
                  <td className="num">{money(p.precio_venta_online)}</td>
                  <td>{p.lleva_estampado ? <Badge color="azul">Sí</Badge> : <Badge>No</Badge>}</td>
                  <td>{(p.tallas ?? []).map((t) => <Badge key={t}>{t}</Badge>)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ padding: "4px 9px", marginRight: 6 }} onClick={() => abrir(p)}>✏</button>
                    <button className="btn danger" style={{ padding: "4px 9px" }} onClick={() => setBorrar(p)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        titulo={editId ? "Editar prenda" : "Nueva prenda"}
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        pie={
          <>
            <button className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary" onClick={guardar}>Guardar prenda</button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        <Campo label="Nombre" requerido>
          <input className="pinput" value={form.nombre} placeholder="Ej: Camiseta básica"
            onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </Campo>
        <Fila>
          <Campo label="Consumo de tela (m/unidad)" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.consumo_metros}
              onChange={(e) => setForm({ ...form, consumo_metros: e.target.value })} />
          </Campo>
          <Campo label="Costo maquila ($/unidad)" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.costo_maquila}
              onChange={(e) => setForm({ ...form, costo_maquila: e.target.value })} />
          </Campo>
        </Fila>
        <Fila>
          <Campo label="Precio venta local" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.precio_venta_local}
              onChange={(e) => setForm({ ...form, precio_venta_local: e.target.value })} />
          </Campo>
          <Campo label="Precio venta online" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.precio_venta_online}
              onChange={(e) => setForm({ ...form, precio_venta_online: e.target.value })} />
          </Campo>
        </Fila>
        <Campo label="Tallas disponibles" requerido>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TALLA_ORDER.map((t) => {
              const activa = form.tallas.includes(t);
              return (
                <button key={t} type="button"
                  className="btn"
                  style={activa ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                  onClick={() =>
                    setForm({
                      ...form,
                      tallas: activa ? form.tallas.filter((x) => x !== t) : [...form.tallas, t],
                    })
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Campo>
        <Campo label="¿Lleva estampado?">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={form.lleva_estampado}
              onChange={(e) => setForm({ ...form, lleva_estampado: e.target.checked })}
              style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
            {form.lleva_estampado ? "Sí" : "No"}
          </label>
        </Campo>
        <Campo label="Notas (opcional)">
          <textarea className="pinput" rows={2} value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </Campo>
      </Modal>

      <Modal
        titulo="Confirmar eliminación"
        abierto={!!borrar}
        onCerrar={() => setBorrar(null)}
        pie={
          <>
            <button className="btn" onClick={() => setBorrar(null)}>Cancelar</button>
            <button className="btn danger" onClick={eliminar}>Eliminar</button>
          </>
        }
      >
        <p className="sub">¿Eliminar “{borrar?.nombre}”? Esta acción no se puede deshacer.</p>
      </Modal>
    </section>
  );
}
