"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";

const NUEVO = "__nuevo__";

/**
 * Fase 8w: el estampado se ELIGE de la lista, no se escribe. Así "Cajas" es
 * siempre el mismo y la orden de estampado suma bien sus metros. Si no está,
 * se agrega a la lista desde aquí mismo.
 */
export default function ElegirEstampado({
  valor,
  onChange,
  ancho = 170,
}: {
  valor: string;
  onChange: (nombre: string) => void;
  ancho?: number;
}) {
  const { data, supabase, reload, toast } = useProd();
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const activos = data.estampados.filter((e) => !e.archivada_en);
  // Un nombre viejo que no está en la lista se sigue mostrando, para no borrarlo sin querer.
  const fuera = valor.trim() && !activos.some((e) => e.nombre === valor);

  async function agregar() {
    const nombre = nuevo.trim();
    if (!nombre || ocupado) return;
    const ya = data.estampados.find((e) => e.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (ya) {
      onChange(ya.nombre);
      setCreando(false);
      setNuevo("");
      return;
    }
    setOcupado(true);
    const { error } = await supabase.from("prod_estampados").insert({ nombre });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    await reload();
    onChange(nombre);
    setCreando(false);
    setNuevo("");
  }

  if (creando) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input className="pinput" autoFocus style={{ width: ancho }} placeholder="Nombre nuevo, ej: Cajas" value={nuevo}
          onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <button className="btn primary" style={{ fontSize: 12 }} disabled={!nuevo.trim() || ocupado} onClick={agregar}>Agregar</button>
        <button className="btn" style={{ fontSize: 12 }} onClick={() => setCreando(false)}>✕</button>
      </span>
    );
  }
  return (
    <select className="pinput" style={{ width: ancho }} value={valor}
      onChange={(e) => (e.target.value === NUEVO ? setCreando(true) : onChange(e.target.value))}>
      <option value="">— Elige el estampado —</option>
      {fuera && <option value={valor}>{valor} (no está en la lista)</option>}
      {activos.map((e) => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
      <option value={NUEVO}>+ Nuevo estampado…</option>
    </select>
  );
}
