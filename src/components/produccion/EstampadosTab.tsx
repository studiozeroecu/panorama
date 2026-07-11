"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Badge, Vacio, Tallas } from "./ui";
import { money, type LoteEstampado } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/produccion/fechas";
import { sumarStock } from "@/lib/produccion/stock";

export default function EstampadosTab() {
  const { data } = useProd();
  const pendientes = data.lotesEstampado.filter((l) => l.estado === "pendiente");
  const enTaller = data.lotesEstampado.filter((l) => l.estado === "en_taller");
  const retornados = data.lotesEstampado.filter((l) => l.estado === "retornado");

  return (
    <section>
      <div className="section-head">
        <h2>Estampados <span className="sub" style={{ fontWeight: 400 }}>· envío y retorno de lotes al taller</span></h2>
      </div>

      {!data.lotesEstampado.length && (
        <Vacio titulo="Sin lotes para estampar aún" hint="Los lotes con estampado que proceses en Envío aparecen aquí." />
      )}

      {pendientes.length > 0 && (
        <>
          <div className="label" style={{ marginBottom: 10 }}>Pendientes de enviar al taller ({pendientes.length})</div>
          {pendientes.map((l) => <LotePendiente key={l.id} lote={l} />)}
        </>
      )}
      {enTaller.length > 0 && (
        <>
          <div className="label" style={{ margin: "18px 0 10px" }}>En taller ({enTaller.length})</div>
          {enTaller.map((l) => <LoteEnTaller key={l.id} lote={l} />)}
        </>
      )}
      {retornados.length > 0 && (
        <>
          <div className="label" style={{ margin: "18px 0 10px" }}>Retornados ({retornados.length})</div>
          {retornados.map((l) => (
            <div className="prod-card" key={l.id} style={{ opacity: 0.75 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <h4>{l.prenda_nombre} <Badge color="azul">{l.color}</Badge></h4>
                  <div className="prod-meta">
                    {l.total_unidades} und. · {(l.disenos ?? []).map((d) => `${d.nombre} (${d.unidades})`).join(", ")} ·
                    costo {money(Number(l.costo_total))} · retornado {fmtFecha(l.fecha_retorno)}
                  </div>
                </div>
                <Badge color="verde">Retornado</Badge>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function LotePendiente({ lote }: { lote: LoteEstampado }) {
  const { data, supabase, reload, toast } = useProd();
  const [tallerId, setTallerId] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());

  async function enviar() {
    if (!fecha) return toast("Ingresa la fecha de envío.", "error");
    const { error } = await supabase
      .from("prod_lotes_estampado")
      .update({ estado: "en_taller", taller_id: tallerId || null, fecha_envio: fecha })
      .eq("id", lote.id);
    if (error) return toast(error.message, "error");
    toast("Lote enviado al taller");
    await reload();
  }

  return (
    <div className="prod-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h4>{lote.prenda_nombre} <Badge color="azul">{lote.color}</Badge></h4>
          <div className="prod-meta">
            {lote.total_unidades} unidades · {(lote.disenos ?? []).map((d) => `${d.nombre} (${d.unidades})`).join(", ")} ·
            costo estimado {money(Number(lote.costo_total))} ({money(Number(lote.costo_unitario))}/und.)
          </div>
          <div style={{ marginTop: 6 }}><Tallas tallas={lote.tallas} /></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 170 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Taller</div>
          <select className="pinput" value={tallerId} onChange={(e) => setTallerId(e.target.value)}>
            <option value="">— Sin asignar —</option>
            {data.talleres.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 150 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Fecha de envío</div>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <button className="btn primary" style={{ fontSize: 12.5 }} onClick={enviar}>Enviar al taller →</button>
      </div>
    </div>
  );
}

function LoteEnTaller({ lote }: { lote: LoteEstampado }) {
  const { data, supabase, reload, toast } = useProd();
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);
  const taller = data.talleres.find((t) => t.id === lote.taller_id);

  async function retornar() {
    if (!fecha) return toast("Ingresa la fecha de retorno.", "error");
    setOcupado(true);
    try {
      // Ingresa al stock online por talla, etiquetado con el/los diseños.
      // Las unidades estampadas (total_unidades) se descuentan de las tallas
      // de mayor cantidad primero (los diseños no van por talla).
      const etiqueta = (lote.disenos ?? []).map((d) => d.nombre).join(", ");
      let porAsignar = lote.total_unidades;
      const entradas: { talla: string; unidades: number }[] = [];
      for (const [talla, cant] of Object.entries(lote.tallas ?? {})) {
        const usa = Math.min(cant, porAsignar);
        if (usa > 0) entradas.push({ talla, unidades: usa });
        porAsignar -= usa;
        if (porAsignar <= 0) break;
      }
      for (const e of entradas) {
        const err = await sumarStock(supabase, {
          prenda_id: lote.prenda_id,
          prenda_nombre: lote.prenda_nombre,
          color: lote.color,
          estampado: etiqueta,
          talla: e.talla,
          unidades: e.unidades,
        });
        if (err) throw new Error(err);
      }
      const { error } = await supabase
        .from("prod_lotes_estampado")
        .update({ estado: "retornado", fecha_retorno: fecha })
        .eq("id", lote.id);
      if (error) throw new Error(error.message);
      toast(`${lote.total_unidades} unidades estampadas ingresadas al stock`);
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="prod-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h4>{lote.prenda_nombre} <Badge color="azul">{lote.color}</Badge></h4>
          <div className="prod-meta">
            {lote.total_unidades} und. · taller: {taller?.nombre ?? "—"} · enviado {fmtFecha(lote.fecha_envio)} ·
            costo {money(Number(lote.costo_total))}
          </div>
          <div style={{ marginTop: 6 }}><Tallas tallas={lote.tallas} /></div>
        </div>
        <Badge color="ambar">En taller</Badge>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 150 }}>
          <div className="label" style={{ fontSize: 10.5 }}>Fecha de retorno</div>
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <button className="btn primary" style={{ fontSize: 12.5 }} disabled={ocupado} onClick={retornar}>
          {ocupado ? "Procesando…" : "Retorno recibido ✓"}
        </button>
      </div>
    </div>
  );
}
