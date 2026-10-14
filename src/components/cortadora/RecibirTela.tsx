"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador } from "@/lib/fechas";
import { validarAnchoCm, type ResultadoRecepcion } from "@/lib/produccion/recepcion";

/**
 * La cortadora confirma que llegó una tela — fase 8l.
 *
 * Solo pasa por `fn_recibir_tela`: ella no tiene permiso de escribir directo en
 * prod_pedidos_tela, y es a propósito (RLS es de fila, no de columna — un update
 * directo le dejaría tocar precios). La función escribe el estado, el ancho, la
 * fecha y que la recibió ella; nada más.
 *
 * El ancho arranca VACÍO, no con el del pedido: lo que vale es lo que ella mide
 * con la cinta. El del pedido se enseña al lado como referencia.
 *
 * Un doble toque no da error: la función devuelve `ya_recibido` y se muestra
 * como aviso.
 */
export default function RecibirTela({
  supabase,
  pedidoId,
  nombreTela,
  anchoPedido,
  onListo,
  onCancelar,
}: {
  supabase: SupabaseClient;
  pedidoId: string;
  nombreTela: string;
  anchoPedido: number | null;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [ancho, setAncho] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function guardar() {
    if (ocupado) return;
    setErr(null);
    const v = validarAnchoCm(ancho);
    if ("error" in v) return setErr(v.error);
    if (!fecha) return setErr("Pon la fecha en que llegó la tela.");

    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("fn_recibir_tela", {
        p_pedido_id: pedidoId,
        p_ancho_real: v.cm,
        p_fecha: fecha,
      });
      if (error) {
        throw new Error(
          error.message.includes("fn_recibir_tela") || error.message.includes("schema cache")
            ? "Falta ejecutar supabase/schema_fase8l_cortadora_recibe_tela.sql."
            : error.message
        );
      }
      const r = (data ?? {}) as ResultadoRecepcion;
      onListo(
        r.ya_recibido
          ? `«${nombreTela}» ya estaba recibida${r.ancho_real != null ? ` (ancho ${Number(r.ancho_real)} cm)` : ""}. No se cambió nada.`
          : `«${nombreTela}» recibida · ancho ${v.cm} cm`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      {err && <div className="error-banner">{err}</div>}

      <div style={{ display: "flex", gap: 9 }}>
        <div style={{ flex: 1 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Ancho (cm)</div>
          <input
            className="pinput" style={{ fontSize: 16, textAlign: "center" }}
            type="number" inputMode="decimal" min={10} max={400} step="0.5"
            placeholder="Ej. 150"
            value={ancho} onChange={(e) => setAncho(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Fecha de llegada</div>
          <input
            className="pinput" style={{ fontSize: 15 }}
            type="date" max={hoyEcuador()}
            value={fecha} onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      </div>
      <p style={{ margin: "7px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
        Mide el ancho con la cinta, en centímetros.
        {anchoPedido != null && ` Se pidió de ${anchoPedido} cm.`}
      </p>

      <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
        <button className="btn" style={BOTON} onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </button>
        <button className="btn primary" style={BOTON} onClick={guardar} disabled={ocupado}>
          {ocupado ? "Guardando…" : "Confirmar llegada"}
        </button>
      </div>
    </div>
  );
}

/** Botones grandes: se usa desde el teléfono. */
const BOTON: React.CSSProperties = { flex: 1, padding: "12px 10px", fontSize: 15 };
