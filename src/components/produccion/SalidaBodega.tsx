"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Campo, Fila } from "@/components/ui";
import { money, TALLA_ORDER, type ColorMaquila, type EntregaMaquila } from "@/lib/produccion/types";
import { hoyEcuador } from "@/lib/fechas";
import { nuevoId } from "@/lib/id";
import { ProduccionCard, type FilaEnvio, type Grupo } from "./EnvioTab";

/**
 * Fase 8y: mandar desde la bodega mercadería de antes de la app (hoodies,
 * camisetas…) a locales o a una feria, básica o estampada. Se escribe como en
 * la hoja de papel —prenda, costo y colores × tallas— y luego se reparte con
 * la MISMA tarjeta de Envío. Las estampadas quedan en Estampados, listas para
 * la orden de impresión.
 */
interface FilaHoja {
  id: string;
  color: string;
  tallas: Record<string, string>;
}

const OTRA = "__otra__";

export default function SalidaBodega({ alCerrar }: { alCerrar: () => void }) {
  const { data } = useProd();
  const [prendaId, setPrendaId] = useState("");
  const [prendaTexto, setPrendaTexto] = useState("");
  const [costo, setCosto] = useState("");
  // El id de cada fila se genera al escribirla: es la clave que impide repartir dos veces.
  const [filas, setFilas] = useState<FilaHoja[]>(() => [{ id: nuevoId(), color: "", tallas: {} }]);
  const [salidaId] = useState(() => nuevoId());
  const [listo, setListo] = useState(false);

  const prenda = prendaId && prendaId !== OTRA ? data.prendas.find((p) => p.id === prendaId) : undefined;
  const prendaNombre = (prenda?.nombre ?? prendaTexto).trim();
  const c = parseFloat(costo);
  const und = (f: FilaHoja) => Object.values(f.tallas).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  const conDatos = filas.filter((f) => f.color.trim() && und(f) > 0);
  const colores = conDatos.map((f) => f.color.trim().toLowerCase());
  const repetidos = colores.length !== new Set(colores).size;
  const valido = prendaNombre && Number.isFinite(c) && c >= 0 && conDatos.length > 0 && !repetidos;

  if (listo && valido) {
    const fecha = hoyEcuador();
    const grupo: Grupo = {
      corte: undefined,
      pedido: undefined,
      prenda: prenda ?? null,
      filas: conDatos.map((f): FilaEnvio => {
        const tallas = Object.fromEntries(
          Object.entries(f.tallas).map(([t, v]) => [t, parseInt(v, 10) || 0]).filter(([, n]) => (n as number) > 0)
        ) as Record<string, number>;
        const unidades = und(f);
        const col: ColorMaquila = {
          id: f.id, corte_color_id: f.id, color: f.color.trim(), parte: null, tono: null, costo_unitario: null,
          tallas, unidades, estado: "entregado", fecha_envio: null, fecha_entrega: null, procesado: false, entregas: [],
        };
        const entrega: EntregaMaquila = { id: f.id, fecha, tallas, unidades, procesado: false, tipo: "entrega", motivo: "" };
        return { col, entrega, etiqueta: f.color.trim(), produccion: c };
      }),
    };
    return (
      <div>
        <button className="btn" style={{ fontSize: 12, marginBottom: 8 }} onClick={() => setListo(false)}>← Volver a la hoja</button>
        <ProduccionCard grupo={grupo}
          manual={{ salidaId, prendaId: prenda?.id ?? null, prendaNombre, alTerminar: alCerrar }} />
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Mandar desde bodega · mercadería que no está en el sistema</div>
      <Fila>
        <Campo label="Prenda" requerido>
          <select className="pinput" value={prendaId} onChange={(e) => setPrendaId(e.target.value)}>
            <option value="">— Elige —</option>
            {data.prendas.filter((p) => !p.archivada_en).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            <option value={OTRA}>Otra (escribir)</option>
          </select>
        </Campo>
        {prendaId === OTRA && (
          <Campo label="Nombre de la prenda" requerido>
            <input className="pinput" placeholder="Ej: Hoodie básico" value={prendaTexto} onChange={(e) => setPrendaTexto(e.target.value)} />
          </Campo>
        )}
        <Campo label="Costo de producción por prenda ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={costo} onChange={(e) => setCosto(e.target.value)} />
        </Campo>
      </Fila>

      <div className="table-scroll" style={{ marginBottom: 8 }}>
        <table style={{ width: "auto", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ padding: "5px 6px", textAlign: "left" }}>Color</th>
              {TALLA_ORDER.map((t) => <th key={t} style={{ padding: "5px 6px", textAlign: "center" }}>{t}</th>)}
              <th style={{ padding: "5px 6px", textAlign: "center" }}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.id}>
                <td style={{ padding: "5px 6px" }}>
                  <input className="pinput" style={{ minWidth: 110 }} placeholder="Ej: Negro" value={f.color}
                    onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
                </td>
                {TALLA_ORDER.map((t) => (
                  <td key={t} style={{ padding: "5px 6px", textAlign: "center" }}>
                    <input className="pinput" type="number" min="0" inputMode="numeric"
                      style={{ width: 54, textAlign: "center", padding: "6px 4px" }} value={f.tallas[t] ?? ""}
                      onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, tallas: { ...x.tallas, [t]: e.target.value } } : x)))} />
                  </td>
                ))}
                <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 600 }} className="num">{und(f)}</td>
                <td>
                  <button className="btn" style={{ padding: "4px 10px" }} disabled={filas.length === 1}
                    onClick={() => setFilas(filas.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" style={{ fontSize: 12, marginBottom: 10 }}
        onClick={() => setFilas([...filas, { id: nuevoId(), color: "", tallas: {} }])}>+ Color</button>

      <div className="sub" style={{ fontSize: 12.5, marginBottom: 10 }}>
        {conDatos.reduce((s, f) => s + und(f), 0)} prendas
        {Number.isFinite(c) && c >= 0 && ` · ${money(c)} c/u de producción`}
        {repetidos && <span style={{ color: "var(--warn)" }}> · hay un color repetido</span>}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={alCerrar}>Cancelar</button>
        <button className="btn primary" disabled={!valido} onClick={() => setListo(true)}>Continuar al reparto →</button>
      </div>
    </div>
  );
}
