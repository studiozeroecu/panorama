"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Maquiladora } from "./CortadoraApp";

/**
 * A dónde va el corte y a qué precio — bloque final de RegistrarCorte.
 *
 * · Maquiladora: se elige de la lista (sin las archivadas, regla de la fase 8e)
 *   o se crea una nueva aquí mismo (fase 8n: la cortadora solo puede CREAR;
 *   archivar o renombrar sigue siendo de Mateo).
 * · Precio unitario: arranca con el costo de maquila de la prenda, como hace
 *   CorteTab, pero se puede cambiar — es lo que se acordó con la maquiladora para
 *   ESTE corte. fn_registrar_corte lo congela en prod_maquilas.costo_unitario.
 *
 * El estado vive en el padre (RegistrarCorte), que es quien guarda.
 */
export default function MaquilaDelCorte({
  supabase,
  maquiladoras,
  maquiladoraId,
  onMaquiladora,
  precio,
  onPrecio,
  precioDeLaPrenda,
  onCreada,
}: {
  supabase: SupabaseClient;
  maquiladoras: Maquiladora[];
  maquiladoraId: string;
  onMaquiladora: (id: string) => void;
  precio: string;
  onPrecio: (v: string) => void;
  /** null = la prenda no tiene costo cargado. */
  precioDeLaPrenda: number | null;
  onCreada: (m: Maquiladora) => void;
}) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function crear() {
    const limpio = nombre.trim();
    if (!limpio) return setErr("Escribe el nombre de la maquiladora.");
    setErr(null);
    setOcupado(true);
    const { data, error } = await supabase
      .from("prod_maquiladoras")
      .insert({ nombre: limpio })
      .select("id, nombre, archivada_en")
      .single();
    setOcupado(false);
    if (error) {
      // El índice único de `nombre` no distingue activas de archivadas (fase 8e).
      if (error.code === "23505")
        return setErr(
          `Ya existe una maquiladora «${limpio}». Si no aparece en la lista está archivada: pídele a Mateo que la reactive.`
        );
      if (error.message.includes("row-level security"))
        return setErr("Todavía no tienes permiso para crear maquiladoras (falta la fase 8n en la base).");
      return setErr(error.message);
    }
    const m = data as Maquiladora;
    onCreada(m);
    onMaquiladora(m.id);
    setCreando(false);
    setNombre("");
  }

  const precioNum = Number(precio.replace(",", "."));
  const sinPrecio = !precio.trim() || !(precioNum > 0);

  return (
    <section style={BLOQUE}>
      <b style={{ fontSize: 15 }}>Maquila</b>

      {err && <div className="error-banner" style={{ marginTop: 8 }}>{err}</div>}

      <div className="label" style={{ fontSize: 10.5, marginTop: 8 }}>Maquiladora</div>
      {!creando ? (
        <select
          className="pinput" style={{ fontSize: 15 }}
          value={maquiladoraId}
          onChange={(e) => {
            if (e.target.value === "__nueva__") {
              setCreando(true);
              setErr(null);
            } else onMaquiladora(e.target.value);
          }}
        >
          <option value="">— Después —</option>
          {/* Fase 8e: aquí se ELIGE, así que las archivadas no se ofrecen. */}
          {maquiladoras
            .filter((m) => !m.archivada_en)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          <option value="__nueva__">+ Nueva maquiladora…</option>
        </select>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="pinput" style={{ flex: 1, fontSize: 15 }}
            placeholder="Nombre de la maquiladora" autoFocus
            value={nombre} onChange={(e) => setNombre(e.target.value)}
          />
          <button className="btn primary" onClick={crear} disabled={ocupado}>
            {ocupado ? "…" : "Crear"}
          </button>
          <button
            className="btn" disabled={ocupado}
            onClick={() => { setCreando(false); setNombre(""); setErr(null); }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="label" style={{ fontSize: 10.5, marginTop: 10 }}>Precio unitario de maquila ($)</div>
      <input
        className="pinput" style={{ fontSize: 16 }}
        type="number" inputMode="decimal" min={0} step="0.01"
        placeholder="Ej. 1.50"
        value={precio} onChange={(e) => onPrecio(e.target.value)}
      />
      <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
        {precioDeLaPrenda != null
          ? `Según la prenda: $${precioDeLaPrenda.toFixed(2)}. Cámbialo si con esta maquiladora es otro.`
          : "La prenda no tiene precio de maquila cargado."}
      </p>
      {sinPrecio && (
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--warn)" }}>
          ⚠️ Sin precio, el corte quedará con maquila a $0. Puedes registrarlo igual y avisar a Mateo.
        </p>
      )}
    </section>
  );
}

const BLOQUE: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 12,
  marginTop: 10,
};
