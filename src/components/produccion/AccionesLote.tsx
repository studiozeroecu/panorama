"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador } from "@/lib/fechas";
import {
  planTodoEnviado, planTodoRecibido, ejecutarTodoEnviado, ejecutarTodoRecibido, type ColorLote,
} from "@/lib/produccion/accionesMaquila";

/**
 * "📤 Todo enviado" / "📥 Todo recibido" para un lote entero de maquila.
 * Lo usan la pantalla de Maquila del admin y la pestaña Maquila de la cortadora.
 *
 * Siempre con un paso de confirmación que dice QUÉ va a hacer (cuántos colores,
 * cuántas prendas) y con qué fecha: marcar recibido no se deshace con un clic.
 * Para recibir solo una parte, o justificar faltantes, se sigue usando cada
 * color por separado.
 */
export default function AccionesLote({
  supabase,
  colores,
  onListo,
  grande,
}: {
  supabase: SupabaseClient;
  colores: ColorLote[];
  onListo: (mensaje: string) => void | Promise<void>;
  /** Botones grandes, para el teléfono (pantalla de la cortadora). */
  grande?: boolean;
}) {
  const [modo, setModo] = useState<"enviar" | "recibir" | null>(null);
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const porEnviar = planTodoEnviado(colores);
  const porRecibir = planTodoRecibido(colores);
  const prendasPorRecibir = porRecibir.reduce((s, x) => s + x.unidades, 0);

  if (!porEnviar.length && !porRecibir.length) return null;

  const estiloBoton: React.CSSProperties = grande
    ? { flex: 1, padding: "11px 8px", fontSize: 14 }
    : { padding: "4px 10px", fontSize: 12 };

  async function confirmar() {
    setOcupado(true);
    setErr(null);
    const r = modo === "enviar"
      ? await ejecutarTodoEnviado(supabase, porEnviar, fecha)
      : await ejecutarTodoRecibido(supabase, porRecibir, fecha);
    setOcupado(false);
    if (r.fallos.length) {
      // Lo que sí se hizo, se queda: volver a pulsar termina lo que falta.
      return setErr(
        `${r.hechos} hecho(s), ${r.fallos.length} con error: ${r.fallos[0]}` +
          (r.hechos ? " — vuelve a pulsar para terminar lo que falta." : "")
      );
    }
    setModo(null);
    await onListo(
      modo === "enviar"
        ? `${r.hechos} color(es) marcados como enviados a maquila`
        : `Recibido completo: ${prendasPorRecibir} prendas en ${r.hechos} color(es)`
    );
  }

  if (!modo) {
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: grande ? 10 : 0 }}>
        {porEnviar.length > 0 && (
          <button className="btn" style={estiloBoton}
            onClick={() => { setFecha(hoyEcuador()); setErr(null); setModo("enviar"); }}>
            📤 Todo enviado ({porEnviar.length})
          </button>
        )}
        {porRecibir.length > 0 && (
          <button className="btn primary" style={estiloBoton}
            onClick={() => { setFecha(hoyEcuador()); setErr(null); setModo("recibir"); }}>
            📥 Todo recibido ({prendasPorRecibir})
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 10, padding: 11, borderRadius: 9,
      background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 13,
    }}>
      {err && <div className="error-banner">{err}</div>}
      <div style={{ marginBottom: 8 }}>
        {modo === "enviar"
          ? <>Se marcarán como <b>enviados a la maquiladora</b> {porEnviar.length} color(es) que todavía no habían salido.</>
          : <>Se registrará como <b>recibido completo</b> lo que falta: <b>{prendasPorRecibir} prendas</b> en {porRecibir.length} color(es). Si llegó solo una parte, o con fallas, mejor regístralo color por color.</>}
      </div>
      <div className="label" style={{ fontSize: 10.5 }}>Fecha</div>
      <input className="pinput" type="date" max={hoyEcuador()} value={fecha}
        onChange={(e) => setFecha(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn" style={{ flex: 1 }} disabled={ocupado} onClick={() => setModo(null)}>Cancelar</button>
        <button className="btn primary" style={{ flex: 1 }} disabled={ocupado || !fecha} onClick={confirmar}>
          {ocupado ? "Guardando…" : modo === "enviar" ? "Confirmar envío" : "Confirmar recibido"}
        </button>
      </div>
    </div>
  );
}
