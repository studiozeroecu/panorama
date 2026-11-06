"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Vacio } from "@/components/ui";
import { useProd } from "./useProduccion";
import { avanceCorte } from "@/lib/produccion/avanceCorte";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import type { PedidoTela, Prenda } from "@/lib/produccion/types";
import type { AnchoDocumento, AreaEstimada, ColumnaDocumento, FilaRetazo, MesaCorte } from "@/lib/produccion/corrida";
import {
  MESAS_INICIALES,
  anchoDocumento,
  calcularArea,
  columnasDocumento,
  guardarMesas,
  leerMesas,
  tallasConUnidades,
  tallasDeCorrida,
  totalCorrida,
} from "@/lib/produccion/corrida";

/**
 * Documento de corrida de corte — pieza 1 de `docs/plan_cortadora.md`.
 *
 * Mateo elige una o varias telas por cortar, escribe para cada una cuántas
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
  llevaRetazo: boolean;
  /** Solo los ribs con nombre o ancho escritos: lo que se imprime. */
  ribs: { nombre: string; ancho: string }[];
  columnas: ColumnaDocumento[];
  porCapa: number;
  /** Pieza 2: solo si se eligió una mesa para esta tela. Es opcional. */
  mesa?: { nombre: string; largo: number; area: AreaEstimada };
}

export default function CorridaCorteModal({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const { data, supabase, reload, toast } = useProd();
  const [sel, setSel] = useState<string[]>([]);
  // corridas[pedidoId][talla] = texto del input
  const [corridas, setCorridas] = useState<Record<string, Record<string, string>>>({});
  // retazos[pedidoId] = sus filas. Sin clave = esa tela no lleva retazo.
  const [retazos, setRetazos] = useState<Record<string, FilaRetazo[]>>({});
  // ribs[pedidoId] = sus filas. Sin clave = esa tela no lleva rib. Solo van en el papel.
  const [ribs, setRibs] = useState<Record<string, { nombre: string; ancho: string }[]>>({});
  const [fecha, setFecha] = useState(hoyEcuador());
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Pieza 2. Arrancan vacías y se rellenan al montar: leerMesas() toca
  // localStorage, que no existe en el render del servidor.
  const [mesas, setMesas] = useState<MesaCorte[]>(MESAS_INICIALES);
  // mesaDe[pedidoId] = índice de mesa, o "" si no se eligió ninguna.
  const [mesaDe, setMesaDe] = useState<Record<string, string>>({});

  useEffect(() => setMesas(leerMesas()), []);

  function ponerLargo(i: number, largo: string) {
    setMesas((prev) => {
      const siguiente = prev.map((m, j) => (j === i ? { ...m, largo } : m));
      guardarMesas(siguiente);
      return siguiente;
    });
  }

  // Mismo criterio que la lista "Por cortar" de CorteTab: lo ya cortado no se imprime.
  const porCortar = useMemo(
    () =>
      data.pedidos.filter(
        (p) =>
          p.estado === "entregado" &&
          !avanceCorte(p.total_metros, p.colores ?? [], data.cortes.filter((c) => c.pedido_id === p.id)).listo
      ),
    [data.pedidos, data.cortes]
  );
  const prendaDe = (p: PedidoTela) => data.prendas.find((x) => x.id === p.prenda_id);

  /** Lo que se imprime, en el orden en que se eligieron las telas. */
  const bloques = useMemo(
    () =>
      sel
        .map((id) => porCortar.find((p) => p.id === id))
        .filter((p): p is PedidoTela => !!p)
        .map((pedido) => {
          const prenda = prendaDe(pedido);
          const tallas = tallasDeCorrida(prenda);
          const corrida = corridas[pedido.id] ?? {};
          const ancho = anchoDocumento(pedido);
          const iMesa = mesaDe[pedido.id];
          const mesa = iMesa !== undefined && iMesa !== "" ? mesas[Number(iMesa)] : undefined;
          const largo = parseFloat(mesa?.largo ?? "");
          return {
            pedido,
            prenda,
            tallas,
            ancho,
            filas: tallasConUnidades(tallas, corrida),
            llevaRetazo: !!retazos[pedido.id],
            ribs: (ribs[pedido.id] ?? [])
              .map((r) => ({ nombre: r.nombre.trim(), ancho: r.ancho.trim() }))
              .filter((r) => r.nombre || r.ancho),
            columnas: columnasDocumento(tallasConUnidades(tallas, corrida), retazos[pedido.id] ?? []),
            porCapa: totalCorrida(corrida),
            mesa: mesa && largo > 0
              ? {
                  nombre: mesa.nombre,
                  largo,
                  area: calcularArea(largo, ancho.cm, Number(pedido.total_metros)),
                }
              : undefined,
          };
        }),
    // prendaDe depende de data.prendas, que ya está en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, porCortar, corridas, retazos, ribs, data.prendas, mesas, mesaDe]
  );

  const listo = bloques.length > 0 && bloques.every((b) => b.filas.length > 0);

  /**
   * Fase 8j: al marcar una tela se precarga su corrida guardada, si la tiene.
   * Así editar el plan es abrir y corregir, no volver a teclearlo entero.
   */
  function alternar(id: string) {
    setSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const pedido = porCortar.find((p) => p.id === id);
      const guardada = pedido?.corrida_base;
      if (guardada && !corridas[id]) {
        setCorridas((c) => ({
          ...c,
          [id]: Object.fromEntries(Object.entries(guardada).map(([t, n]) => [t, String(n)])),
        }));
      }
      return [...prev, id];
    });
  }

  /**
   * Guarda la corrida en `prod_pedidos_tela.corrida_base` — el PLAN que leerá la
   * cortadora. No se guarda al imprimir: el documento es efímero y el plan no,
   * así que son dos actos distintos y conviene que se vean distintos.
   *
   * Las tallas en cero no se guardan: el mapa dice lo que SÍ se corta.
   */
  async function guardarCorridas() {
    setGuardando(true);
    try {
      for (const b of bloques) {
        const base = Object.fromEntries(b.filas.map((f) => [f.talla, f.unidades]));
        const { error } = await supabase
          .from("prod_pedidos_tela")
          .update({ corrida_base: base })
          .eq("id", b.pedido.id);
        if (error) throw new Error(error.message);
      }
      toast(
        bloques.length === 1
          ? "Corrida guardada para la cortadora"
          : `${bloques.length} corridas guardadas para la cortadora`
      );
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setGuardando(false);
    }
  }

  function alternarRetazo(pedidoId: string) {
    setRetazos((prev) => {
      if (!prev[pedidoId]) return { ...prev, [pedidoId]: [{ talla: "", nueva: false, unidades: "" }] };
      const { [pedidoId]: _, ...resto } = prev;
      return resto;
    });
  }

  function ponerRetazo(pedidoId: string, i: number, cambio: Partial<FilaRetazo>) {
    setRetazos((prev) => ({
      ...prev,
      [pedidoId]: prev[pedidoId].map((r, j) => (j === i ? { ...r, ...cambio } : r)),
    }));
  }

  function alternarRib(pedidoId: string) {
    setRibs((prev) => {
      if (!prev[pedidoId]) return { ...prev, [pedidoId]: [{ nombre: "", ancho: "" }] };
      const { [pedidoId]: _, ...resto } = prev;
      return resto;
    });
  }

  function ponerRib(pedidoId: string, i: number, cambio: { nombre?: string; ancho?: string }) {
    setRibs((prev) => ({
      ...prev,
      [pedidoId]: prev[pedidoId].map((r, j) => (j === i ? { ...r, ...cambio } : r)),
    }));
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
          <button className="btn" disabled={!listo || guardando} onClick={guardarCorridas}>
            {guardando ? "Guardando…" : "Guardar para la cortadora"}
          </button>
          <button className="btn primary" disabled={!listo} onClick={() => window.print()}>
            Imprimir / Guardar PDF
          </button>
        </>
      }
    >
      {/* Todo lo de arriba es el formulario: no sale impreso. */}
      <div className="no-imprimir">
        {!porCortar.length ? (
          <Vacio
            titulo="No hay telas por cortar"
            hint="Una tela aparece aquí cuando se confirma su llegada."
          />
        ) : (
          <>
            <div
              style={{
                border: "1px solid var(--border)", borderRadius: 9,
                padding: "9px 12px", marginBottom: 14,
                display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
                Largo de las mesas de corte
              </div>
              {mesas.map((m, i) => (
                <div key={m.nombre} style={{ width: 118 }}>
                  <div className="label" style={{ fontSize: 10 }}>{m.nombre} (m)</div>
                  <input
                    className="pinput" type="number" min={0} step={0.1} placeholder="Ej: 4.5"
                    value={m.largo} onChange={(e) => ponerLargo(i, e.target.value)}
                  />
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: "var(--muted)", flex: 1, minWidth: 190 }}>
                Se recuerdan en este navegador. Mídelas una vez.
              </div>
            </div>

            <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>
              Telas para este documento
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
              {porCortar.map((p) => {
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

                {/* Sin marcar, el documento no lleva la fila de retazo. */}
                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={b.llevaRetazo} onChange={() => alternarRetazo(b.pedido.id)} />
                  Lleva retazo
                </label>
                {(retazos[b.pedido.id] ?? []).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                    <select
                      className="pinput"
                      style={{ width: 140 }}
                      value={r.nueva ? "__nueva__" : r.talla}
                      onChange={(e) =>
                        ponerRetazo(b.pedido.id, i, e.target.value === "__nueva__"
                          ? { nueva: true, talla: "" }
                          : { nueva: false, talla: e.target.value })
                      }
                    >
                      <option value="">— Talla —</option>
                      {b.tallas.map((t) => <option key={t} value={t}>{t}</option>)}
                      <option value="__nueva__">+ Talla nueva…</option>
                    </select>
                    {r.nueva && (
                      <input
                        className="pinput" style={{ width: 90 }} placeholder="Ej: XXXL" value={r.talla}
                        onChange={(e) => ponerRetazo(b.pedido.id, i, { talla: e.target.value })}
                      />
                    )}
                    <input
                      className="pinput" type="number" min={0} step={1} style={{ width: 90, textAlign: "center" }}
                      placeholder="Cantidad" value={r.unidades}
                      onChange={(e) => ponerRetazo(b.pedido.id, i, { unidades: e.target.value })}
                    />
                    <button
                      className="btn" style={{ padding: "4px 10px" }}
                      onClick={() =>
                        setRetazos((prev) => ({
                          ...prev,
                          [b.pedido.id]: prev[b.pedido.id].filter((_, j) => j !== i),
                        }))
                      }
                    >✕</button>
                  </div>
                ))}
                {b.llevaRetazo && (
                  <button
                    className="btn" style={{ fontSize: 12, padding: "4px 10px", marginTop: 6 }}
                    onClick={() =>
                      setRetazos((prev) => ({
                        ...prev,
                        [b.pedido.id]: [...prev[b.pedido.id], { talla: "", nueva: false, unidades: "" }],
                      }))
                    }
                  >+ Otra talla</button>
                )}

                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!ribs[b.pedido.id]} onChange={() => alternarRib(b.pedido.id)} />
                  Lleva rib
                </label>
                {(ribs[b.pedido.id] ?? []).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                    <input
                      className="pinput" style={{ width: 200 }} placeholder="Nombre del rib" value={r.nombre}
                      onChange={(e) => ponerRib(b.pedido.id, i, { nombre: e.target.value })}
                    />
                    <input
                      className="pinput" type="number" min={0} step="0.1" style={{ width: 110, textAlign: "center" }}
                      placeholder="Ancho (cm)" value={r.ancho}
                      onChange={(e) => ponerRib(b.pedido.id, i, { ancho: e.target.value })}
                    />
                    <button
                      className="btn" style={{ padding: "4px 10px" }}
                      onClick={() =>
                        setRibs((prev) => ({
                          ...prev,
                          [b.pedido.id]: prev[b.pedido.id].filter((_, j) => j !== i),
                        }))
                      }
                    >✕</button>
                  </div>
                ))}
                {ribs[b.pedido.id] && (
                  <button
                    className="btn" style={{ fontSize: 12, padding: "4px 10px", marginTop: 6 }}
                    onClick={() =>
                      setRibs((prev) => ({
                        ...prev,
                        [b.pedido.id]: [...prev[b.pedido.id], { nombre: "", ancho: "" }],
                      }))
                    }
                  >+ Otro rib</button>
                )}

                {/* Pieza 2 · área estimada. Opcional: sin mesa elegida no pasa nada. */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <select
                    className="pinput"
                    style={{ width: 150 }}
                    value={mesaDe[b.pedido.id] ?? ""}
                    onChange={(e) =>
                      setMesaDe((prev) => ({ ...prev, [b.pedido.id]: e.target.value }))
                    }
                  >
                    <option value="">— Sin calcular área —</option>
                    {mesas.map((m, i) => (
                      <option key={m.nombre} value={String(i)} disabled={!(parseFloat(m.largo) > 0)}>
                        {m.nombre}
                        {parseFloat(m.largo) > 0 ? ` · ${m.largo} m` : " · sin largo"}
                      </option>
                    ))}
                  </select>

                  {b.mesa && (
                    <div style={{ fontSize: 12.5 }}>
                      {b.mesa.area.anchoSospechoso ? (
                        <span style={{ color: "var(--warn)" }}>
                          El ancho de esta tela ({b.ancho.cm}) parece estar en metros y no en
                          centímetros — revísalo antes de fiarte del área.
                        </span>
                      ) : b.mesa.area.m2 == null ? (
                        <span className="sub">Falta el ancho de la tela para calcular el área.</span>
                      ) : (
                        <span style={{ color: "var(--accent)" }}>
                          ≈ <b>{b.mesa.area.m2.toFixed(2)} m²</b> por tendida
                          {b.mesa.area.tendidas != null && (
                            <> · la tela daría ≈ <b>{b.mesa.area.tendidas.toFixed(1)}</b> tendidas</>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {b.mesa?.area.m2 != null && (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                    Aproximado: el patronaje real ajusta las piezas y puede rendir distinto.
                  </div>
                )}
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
            {b.mesa && b.mesa.area.m2 != null && (
              <p className="dato">
                Mesa: <b>{b.mesa.nombre} ({b.mesa.largo} m)</b>
                {" · área por tendida "}
                <b>≈ {b.mesa.area.m2.toFixed(2)} m²</b>
                {b.mesa.area.tendidas != null && (
                  <> · ≈ <b>{b.mesa.area.tendidas.toFixed(1)}</b> tendidas de tela</>
                )}
                <span className="aviso"> — aproximado, el patronaje puede rendir distinto</span>
              </p>
            )}
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

            <p className="capas">
              Esta corrida es por <b>una capa</b> y aplica igual a <b>todos los colores</b> de esta tela.
            </p>
            <table>
              <thead>
                <tr>
                  <th></th>
                  {b.columnas.map((c) => <th key={c.talla}>{c.talla}</th>)}
                  <th>POR CAPA</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontSize: 13 }}>Corrida</td>
                  {b.columnas.map((c) => <td key={c.talla}>{c.corrida || "—"}</td>)}
                  <td>{b.porCapa}</td>
                </tr>
                {/* ✓ = esa talla lleva retazo, sin cantidad: la cortadora la anota a mano. */}
                {b.llevaRetazo && (
                  <tr>
                    <td style={{ fontSize: 13 }}>Retazo</td>
                    {b.columnas.map((c) => <td key={c.talla}>{c.retazo == null ? "" : c.retazo || "✓"}</td>)}
                    <td>{b.columnas.reduce((s, c) => s + (c.retazo ?? 0), 0) || ""}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {b.ribs.map((r, i) => (
              <p className="dato" key={i} style={{ marginTop: i ? 2 : 7 }}>
                Rib: <b>{r.nombre || "—"}</b>
                {r.ancho && <> · ancho <b>{r.ancho} cm</b></>}
              </p>
            ))}
          </section>
        ))}

        {nota.trim() && <div className="hoja-nota">Observaciones: {nota.trim()}</div>}
      </div>
  );
}
