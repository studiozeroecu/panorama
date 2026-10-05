"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { money, type Corte } from "@/lib/produccion/types";
import { costoCorte } from "@/lib/produccion/costoCorte";

/**
 * Costo de producción de un corte — fase 8p. Solo admin (vive en CorteTab).
 *
 * Suma tela + maquila + horas de corte + insumos + estampado y lo divide entre
 * las prendas buenas. Las reglas están en src/lib/produccion/costoCorte.ts.
 *
 * Aquí también se pone el COSTO de cada insumo: la cortadora anota qué y cuánto
 * se usó, pero el precio lo pone Mateo (la base lo impide para cualquier otro).
 */
export default function CostoCorteCard({ corte }: { corte: Corte }) {
  const { data, supabase, reload, toast } = useProd();
  const [abierto, setAbierto] = useState(false);

  const pedido = data.pedidos.find((p) => p.id === corte.pedido_id);
  const maquila = data.maquilas.find((m) => m.corte_id === corte.id);
  if (!pedido) return null;

  const cortesDelPedido = data.cortes.filter((c) => c.pedido_id === pedido.id);
  const estampado = maquila
    ? data.lotesEstampado
        .filter((l) => l.maquila_id === maquila.id)
        .reduce((s, l) => s + Number(l.costo_total), 0)
    : 0;

  const c = costoCorte({
    corte,
    pedido,
    cortesDelPedido,
    costoMaquilaUnitario: maquila ? Number(maquila.costo_unitario) : 0,
    coloresMaquila: (maquila?.colores ?? []).map((col) => ({
      unidades: col.unidades,
      entregas: col.entregas,
    })),
    jornadas: corte.jornadas,
    insumos: corte.insumos,
    estampado,
  });

  const maquiladora = maquila
    ? data.maquiladoras.find((x) => x.id === maquila.maquiladora_id)?.nombre
    : undefined;
  const bajas = (maquila?.colores ?? []).flatMap((col) =>
    col.entregas.filter((e) => e.tipo !== "entrega").map((e) => ({ ...e, color: col.color }))
  );

  async function guardarCostoInsumo(id: string, texto: string) {
    const limpio = texto.trim().replace(",", ".");
    const costo = limpio === "" ? null : Number(limpio);
    if (costo != null && (!Number.isFinite(costo) || costo < 0))
      return toast("El costo tiene que ser un número (o vacío).", "error");
    const { error } = await supabase.from("prod_corte_insumos").update({ costo }).eq("id", id);
    if (error) return toast(error.message, "error");
    toast("Costo del insumo guardado");
    await reload();
  }

  return (
    <div style={{ marginTop: 6 }}>
      {/* Resumen en una línea: lo que más se mira. */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
        <span>
          Maquila a pagar: <b>{money(c.maquila.aPagar)}</b>
          <span className="sub"> ({c.maquila.buenas} buenas × {money(c.maquila.costoUnitario)})</span>
        </span>
        <span>
          Costo total: <b>{money(c.total)}</b>
        </span>
        <span>
          Costo unitario: <b style={{ color: "var(--accent)" }}>{c.costoUnitario != null ? money(c.costoUnitario) : "—"}</b>
          <span className="sub"> ({c.unidades} prendas)</span>
        </span>
        <button className="btn" style={{ padding: "2px 9px", fontSize: 11.5 }} onClick={() => setAbierto(!abierto)}>
          {abierto ? "Ocultar detalle" : "Ver detalle"}
        </button>
      </div>

      {abierto && (
        <div className="card" style={{ padding: 12, marginTop: 8, fontSize: 12.5 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 18px", width: "fit-content" }}>
            <span>Tela{c.tela.estimado && <span className="sub"> (estimado: sin metros anotados, repartido por prendas)</span>}</span>
            <span className="num">{money(c.tela.valor)}</span>

            <span>
              Maquila{maquiladora ? ` · ${maquiladora}` : ""}
              <span className="sub">
                {" "}· {money(c.maquila.costoUnitario)} c/u
                {c.maquila.pendientes > 0 && ` · incluye ${c.maquila.pendientes} que aún no entrega`}
              </span>
            </span>
            <span className="num">{money(c.maquila.esperado)}</span>

            <span>Corte (cortadora){c.corte.horas > 0 && <span className="sub"> · {c.corte.horas} h</span>}</span>
            <span className="num">{money(c.corte.valor)}</span>

            <span>
              Insumos
              {c.insumos.sinCosto > 0 && (
                <span style={{ color: "var(--warn)" }}> · {c.insumos.sinCosto} sin costo (pónselo abajo)</span>
              )}
            </span>
            <span className="num">{money(c.insumos.valor)}</span>

            <span>Estampado</span>
            <span className="num">{money(c.estampado)}</span>

            <b>Total producción</b>
            <b className="num">{money(c.total)}</b>
            <b>Costo por prenda buena</b>
            <b className="num" style={{ color: "var(--accent)" }}>
              {c.costoUnitario != null ? money(c.costoUnitario) : "—"}
            </b>
          </div>

          {c.maquila.pendientes > 0 && (
            <p className="sub" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
              Mientras el lote siga en maquila, lo que falta se cuenta como si llegara bien. Hoy se le
              debe {money(c.maquila.aPagar)} (solo lo entregado).
            </p>
          )}

          {bajas.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="label" style={{ fontSize: 10.5 }}>Bajas justificadas (no se pagan)</div>
              {bajas.map((b) => (
                <div key={b.id} style={{ marginTop: 3 }}>
                  {b.color}: <b>{b.unidades}</b> {b.tipo === "falla" ? "con fallas" : "no entregadas"}
                  <span className="sub"> — {b.motivo}</span>
                </div>
              ))}
            </div>
          )}

          {corte.insumos.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="label" style={{ fontSize: 10.5 }}>Insumos · costo total de cada línea ($)</div>
              {corte.insumos.map((i) => (
                <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span style={{ minWidth: 160 }}>{i.descripcion}: {i.cantidad}</span>
                  <input
                    className="pinput" style={{ width: 100 }} type="number" min="0" step="0.01"
                    placeholder="sin costo" defaultValue={i.costo ?? ""}
                    // Se guarda al salir del campo: son pocos y se ponen de uno en uno.
                    onBlur={(e) => {
                      const actual = i.costo == null ? "" : String(i.costo);
                      if (e.target.value.trim() !== actual) guardarCostoInsumo(i.id, e.target.value);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
