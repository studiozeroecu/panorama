"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal } from "@/components/ui";
import { ordenarTallas, type Corte } from "@/lib/produccion/types";
import { entregadoPorTalla } from "@/lib/produccion/entregas";

/**
 * Corregir las cantidades de un corte ya registrado — fase 8q. Solo admin.
 *
 * Todo pasa por fn_corregir_corte, que actualiza en una transacción los cinco
 * sitios donde viven las cantidades y reajusta el estado del lote en maquila.
 *
 * Cada talla tiene un MÍNIMO: lo que la maquila ya entregó o se justificó. Esas
 * prendas existen; la base rechaza bajar por debajo, y aquí se enseña antes.
 * Se pueden agregar tallas a un color, pero no colores nuevos.
 */
export default function CorregirCorteModal({
  corte,
  onCerrar,
}: {
  corte: Corte;
  onCerrar: () => void;
}) {
  const { data, supabase, reload, toast } = useProd();
  const pedido = data.pedidos.find((p) => p.id === corte.pedido_id);
  const prenda = data.prendas.find((x) => x.id === pedido?.prenda_id);
  const maquila = data.maquilas.find((m) => m.corte_id === corte.id);

  // Columnas: las tallas de la prenda más cualquiera que ya tenga el corte.
  const tallas = ordenarTallas([
    ...new Set([
      ...(prenda?.tallas?.length ? prenda.tallas : ["XS", "S", "M", "L", "XL", "XXL"]),
      ...corte.colores.flatMap((c) => Object.keys(c.tallas)),
    ]),
  ]);

  const [valores, setValores] = useState<Record<string, Record<string, string>>>(() => {
    const v: Record<string, Record<string, string>> = {};
    for (const c of corte.colores) {
      v[c.id] = {};
      for (const t of tallas) v[c.id][t] = c.tallas[t] ? String(c.tallas[t]) : "";
    }
    return v;
  });
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Lo ya entregado o justificado de un color de corte, por talla: el mínimo. */
  const minimos = (corteColorId: string) =>
    entregadoPorTalla(maquila?.colores.find((mc) => mc.corte_color_id === corteColorId)?.entregas ?? []);

  const totalDe = (id: string) =>
    Object.values(valores[id] ?? {}).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  const total = corte.colores.reduce((s, c) => s + totalDe(c.id), 0);

  async function guardar() {
    setErr(null);
    const payload = [];
    for (const c of corte.colores) {
      const min = minimos(c.id);
      const t: Record<string, number> = {};
      for (const talla of tallas) {
        const texto = (valores[c.id]?.[talla] ?? "").trim();
        const n = texto === "" ? 0 : Number(texto);
        if (!Number.isInteger(n) || n < 0) return setErr(`${c.color}, talla ${talla}: pon un número entero.`);
        if (n < (min[talla] ?? 0))
          return setErr(`${c.color}, talla ${talla}: no puede quedar en ${n}, la maquila ya entregó ${min[talla]}.`);
        if (n > 0) t[talla] = n;
      }
      payload.push({ corte_color_id: c.id, tallas: t });
    }
    if (total <= 0) return setErr("El corte no puede quedar sin unidades.");

    setOcupado(true);
    const { error } = await supabase.rpc("fn_corregir_corte", { p_corte_id: corte.id, p_colores: payload });
    setOcupado(false);
    if (error) {
      return setErr(
        error.message.includes("fn_corregir_corte") || error.message.includes("schema cache")
          ? "Falta aplicar la fase 8q en la base (supabase/schema_fase8q_corregir_corte.sql)."
          : error.message
      );
    }
    toast(`Corte corregido · ${total} unidades`);
    onCerrar();
    await reload();
  }

  return (
    <Modal
      titulo={`Corregir cantidades — ${pedido?.nombre_tela ?? "corte"}`}
      abierto
      onCerrar={onCerrar}
      ancho={760}
      pie={
        <>
          <span className="sub" style={{ marginRight: "auto", fontSize: 13 }}>
            Total: <b>{total}</b> unidades (antes {corte.total_unidades})
          </span>
          <button className="btn" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={ocupado}>
            {ocupado ? "Guardando…" : "Guardar corrección"}
          </button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      <p className="sub" style={{ marginTop: 0, fontSize: 12.5 }}>
        Corrige lo que salió de verdad en cada talla. Si la maquila ya entregó prendas de una talla,
        no puede quedar por debajo de eso (sale en gris debajo). Si subes una talla de un color que ya
        estaba entregado completo, vuelve a quedar pendiente en Maquila.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Color</th>
              {tallas.map((t) => <th key={t} style={{ textAlign: "center" }}>{t}</th>)}
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {corte.colores.map((c) => {
              const min = minimos(c.id);
              return (
                <tr key={c.id}>
                  <td><b>{c.color}</b></td>
                  {tallas.map((t) => (
                    <td key={t} style={{ textAlign: "center" }}>
                      <input
                        className="pinput" type="number" min={min[t] ?? 0} step={1}
                        style={{ width: 58, textAlign: "center" }}
                        value={valores[c.id]?.[t] ?? ""}
                        onChange={(e) =>
                          setValores((v) => ({ ...v, [c.id]: { ...v[c.id], [t]: e.target.value } }))
                        }
                      />
                      {(min[t] ?? 0) > 0 && (
                        <div className="sub" style={{ fontSize: 10.5 }}>mín. {min[t]}</div>
                      )}
                    </td>
                  ))}
                  <td className="num" style={{ textAlign: "right" }}>
                    {totalDe(c.id)}
                    <div className="sub" style={{ fontSize: 10.5 }}>antes {c.unidades}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
