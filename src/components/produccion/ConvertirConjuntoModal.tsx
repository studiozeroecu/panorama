"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal } from "@/components/ui";
import { ordenarTallas, type Corte } from "@/lib/produccion/types";
import { nombreParte } from "@/lib/produccion/conjuntos";

/**
 * Fase 8x: separa en sus dos partes un corte de CONJUNTO que se registró antes
 * de la fase 8r (una sola fila por color). Por cada color se escribe cuántas
 * salieron de la parte superior y de la inferior; arranca con lo mismo en las
 * dos, que es lo normal (un set = una de cada).
 *
 * Todo pasa por fn_convertir_a_conjunto: corte, maquila, entregas, totales y
 * respaldos en una transacción. No se puede si algo del corte ya pasó por Envío.
 */
export default function ConvertirConjuntoModal({ corte, onCerrar }: { corte: Corte; onCerrar: () => void }) {
  const { data, supabase, reload, toast } = useProd();
  const pedido = data.pedidos.find((p) => p.id === corte.pedido_id);
  const prenda = data.prendas.find((x) => x.id === pedido?.prenda_id);
  const tallas = ordenarTallas([...new Set(corte.colores.flatMap((c) => Object.keys(c.tallas)))]);
  const partes = ["superior", "inferior"] as const;

  const [valores, setValores] = useState<Record<string, Record<string, Record<string, string>>>>(() =>
    Object.fromEntries(
      corte.colores.map((c) => [
        c.id,
        Object.fromEntries(partes.map((p) => [p, Object.fromEntries(tallas.map((t) => [t, c.tallas[t] ? String(c.tallas[t]) : ""]))])),
      ])
    )
  );
  const [ocupado, setOcupado] = useState(false);

  const limpias = (t: Record<string, string>) =>
    Object.fromEntries(Object.entries(t).map(([k, v]) => [k, parseInt(v, 10) || 0]).filter(([, n]) => (n as number) > 0));
  const suma = (t: Record<string, string>) => Object.values(t).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  const faltan = corte.colores.some((c) => partes.some((p) => suma(valores[c.id][p]) === 0));

  async function guardar() {
    if (ocupado || faltan) return;
    setOcupado(true);
    const { error } = await supabase.rpc("fn_convertir_a_conjunto", {
      p_corte_id: corte.id,
      p_colores: corte.colores.map((c) => ({
        corte_color_id: c.id,
        superior: limpias(valores[c.id].superior),
        inferior: limpias(valores[c.id].inferior),
      })),
    });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    toast("Corte separado en conjunto: cada color tiene ahora sus dos partes");
    await reload();
    onCerrar();
  }

  const celda = { padding: "5px 6px", textAlign: "center" as const };

  return (
    <Modal titulo="Separar en conjunto" abierto onCerrar={onCerrar} ancho={720}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" disabled={ocupado || faltan} onClick={guardar}>
            {ocupado ? "Guardando…" : "Separar"}
          </button>
        </>
      }>
      <p className="sub" style={{ fontSize: 12.5, marginTop: 0 }}>
        Este corte se registró antes de los conjuntos y cuenta cada color como una sola prenda. Escribe cuántas salieron de
        cada parte. Lo que ya volvió de maquila queda recibido igual, ahora por parte, y aparece así en Envío.
      </p>
      {corte.colores.map((c) => (
        <div key={c.id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {c.color} <span className="sub" style={{ fontWeight: 400 }}>· hoy cuenta {c.unidades}</span>
          </div>
          <div className="table-scroll">
            <table style={{ width: "auto", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...celda, textAlign: "left" }}>Parte</th>
                  {tallas.map((t) => <th key={t} style={celda}>{t}</th>)}
                  <th style={celda}>Total</th>
                </tr>
              </thead>
              <tbody>
                {partes.map((p) => (
                  <tr key={p}>
                    <td style={{ ...celda, textAlign: "left" }}>{nombreParte(prenda, p)}</td>
                    {tallas.map((t) => (
                      <td key={t} style={celda}>
                        <input className="pinput" type="number" min="0" inputMode="numeric"
                          style={{ width: 56, textAlign: "center", padding: "6px 4px" }}
                          value={valores[c.id][p][t] ?? ""}
                          onChange={(e) =>
                            setValores((v) => ({ ...v, [c.id]: { ...v[c.id], [p]: { ...v[c.id][p], [t]: e.target.value } } }))
                          } />
                      </td>
                    ))}
                    <td style={{ ...celda, fontWeight: 600 }} className="num">{suma(valores[c.id][p])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {faltan && <div style={{ fontSize: 12.5, color: "var(--warn)" }}>⚠ Cada color necesita unidades en las dos partes.</div>}
    </Modal>
  );
}
