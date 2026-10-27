"use client";

import { useState, useEffect } from "react";
import { useProd } from "./useProduccion";
import NombreTela from "./ResumenTela";
import { Campo, Fila, Badge, Vacio } from "@/components/ui";
import {
  money,
  ordenarTallas,
  type Corte,
  type Maquila,
  type ColorMaquila,
  type EntregaMaquila,
  type PedidoTela,
  type Prenda,
} from "@/lib/produccion/types";
import { fmtFecha, diasHasta, hoyEcuador } from "@/lib/fechas";
import { etiquetaFila } from "@/lib/produccion/conjuntos";
import { LOCALES, type Guia } from "@/lib/locales";
import {
  COSTO_ESTAMPADO_DEFECTO,
  COSTO_OPERATIVO,
  DESTINOS,
  basicosDestino,
  cantidad,
  completarGrupoConBodega,
  costoSalida,
  faltaPorTalla,
  formDeEntrega,
  grupoVacio,
  problemasReparto,
  repartoParaBase,
  sumaTallas,
  tallasDestino,
  tallasEstampado,
  type DestinoEnvio,
  type EstampadoGrupo,
  type GrupoForm,
} from "@/lib/produccion/reparto";
import { costoProduccionUnitario } from "./costoDeCorte";

/**
 * Envío se arma POR PRODUCCIÓN (decisión del dueño, 2026-10-27): una tarjeta
 * por corte, con los colores en filas y las tallas en columnas, y una tabla
 * igual para cada destino. Antes era una tarjeta por color y un corte de ocho
 * colores eran ocho formularios.
 *
 * Cada fila sigue siendo UNA entrega de maquila (fase 8o: un color puede
 * volver en partes) y en la base se procesa por separado.
 */
interface FilaEnvio {
  col: ColorMaquila;
  entrega: EntregaMaquila;
  etiqueta: string;
  /** Costo completo de producción por prenda (sin estampado ni operativo). null = no se pudo calcular. */
  produccion: number | null;
}

interface Grupo {
  maquila: Maquila;
  corte: Corte | undefined;
  pedido: PedidoTela | null | undefined;
  prenda: Prenda | null | undefined;
  filas: FilaEnvio[];
}

export default function EnvioTab() {
  const { data } = useProd();

  const grupos: Grupo[] = [];
  for (const m of data.maquilas) {
    const corte = data.cortes.find((c) => c.id === m.corte_id);
    const pedido = corte ? data.pedidos.find((p) => p.id === corte.pedido_id) : null;
    const prenda = pedido ? data.prendas.find((x) => x.id === pedido.prenda_id) : null;
    const filas: FilaEnvio[] = [];
    for (const col of m.colores) {
      const pendientes = col.entregas.filter((e) => !e.procesado);
      for (const entrega of pendientes) {
        filas.push({
          col,
          entrega,
          // Si un color tiene dos entregas pendientes, la fecha las distingue.
          etiqueta: etiquetaFila(col.color, col.parte, prenda) + (pendientes.length > 1 ? ` · ${fmtFecha(entrega.fecha)}` : ""),
          produccion: corte ? costoProduccionUnitario(data, corte, col.parte) : null,
        });
      }
    }
    if (filas.length) grupos.push({ maquila: m, corte, pedido, prenda, filas });
  }

  return (
    <section>
      <div className="section-head">
        <h2>Envío <span className="sub" style={{ fontWeight: 400 }}>· reparte cada producción, color por color y talla por talla, entre bodega, locales y feria</span></h2>
      </div>

      {!grupos.length ? (
        <Vacio titulo="Sin entregas por procesar" hint="Aparecen aquí cuando un color vuelve de maquila, entero o en partes." />
      ) : (
        grupos.map((g) => <ProduccionCard key={g.maquila.id} grupo={g} />)
      )}

      <Historial />
      <GuiasLogistica />
    </section>
  );
}

function ProduccionCard({ grupo }: { grupo: Grupo }) {
  const { data, supabase, reload, toast } = useProd();
  const { pedido, prenda, filas } = grupo;
  const tallas = ordenarTallas([
    ...new Set(filas.flatMap((f) => Object.keys(f.entrega.tallas ?? {}).filter((t) => (f.entrega.tallas[t] ?? 0) > 0))),
  ]);
  const llegadas: Record<string, Record<string, number>> = Object.fromEntries(
    filas.map((f) => [f.entrega.id, f.entrega.tallas ?? {}])
  );
  const totalLlego = filas.reduce((s, f) => s + Number(f.entrega.unidades), 0);
  const parcial = filas.some((f) => f.col.estado !== "entregado" || f.col.entregas.length > 1);

  // Arranca como antes —todo a la bodega— y cada destino que se marca se
  // lleva su parte.
  const [g, setG] = useState<GrupoForm>(() => {
    const x = grupoVacio(["bodega"]);
    x.tallas.bodega = Object.fromEntries(
      filas.map((f) => [f.entrega.id, Object.fromEntries(Object.entries(f.entrega.tallas ?? {}).map(([t, n]) => [t, String(n)]))])
    );
    return x;
  });
  const [costoEstampado, setCostoEstampado] = useState(String(COSTO_ESTAMPADO_DEFECTO));
  const [productoCodigo, setProductoCodigo] = useState("");
  const [localDestino, setLocalDestino] = useState("");
  const [feriaId, setFeriaId] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const costoEst = parseFloat(costoEstampado) || 0;
  const precioLocal = prenda ? Number(prenda.precio_venta_local) : 0;
  const activo = (d: DestinoEnvio) => g.activos.includes(d);
  const hayEstampados = g.activos.some((d) => g.estampados[d].length > 0);

  // Las reglas son las de una entrega; aquí se aplican fila por fila y se
  // dice de qué color es cada aviso.
  const problemas: string[] = [];
  if (!g.activos.length) problemas.push("Marca al menos un destino.");
  else {
    for (const f of filas) {
      for (const p of problemasReparto(llegadas[f.entrega.id], formDeEntrega(g, f.entrega.id))) {
        // "X está marcado pero no tiene unidades" vale para el destino entero, no por color.
        if (!p.includes("está marcado")) problemas.push(`${f.etiqueta} — ${p}`);
      }
    }
    for (const { id, etiqueta } of DESTINOS) {
      if (activo(id) && filas.every((f) => sumaTallas(tallasDestino(formDeEntrega(g, f.entrega.id), id)) === 0)) {
        problemas.push(`${etiqueta} está marcado pero no tiene unidades.`);
      }
    }
  }
  if (activo("feria") && !feriaId) problemas.push("Elige a qué feria va la mercadería.");

  const alternar = (d: DestinoEnvio) =>
    setG((x) => ({
      ...x,
      activos: DESTINOS.map((y) => y.id).filter((y) => (y === d ? !x.activos.includes(d) : x.activos.includes(y))),
    }));

  /**
   * Una llamada a fn_repartir_entrega_maquila POR FILA, una detrás de otra.
   * Cada una es atómica e idempotente: si una falla a mitad, las anteriores
   * quedan hechas (y desaparecen de la lista al recargar) y la que falló, con
   * las siguientes, siguen pendientes tal como estaban.
   */
  async function procesar() {
    if (problemas.length) return;
    setOcupado(true);
    const hechas: string[] = [];
    try {
      for (const f of filas) {
        const r = repartoParaBase(formDeEntrega(g, f.entrega.id));
        if (!Object.keys(r).length) continue;
        const { error } = await supabase.rpc("fn_repartir_entrega_maquila", {
          p_entrega_id: f.entrega.id,
          p_reparto: {
            costo_produccion: f.produccion ?? 0,
            costo_estampado: costoEst,
            bodega: r.bodega ?? null,
            local: r.local
              ? { ...r.local, local_destino: localDestino || null, producto_codigo: productoCodigo.trim() || null, precio: precioLocal }
              : null,
            feria: r.feria ? { ...r.feria, feria_id: feriaId } : null,
          },
        });
        if (error) throw new Error(`${f.etiqueta}: ${error.message}`);
        hechas.push(f.etiqueta);
      }
      toast(`Producción procesada · ${hechas.length} ${hechas.length === 1 ? "color" : "colores"}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(hechas.length ? `Se procesaron ${hechas.length} de ${filas.length}. Falló ${msg}` : msg, "error");
    } finally {
      setOcupado(false);
      await reload();
    }
  }

  return (
    <div className="prod-card">
      <h4>
        <NombreTela pedido={pedido ?? null} />
        {prenda && <span className="sub" style={{ fontWeight: 400 }}> · {prenda.nombre}</span>}
        {parcial && <> <Badge color="ambar">Entrega parcial</Badge></>}
      </h4>
      <div className="prod-meta">
        {totalLlego} unidades · {filas.length} {filas.length === 1 ? "color" : "colores"} por repartir
      </div>
      {pedido?.destino_indicado && (
        <div className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
          👉 Indicación al pedir la tela: <b>{pedido.destino_indicado === "locales" ? "directo a locales" : "bodega de estampados"}</b>
        </div>
      )}

      {/* Lo que llegó, y lo que falta repartir en cada casilla */}
      <div className="table-scroll" style={{ margin: "12px 0" }}>
        <table style={{ width: "auto", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...CELDA, textAlign: "left" }}>Llegó</th>
              {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
              <th style={CELDA}>Total</th>
              <th style={CELDA}>Producción c/u</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const falta = faltaPorTalla(llegadas[f.entrega.id], formDeEntrega(g, f.entrega.id));
              return (
                <tr key={f.entrega.id}>
                  <td style={{ ...CELDA, textAlign: "left", fontWeight: 600 }}>{f.etiqueta}</td>
                  {tallas.map((t) => {
                    const n = f.entrega.tallas[t] ?? 0;
                    const x = falta[t] ?? 0;
                    return (
                      <td key={t} style={CELDA}>
                        <div className="num">{n || "—"}</div>
                        {x !== 0 && (
                          <div style={{ fontSize: 10.5, color: "var(--bad)" }}>{x > 0 ? `faltan ${x}` : `+${-x} de más`}</div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ ...CELDA, fontWeight: 600 }} className="num">{f.entrega.unidades}</td>
                  <td style={CELDA} className="num">
                    {f.produccion != null ? money(f.produccion) : <span style={{ color: "var(--warn)" }}>sin calcular</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ margin: "4px 0 10px" }}>
        <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Destinos · marca uno o varios</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {DESTINOS.map(({ id, etiqueta }) => (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={activo(id)} onChange={() => alternar(id)} style={{ accentColor: "var(--accent)" }} />
              {etiqueta}
            </label>
          ))}
          {activo("bodega") && g.activos.length > 1 && (
            <button className="btn" style={{ fontSize: 12 }}
              onClick={() => setG((x) => ({ ...x, tallas: { ...x.tallas, bodega: completarGrupoConBodega(llegadas, x) } }))}>
              Lo que sobra → bodega
            </button>
          )}
        </div>
      </div>

      {DESTINOS.filter((d) => activo(d.id)).map(({ id }) => (
        <DestinoGrupo key={id} destino={id} g={g} setG={setG} filas={filas} tallas={tallas}
          costoEstampado={costoEst} precioLocal={precioLocal}>
          {id === "local" && (
            <Fila>
              <Campo label="Local destino (para cruzar con las guías de logística)">
                <select className="pinput" value={localDestino} onChange={(e) => setLocalDestino(e.target.value)}>
                  <option value="">— Sin especificar —</option>
                  {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Campo>
              <Campo label="Producto VATEX (opcional — para cruzar con ventas)">
                <input className="pinput" list="productos-vatex" placeholder="Código, ej: MS0164I"
                  value={productoCodigo} onChange={(e) => setProductoCodigo(e.target.value)} />
                <datalist id="productos-vatex">
                  {data.productosVatex.slice(0, 500).map((p) => (
                    <option key={p.codigo} value={p.codigo}>{p.descripcion}</option>
                  ))}
                </datalist>
              </Campo>
            </Fila>
          )}
          {id === "feria" && <ElegirFeria feriaId={feriaId} setFeriaId={setFeriaId} />}
        </DestinoGrupo>
      ))}

      {hayEstampados && (
        <Fila>
          <Campo label="Costo de estampado por prenda ($)">
            <input className="pinput" type="number" step="0.01" min="0" value={costoEstampado}
              onChange={(e) => setCostoEstampado(e.target.value)} />
          </Campo>
          <div className="sub" style={{ flex: 2, alignSelf: "flex-end", fontSize: 12.5, paddingBottom: 14 }}>
            Las estampadas se van al taller y, cuando las registres de vuelta en Estampados, entran solas a su destino.
          </div>
        </Fila>
      )}

      {problemas.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 10 }}>
          {problemas.slice(0, 8).map((p) => <div key={p}>⚠ {p}</div>)}
          {problemas.length > 8 && <div>… y {problemas.length - 8} más.</div>}
        </div>
      )}

      <div style={{ textAlign: "right" }}>
        <button className="btn primary" style={{ fontSize: 13 }} disabled={ocupado || problemas.length > 0} onClick={procesar}>
          {ocupado ? "Procesando…" : filas.length > 1 ? `Procesar los ${filas.length} colores` : "Procesar entrega"}
        </button>
      </div>
    </div>
  );
}

const CELDA = { padding: "6px 8px", textAlign: "center" as const };

function InputTalla({ valor, max, onChange }: { valor: string | undefined; max: number; onChange: (v: string) => void }) {
  return (
    <input className="pinput" type="number" min="0" max={max} inputMode="numeric"
      style={{ width: 56, textAlign: "center", padding: "6px 4px" }}
      value={valor ?? ""} onChange={(e) => onChange(e.target.value)} />
  );
}

/**
 * Lo que va a UN destino: colores en filas, tallas en columnas. Debajo, los
 * estampados (cada uno de un color) y las básicas que quedan, y lo que cuesta:
 * producción + estampado + operativo del destino.
 */
function DestinoGrupo({
  destino,
  g,
  setG,
  filas,
  tallas,
  costoEstampado,
  precioLocal,
  children,
}: {
  destino: DestinoEnvio;
  g: GrupoForm;
  setG: React.Dispatch<React.SetStateAction<GrupoForm>>;
  filas: FilaEnvio[];
  tallas: string[];
  costoEstampado: number;
  precioLocal: number;
  children?: React.ReactNode;
}) {
  const etiqueta = DESTINOS.find((d) => d.id === destino)!.etiqueta;
  const estampados = g.estampados[destino];

  const porFila = filas.map((f) => {
    const form = formDeEntrega(g, f.entrega.id);
    const van = tallasDestino(form, destino);
    const est = sumaTallas(tallasEstampado(form.disenos[destino]));
    const nVan = sumaTallas(van);
    const cp = f.produccion ?? 0;
    return {
      f, van, nVan, nEst: est, nBas: nVan - est,
      basicos: basicosDestino(form, destino),
      costo: (nVan - est) * costoSalida(cp, destino, null) + est * costoSalida(cp, destino, costoEstampado),
    };
  });
  const nVan = porFila.reduce((s, x) => s + x.nVan, 0);
  const nEst = porFila.reduce((s, x) => s + x.nEst, 0);
  const total = porFila.reduce((s, x) => s + x.costo, 0);
  const costos = [...new Set(filas.map((f) => f.produccion ?? 0))];
  const operativo = COSTO_OPERATIVO[destino];

  const escribir = (entregaId: string, talla: string, v: string) =>
    setG((x) => ({
      ...x,
      tallas: { ...x.tallas, [destino]: { ...x.tallas[destino], [entregaId]: { ...(x.tallas[destino][entregaId] ?? {}), [talla]: v } } },
    }));
  const cambiarEstampados = (fn: (e: EstampadoGrupo[]) => EstampadoGrupo[]) =>
    setG((x) => ({ ...x, estampados: { ...x.estampados, [destino]: fn(x.estampados[destino]) } }));
  const escribirEstampado = (i: number, cambio: Partial<EstampadoGrupo>) =>
    cambiarEstampados((es) => es.map((e, j) => (j === i ? { ...e, ...cambio } : e)));

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="label" style={{ fontSize: 10.5 }}>{etiqueta} · {nVan} und.</div>
        {nVan > 0 && <span className="sub" style={{ fontSize: 12 }}>{nVan - nEst} básicas{nEst > 0 ? ` · ${nEst} estampadas` : ""}</span>}
      </div>

      {children}

      <div className="table-scroll" style={{ marginBottom: 8 }}>
        <table style={{ width: "auto", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...CELDA, textAlign: "left" }}>Color</th>
              {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
              <th style={CELDA}>Total</th>
              <th style={CELDA}>Costo</th>
            </tr>
          </thead>
          <tbody>
            {porFila.map(({ f, nVan: n, costo }) => (
              <tr key={f.entrega.id}>
                <td style={{ ...CELDA, textAlign: "left" }}>{f.etiqueta}</td>
                {tallas.map((t) => {
                  const llego = f.entrega.tallas[t] ?? 0;
                  return (
                    <td key={t} style={CELDA}>
                      {llego > 0 ? (
                        <InputTalla valor={g.tallas[destino][f.entrega.id]?.[t]} max={llego}
                          onChange={(v) => escribir(f.entrega.id, t, v)} />
                      ) : <span className="sub">—</span>}
                    </td>
                  );
                })}
                <td style={{ ...CELDA, fontWeight: 600 }} className="num">{n}</td>
                <td style={CELDA} className="num">{n > 0 ? money(costo) : <span className="sub">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {estampados.length > 0 && (
        <>
          <div className="label" style={{ fontSize: 10.5, margin: "10px 0 6px" }}>De esas, cuántas van con cada estampado</div>
          <div className="table-scroll" style={{ marginBottom: 8 }}>
            <table style={{ width: "auto", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...CELDA, textAlign: "left" }}>Estampado</th>
                  <th style={{ ...CELDA, textAlign: "left" }}>Color</th>
                  {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
                  <th style={CELDA}>Total</th>
                  <th style={CELDA}></th>
                </tr>
              </thead>
              <tbody>
                {estampados.map((e, i) => {
                  const van = porFila.find((x) => x.f.entrega.id === e.entregaId)?.van ?? {};
                  return (
                    <tr key={i}>
                      <td style={{ ...CELDA, textAlign: "left" }}>
                        <input className="pinput" style={{ minWidth: 120 }} placeholder="Ej: Logo frontal" value={e.nombre}
                          onChange={(ev) => escribirEstampado(i, { nombre: ev.target.value })} />
                      </td>
                      <td style={{ ...CELDA, textAlign: "left" }}>
                        <select className="pinput" value={e.entregaId}
                          onChange={(ev) => escribirEstampado(i, { entregaId: ev.target.value })}>
                          {filas.map((f) => <option key={f.entrega.id} value={f.entrega.id}>{f.etiqueta}</option>)}
                        </select>
                      </td>
                      {tallas.map((t) => (
                        <td key={t} style={CELDA}>
                          {(van[t] ?? 0) > 0 ? (
                            <InputTalla valor={e.tallas[t]} max={van[t]}
                              onChange={(v) => escribirEstampado(i, { tallas: { ...e.tallas, [t]: v } })} />
                          ) : <span className="sub">—</span>}
                        </td>
                      ))}
                      <td style={CELDA} className="num">{Object.values(e.tallas).reduce((s, v) => s + cantidad(v), 0)}</td>
                      <td style={CELDA}>
                        <button className="btn" style={{ padding: "4px 10px" }}
                          onClick={() => cambiarEstampados((es) => es.filter((_, j) => j !== i))}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="label" style={{ fontSize: 10.5, margin: "10px 0 6px" }}>Básicas (lo que queda sin estampar)</div>
          <div className="table-scroll" style={{ marginBottom: 8 }}>
            <table style={{ width: "auto", minWidth: "100%" }}>
              <tbody>
                {porFila.filter((x) => x.nVan > 0).map(({ f, basicos, nBas }) => (
                  <tr key={f.entrega.id}>
                    <td style={{ ...CELDA, textAlign: "left" }}>{f.etiqueta}</td>
                    {tallas.map((t) => {
                      const n = basicos[t] ?? 0;
                      return <td key={t} style={{ ...CELDA, color: n < 0 ? "var(--bad)" : undefined }} className="num">{n || "—"}</td>;
                    })}
                    <td style={{ ...CELDA, fontWeight: 600 }} className="num">{nBas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {nVan > 0 && (
        <button className="btn" style={{ fontSize: 12, marginBottom: 10 }}
          onClick={() => {
            // Por defecto, el primer color que tiene algo en este destino.
            const primero = porFila.find((x) => x.nVan > 0)?.f.entrega.id ?? filas[0].entrega.id;
            cambiarEstampados((es) => [...es, { nombre: "", tallas: {}, entregaId: primero }]);
          }}>
          + Agregar estampado
        </button>
      )}

      {nVan > 0 && (
        <div style={{ fontSize: 12.5, display: "grid", gridTemplateColumns: "auto auto", gap: "3px 16px", width: "fit-content" }}>
          {costos.length === 1 ? (
            <>
              <span className="sub">Básica:</span>
              <span className="num">
                {money(costoSalida(costos[0], destino, null))} c/u{" "}
                <span className="sub">(producción {money(costos[0])}{operativo ? ` + operativo ${money(operativo)}` : ""})</span>
              </span>
              {nEst > 0 && (
                <>
                  <span className="sub">Estampada:</span>
                  <span className="num">
                    {money(costoSalida(costos[0], destino, costoEstampado))} c/u{" "}
                    <span className="sub">(+ estampado {money(costoEstampado)})</span>
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="sub">Por prenda:</span>
              <span className="sub">producción de cada color{operativo ? ` + operativo ${money(operativo)}` : ""}{nEst > 0 ? ` (+ estampado ${money(costoEstampado)})` : ""}</span>
            </>
          )}
          <span className="sub">Costo total ({nVan} und.):</span><span className="num">{money(total)}</span>
          {destino === "local" && (
            <>
              <span className="sub">Precio local:</span><span className="num">{money(precioLocal)} c/u</span>
              <span className="sub">Margen:</span>
              <span className="num" style={{ color: nVan * precioLocal - total >= 0 ? "var(--good)" : "var(--bad)" }}>
                {money(nVan * precioLocal - total)}
              </span>
            </>
          )}
          {destino === "bodega" && (
            <span className="sub" style={{ gridColumn: "1 / -1" }}>
              El operativo de la venta en línea ({money(COSTO_OPERATIVO.online)}) se suma cuando sale de la bodega.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Fase 8s: a qué feria va la mercadería. Se elige una abierta o se crea ahí
 * mismo. Lo que se gana en la feria se anota a mano en Finanzas; aquí solo
 * queda qué salió y cuánto costó.
 */
function ElegirFeria({ feriaId, setFeriaId }: { feriaId: string; setFeriaId: (id: string) => void }) {
  const { data, supabase, reload, toast } = useProd();
  const abiertas = data.ferias.filter((f) => !f.cerrada_en);
  const [creando, setCreando] = useState(abiertas.length === 0);
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    if (!nombre.trim() || ocupado) return;
    setOcupado(true);
    const { data: nueva, error } = await supabase
      .from("prod_ferias")
      .insert({ nombre: nombre.trim(), fecha })
      .select("id")
      .single();
    setOcupado(false);
    if (error) return toast(error.message, "error");
    await reload();
    setFeriaId(nueva.id);
    setCreando(false);
    setNombre("");
  }

  return creando ? (
    <Fila>
      <Campo label="Nombre de la feria">
        <input className="pinput" placeholder="Ej: Feria Navideña CCI" value={nombre}
          onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo label="Fecha">
        <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      <div style={{ alignSelf: "flex-end", paddingBottom: 14, display: "flex", gap: 8 }}>
        <button className="btn primary" disabled={!nombre.trim() || ocupado} onClick={crear}>
          {ocupado ? "Creando…" : "Crear feria"}
        </button>
        {abiertas.length > 0 && <button className="btn" onClick={() => setCreando(false)}>Cancelar</button>}
      </div>
    </Fila>
  ) : (
    <Fila>
      <Campo label="¿A qué feria va?">
        <select className="pinput" value={feriaId} onChange={(e) => setFeriaId(e.target.value)}>
          <option value="">— Elige una feria —</option>
          {abiertas.map((f) => <option key={f.id} value={f.id}>{f.nombre} · {fmtFecha(f.fecha)}</option>)}
        </select>
      </Campo>
      <div style={{ alignSelf: "flex-end", paddingBottom: 14 }}>
        <button className="btn" onClick={() => setCreando(true)}>+ Nueva feria</button>
      </div>
    </Fila>
  );
}

/**
 * Cruce guías (logística) ↔ envíos a locales (producción).
 * Una guía "cuadra" si existe un envío al mismo local con fecha a ±3 días
 * y las unidades coinciden; si no, se marca la discrepancia.
 */
function GuiasLogistica() {
  const { data, supabase } = useProd();
  const [guias, setGuias] = useState<Guia[] | null>(null);

  useEffect(() => {
    supabase
      .from("guias_transferencia")
      .select("*")
      .order("fecha", { ascending: false })
      .limit(20)
      .then(({ data: g }) => setGuias((g ?? []) as Guia[]));
  }, [supabase]);

  if (!guias?.length) return null;

  return (
    <div style={{ marginTop: 26 }}>
      <div className="label" style={{ marginBottom: 10 }}>
        Guías de logística · cruce con producción
      </div>
      <div className="card" style={{ padding: "6px 16px" }}>
        {guias.map((g) => {
          const candidatos = data.enviosLocales.filter(
            (e) =>
              e.local_destino === g.local_destino &&
              Math.abs(diasHasta(e.fecha) - diasHasta(g.fecha)) <= 3
          );
          const unidadesProd = candidatos.reduce((s, e) => s + e.unidades, 0);
          const sinDato = !candidatos.length;
          const cuadra = !sinDato && unidadesProd === g.total_unidades;
          return (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5, flexWrap: "wrap" }}>
              <span>
                {fmtFecha(g.fecha)} · <span className="local-tag">{g.local_destino}</span> · {g.total_unidades} und.
                {g.recibido_por && <span className="sub"> · recibió {g.recibido_por}</span>}
              </span>
              {cuadra ? (
                <Badge color="verde">✓ cuadra con producción</Badge>
              ) : sinDato ? (
                <Badge color="ambar">sin envío de producción registrado (±3 días)</Badge>
              ) : (
                <Badge color="rojo">⚠ producción registró {unidadesProd} und.</Badge>
              )}
            </div>
          );
        })}
      </div>
      <p className="sub" style={{ fontSize: 12, marginTop: 8 }}>
        Para que el cruce funcione, elige el local destino al procesar lotes a locales.
      </p>
    </div>
  );
}

function Historial() {
  const { data } = useProd();
  const items = [
    ...data.lotesEstampado.map((l) => ({
      key: `e-${l.id}`,
      fecha: l.fecha_envio ?? "",
      texto: `${l.prenda_nombre} · ${l.color} · ${l.total_unidades} und. a estampar (${(l.disenos ?? []).map((d) => d.nombre).join(", ")})`,
      badge: <Badge color="ambar">Estampado</Badge>,
    })),
    ...data.enviosLocales.map((v) => ({
      key: `l-${v.id}`,
      fecha: v.fecha,
      texto: `${v.prenda_nombre} · ${v.color} · ${v.unidades} und. a locales · margen ${money(Number(v.margen))}${v.producto_codigo ? ` · ${v.producto_codigo}` : ""}`,
      badge: <Badge color="azul">Locales</Badge>,
    })),
    ...data.feriaIngresos.map((f) => ({
      key: `f-${f.id}`,
      fecha: f.fecha,
      texto: `${f.prenda_nombre} · ${f.color}${f.estampado ? ` · ${f.estampado}` : ""} · ${f.unidades} und. a ${data.ferias.find((x) => x.id === f.feria_id)?.nombre ?? "feria"} · ${money(Number(f.costo_unitario))} c/u`,
      badge: <Badge color="verde">Feria</Badge>,
    })),
  ].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  if (!items.length) return null;
  return (
    <div style={{ marginTop: 26 }}>
      <div className="label" style={{ marginBottom: 10 }}>Historial de salidas</div>
      <div className="card" style={{ padding: "6px 16px" }}>
        {items.slice(0, 25).map((i) => (
          <div key={i.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
            <span>{i.texto}</span>
            <span style={{ whiteSpace: "nowrap" }}>{i.badge} <span className="sub" style={{ fontSize: 11.5 }}>{fmtFecha(i.fecha)}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
