"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "@/components/ui";
import { money, TALLA_ORDER, type StockOnline } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";

export default function StockTab() {
  const { data, supabase, reload, toast } = useProd();
  const [venta, setVenta] = useState<StockOnline | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [idemId, setIdemId] = useState("");

  const totalDisp = data.stock.reduce((s, v) => s + v.disponibles, 0);
  const totalVend = data.stock.reduce((s, v) => s + v.vendidas, 0);

  // agrupar por prenda+color+estampado
  const grupos = new Map<string, StockOnline[]>();
  for (const s of data.stock) {
    const k = `${s.prenda_nombre}||${s.color}||${s.estampado}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(s);
  }

  function abrirVenta(s: StockOnline) {
    // Fase 8d: el id de idempotencia nace AL ABRIR el modal, no al confirmar.
    // Una apertura = una venta; vender dos veces lo mismo son dos aperturas.
    setIdemId(crypto.randomUUID());
    setVenta(s);
    setCantidad("1");
    setFecha(hoyEcuador());
    const prenda = data.prendas.find((p) => p.id === s.prenda_id || p.nombre === s.prenda_nombre);
    setPrecio(prenda ? String(prenda.precio_venta_online) : "");
    setErr(null);
  }

  /**
   * Fase 8d: una sola llamada a fn_confirmar_venta_online. Antes eran un insert y
   * un update sueltos, y el update escribía un valor ABSOLUTO calculado desde el
   * estado de la pantalla: con el stock desactualizado inventaba unidades (stock
   * real 3, pantalla 10, vender 2 escribía 8). Ahora el descuento es relativo y
   * las validaciones viven en la base, contra el valor real y con la fila bloqueada.
   */
  async function confirmarVenta() {
    if (!venta) return;
    setErr(null);
    setOcupado(true);
    const { data: res, error } = await supabase.rpc("fn_confirmar_venta_online", {
      p_stock_id: venta.id,
      p_cantidad: parseInt(cantidad, 10) || 0,
      p_precio: parseFloat(precio),
      p_fecha: fecha || null,
      p_idem_id: idemId || null,
    });
    setOcupado(false);
    if (error) return setErr(error.message);

    const r = (res ?? {}) as { ya_registrada?: boolean; cantidad?: number; total?: number };
    const n = r.cantidad ?? 0;
    // Un reintento no es un fallo: la venta ya está registrada.
    toast(
      r.ya_registrada
        ? "Esta venta ya estaba registrada."
        : `${n} und. vendida${n > 1 ? "s" : ""} · ${money(r.total ?? 0)}`
    );
    setVenta(null);
    await reload();
  }

  return (
    <section>
      <div className="section-head">
        <h2>Venta online <span className="sub" style={{ fontWeight: 400 }}>· stock disponible y registro de ventas</span></h2>
      </div>

      <div className="cards" style={{ marginBottom: 24 }}>
        <div className="card"><div className="label">En stock online</div><div className="value">{totalDisp}</div><div className="hint">unidades disponibles</div></div>
        <div className="card"><div className="label">Vendidas online</div><div className="value">{totalVend}</div><div className="hint">unidades acumuladas</div></div>
        <div className="card"><div className="label">Ingreso online (30 días)</div>
          <div className="value">{money(
            data.ventasOnline
              .filter((v) => v.fecha >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
              .reduce((s, v) => s + Number(v.total), 0)
          )}</div>
          <div className="hint">ventas con fecha y precio reales</div>
        </div>
      </div>

      {!grupos.size ? (
        <Vacio titulo="Sin stock online aún" hint='El stock entra desde "Envío" y cuando los estampados retornan del taller.' />
      ) : (
        [...grupos.entries()].map(([k, items]) => {
          const [prenda, color, estampado] = k.split("||");
          const disp = items.reduce((s, v) => s + v.disponibles, 0);
          const vend = items.reduce((s, v) => s + v.vendidas, 0);
          const sorted = [...items].sort(
            (a, b) => (TALLA_ORDER.indexOf(a.talla) + 1 || 99) - (TALLA_ORDER.indexOf(b.talla) + 1 || 99)
          );
          return (
            <div className="prod-card" key={k}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div>
                  <h4>
                    {prenda || "(sin prenda)"} <Badge color="azul">{color}</Badge>
                    {estampado && <Badge color="ambar">{estampado}</Badge>}
                  </h4>
                  <div className="prod-meta">{disp} disponibles · {vend} vendidas</div>
                </div>
                {disp === 0 && <Badge color="rojo">Sin stock</Badge>}
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Talla</th>
                      <th style={{ textAlign: "center" }}>Disponibles</th>
                      <th style={{ textAlign: "center" }}>Vendidas</th>
                      <th style={{ textAlign: "right" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.id} style={s.disponibles === 0 ? { opacity: 0.55 } : undefined}>
                        <td style={{ fontWeight: 500 }}>{s.talla}</td>
                        <td className="num" style={{ textAlign: "center" }}>{s.disponibles}</td>
                        <td className="num" style={{ textAlign: "center" }}>{s.vendidas}</td>
                        <td style={{ textAlign: "right" }}>
                          {s.disponibles === 0
                            ? <Badge color="rojo">Agotado</Badge>
                            : <button className="btn" style={{ fontSize: 12 }} onClick={() => abrirVenta(s)}>Vender</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}

      {data.ventasOnline.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div className="label" style={{ marginBottom: 10 }}>Últimas ventas</div>
          <div className="card" style={{ padding: "6px 16px" }}>
            {data.ventasOnline.slice(0, 15).map((v) => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                <span>{v.prenda_nombre} · {v.color}{v.estampado ? ` · ${v.estampado}` : ""} · talla {v.talla} × {v.cantidad}</span>
                <span style={{ whiteSpace: "nowrap" }}>
                  <span className="num" style={{ marginRight: 10 }}>{money(Number(v.total))}</span>
                  <span className="sub" style={{ fontSize: 11.5 }}>{fmtFecha(v.fecha)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        titulo="Registrar venta online"
        abierto={!!venta}
        onCerrar={() => setVenta(null)}
        pie={
          <>
            <button className="btn" onClick={() => setVenta(null)}>Cancelar</button>
            <button className="btn primary" disabled={ocupado} onClick={confirmarVenta}>
              {ocupado ? "Registrando…" : "Registrar venta"}
            </button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        <p className="sub" style={{ marginTop: 0 }}>
          {venta?.prenda_nombre} · {venta?.color}{venta?.estampado ? ` · ${venta.estampado}` : ""} · talla <b>{venta?.talla}</b> · {venta?.disponibles} disponibles
        </p>
        <Fila>
          <Campo label="Cantidad" requerido>
            <input className="pinput" type="number" min="1" max={venta?.disponibles} value={cantidad}
              onChange={(e) => setCantidad(e.target.value)} />
          </Campo>
          <Campo label="Precio unitario ($)" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={precio}
              onChange={(e) => setPrecio(e.target.value)} />
          </Campo>
          <Campo label="Fecha" requerido>
            <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
        </Fila>
      </Modal>
    </section>
  );
}
