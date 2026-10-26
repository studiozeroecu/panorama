"use client";

import { useMemo, useState } from "react";
import { nuevoId } from "@/lib/id";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEcuador } from "@/lib/fechas";
import { compararCorte, esperadoPorTalla } from "@/lib/produccion/descuadre";
import type { Maquiladora } from "./CortadoraApp";
import MaquilaDelCorte from "./MaquilaDelCorte";
import { validarHoras, fmtHoras, guardarHorasCorte } from "@/lib/produccion/horas";
import CampoHoras from "./CampoHoras";
import type { Parte } from "@/lib/produccion/conjuntos";

/** Fase 8r: una parte de un conjunto, como la necesita este formulario. */
export interface ParteCorte {
  parte: Parte;
  nombre: string;
  /** Costo de maquila de la parte en Prendas. null = sin costo cargado. */
  costo: number | null;
}

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
  maquiladoras,
  costoMaquila,
  partes,
  onMaquiladoraCreada,
  onListo,
  onCancelar,
}: {
  supabase: SupabaseClient;
  pedidoId: string;
  nombreTela: string;
  colores: ColorTela[];
  corridaBase: Record<string, number> | null;
  tallas: string[];
  maquiladoras: Maquiladora[];
  /** De la prenda del pedido. null = sin prenda o sin costo cargado. */
  costoMaquila: number | null;
  /**
   * Fase 8r: si la prenda es un conjunto, sus dos partes. Cada color se corta
   * en DOS filas (superior e inferior), cada una con sus capas y sus tallas —
   * el rollo se parte por la mitad y no salen las mismas de cada parte.
   */
  partes?: ParteCorte[] | null;
  onMaquiladoraCreada: (m: Maquiladora) => void;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  // Nace AL ABRIR, no al guardar: una apertura = un intento (regla de la fase 8b).
  const [idemId] = useState(() => nuevoId());
  const [filas, setFilas] = useState<Record<string, FilaColor>>({});
  const [ocupado, setOcupado] = useState(false);
  const [maquiladoraId, setMaquiladoraId] = useState("");
  // Arranca con el de la prenda (como CorteTab); ella lo puede cambiar.
  const [precio, setPrecio] = useState(costoMaquila != null ? String(costoMaquila) : "");
  // Fase 8r: en un conjunto cada parte paga la maquila a su precio.
  const [preciosParte, setPreciosParte] = useState<Record<string, string>>(() =>
    Object.fromEntries((partes ?? []).map((x) => [x.parte, x.costo != null ? String(x.costo) : ""]))
  );
  const esConjunto = !!partes?.length;

  /** Las filas del formulario: una por color, o dos (una por parte) en un conjunto. */
  const filasCorte = useMemo(
    () =>
      esConjunto
        ? colores.flatMap((c) =>
            partes!.map((x) => ({
              ...c, parte: x.parte as Parte | null,
              clave: `${c.color}|${x.parte}`, etiqueta: `${c.color} · ${x.nombre}`,
            }))
          )
        : colores.map((c) => ({ ...c, parte: null as Parte | null, clave: c.color, etiqueta: c.color })),
    [colores, partes, esConjunto]
  );
  const [horas, setHoras] = useState("");
  const [minutos, setMinutos] = useState("0");
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
      filasCorte
        .map((c) => ({ ...c, capas: parseInt(fila(c.clave).capas, 10) || 0 }))
        .filter((c) => c.capas > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filasCorte, filas]
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
        // La etiqueta ("Negro · Blusa") identifica cada fila: el aviso de
        // descuadre es por fila, y en un conjunto cada parte es un tendido aparte.
        activos.map((a) => ({ color: a.etiqueta, capas: a.capas, real: realDe(a.clave, a.capas) }))
      ),
    [corridaBase, activos, realDe]
  );

  async function guardar() {
    setErr(null);
    if (!activos.length) return setErr("Pon las capas de al menos un color.");

    // Fase 8r: el precio de maquila de cada parte, validado como el precio único.
    const precioDeParte: Record<string, number | null> = {};
    for (const x of partes ?? []) {
      const t = (preciosParte[x.parte] ?? "").trim();
      const n = t ? Number(t.replace(",", ".")) : null;
      if (n != null && (!Number.isFinite(n) || n < 0))
        return setErr(`El precio de maquila de ${x.nombre} tiene que ser un número (o déjalo en blanco).`);
      precioDeParte[x.parte] = n;
    }

    const payload = activos.map((a) => {
      const m = parseFloat(fila(a.clave).metros);
      return {
        color: a.color,
        ...(a.parte ? { parte: a.parte, costo_maquila: precioDeParte[a.parte] ?? null } : {}),
        capas: a.capas,
        tallas: realDe(a.clave, a.capas),
        metros_usados: isNaN(m) ? null : m,
      };
    });
    if (payload.every((c) => Object.keys(c.tallas).length === 0))
      return setErr("No hay ninguna unidad que registrar.");

    const vh = validarHoras(horas, minutos);
    if ("error" in vh) return setErr(vh.error);

    const precioNum = precio.trim() ? Number(precio.replace(",", ".")) : null;
    if (precioNum != null && (!Number.isFinite(precioNum) || precioNum < 0))
      return setErr("El precio de maquila tiene que ser un número (o déjalo en blanco).");

    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("fn_registrar_corte", {
        p_pedido_id: pedidoId,
        p_fecha: hoyEcuador(),
        p_maquiladora_id: maquiladoraId || null,
        p_observaciones: "",
        // El precio acordado para ESTE corte (arranca con el de la prenda). La
        // función lo congela en prod_maquilas.costo_unitario. ⚠️ En blanco viaja
        // null y fn_registrar_corte lo guarda como 0 (coalesce): no se inventa un
        // valor; la pantalla avisa antes.
        p_costo_maquila: precioNum,
        p_colores: payload,
        p_idem_id: idemId,
        // La corrida sí es una sola para todo el corte; las capas van dentro de
        // cada color, arriba.
        p_corrida_base: corridaBase,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { ya_registrado?: boolean; unidades?: number; corte_id?: string };
      if (r.ya_registrado) return onListo("Este corte ya estaba registrado.");

      let msg = `Corte registrado · ${r.unidades ?? comparacion.totalReal} unidades`;
      // Las horas van DESPUÉS y aparte (fase 8o): si fallaran, el corte ya está
      // guardado y no se pierde; se avisa para añadirlas con «+ Horas».
      if (vh.horas != null && r.corte_id) {
        try {
          await guardarHorasCorte(supabase, r.corte_id, vh.horas, `Corte ${nombreTela}`);
          msg += ` · ${fmtHoras(vh.horas)}`;
        } catch (e) {
          msg += ` — ⚠️ ${e instanceof Error ? e.message : String(e)}. Añádelas con «+ Horas».`;
        }
      }
      onListo(msg);
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

      {esConjunto && (
        <p style={{ fontSize: 12.5, color: "var(--accent)", margin: "0 0 10px" }}>
          Esta tela es de un conjunto: cada color va en dos filas, una por parte. Pon las capas
          de cada parte por separado (no tienen por qué ser iguales).
        </p>
      )}

      {filasCorte.map((c) => {
        const f = fila(c.clave);
        const nCapas = parseInt(f.capas, 10) || 0;
        const sug = esperadoPorTalla(corridaBase, nCapas);
        const d = comparacion.porColor.find((x) => x.color === c.etiqueta);

        return (
          <section key={c.clave} style={BLOQUE}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <b style={{ flex: 1, fontSize: 15 }}>{c.etiqueta}</b>
              {c.parte !== "inferior" && (
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {Number(c.metros).toFixed(1)} m
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 9, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 10 }}>Capas</div>
                <input
                  className="pinput" style={{ textAlign: "center", fontSize: 16 }}
                  type="number" inputMode="numeric" min={0} placeholder="0"
                  value={f.capas} onChange={(e) => poner(c.clave, { capas: e.target.value })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 10 }}>Metros usados</div>
                <input
                  className="pinput" style={{ textAlign: "center" }}
                  type="number" inputMode="decimal" step="0.1" min={0} placeholder="Opcional"
                  value={f.metros} onChange={(e) => poner(c.clave, { metros: e.target.value })}
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
                    const real = realDe(c.clave, nCapas)[t] ?? 0;
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
                          onChange={(e) => ponerTalla(c.clave, t, e.target.value)}
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

      {/* Fase 8o: las horas de ESTE corte. La tarifa la congela la base. */}
      <section style={{ ...BLOQUE, marginTop: 10, marginBottom: 0 }}>
        <b style={{ fontSize: 15 }}>Horas de este corte</b>
        <div style={{ marginTop: 8 }}>
          <CampoHoras horas={horas} minutos={minutos} onHoras={setHoras} onMinutos={setMinutos} />
        </div>
      </section>

      {/* Al final: primero se registra lo cortado, después a dónde va y a qué precio. */}
      <MaquilaDelCorte
        supabase={supabase}
        maquiladoras={maquiladoras}
        maquiladoraId={maquiladoraId}
        onMaquiladora={setMaquiladoraId}
        precio={precio}
        onPrecio={setPrecio}
        precioDeLaPrenda={costoMaquila}
        onCreada={onMaquiladoraCreada}
        partes={partes ?? null}
        preciosParte={preciosParte}
        onPrecioParte={(parte, v) => setPreciosParte((p) => ({ ...p, [parte]: v }))}
      />

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
