"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Vacio, Tallas } from "@/components/ui";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { nuevoId } from "@/lib/id";
import { ordenarTallas } from "@/lib/produccion/types";
import {
  pendientesPorTalla, sumaTallas, etapaMaquila, TEXTO_ETAPA, type EtapaMaquila,
} from "@/lib/produccion/entregas";

/**
 * Pestaña "Maquila" de la cortadora — fase 8o.
 *
 * Dónde está cada lote (por enviar, en maquila, entrega parcial, entregado) y
 * los dos pasos que ella hace: marcar que lo mandó y registrar lo que vuelve,
 * completo o en partes, por talla.
 *
 * Las dos escrituras pasan por funciones de la base (fn_marcar_enviado_maquila,
 * fn_registrar_entrega_maquila): ella no tiene update sobre los lotes, a
 * propósito — una política de update le dejaría tocar `procesado`, que es de
 * Envío. Una entrega parcial ya aparece en Envío de Mateo para mandarse a locales
 * o estampado sin esperar el resto.
 *
 * Fase 8p: "Justificar faltante" — prendas que llegaron con fallas o que la
 * maquila no entregó, por talla y con motivo obligatorio. Cierran el lote, pero
 * se dan de baja: no van a Envío y no se le pagan a la maquila.
 */

export interface EntregaC {
  id: string;
  fecha: string;
  tallas: Record<string, number>;
  unidades: number;
  tipo: "entrega" | "falla" | "faltante";
  motivo: string;
}

export interface ColorMaquilaC {
  id: string;
  estado: "pendiente" | "enviado" | "entregado";
  fecha_envio: string | null;
  fecha_entrega: string | null;
  color: string;
  orden: number;
  tallas: Record<string, number>;
  entregas: EntregaC[];
}

export interface MaquilaC {
  id: string;
  corte_id: string;
  maquiladora_id: string | null;
  colores: ColorMaquilaC[];
}

interface CorteRef { id: string; pedido_id: string; fecha: string }
interface PedidoRef { id: string; nombre_tela: string; destino_indicado: "locales" | "estampado" | null }

const COLOR_ETAPA: Record<EtapaMaquila, "gris" | "azul" | "ambar" | "verde"> = {
  por_enviar: "gris",
  en_maquila: "azul",
  parcial: "ambar",
  entregado: "verde",
};

export const TEXTO_DESTINO = { locales: "Directo a locales", estampado: "Bodega de estampados" } as const;

export default function MaquilasCortadora({
  supabase,
  maquilas,
  cortes,
  pedidos,
  maquiladoras,
  onListo,
}: {
  supabase: SupabaseClient;
  maquilas: MaquilaC[];
  cortes: CorteRef[];
  pedidos: PedidoRef[];
  maquiladoras: { id: string; nombre: string }[];
  onListo: (mensaje: string) => void;
}) {
  const activas = maquilas.filter((m) => m.colores.some((c) => c.estado !== "entregado"));
  const terminadas = maquilas.filter(
    (m) => m.colores.length > 0 && m.colores.every((c) => c.estado === "entregado")
  );

  if (!activas.length && !terminadas.length) {
    return <Vacio titulo="No hay lotes en maquila" hint="Aparecen aquí cuando registras un corte." />;
  }

  const tarjeta = (m: MaquilaC) => {
    const corte = cortes.find((c) => c.id === m.corte_id);
    const pedido = corte ? pedidos.find((p) => p.id === corte.pedido_id) : undefined;
    return (
      <TarjetaMaquila
        key={m.id}
        supabase={supabase}
        maquila={m}
        nombreTela={pedido?.nombre_tela ?? "(tela)"}
        fechaCorte={corte?.fecha ?? null}
        destino={pedido?.destino_indicado ?? null}
        maquiladora={maquiladoras.find((x) => x.id === m.maquiladora_id)?.nombre ?? null}
        onListo={onListo}
      />
    );
  };

  return (
    <>
      {activas.length > 0 && (
        <>
          <h2 style={ROTULO}>En proceso ({activas.length})</h2>
          {activas.map(tarjeta)}
        </>
      )}
      {terminadas.length > 0 && (
        <>
          <h2 style={ROTULO}>Entregadas (últimas {Math.min(terminadas.length, 10)})</h2>
          {terminadas.slice(0, 10).map(tarjeta)}
        </>
      )}
    </>
  );
}

function TarjetaMaquila({
  supabase, maquila, nombreTela, fechaCorte, destino, maquiladora, onListo,
}: {
  supabase: SupabaseClient;
  maquila: MaquilaC;
  nombreTela: string;
  fechaCorte: string | null;
  destino: "locales" | "estampado" | null;
  maquiladora: string | null;
  onListo: (mensaje: string) => void;
}) {
  return (
    <section style={TARJETA}>
      <h3 style={{ margin: 0, fontSize: 17 }}>{nombreTela}</h3>
      <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
        {maquiladora ?? "Maquiladora sin asignar"}
        {fechaCorte && ` · cortado ${fmtFecha(fechaCorte)}`}
      </p>
      {destino && (
        <p style={{ margin: "7px 0 0", fontSize: 13.5 }}>
          👉 Indicación de Mateo: <b>{TEXTO_DESTINO[destino]}</b>
        </p>
      )}
      {[...maquila.colores]
        .sort((a, b) => a.orden - b.orden)
        .map((c) => (
          <FilaColor key={c.id} supabase={supabase} col={c} nombreTela={nombreTela} onListo={onListo} />
        ))}
    </section>
  );
}

function FilaColor({
  supabase, col, nombreTela, onListo,
}: {
  supabase: SupabaseClient;
  col: ColorMaquilaC;
  nombreTela: string;
  onListo: (mensaje: string) => void;
}) {
  const [modo, setModo] = useState<"enviar" | "entregar" | "justificar" | null>(null);
  const [tipoBaja, setTipoBaja] = useState<"falla" | "faltante">("falla");
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [idemId, setIdemId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const etapa = etapaMaquila(col.estado, col.entregas);
  const cortado = sumaTallas(col.tallas);
  const falta = pendientesPorTalla(col.tallas, col.entregas);
  const sumaTipo = (t: EntregaC["tipo"]) =>
    col.entregas.filter((e) => e.tipo === t).reduce((s, e) => s + e.unidades, 0);
  const buenas = sumaTipo("entrega");
  const fallas = sumaTipo("falla");
  const faltantes = sumaTipo("faltante");

  function abrirEntrega() {
    // Precargado con TODO lo que falta: si llegó completo, solo confirma. Si
    // fue parcial, baja los números.
    const init: Record<string, string> = {};
    for (const [t, n] of Object.entries(falta)) init[t] = String(n);
    setCantidades(init);
    setFecha(hoyEcuador());
    // Una apertura = un intento (regla de la fase 8b).
    setIdemId(nuevoId());
    setErr(null);
    setModo("entregar");
  }

  function abrirJustificar() {
    // Al revés que la entrega: arranca en CERO. Una baja se anota a propósito,
    // talla por talla; precargarla con todo lo que falta invitaría a cerrar el
    // lote sin mirar.
    setCantidades({});
    setFecha(hoyEcuador());
    setTipoBaja("falla");
    setMotivo("");
    setIdemId(nuevoId());
    setErr(null);
    setModo("justificar");
  }

  async function marcarEnviado() {
    setOcupado(true);
    setErr(null);
    const { data, error } = await supabase.rpc("fn_marcar_enviado_maquila", {
      p_maquila_color_id: col.id,
      p_fecha: fecha,
    });
    setOcupado(false);
    if (error) return setErr(faltaFase(error.message));
    const r = (data ?? {}) as { ya_enviado?: boolean };
    setModo(null);
    onListo(r.ya_enviado ? `${col.color} ya estaba enviado.` : `${col.color} de «${nombreTela}» enviado a maquila`);
  }

  async function registrarEntrega() {
    const baja = modo === "justificar";
    if (baja && !motivo.trim()) return setErr("Escribe el motivo: es lo que justifica las prendas que faltan.");
    const tallas: Record<string, number> = {};
    for (const [t, v] of Object.entries(cantidades)) {
      const n = v.trim() === "" ? 0 : Number(v);
      if (!Number.isInteger(n) || n < 0) return setErr(`Talla ${t}: pon un número entero.`);
      if (n > (falta[t] ?? 0)) return setErr(`Talla ${t}: solo faltan ${falta[t] ?? 0}.`);
      if (n > 0) tallas[t] = n;
    }
    if (!sumaTallas(tallas)) return setErr(baja ? "Anota cuántas prendas justificas." : "Anota al menos una prenda entregada.");
    setOcupado(true);
    setErr(null);
    const { data, error } = await supabase.rpc("fn_registrar_entrega_maquila", {
      p_maquila_color_id: col.id,
      p_fecha: fecha,
      p_tallas: tallas,
      p_idem_id: idemId,
      p_tipo: baja ? tipoBaja : "entrega",
      p_motivo: baja ? motivo.trim() : null,
    });
    setOcupado(false);
    if (error) return setErr(faltaFase(error.message));
    const r = (data ?? {}) as { ya_registrada?: boolean; completo?: boolean; unidades?: number };
    setModo(null);
    onListo(
      r.ya_registrada
        ? "Esto ya estaba registrado."
        : baja
          ? `${col.color}: ${r.unidades} ${tipoBaja === "falla" ? "con fallas" : "no entregadas"} justificadas${r.completo ? " — lote cerrado" : ""}`
          : r.completo
            ? `${col.color}: entrega completa (${r.unidades} und.)`
            : `${col.color}: entrega parcial de ${r.unidades} und. — ya puede salir en Envío`
    );
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <b style={{ fontSize: 15 }}>{col.color}</b>
        <Badge color={COLOR_ETAPA[etapa]}>{TEXTO_ETAPA[etapa]}</Badge>
      </div>
      <div style={{ fontSize: 13.5, marginTop: 4 }}>
        {buenas} de {cortado} entregadas bien
        {fallas > 0 && <span style={{ color: "var(--warn)" }}> · {fallas} con fallas</span>}
        {faltantes > 0 && <span style={{ color: "var(--warn)" }}> · {faltantes} no entregadas</span>}
        <span style={{ color: "var(--muted)" }}>
          {col.fecha_envio && ` · enviado ${fmtFecha(col.fecha_envio)}`}
          {col.fecha_entrega && ` · completo ${fmtFecha(col.fecha_entrega)}`}
        </span>
      </div>
      {etapa !== "entregado" && sumaTallas(falta) > 0 && (
        <div style={{ marginTop: 5, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Falta: </span>
          <Tallas tallas={ordenado(falta)} />
        </div>
      )}
      {col.entregas.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 12.5, color: "var(--muted)" }}>
          {[...col.entregas]
            .sort((a, b) => a.fecha.localeCompare(b.fecha))
            .map((e) => (
              <div key={e.id} style={e.tipo !== "entrega" ? { color: "var(--warn)" } : undefined}>
                {e.tipo === "entrega" ? "Llegaron" : e.tipo === "falla" ? "Con fallas" : "No entregadas"}{" "}
                {e.unidades} el {fmtFecha(e.fecha)} ·{" "}
                {ordenarTallas(Object.keys(e.tallas)).map((t) => `${t}:${e.tallas[t]}`).join(" ")}
                {e.motivo && ` — ${e.motivo}`}
              </div>
            ))}
        </div>
      )}

      {err && <div className="error-banner" style={{ marginTop: 8 }}>{err}</div>}

      {etapa !== "entregado" && modo === null && (
        <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
          {etapa === "por_enviar" && (
            <button className="btn" style={BOTON} onClick={() => { setFecha(hoyEcuador()); setErr(null); setModo("enviar"); }}>
              📤 Marcar enviado
            </button>
          )}
          <button className="btn primary" style={BOTON} onClick={abrirEntrega}>
            📥 Registrar entrega
          </button>
        </div>
      )}
      {etapa !== "entregado" && modo === null && etapa !== "por_enviar" && (
        <button className="btn" style={{ ...BOTON, width: "100%", marginTop: 8 }} onClick={abrirJustificar}>
          ⚠️ Justificar faltante o fallas
        </button>
      )}

      {modo === "enviar" && (
        <div style={FORM}>
          <div className="label" style={{ fontSize: 10.5 }}>¿Cuándo lo mandaste a la maquiladora?</div>
          <input className="pinput" type="date" max={hoyEcuador()} value={fecha}
            onChange={(e) => setFecha(e.target.value)} />
          <Pie ocupado={ocupado} onCancelar={() => setModo(null)} onGuardar={marcarEnviado} texto="Confirmar envío" />
        </div>
      )}

      {(modo === "entregar" || modo === "justificar") && (
        <div style={FORM}>
          {modo === "justificar" ? (
            <>
              <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>¿Qué pasó?</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {([["falla", "Llegaron con fallas"], ["faltante", "No las entregó"]] as const).map(([v, t]) => (
                  <button key={v} className={tipoBaja === v ? "btn primary" : "btn"} style={BOTON}
                    onClick={() => setTipoBaja(v)}>{t}</button>
                ))}
              </div>
              <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--muted)" }}>
                ¿Cuántas de cada talla? Estas prendas se dan de baja: no van a Envío y no
                se le pagan a la maquila.
              </p>
            </>
          ) : (
            <>
              <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>
                ¿Cuántas llegaron de cada talla?
              </div>
              <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--muted)" }}>
                Está lleno con todo lo que falta. Si llegó completo, solo confirma; si
                llegó una parte, baja los números.
              </p>
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ordenarTallas(Object.keys(falta)).map((t) => (
              <div key={t} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t} <span style={{ opacity: 0.7 }}>/ {falta[t]}</span></div>
                <input
                  className="pinput" style={{ width: 62, textAlign: "center", fontSize: 16 }}
                  type="number" inputMode="numeric" min={0} max={falta[t]}
                  value={cantidades[t] ?? ""}
                  onChange={(e) => setCantidades({ ...cantidades, [t]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {modo === "justificar" && (
            <>
              <div className="label" style={{ fontSize: 10.5, marginTop: 10 }}>Motivo (obligatorio)</div>
              <input className="pinput" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder={tipoBaja === "falla" ? "Ej. costura torcida, mancha" : "Ej. la maquila no entregó la mitad"} />
            </>
          )}
          <div className="label" style={{ fontSize: 10.5, marginTop: 10 }}>
            {modo === "justificar" ? "Fecha" : "Fecha en que llegó"}
          </div>
          <input className="pinput" type="date" max={hoyEcuador()} value={fecha}
            onChange={(e) => setFecha(e.target.value)} />
          <Pie ocupado={ocupado} onCancelar={() => setModo(null)} onGuardar={registrarEntrega}
            texto={modo === "justificar" ? "Guardar justificación" : "Guardar entrega"} />
        </div>
      )}
    </div>
  );
}

function Pie({ ocupado, onCancelar, onGuardar, texto }: {
  ocupado: boolean; onCancelar: () => void; onGuardar: () => void; texto: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button className="btn" style={BOTON} onClick={onCancelar} disabled={ocupado}>Cancelar</button>
      <button className="btn primary" style={BOTON} onClick={onGuardar} disabled={ocupado}>
        {ocupado ? "Guardando…" : texto}
      </button>
    </div>
  );
}

/** `Tallas` espera las tallas en orden XS→XXL. */
function ordenado(t: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ordenarTallas(Object.keys(t))) out[k] = t[k];
  return out;
}

function faltaFase(msg: string): string {
  return msg.includes("schema cache") || msg.includes("does not exist")
    ? "Falta aplicar la fase 8o en la base (supabase/schema_fase8o_maquila_entregas.sql)."
    : msg;
}

const TARJETA: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 12, padding: 15, marginBottom: 12,
};
const FORM: React.CSSProperties = {
  marginTop: 9, padding: 11, borderRadius: 9,
  background: "var(--surface-2)", border: "1px solid var(--border)",
};
const BOTON: React.CSSProperties = { flex: 1, padding: "11px 8px", fontSize: 14 };
const ROTULO: React.CSSProperties = {
  fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--muted)", margin: "20px 0 9px", fontWeight: 600,
};
