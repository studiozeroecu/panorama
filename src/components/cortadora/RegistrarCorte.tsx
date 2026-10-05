"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador } from "@/lib/fechas";
import { compararCorte, esperadoPorTalla } from "@/lib/produccion/descuadre";

/**
 * Registro de un corte por la cortadora — fase 8k.
 *
 * La corrida (la proporción por talla) es UNA para toda la tela. Las **capas no**:
 * las telas no llegan con el metraje exacto por color, así que un color puede dar
 * más tendidos que otro en el mismo corte. Por eso cada color trae sus propias
 * capas y su propia sugerencia `corrida × capas de ESE color`.
 *
 * El aviso de descuadre se da **por color**, no sobre el total. Un total puede
 * salir exacto con dos tendidos mal: +8 en Negro y −8 en Crudo se compensan y
 * nadie iría a mirar. El descuadre lo causa algo físico en un tendido concreto.
 *
 * Todo el cálculo es de cliente (src/lib/produccion/descuadre.ts). Lo que viaja
 * al servidor son las cantidades ya ajustadas más las capas de cada color, para
 * poder reconstruir esta comparación después.
 */

interface ColorTela {
  color: string;
  metros: number | string;
}

/** Lo que se teclea para un color. Vacío = ese color no entra en el corte. */
interface FilaColor {
  capas: string;
  metros: string;
  /** ajustes[talla]; vacío significa "lo sugerido". */
  ajustes: Record<string, string>;
}

const FILA_VACIA: FilaColor = { capas: "", metros: "", ajustes: {} };

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
  // Nace AL ABRIR, no al guardar: una apertura = un intento (regla de la fase 8b).
  const [idemId] = useState(() => crypto.randomUUID());
  const [filas, setFilas] = useState<Record<string, FilaColor>>({});
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fila = (c: string) => filas[c] ?? FILA_VACIA;

  function poner(color: string, cambios: Partial<FilaColor>) {
    setFilas((p) => ({ ...p, [color]: { ...fila(color), ...cambios } }));
  }
  function ponerTalla(color: string, talla: string, valor: string) {
    const f = fila(color);
    poner(color, { ajustes: { ...f.ajustes, [talla]: valor } });
  }

  /** Solo los colores con capas: el resto no entra en este corte. */
  const activos = useMemo(
    () =>
      colores
        .map((c) => ({ color: c.color, capas: parseInt(fila(c.color).capas, 10) || 0 }))
        .filter((c) => c.capas > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colores, filas]
  );

  /** Cantidades reales de un color: el ajuste si lo hay, si no lo sugerido. */
  const realDe = useMemo(
    () => (color: string, capas: number) => {
      const sug = esperadoPorTalla(corridaBase, capas);
      const f = fila(color);
      const out: Record<string, number> = {};
      for (const t of tallas) {
        const escrito = f.ajustes[t];
        const n =
          escrito === undefined || escrito === "" ? (sug[t] ?? 0) : parseInt(escrito, 10) || 0;
        if (n > 0) out[t] = n;
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [corridaBase, tallas, filas]
  );

  const comparacion = useMemo(
    () =>
      compararCorte(
        corridaBase,
        activos.map((a) => ({ color: a.color, capas: a.capas, real: realDe(a.color, a.capas) }))
      ),
    [corridaBase, activos, realDe]
  );

  async function guardar() {
    setErr(null);
    if (!activos.length) return setErr("Pon las capas de al menos un color.");

    const payload = activos.map((a) => {
      const m = parseFloat(fila(a.color).metros);
      return {
        color: a.color,
        capas: a.capas,
        tallas: realDe(a.color, a.capas),
        metros_usados: isNaN(m) ? null : m,
      };
    });
    if (payload.every((c) => Object.keys(c.tallas).length === 0))
      return setErr("No hay ninguna unidad que registrar.");

    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("fn_registrar_corte", {
        p_pedido_id: pedidoId,
        p_fecha: hoyEcuador(),
        p_maquiladora_id: null,
        p_observaciones: "",
        p_costo_maquila: 0,
        p_colores: payload,
        p_idem_id: idemId,
        // La corrida sí es una sola para todo el corte; las capas van dentro de
        // cada color, arriba.
        p_corrida_base: corridaBase,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { ya_registrado?: boolean; unidades?: number };
      onListo(
        r.ya_registrado
          ? "Este corte ya estaba registrado."
          : `Corte registrado · ${r.unidades ?? comparacion.totalReal} unidades`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div className="label" style={{ fontSize: 10.5, marginBottom: 4 }}>
        Registrar corte de «{nombreTela}»
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--muted)" }}>
        Pon las capas de cada color que tendiste. Los que dejes en blanco no entran.
      </p>

      {err && <div className="error-banner">{err}</div>}

      {!corridaBase && (
        <p style={{ fontSize: 12.5, color: "var(--warn)", margin: "0 0 10px" }}>
          Esta tela todavía no tiene corrida definida, así que no hay nada que sugerir.
          Escribe las cantidades a mano.
        </p>
      )}

      {colores.map((c) => {
        const f = fila(c.color);
        const nCapas = parseInt(f.capas, 10) || 0;
        const sug = esperadoPorTalla(corridaBase, nCapas);
        const d = comparacion.porColor.find((x) => x.color === c.color);

        return (
          <section key={c.color} style={BLOQUE}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <b style={{ flex: 1, fontSize: 15 }}>{c.color}</b>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {Number(c.metros).toFixed(1)} m
              </span>
            </div>

            <div style={{ display: "flex", gap: 9, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 10 }}>Capas</div>
                <input
                  className="pinput" style={{ textAlign: "center", fontSize: 16 }}
                  type="number" inputMode="numeric" min={0} placeholder="0"
                  value={f.capas} onChange={(e) => poner(c.color, { capas: e.target.value })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 10 }}>Metros usados</div>
                <input
                  className="pinput" style={{ textAlign: "center" }}
                  type="number" inputMode="decimal" step="0.1" min={0} placeholder="Opcional"
                  value={f.metros} onChange={(e) => poner(c.color, { metros: e.target.value })}
                />
              </div>
            </div>

            {nCapas > 0 && (
              <>
                <div className="label" style={{ fontSize: 10, margin: "10px 0 5px" }}>
                  Unidades por talla
                  {corridaBase && (
                    <span style={{ fontWeight: 400, textTransform: "none", color: "var(--muted)" }}>
                      {" "}· sugerido = corrida × {nCapas}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {tallas.map((t) => {
                    const s = sug[t] ?? 0;
                    const real = realDe(c.color, nCapas)[t] ?? 0;
                    const dif = real - s;
                    return (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 40, fontWeight: 600 }}>{t}</span>
                        <input
                          className="pinput"
                          style={{ width: 86, textAlign: "center", fontSize: 16 }}
                          type="number" inputMode="numeric" min={0}
                          placeholder={s ? String(s) : "0"}
                          value={f.ajustes[t] ?? ""}
                          onChange={(e) => ponerTalla(c.color, t, e.target.value)}
                        />
                        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                          {s > 0 && `sugerido ${s}`}
                          {dif !== 0 && s > 0 && (
                            <b style={{ color: dif > 0 ? "var(--good)" : "var(--warn)" }}>
                              {" "}({dif > 0 ? "+" : ""}{dif})
                            </b>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {d && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>
                      {d.real} de {d.esperado} esperadas
                    </span>
                    {d.mensaje && (
                      <div
                        style={{
                          marginTop: 5, padding: "8px 11px", borderRadius: 8,
                          background: d.severidad === "alto" ? "var(--bad-soft)" : "var(--accent-soft)",
                          color: d.severidad === "alto" ? "var(--bad)" : "var(--accent)",
                        }}
                      >
                        {d.mensaje}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      <div style={{ marginTop: 12, fontSize: 15 }}>
        Total del corte: <b>{comparacion.totalReal} unidades</b>
        {comparacion.totalEsperado > 0 && (
          <span style={{ color: "var(--muted)" }}>
            {" "}· esperadas {comparacion.totalEsperado}
          </span>
        )}
      </div>

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

const BLOQUE: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 12,
  marginBottom: 10,
};

/** Botones grandes: se usa desde el teléfono. */
const BOTON: React.CSSProperties = { flex: 1, padding: "12px 10px", fontSize: 15 };
