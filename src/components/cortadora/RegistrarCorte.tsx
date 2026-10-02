"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador } from "@/lib/fechas";
import { compararConCorrida, esperadoPorTalla } from "@/lib/produccion/descuadre";

/**
 * Registro de un corte por la cortadora — fase 8j.
 *
 * El flujo: ella pone las CAPAS, el sistema sugiere `corrida × capas` por talla,
 * y ella AJUSTA lo que haga falta. El aviso de descuadre sube de tono con la
 * desviación pero **nunca bloquea**: el corte real manda sobre la teoría.
 *
 * Todo el cálculo es de cliente (ver src/lib/produccion/descuadre.ts). Lo único
 * que viaja al servidor son las cantidades ya ajustadas, más `capas` y
 * `corrida_base` para poder reconstruir esta comparación meses después.
 */

interface ColorTela {
  color: string;
  metros: number | string;
}

export default function RegistrarCorte({
  supabase,
  pedidoId,
  nombreTela,
  colores,
  corridaBase,
  tallas,
  onListo,
  onCancelar,
}: {
  supabase: SupabaseClient;
  pedidoId: string;
  nombreTela: string;
  colores: ColorTela[];
  corridaBase: Record<string, number> | null;
  tallas: string[];
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  // El id de idempotencia nace AL ABRIR, no al guardar: una apertura = un
  // intento. Es la regla de la fase 8b.
  const [idemId] = useState(() => crypto.randomUUID());
  const [capas, setCapas] = useState("");
  const [color, setColor] = useState(colores[0]?.color ?? "");
  const [metros, setMetros] = useState("");
  // ajustes[talla] = texto; vacío significa "lo sugerido"
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nCapas = parseInt(capas, 10) || 0;
  const sugerido = useMemo(() => esperadoPorTalla(corridaBase, nCapas), [corridaBase, nCapas]);

  /** Lo que realmente se va a guardar: el ajuste si lo hay, si no lo sugerido. */
  const real = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of tallas) {
      const escrito = ajustes[t];
      const n = escrito === undefined || escrito === "" ? (sugerido[t] ?? 0) : parseInt(escrito, 10) || 0;
      if (n > 0) out[t] = n;
    }
    return out;
  }, [ajustes, sugerido, tallas]);

  const descuadre = useMemo(
    () => compararConCorrida(corridaBase, nCapas, real),
    [corridaBase, nCapas, real]
  );
  const totalReal = Object.values(real).reduce((s, n) => s + n, 0);

  async function guardar() {
    setErr(null);
    if (!color) return setErr("Elige el color que cortaste.");
    if (totalReal <= 0) return setErr("No hay ninguna unidad que registrar.");

    const m = parseFloat(metros);
    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("fn_registrar_corte", {
        p_pedido_id: pedidoId,
        p_fecha: hoyEcuador(),
        p_maquiladora_id: null,
        p_observaciones: "",
        p_costo_maquila: 0,
        p_colores: [{ color, tallas: real, metros_usados: isNaN(m) ? null : m }],
        p_idem_id: idemId,
        // La foto: con qué corrida y cuántas capas se cortó de verdad.
        p_capas: nCapas > 0 ? nCapas : null,
        p_corrida_base: corridaBase,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { ya_registrado?: boolean; unidades?: number };
      onListo(
        r.ya_registrado
          ? "Este corte ya estaba registrado."
          : `Corte registrado · ${r.unidades ?? totalReal} unidades`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>
        Registrar corte de «{nombreTela}»
      </div>

      {err && <div className="error-banner">{err}</div>}

      <Campo etiqueta="Color">
        <select className="pinput" value={color} onChange={(e) => setColor(e.target.value)}>
          {colores.map((c) => (
            <option key={c.color} value={c.color}>
              {c.color} ({Number(c.metros).toFixed(1)} m)
            </option>
          ))}
        </select>
      </Campo>

      <div style={{ display: "flex", gap: 10 }}>
        <Campo etiqueta="Capas que tendiste">
          <input
            className="pinput" type="number" inputMode="numeric" min={1} placeholder="Ej: 5"
            value={capas} onChange={(e) => setCapas(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Metros usados">
          <input
            className="pinput" type="number" inputMode="decimal" step="0.1" min={0} placeholder="Opcional"
            value={metros} onChange={(e) => setMetros(e.target.value)}
          />
        </Campo>
      </div>

      {!corridaBase && (
        <p style={{ fontSize: 12.5, color: "var(--warn)", margin: "4px 0 8px" }}>
          Esta tela todavía no tiene corrida definida, así que no hay nada que sugerir.
          Escribe las cantidades a mano.
        </p>
      )}

      <div className="label" style={{ fontSize: 10.5, margin: "10px 0 6px" }}>
        Unidades por talla
        {nCapas > 0 && corridaBase && (
          <span style={{ fontWeight: 400, textTransform: "none", color: "var(--muted)" }}>
            {" "}· sugerido = corrida × {nCapas} capas
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {tallas.map((t) => {
          const sug = sugerido[t] ?? 0;
          const dif = (real[t] ?? 0) - sug;
          return (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 44, fontWeight: 600, fontSize: 15 }}>{t}</span>
              <input
                className="pinput"
                style={{ width: 92, textAlign: "center", fontSize: 16 }}
                type="number" inputMode="numeric" min={0}
                placeholder={sug ? String(sug) : "0"}
                value={ajustes[t] ?? ""}
                onChange={(e) => setAjustes((p) => ({ ...p, [t]: e.target.value }))}
              />
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {sug > 0 && `sugerido ${sug}`}
                {dif !== 0 && sug > 0 && (
                  <b style={{ color: dif > 0 ? "var(--good)" : "var(--warn)" }}>
                    {" "}({dif > 0 ? "+" : ""}{dif})
                  </b>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, fontSize: 14 }}>
        Total: <b>{totalReal} unidades</b>
        {descuadre.esperado > 0 && (
          <span style={{ color: "var(--muted)" }}> · esperadas {descuadre.esperado}</span>
        )}
      </div>

      {descuadre.mensaje && (
        <div
          style={{
            marginTop: 8, padding: "9px 12px", borderRadius: 9, fontSize: 13,
            background: descuadre.severidad === "alto" ? "var(--bad-soft)" : "var(--accent-soft)",
            color: descuadre.severidad === "alto" ? "var(--bad)" : "var(--accent)",
          }}
        >
          {descuadre.mensaje}
        </div>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
        <button className="btn" style={BOTON} onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </button>
        <button className="btn primary" style={BOTON} onClick={guardar} disabled={ocupado}>
          {ocupado ? "Guardando…" : "Guardar corte"}
        </button>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, marginBottom: 10 }}>
      <div className="label" style={{ fontSize: 10 }}>{etiqueta}</div>
      {children}
    </div>
  );
}

/** Botones grandes: se usa desde el teléfono y a veces con las manos ocupadas. */
const BOTON: React.CSSProperties = { flex: 1, padding: "12px 10px", fontSize: 15 };

