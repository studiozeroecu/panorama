"use client";

import { useMemo, useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio, Tallas } from "@/components/ui";
import { ordenarTallas, type PedidoTela } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";

export default function CorteTab() {
  const { data, supabase, reload, toast } = useProd();
  const [pedidoSel, setPedidoSel] = useState<PedidoTela | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [idemId, setIdemId] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [maquiladoraId, setMaquiladoraId] = useState("");
  const [obs, setObs] = useState("");
  // matriz[color][talla] = string; metros[color] = string
  const [matriz, setMatriz] = useState<Record<string, Record<string, string>>>({});
  const [metrosUsados, setMetrosUsados] = useState<Record<string, string>>({});

  /** Metros ya consumidos por pedido (mejora 1: inventario de tela). */
  const consumidoPorPedido = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data.cortes) {
      m.set(c.pedido_id, (m.get(c.pedido_id) ?? 0) + Number(c.metros_consumidos ?? 0));
    }
    return m;
  }, [data.cortes]);

  const entregados = data.pedidos.filter((p) => p.estado === "entregado");

  function saldoDe(p: PedidoTela): number {
    return Number(p.total_metros) - (consumidoPorPedido.get(p.id) ?? 0);
  }

  function abrirCorte(p: PedidoTela) {
    // Fase 8b: el id de idempotencia nace AL ABRIR el modal, no al pulsar Guardar.
    // Si naciera en el handler del clic, cada intento traería un id distinto y la
    // deduplicación del servidor no serviría de nada. Una apertura = un intento.
    setIdemId(crypto.randomUUID());
    setPedidoSel(p);
    setErr(null);
    setFecha(hoyEcuador());
    setMaquiladoraId("");
    setObs("");
    setMatriz({});
    setMetrosUsados({});
  }

  const prendaDe = (p: PedidoTela | null) => data.prendas.find((x) => x.id === p?.prenda_id);
  const tallasDe = (p: PedidoTela | null) => {
    const pr = prendaDe(p);
    return ordenarTallas(pr?.tallas?.length ? pr.tallas : ["XS", "S", "M", "L", "XL", "XXL"]);
  };

  /**
   * Fase 7: una sola llamada a fn_registrar_corte, que escribe corte + maquila +
   * colores + tallas en una transacción. Antes eran dos inserts sueltos: si el
   * segundo fallaba, el corte quedaba huérfano y reintentar lo duplicaba.
   * Las reglas de negocio (mínimo una unidad, saldo de tela, color sin nombre)
   * viven ahora en la función; aquí no se repiten.
   */
  async function guardarCorte() {
    if (!pedidoSel) return;
    setErr(null);
    const tallas = tallasDe(pedidoSel);

    const colores = (pedidoSel.colores ?? [])
      .map((c) => {
        const fila = matriz[c.color] ?? {};
        const tallasObj: Record<string, number> = {};
        for (const t of tallas) {
          const n = parseInt(fila[t] ?? "0", 10) || 0;
          if (n > 0) tallasObj[t] = n;
        }
        const mUsados = parseFloat(metrosUsados[c.color] ?? "");
        return {
          color: c.color,
          tallas: tallasObj,
          metros_usados: isNaN(mUsados) ? null : mUsados,
        };
      })
      .filter((c) => Object.keys(c.tallas).length > 0 || (c.metros_usados ?? 0) > 0);

    setOcupado(true);
    const { data: res, error } = await supabase.rpc("fn_registrar_corte", {
      p_pedido_id: pedidoSel.id,
      p_fecha: fecha || null,
      p_maquiladora_id: maquiladoraId || null,
      p_observaciones: obs.trim(),
      p_costo_maquila: prendaDe(pedidoSel)?.costo_maquila ?? 0,
      p_colores: colores,
      p_idem_id: idemId || null,
    });
    setOcupado(false);
    if (error) return setErr(error.message);

    const r = (res ?? {}) as { ya_registrado?: boolean; unidades?: number };
    // Un reintento no es un fallo: el corte ya existe, que es lo que se quería.
    toast(
      r.ya_registrado
        ? "Este corte ya estaba registrado."
        : `Corte registrado · ${r.unidades ?? totalModal} unidades`
    );
    setPedidoSel(null);
    await reload();
  }

  const tallas = tallasDe(pedidoSel);
  const totalModal = Object.values(matriz).reduce(
    (s, fila) => s + Object.values(fila).reduce((a, v) => a + (parseInt(v, 10) || 0), 0),
    0
  );

  return (
    <section>
      <div className="section-head">
        <h2>Corte <span className="sub" style={{ fontWeight: 400 }}>· unidades por color y talla, con control de tela</span></h2>
      </div>

      {!entregados.length ? (
        <Vacio titulo="Sin telas entregadas aún" hint="Al confirmar la entrega de una tela, aparece aquí para cortar." />
      ) : (
        entregados.map((p) => {
          const saldo = saldoDe(p);
          const cortesDelPedido = data.cortes.filter((c) => c.pedido_id === p.id);
          const sinRegistroMetros = cortesDelPedido.some((c) => c.metros_consumidos == null);
          const prenda = prendaDe(p);
          return (
            <div className="prod-card" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h4>{p.nombre_tela}</h4>
                  <div className="prod-meta">
                    {Number(p.total_metros).toFixed(1)} m comprados
                    {prenda ? ` · ${prenda.nombre}` : ""} · entregado {fmtFecha(p.fecha_entrega_real)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Badge color={saldo > 0.5 ? "verde" : "gris"}>
                      Saldo de tela: {saldo.toFixed(1)} m{sinRegistroMetros ? " (hay cortes sin metros registrados)" : ""}
                    </Badge>
                    {cortesDelPedido.length > 0 && (
                      <Badge color="azul">{cortesDelPedido.length} corte{cortesDelPedido.length !== 1 ? "s" : ""}</Badge>
                    )}
                  </div>
                </div>
                <button className="btn primary" style={{ fontSize: 12.5 }} onClick={() => abrirCorte(p)}>
                  {cortesDelPedido.length ? "+ Nuevo corte" : "Registrar corte"}
                </button>
              </div>

              {cortesDelPedido.length > 0 && (
                <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  {cortesDelPedido.map((c) => (
                    <div key={c.id} style={{ fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="sub">{fmtFecha(c.fecha)}</span>
                      {" · "}
                      <b>{c.total_unidades} und.</b>
                      {c.metros_consumidos != null && <span className="sub"> · {Number(c.metros_consumidos).toFixed(1)} m usados</span>}
                      <div style={{ marginTop: 3 }}>
                        {(c.colores ?? []).map((col) => (
                          <span key={col.color} style={{ marginRight: 10 }}>
                            <b style={{ fontSize: 12 }}>{col.color}</b>{" "}
                            <Tallas tallas={col.tallas} />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      <Modal
        titulo={`Registrar corte — ${pedidoSel?.nombre_tela ?? ""}`}
        abierto={!!pedidoSel}
        onCerrar={() => setPedidoSel(null)}
        ancho={860}
        pie={
          <>
            <span className="sub" style={{ marginRight: "auto", fontSize: 13 }}>
              Total: <b>{totalModal}</b> unidades
            </span>
            <button className="btn" onClick={() => setPedidoSel(null)}>Cancelar</button>
            <button className="btn primary" disabled={ocupado} onClick={guardarCorte}>
              {ocupado ? "Guardando…" : "Guardar corte"}
            </button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        {pedidoSel && (
          <>
            <p className="sub" style={{ marginTop: 0, fontSize: 12.5 }}>
              Saldo de tela disponible: <b>{saldoDe(pedidoSel).toFixed(1)} m</b> · ancho real {pedidoSel.ancho_real ?? "—"} cm
            </p>
            <div className="table-scroll" style={{ marginBottom: 14 }}>
              <table className="matriz">
                <thead>
                  <tr>
                    <th>Color</th>
                    {tallas.map((t) => <th key={t} style={{ textAlign: "center" }}>{t}</th>)}
                    <th style={{ textAlign: "right" }}>Und.</th>
                    <th style={{ textAlign: "right" }}>Metros usados</th>
                  </tr>
                </thead>
                <tbody>
                  {(pedidoSel.colores ?? []).map((c) => {
                    const fila = matriz[c.color] ?? {};
                    const unidades = tallas.reduce((s, t) => s + (parseInt(fila[t] ?? "0", 10) || 0), 0);
                    return (
                      <tr key={c.color}>
                        <td style={{ fontWeight: 500 }}>{c.color}<div className="sub" style={{ fontSize: 11 }}>{Number(c.metros).toFixed(1)} m pedidos</div></td>
                        {tallas.map((t) => (
                          <td key={t} style={{ textAlign: "center" }}>
                            <input className="pinput" type="number" min="0" step="1" placeholder="0"
                              value={fila[t] ?? ""}
                              onChange={(e) =>
                                setMatriz({ ...matriz, [c.color]: { ...fila, [t]: e.target.value } })
                              } />
                          </td>
                        ))}
                        <td className="num" style={{ fontWeight: 600 }}>{unidades}</td>
                        <td style={{ textAlign: "right" }}>
                          <input className="pinput" type="number" min="0" step="0.1" placeholder="m"
                            style={{ width: 78, textAlign: "center", padding: "5px 4px" }}
                            value={metrosUsados[c.color] ?? ""}
                            onChange={(e) => setMetrosUsados({ ...metrosUsados, [c.color]: e.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Fila>
              <Campo label="Fecha de corte" requerido>
                <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </Campo>
              <Campo label="Maquiladora">
                <select className="pinput" value={maquiladoraId} onChange={(e) => setMaquiladoraId(e.target.value)}>
                  <option value="">— Después —</option>
                  {/* Fase 8e: aquí se ELIGE, así que las archivadas no se ofrecen. */}
                  {data.maquiladoras.filter((m) => !m.archivada_en)
                    .map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </Campo>
            </Fila>
            <Campo label="Observaciones">
              <textarea className="pinput" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
            </Campo>
            <p className="sub" style={{ fontSize: 12 }}>
              Los metros usados por color son opcionales pero alimentan el inventario de tela — si los registras, el saldo del pedido se descuenta automáticamente.
            </p>
          </>
        )}
      </Modal>
    </section>
  );
}
