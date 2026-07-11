"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { money } from "@/lib/produccion/types";

export default function CostosTab() {
  const { data, supabase, reload, toast } = useProd();
  const [nombre, setNombre] = useState("");
  const [valor, setValor] = useState("");

  const total = data.costosFijos.reduce((s, c) => s + Number(c.valor), 0);

  async function agregar() {
    const v = parseFloat(valor);
    if (!nombre.trim() || !(v > 0)) {
      toast("Completa descripción y un valor mayor a 0.", "error");
      return;
    }
    const { error } = await supabase.from("prod_costos_fijos").insert({ nombre: nombre.trim(), valor: v });
    if (error) return toast(error.message, "error");
    setNombre("");
    setValor("");
    toast("Costo agregado");
    await reload();
  }

  async function quitar(id: string, n: string) {
    const { error } = await supabase.from("prod_costos_fijos").delete().eq("id", id);
    if (error) toast("No se pudo eliminar.", "error");
    else {
      toast(`"${n}" eliminado`);
      await reload();
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Costos fijos por unidad <span className="sub" style={{ fontWeight: 400 }}>· se suman a cada unidad producida</span></h2>
      </div>

      <div className="table-scroll" style={{ marginBottom: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Descripción</th>
              <th style={{ textAlign: "right" }}>Valor por unidad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!data.costosFijos.length && (
              <tr><td colSpan={3} className="empty">Sin costos registrados aún.</td></tr>
            )}
            {data.costosFijos.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td className="num">{money(Number(c.valor))}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn danger" style={{ padding: "4px 9px" }} onClick={() => quitar(c.id, c.nombre)}>🗑</button>
                </td>
              </tr>
            ))}
            {data.costosFijos.length > 0 && (
              <tr>
                <td style={{ fontWeight: 600 }}>TOTAL por unidad</td>
                <td className="num" style={{ fontWeight: 600, color: "var(--accent)" }}>{money(total)}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input className="pinput" style={{ flex: 2, minWidth: 180 }} placeholder="Ej: Etiquetas, bolsas, transporte…"
          value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <input className="pinput" style={{ flex: 1, minWidth: 110 }} type="number" step="0.01" min="0" placeholder="$/unidad"
          value={valor} onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <button className="btn primary" onClick={agregar}>+ Agregar</button>
      </div>
    </section>
  );
}
