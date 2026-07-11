"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Badge, Vacio, Tallas } from "./ui";
import { money, type Maquila, type ColorMaquila } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/produccion/fechas";

export default function MaquilaTab() {
  const { data, supabase, reload, toast } = useProd();
  const [fechaModal, setFechaModal] = useState<{
    maquila: Maquila;
    colorIdx: number;
    tipo: "enviado" | "entregado";
  } | null>(null);
  const [fecha, setFecha] = useState(hoyEcuador());

  const activas = data.maquilas.filter((m) => m.colores.some((c) => c.estado !== "entregado"));
  const terminadas = data.maquilas.filter((m) => m.colores.every((c) => c.estado === "entregado"));

  async function guardarCampo(m: Maquila, cambios: Partial<Maquila>) {
    const { error } = await supabase.from("prod_maquilas").update(cambios).eq("id", m.id);
    if (error) toast(error.message, "error");
    else await reload();
  }

  async function confirmarFecha() {
    if (!fechaModal || !fecha) return;
    const { maquila, colorIdx, tipo } = fechaModal;
    const colores = maquila.colores.map((c, i) =>
      i !== colorIdx
        ? c
        : tipo === "enviado"
          ? { ...c, estado: "enviado" as const, fecha_envio: fecha }
          : { ...c, estado: "entregado" as const, fecha_entrega: fecha }
    );
    const { error } = await supabase.from("prod_maquilas").update({ colores }).eq("id", maquila.id);
    if (error) return toast(error.message, "error");
    toast(tipo === "enviado" ? "Marcado como enviado" : "Marcado como entregado — listo en Envío");
    setFechaModal(null);
    await reload();
  }

  function infoDe(m: Maquila) {
    const corte = data.cortes.find((c) => c.id === m.corte_id);
    const pedido = corte ? data.pedidos.find((p) => p.id === corte.pedido_id) : null;
    const prenda = pedido ? data.prendas.find((x) => x.id === pedido.prenda_id) : null;
    return { corte, pedido, prenda };
  }

  function Card({ m, terminada }: { m: Maquila; terminada: boolean }) {
    const { corte, pedido, prenda } = infoDe(m);
    const entregados = m.colores.filter((c) => c.estado === "entregado").length;
    const pct = m.colores.length ? Math.round((entregados / m.colores.length) * 100) : 0;

    return (
      <div className="prod-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h4>{pedido?.nombre_tela ?? "(pedido eliminado)"}{prenda ? ` — ${prenda.nombre}` : ""}</h4>
            <div className="prod-meta">
              Cortado: {corte ? fmtFecha(corte.fecha) : "—"} · {m.total_unidades} unidades · {m.colores.length} color{m.colores.length !== 1 ? "es" : ""}
            </div>
          </div>
          {terminada ? <Badge color="verde">Terminado</Badge> : <span className="sub" style={{ fontSize: 12 }}>{entregados}/{m.colores.length} entregados</span>}
        </div>

        <div style={{ display: "flex", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="label" style={{ fontSize: 10.5 }}>Maquiladora</div>
            <select className="pinput" value={m.maquiladora_id ?? ""}
              onChange={(e) => guardarCampo(m, { maquiladora_id: e.target.value || null })}>
              <option value="">— Sin asignar —</option>
              {data.maquiladoras.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div className="label" style={{ fontSize: 10.5 }}>Costo por unidad ($)</div>
            <input className="pinput" type="number" step="0.01" min="0" defaultValue={m.costo_unitario || ""}
              onBlur={(e) => {
                const v = parseFloat(e.target.value) || 0;
                if (v !== Number(m.costo_unitario)) guardarCampo(m, { costo_unitario: v });
              }} />
          </div>
          <div style={{ flex: 2, minWidth: 160, display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div className="prod-progress"><div className={pct === 100 ? "done" : ""} style={{ width: `${pct}%` }} /></div>
            <span className="sub" style={{ fontSize: 12 }}>{pct}%</span>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Color / tallas</th>
                <th style={{ textAlign: "center" }}>Und.</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {m.colores.map((c: ColorMaquila, ci) => (
                <tr key={ci}>
                  <td>
                    <b style={{ fontSize: 13 }}>{c.color}</b>
                    <div style={{ marginTop: 3 }}><Tallas tallas={c.tallas} /></div>
                  </td>
                  <td className="num" style={{ textAlign: "center" }}>{c.unidades}</td>
                  <td>
                    {c.estado === "pendiente" && <Badge>Pendiente</Badge>}
                    {c.estado === "enviado" && <Badge color="ambar">Enviado</Badge>}
                    {c.estado === "entregado" && <Badge color="verde">Entregado</Badge>}
                    <div className="sub" style={{ fontSize: 11 }}>
                      {c.fecha_envio && <>Env: {fmtFecha(c.fecha_envio)} </>}
                      {c.fecha_entrega && <>· Rec: {fmtFecha(c.fecha_entrega)}</>}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {c.estado === "pendiente" && (
                      <button className="btn" style={{ fontSize: 12 }}
                        onClick={() => { setFecha(hoyEcuador()); setFechaModal({ maquila: m, colorIdx: ci, tipo: "enviado" }); }}>
                        Marcar enviado
                      </button>
                    )}
                    {c.estado === "enviado" && (
                      <button className="btn primary" style={{ fontSize: 12 }}
                        onClick={() => { setFecha(hoyEcuador()); setFechaModal({ maquila: m, colorIdx: ci, tipo: "entregado" }); }}>
                        Marcar entregado
                      </button>
                    )}
                    {c.estado === "entregado" && (
                      c.procesado
                        ? <span className="sub" style={{ fontSize: 11.5 }}>Procesado en Envío</span>
                        : <span style={{ fontSize: 11.5, color: "var(--good)" }}>Listo para Envío →</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Number(m.costo_unitario) > 0 && (
          <div className="sub" style={{ fontSize: 12, marginTop: 8, textAlign: "right" }}>
            Costo total maquila: <b>{money(Number(m.costo_unitario) * m.total_unidades)}</b>
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2>Maquila <span className="sub" style={{ fontWeight: 400 }}>· envío y recepción por color</span></h2>
      </div>

      {!data.maquilas.length && (
        <Vacio titulo="Sin producciones en maquila aún" hint="Al registrar un corte se crea automáticamente una producción aquí." />
      )}

      {activas.length > 0 && (
        <>
          <div className="label" style={{ marginBottom: 10 }}>En proceso ({activas.length})</div>
          {activas.map((m) => <Card key={m.id} m={m} terminada={false} />)}
        </>
      )}
      {terminadas.length > 0 && (
        <>
          <div className="label" style={{ margin: "18px 0 10px" }}>Terminadas ({terminadas.length})</div>
          {terminadas.map((m) => <Card key={m.id} m={m} terminada />)}
        </>
      )}

      <Modal
        titulo={fechaModal?.tipo === "enviado" ? "Marcar como enviado" : "Marcar como entregado"}
        abierto={!!fechaModal}
        onCerrar={() => setFechaModal(null)}
        pie={
          <>
            <button className="btn" onClick={() => setFechaModal(null)}>Cancelar</button>
            <button className="btn primary" onClick={confirmarFecha}>Confirmar</button>
          </>
        }
      >
        <p className="sub" style={{ marginTop: 0 }}>
          Color: <b>{fechaModal?.maquila.colores[fechaModal.colorIdx]?.color}</b> ·{" "}
          {fechaModal?.maquila.colores[fechaModal.colorIdx]?.unidades} unidades
        </p>
        <Campo label={fechaModal?.tipo === "enviado" ? "Fecha de envío a maquila" : "Fecha de entrega de maquila"} requerido>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
      </Modal>
    </section>
  );
}
