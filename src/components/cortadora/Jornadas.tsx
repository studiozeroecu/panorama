"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";

/**
 * Horas trabajadas — fase 8j, pieza 4 de docs/plan_cortadora.md.
 *
 * Se registran POR JORNADA y no por corte: aunque casi siempre haga un corte a
 * la vez, un corte grande puede ocupar dos días y una jornada puede cubrir
 * varios cortes. Por eso en la base hay una tabla intermedia
 * (`prod_jornada_cortes`) y no una clave foránea directa.
 *
 * Aquí solo se CAPTURAN las horas. El costo (horas × tarifa) es la pieza 5 del
 * plan y va aparte — a propósito, porque esa tarifa habrá que congelarla al
 * registrar y no leerla viva, o editarla reescribiría el pasado.
 */

interface CorteBreve {
  id: string;
  fecha: string;
  total_unidades: number;
}

export default function Jornadas({
  supabase,
  cortes,
  onListo,
}: {
  supabase: SupabaseClient;
  cortes: CorteBreve[];
  onListo: (mensaje: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(hoyEcuador());
  const [horas, setHoras] = useState("");
  const [nota, setNota] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Los cortes recientes son los candidatos razonables para una jornada.
  const candidatos = cortes.slice(0, 8);

  async function guardar() {
    const h = parseFloat(horas);
    if (!(h > 0)) return setErr("¿Cuántas horas trabajaste?");
    setErr(null);
    setOcupado(true);
    try {
      const { data, error } = await supabase
        .from("prod_jornadas")
        .insert({ fecha, horas: h, nota: nota.trim() })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      // El enlace a los cortes va aparte: si falla, la jornada ya quedó
      // registrada y las horas no se pierden, que es lo que importa.
      if (sel.length) {
        const { error: e2 } = await supabase
          .from("prod_jornada_cortes")
          .insert(sel.map((corte_id) => ({ jornada_id: data.id, corte_id })));
        if (e2) throw new Error(`Horas guardadas, pero no se enlazaron los cortes: ${e2.message}`);
      }

      setAbierto(false);
      setHoras("");
      setNota("");
      setSel([]);
      onListo(`Jornada guardada · ${h} h`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button
        className="btn"
        style={{ width: "100%", padding: "13px", fontSize: 15, marginTop: 22 }}
        onClick={() => setAbierto(true)}
      >
        🕑 Anotar horas de hoy
      </button>
    );
  }

  return (
    <section
      style={{
        marginTop: 22, padding: 15, borderRadius: 12,
        background: "var(--surface)", border: "1px solid var(--border)",
      }}
    >
      <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Horas trabajadas</h2>
      {err && <div className="error-banner">{err}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="label" style={{ fontSize: 10 }}>Fecha</div>
          <input
            className="pinput" type="date"
            value={fecha} onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <div style={{ width: 110 }}>
          <div className="label" style={{ fontSize: 10 }}>Horas</div>
          <input
            className="pinput" style={{ textAlign: "center" }}
            type="number" inputMode="decimal" min={0} step="0.5" placeholder="7.5"
            value={horas} onChange={(e) => setHoras(e.target.value)}
          />
        </div>
      </div>

      {candidatos.length > 0 && (
        <>
          <div className="label" style={{ fontSize: 10, margin: "10px 0 5px" }}>
            ¿En qué cortes? (opcional, puedes marcar varios)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {candidatos.map((c) => (
              <label
                key={c.id}
                style={{
                  display: "flex", gap: 9, alignItems: "center",
                  padding: "7px 9px", borderRadius: 7, fontSize: 13.5, cursor: "pointer",
                  background: sel.includes(c.id) ? "var(--accent-soft)" : "transparent",
                }}
              >
                <input
                  type="checkbox" checked={sel.includes(c.id)}
                  onChange={() =>
                    setSel((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
                  }
                />
                {fmtFecha(c.fecha)} · {c.total_unidades} und.
              </label>
            ))}
          </div>
        </>
      )}

      <input
        className="pinput" style={{ marginTop: 10 }} placeholder="Nota (opcional)"
        value={nota} onChange={(e) => setNota(e.target.value)}
      />

      <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
        <button
          className="btn" style={{ flex: 1, padding: "12px" }}
          onClick={() => setAbierto(false)} disabled={ocupado}
        >
          Cancelar
        </button>
        <button
          className="btn primary" style={{ flex: 1, padding: "12px" }}
          onClick={guardar} disabled={ocupado}
        >
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </section>
  );
}
