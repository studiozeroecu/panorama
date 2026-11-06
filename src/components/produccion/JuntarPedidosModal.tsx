"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo } from "@/components/ui";
import { money, type PedidoTela } from "@/lib/produccion/types";
import { ordenParaUnir, vistaUnion } from "@/lib/produccion/unirPedidos";
import { validarAnchoCm } from "@/lib/produccion/recepcion";
import { fmtFecha } from "@/lib/fechas";

/**
 * Fase 8z: dos pedidos de la misma tela que llegaron juntos se cortan como uno.
 * Quedan como UN pedido (fn_unir_pedidos): se queda el más antiguo, los otros se
 * borran y quedan anotados dentro. `candidatos` = telas entregadas y sin cortes.
 */
export default function JuntarPedidosModal({ candidatos, onCerrar }: { candidatos: PedidoTela[]; onCerrar: () => void }) {
  const { data, supabase, reload, toast } = useProd();
  const [ids, setIds] = useState<string[]>([]);
  const [nombre, setNombre] = useState("");
  const [prendaId, setPrendaId] = useState("");
  // null = no lo ha tocado: vale el más pequeño de los pedidos marcados.
  const [ancho, setAncho] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const elegidos = ordenParaUnir(candidatos.filter((p) => ids.includes(p.id)));
  const vista = vistaUnion(elegidos);
  const hayVarias = vista.prendaIds.length > 1;
  const nombreFinal = nombre.trim() || (elegidos[0]?.nombre_tela ?? "");
  const proveedorDe = (p: PedidoTela) => data.proveedores.find((x) => x.id === p.proveedor_id)?.empresa;
  const prendaDe = (id: string | null) => data.prendas.find((x) => x.id === id)?.nombre;
  const anchoTexto = ancho ?? (vista.anchos[0] != null ? String(vista.anchos[0]) : "");
  // Sin ningún ancho medido no hay nada que elegir: la tela sigue sin ancho.
  const anchoRes = anchoTexto.trim() ? validarAnchoCm(anchoTexto) : null;
  const anchoError = anchoRes && "error" in anchoRes ? anchoRes.error : null;
  const anchoCm = anchoRes && "cm" in anchoRes ? anchoRes.cm : null;
  const faltaAncho = vista.anchos.length > 0 && anchoCm == null;
  const listo = elegidos.length >= 2 && !!nombreFinal && !faltaAncho && !anchoError
    && (!hayVarias || vista.prendaIds.includes(prendaId));

  function alternar(id: string) {
    setIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
    setPrendaId("");
    setAncho(null);
  }

  async function juntar() {
    if (ocupado || !listo) return;
    setOcupado(true);
    const { error } = await supabase.rpc("fn_unir_pedidos", {
      p_pedido_ids: elegidos.map((p) => p.id),
      p_nombre: nombreFinal,
      p_prenda_id: hayVarias ? prendaId : null,
      p_ancho_real: anchoCm,
    });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    toast(`Telas juntadas: ${vista.totalMetros.toFixed(1)} m en un solo pedido`);
    await reload();
    onCerrar();
  }

  return (
    <Modal titulo="Juntar telas para el corte" abierto onCerrar={onCerrar} ancho={680}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" disabled={ocupado || !listo} onClick={juntar}>
            {ocupado ? "Juntando…" : `Juntar ${elegidos.length >= 2 ? elegidos.length + " pedidos" : ""}`}
          </button>
        </>
      }>
      <p className="sub" style={{ fontSize: 12.5, marginTop: 0 }}>
        Marca los pedidos que vas a cortar como una sola tela. Quedan como un solo pedido, y no se puede deshacer.
      </p>

      {candidatos.map((p) => (
        <label key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", cursor: "pointer",
          border: "1px solid var(--border)", borderRadius: 10, marginBottom: 6 }}>
          <input type="checkbox" checked={ids.includes(p.id)} onChange={() => alternar(p.id)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 13 }}>
            <b>{p.nombre_tela}</b> · {Number(p.total_metros).toFixed(1)} m · {money(Number(p.total_pagar))}
            <span className="sub" style={{ display: "block", fontSize: 12 }}>
              {[prendaDe(p.prenda_id), proveedorDe(p), `pedido ${fmtFecha(p.fecha_pedido)}`,
                p.ancho_real != null ? `ancho ${p.ancho_real} cm` : null].filter(Boolean).join(" · ")}
              <br />
              {(p.colores ?? []).map((c) => `${c.color} ${Number(c.metros).toFixed(1)} m`).join(" · ")}
            </span>
          </span>
        </label>
      ))}

      {elegidos.length >= 2 && (
        <div style={{ marginTop: 12 }}>
          {vista.nombres.length > 1 && (
            <div style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 8 }}>
              ⚠ Los nombres son distintos: {vista.nombres.join(" y ")}. Revisa que sea la misma tela.
            </div>
          )}
          <Campo label="Nombre de la tela">
            <input className="pinput" value={nombre || elegidos[0].nombre_tela} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo label="Ancho con el que queda (cm)">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {vista.anchos.length > 1 && vista.anchos.map((a, i) => (
                <button key={a} type="button" className={`btn${Number(anchoTexto) === a ? " primary" : ""}`}
                  style={{ padding: "4px 10px", fontSize: 12.5 }} onClick={() => setAncho(String(a))}>
                  {a} cm{i === 0 ? " (el más pequeño)" : ""}
                </button>
              ))}
              <input className="pinput" type="number" step="0.01" min="0" style={{ width: 110 }} placeholder="Otro"
                value={anchoTexto} onChange={(e) => setAncho(e.target.value)} />
            </div>
            {anchoError && <div style={{ fontSize: 12.5, color: "var(--warn)", marginTop: 4 }}>{anchoError}</div>}
          </Campo>
          {hayVarias && (
            <Campo label="Eran para prendas distintas: ¿para cuál es la tela?" requerido>
              <select className="pinput" value={prendaId} onChange={(e) => setPrendaId(e.target.value)}>
                <option value="">— Elige —</option>
                {vista.prendaIds.map((id) => <option key={id} value={id}>{prendaDe(id) ?? "Prenda"}</option>)}
              </select>
            </Campo>
          )}
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginTop: 8 }}>
            <b>Quedará así:</b> {vista.totalMetros.toFixed(1)} m · {money(vista.totalPagar)} · {money(vista.valorMetro)} el metro
            {anchoCm != null && ` · ancho ${anchoCm} cm`}
            <div className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
              {vista.colores.map((c) => `${c.color} ${c.metros.toFixed(1)} m`).join(" · ")}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
