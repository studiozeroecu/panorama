"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui";

/**
 * Retazos e insumos de un corte ya registrado — fase 8j.
 *
 * Van en llamadas aparte y no dentro de `fn_registrar_corte` a propósito: son
 * EVENTOS que se añaden y se corrigen después, no hace falta que sean atómicos
 * con el corte, y meterlos ahí complicaría una función ya hardeneada sin ganar
 * nada. Si una de estas falla, el corte sigue bien registrado.
 *
 * El retazo lleva la talla puesta A MANO: un trozo sobrante sirve para cierta
 * talla si alcanza, y eso lo decide quien lo tiene delante, no una fórmula. Y no
 * suma al total del corte — es tela que podría dar una unidad, no una unidad.
 */

export default function ExtrasCorte({
  supabase,
  corteId,
  tallas,
  onListo,
}: {
  supabase: SupabaseClient;
  corteId: string;
  tallas: string[];
  onListo: (mensaje: string) => void;
}) {
  const [abierto, setAbierto] = useState<"retazo" | "insumo" | null>(null);
  const [talla, setTalla] = useState(tallas[0] ?? "M");
  const [unidades, setUnidades] = useState("");
  const [nota, setNota] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function cerrar() {
    setAbierto(null);
    setUnidades("");
    setNota("");
    setDescripcion("");
    setCantidad("");
    setErr(null);
  }

  async function guardarRetazo() {
    const n = parseInt(unidades, 10);
    if (!(n > 0)) return setErr("¿Para cuántas unidades alcanza el retazo?");
    setOcupado(true);
    const { error } = await supabase.from("prod_corte_retazos").insert({
      corte_id: corteId, talla, unidades: n, nota: nota.trim(),
    });
    setOcupado(false);
    if (error) return setErr(error.message);
    cerrar();
    onListo(`Retazo anotado · ${n} de talla ${talla}`);
  }

  async function guardarInsumo() {
    const c = parseFloat(cantidad);
    if (!descripcion.trim()) return setErr("Escribe qué insumo se usó.");
    if (!(c > 0)) return setErr("Escribe la cantidad.");
    setOcupado(true);
    const { error } = await supabase.from("prod_corte_insumos").insert({
      corte_id: corteId, descripcion: descripcion.trim(), cantidad: c,
    });
    setOcupado(false);
    if (error) return setErr(error.message);
    cerrar();
    onListo(`Insumo anotado · ${descripcion.trim()}`);
  }

  if (!abierto) {
    return (
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn" style={CHICO} onClick={() => setAbierto("retazo")}>
          + Retazo
        </button>
        <button className="btn" style={CHICO} onClick={() => setAbierto("insumo")}>
          + Insumo
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 9, padding: 11, borderRadius: 9,
        background: "var(--surface-2)", border: "1px solid var(--border)",
      }}
    >
      {err && <div className="error-banner">{err}</div>}

      {abierto === "retazo" ? (
        <>
          <div className="label" style={{ fontSize: 10, marginBottom: 6 }}>
            Retazo — ¿para qué talla alcanza?
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select
              className="pinput" style={{ width: 92 }}
              value={talla} onChange={(e) => setTalla(e.target.value)}
            >
              {tallas.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              className="pinput" style={{ width: 92, textAlign: "center" }}
              type="number" inputMode="numeric" min={1} placeholder="unid."
              value={unidades} onChange={(e) => setUnidades(e.target.value)}
            />
          </div>
          <input
            className="pinput" placeholder="Nota (opcional)"
            value={nota} onChange={(e) => setNota(e.target.value)}
          />
          <Pie ocupado={ocupado} onCancelar={cerrar} onGuardar={guardarRetazo} />
        </>
      ) : (
        <>
          <div className="label" style={{ fontSize: 10, marginBottom: 6 }}>
            Insumo usado
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="pinput" style={{ flex: 2 }} placeholder="Ej: botones"
              value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            />
            <input
              className="pinput" style={{ width: 92, textAlign: "center" }}
              type="number" inputMode="decimal" min={0} step="0.01" placeholder="cant."
              value={cantidad} onChange={(e) => setCantidad(e.target.value)}
            />
          </div>
          <Pie ocupado={ocupado} onCancelar={cerrar} onGuardar={guardarInsumo} />
        </>
      )}
    </div>
  );
}

function Pie({
  ocupado,
  onCancelar,
  onGuardar,
}: {
  ocupado: boolean;
  onCancelar: () => void;
  onGuardar: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button className="btn" style={{ flex: 1, padding: "10px" }} onClick={onCancelar} disabled={ocupado}>
        Cancelar
      </button>
      <button className="btn primary" style={{ flex: 1, padding: "10px" }} onClick={onGuardar} disabled={ocupado}>
        {ocupado ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

/** Lista de lo ya anotado, para que se vea que quedó registrado. */
export function ListaExtras({
  retazos,
  insumos,
}: {
  retazos: { id: string; talla: string; unidades: number }[];
  insumos: { id: string; descripcion: string; cantidad: number | string }[];
}) {
  if (!retazos.length && !insumos.length) return null;
  return (
    <div style={{ marginTop: 7 }}>
      {retazos.map((r) => (
        <Badge key={r.id} color="ambar">retazo {r.talla}: {r.unidades}</Badge>
      ))}
      {insumos.map((i) => (
        <Badge key={i.id} color="azul">{i.descripcion}: {Number(i.cantidad)}</Badge>
      ))}
    </div>
  );
}

const CHICO: React.CSSProperties = { flex: 1, padding: "9px", fontSize: 13 };
