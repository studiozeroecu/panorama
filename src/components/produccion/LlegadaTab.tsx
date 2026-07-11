"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "./ui";
import { money, type PedidoTela } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha, sumarDiasLaborables, diasHasta } from "@/lib/produccion/fechas";

export default function LlegadaTab() {
  const { data, supabase, reload, toast } = useProd();
  const [entregar, setEntregar] = useState<PedidoTela | null>(null);
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ancho, setAncho] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const pendientes = data.pedidos.filter((p) => p.estado === "pendiente" || p.estado === "en_camino");

  function abrirEntrega(p: PedidoTela) {
    setEntregar(p);
    setFecha(hoyEcuador());
    setAncho(String(p.ancho_real ?? p.ancho_pedido ?? ""));
    setErr(null);
  }

  async function confirmar() {
    if (!entregar) return;
    const a = parseFloat(ancho);
    if (!fecha) return setErr("Ingresa la fecha de entrega.");
    if (!(a > 0)) return setErr("Ingresa el ancho real (> 0).");
    const { error } = await supabase
      .from("prod_pedidos_tela")
      .update({ estado: "entregado", fecha_entrega_real: fecha, ancho_real: a })
      .eq("id", entregar.id);
    if (error) return setErr(error.message);
    toast(`"${entregar.nombre_tela}" marcada como entregada`);
    setEntregar(null);
    await reload();
  }

  async function marcarEnCamino(p: PedidoTela) {
    const { error } = await supabase.from("prod_pedidos_tela").update({ estado: "en_camino" }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`"${p.nombre_tela}" en camino`);
    await reload();
  }

  return (
    <section>
      <div className="section-head">
        <h2>Llegada de telas <span className="sub" style={{ fontWeight: 400 }}>· confirma entregas y registra el ancho real</span></h2>
      </div>

      {!pendientes.length ? (
        <Vacio titulo="Sin pedidos pendientes de entrega" hint='Los pedidos "Pendiente" o "En camino" aparecen aquí' />
      ) : (
        pendientes.map((p) => {
          const prov = data.proveedores.find((x) => x.id === p.proveedor_id);
          const prenda = data.prendas.find((x) => x.id === p.prenda_id);
          let estimada = "—";
          let countdown: React.ReactNode = null;
          if (prov && p.fecha_pedido) {
            const est = sumarDiasLaborables(p.fecha_pedido, prov.dias_entrega);
            estimada = fmtFecha(est);
            const d = diasHasta(est);
            countdown =
              d > 0 ? (
                <Badge color="verde">Faltan {d} día{d !== 1 ? "s" : ""}</Badge>
              ) : d === 0 ? (
                <Badge color="ambar">Llega hoy</Badge>
              ) : (
                <Badge color="rojo">Atrasado {-d} día{d !== -1 ? "s" : ""}</Badge>
              );
          }
          return (
            <div className="prod-card" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h4>{p.nombre_tela}</h4>
                  <div className="prod-meta">
                    {prov?.empresa ?? "Sin proveedor"}
                    {prenda ? ` · Para: ${prenda.nombre}` : ""} · {Number(p.total_metros).toFixed(1)} m
                  </div>
                </div>
                <Badge color={p.estado === "en_camino" ? "azul" : "ambar"}>
                  {p.estado === "en_camino" ? "En camino" : "Pendiente"}
                </Badge>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "14px 0" }}>
                <div>
                  <div className="label" style={{ fontSize: 10.5 }}>Fecha pedido</div>
                  <div style={{ fontSize: 13 }}>{fmtFecha(p.fecha_pedido)}</div>
                </div>
                <div>
                  <div className="label" style={{ fontSize: 10.5 }}>Entrega estimada</div>
                  <div style={{ fontSize: 13 }}>{estimada}</div>
                  <div style={{ marginTop: 3 }}>{countdown}</div>
                </div>
                <div>
                  <div className="label" style={{ fontSize: 10.5 }}>Ancho pedido</div>
                  <div style={{ fontSize: 13 }}>{p.ancho_pedido ?? "—"} cm</div>
                </div>
                <div>
                  <div className="label" style={{ fontSize: 10.5 }}>Colores</div>
                  <div style={{ fontSize: 12.5 }}>
                    {(p.colores ?? []).map((c) => `${c.color} (${Number(c.metros).toFixed(1)} m)`).join(", ")}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {p.estado === "pendiente" && (
                  <button className="btn" style={{ fontSize: 12.5 }} onClick={() => marcarEnCamino(p)}>📦 Marcar en camino</button>
                )}
                <button className="btn primary" style={{ fontSize: 12.5 }} onClick={() => abrirEntrega(p)}>✓ Marcar como entregada</button>
              </div>
            </div>
          );
        })
      )}

      <Modal
        titulo="Confirmar entrega de tela"
        abierto={!!entregar}
        onCerrar={() => setEntregar(null)}
        pie={
          <>
            <button className="btn" onClick={() => setEntregar(null)}>Cancelar</button>
            <button className="btn primary" onClick={confirmar}>Confirmar entrega</button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        <p className="sub" style={{ marginTop: 0 }}>
          Tela: <b>{entregar?.nombre_tela}</b> · {money(Number(entregar?.total_pagar))}
        </p>
        <Fila>
          <Campo label="Fecha real de entrega" requerido>
            <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Campo label="Ancho real de tela (cm)" requerido>
            <input className="pinput" type="number" min="1" step="0.5" value={ancho}
              onChange={(e) => setAncho(e.target.value)} />
          </Campo>
        </Fila>
        <p className="sub" style={{ fontSize: 12 }}>El ancho real puede diferir del pedido; se usa como referencia en Corte.</p>
      </Modal>
    </section>
  );
}
