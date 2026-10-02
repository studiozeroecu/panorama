"use client";

import { useMemo, useState } from "react";
import { Modal, Vacio } from "@/components/ui";
import { useProd } from "./useProduccion";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import type { PedidoTela, Prenda } from "@/lib/produccion/types";
import type { AnchoDocumento } from "@/lib/produccion/corrida";
import {
  anchoDocumento,
  tallasConUnidades,
  tallasDeCorrida,
  totalCorrida,
} from "@/lib/produccion/corrida";

/**
 * Documento de corrida de corte — pieza 1 de `docs/plan_cortadora.md`.
 *
 * Mateo elige una o varias telas ya entregadas, escribe para cada una cuántas
 * unidades de cada talla salen de UNA capa, e imprime el documento para la
 * cortadora.
 *
 * EFÍMERO: no se guarda en Storage ni en la base — misma decisión que la ficha
 * de estampado. Lo que queda es el papel (o el PDF) que se le manda.
 *
 * La impresión es `window.print()` con el bloque `@media print` de globals.css:
 * el navegador ya sabe guardar como PDF y así no entra ninguna dependencia nueva.
 */
/** Un bloque de la hoja: una tela con su corrida ya resuelta. */
export interface BloqueCorrida {
  pedido: PedidoTela;
  prenda: Prenda | undefined;
  ancho: AnchoDocumento;
  filas: { talla: string; unidades: number }[];
  porCapa: number;
}

export default function CorridaCorteModal({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const { data } = useProd();
  const [sel, setSel] = useState<string[]>([]);
  // corridas[pedidoId][talla] = texto del input
  const [corridas, setCorridas] = useState<Record<string, Record<string, string>>>({});
  const [fecha, setFecha] = useState(hoyEcuador());
  const [nota, setNota] = useState("");

  const entregados = useMemo(
    () => data.pedidos.filter((p) => p.estado === "entregado"),
    [data.pedidos]
  );
  const prendaDe = (p: PedidoTela) => data.prendas.find((x) => x.id === p.prenda_id);

  /** Lo que se imprime, en el orden en que se eligieron las telas. */
  const bloques = useMemo(
    () =>
      sel
        .map((id) => entregados.find((p) => p.id === id))
        .filter((p): p is PedidoTela => !!p)
        .map((pedido) => {
          const prenda = prendaDe(pedido);
          const tallas = tallasDeCorrida(prenda);
          const corrida = corridas[pedido.id] ?? {};
          return {
            pedido,
            prenda,
            tallas,
            ancho: anchoDocumento(pedido),
            filas: tallasConUnidades(tallas, corrida),
            porCapa: totalCorrida(corrida),
          };
        }),
    // prendaDe depende de data.prendas, que ya está en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, entregados, corridas, data.prendas]
  );

  const listo = bloques.length > 0 && bloques.every((b) => b.filas.length > 0);

  function alternar(id: string) {
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function ponerCorrida(pedidoId: string, talla: string, valor: string) {
    setCorridas((prev) => ({
      ...prev,
      [pedidoId]: { ...(prev[pedidoId] ?? {}), [talla]: valor },
    }));
  }

  return (
    <Modal
      titulo="Corrida de corte"
      abierto={abierto}
      onCerrar={onCerrar}
      ancho={980}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cerrar</button>
          <button className="btn primary" disabled={!listo} onClick={() => window.print()}>
            Imprimir / Guardar PDF
          </button>
        </>
      }
    >
      {/* Todo lo de arriba es el formulario: no sale impreso. */}
      <div className="no-imprimir">
        {!entregados.length ? (
          <Vacio
            titulo="No hay telas entregadas"
            hint="Una tela aparece aquí cuando se confirma su llegada."
          />
        ) : (
          <>
            <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>
              Telas para este documento
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
              {entregados.map((p) => {
                const prenda = prendaDe(p);
                const marcado = sel.includes(p.id);
                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex", gap: 9, alignItems: "center", cursor: "pointer",
                      padding: "6px 9px", borderRadius: 7, fontSize: 13,
                      background: marcado ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    <input type="checkbox" checked={marcado} onChange={() => alternar(p.id)} />
                    <span>
                      <b>{p.nombre_tela}</b>
                      <span className="sub">
                        {" · "}{prenda?.nombre ?? "sin prenda"}
                        {" · "}{Number(p.total_metros).toFixed(1)} m
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {bloques.map((b) => (
              <div
                key={b.pedido.id}
                style={{
                  borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10,
                }}
              >
                <div className="label" style={{ fontSize: 10.5 }}>
                  Corrida de «{b.pedido.nombre_tela}» — unidades por talla en <b>una capa</b>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {b.tallas.map((t) => (
                    <div key={t} style={{ width: 66 }}>
                      <div className="label" style={{ fontSize: 10, textAlign: "center" }}>{t}</div>
                      <input
                        className="pinput"
                        type="number"
                        min={0}
                        step={1}
                        style={{ textAlign: "center" }}
                        value={corridas[b.pedido.id]?.[t] ?? ""}
                        onChange={(e) => ponerCorrida(b.pedido.id, t, e.target.value)}
                      />
                    </div>
                  ))}
                  <div style={{ alignSelf: "flex-end", paddingBottom: 9, fontSize: 12.5 }}>
                    = <b>{b.porCapa}</b> por capa
                  </div>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ width: 170 }}>
                <div className="label" style={{ fontSize: 10.5 }}>Fecha del documento</div>
                <input
                  className="pinput" type="date" value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="label" style={{ fontSize: 10.5 }}>Nota para la cortadora (opcional)</div>
                <input
                  className="pinput" value={nota} placeholder="Ej.: priorizar las tallas S y M"
                  onChange={(e) => setNota(e.target.value)}
                />
              </div>
            </div>

            <div className="label" style={{ fontSize: 10.5, margin: "18px 0 6px" }}>
              Vista previa — así sale impreso
            </div>
          </>
        )}
      </div>

      {/* Lo único que se imprime. Se ve como papel también en pantalla. */}
      {bloques.length > 0 && <HojaCorrida bloques={bloques} fecha={fecha} nota={nota} />}
    </Modal>
  );
}

/**
 * La hoja, separada del formulario a propósito: es lo único que acaba en manos
 * de la cortadora, así que poder renderizarla sola —con datos de prueba, sin
 * sesión ni base— es lo que permite revisar cómo sale impresa.
 */
export function HojaCorrida({
  bloques,
  fecha,
  nota,
}: {
  bloques: BloqueCorrida[];
  fecha: string;
  nota: string;
}) {
  return (

      <div className="corrida-hoja">
        <div className="hoja-head">
          <h1>CORRIDA DE CORTE</h1>
          <div className="hoja-fecha">{fmtFecha(fecha)}</div>
        </div>

        {bloques.map((b) => (
          <section className="corrida-bloque" key={b.pedido.id}>
            <h2>{b.pedido.nombre_tela}</h2>
            <p className="dato">
              Prenda: <b>{b.prenda?.nombre ?? "— sin prenda asignada —"}</b>
            </p>
            <p className="dato">
              Ancho{" "}
              {b.ancho.cm == null ? (
                <b className="aviso">sin registrar</b>
              ) : (
                <>
                  <b>{b.ancho.cm} cm</b>
                  {!b.ancho.esReal && (
                    <span className="aviso"> — es el ancho del PEDIDO, no se confirmó el real</span>
                  )}
                </>
              )}
            </p>
            <p className="dato">
              Colores:{" "}
              <b>
                {b.pedido.colores?.length
                  ? b.pedido.colores
                      .map((c) => `${c.color} (${Number(c.metros).toFixed(1)} m)`)
                      .join("  ·  ")
                  : "—"}
              </b>
              {"  ·  total "}
              <b>{Number(b.pedido.total_metros).toFixed(1)} m</b>
            </p>

            <table>
              <thead>
                <tr>
                  {b.filas.map((f) => <th key={f.talla}>{f.talla}</th>)}
                  <th>POR CAPA</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {b.filas.map((f) => <td key={f.talla}>{f.unidades}</td>)}
                  <td>{b.porCapa}</td>
                </tr>
              </tbody>
            </table>
            <p className="dato" style={{ marginTop: 7 }}>
              Esta corrida es por <b>una capa</b> y aplica igual a <b>todos los colores</b> de esta tela.
            </p>
          </section>
        ))}

        {nota.trim() && <div className="hoja-nota">{nota.trim()}</div>}
      </div>
  );
}
