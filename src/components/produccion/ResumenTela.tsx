"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal } from "@/components/ui";
import { money, type PedidoTela } from "@/lib/produccion/types";
import { estimarUnidades } from "@/lib/produccion/estimacion";
import { avanceCorte } from "@/lib/produccion/avanceCorte";
import { resumenTela, type CorteResumen } from "@/lib/produccion/resumenTela";
import { fmtFecha } from "@/lib/fechas";
import { fmtHoras } from "@/lib/produccion/horas";

/**
 * El nombre de una tela, clicable: abre el resumen de lo que lleva gastado,
 * en la etapa en que esté. Se usa en todas las pestañas donde sale una tela
 * (Pedidos, Llegada, Corte, Maquila, Envío), así el resumen está a un toque
 * desde cualquier fase.
 *
 * Solo admin: vive en /produccion. Las cuentas están en
 * src/lib/produccion/resumenTela.ts.
 */
export default function NombreTela({
  pedido,
  children,
}: {
  pedido: PedidoTela | null | undefined;
  /** Lo que se muestra como enlace; por defecto, el nombre de la tela. */
  children?: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!pedido) return <>{children ?? "(pedido eliminado)"}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Ver cuánto lleva gastado esta tela"
        style={{
          background: "none", border: "none", padding: 0, font: "inherit",
          color: "inherit", cursor: "pointer", textAlign: "left",
          textDecoration: "underline dotted", textUnderlineOffset: 3,
        }}
      >
        {children ?? pedido.nombre_tela}
      </button>
      {abierto && <ModalResumen pedido={pedido} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function ModalResumen({ pedido, onCerrar }: { pedido: PedidoTela; onCerrar: () => void }) {
  const { data } = useProd();
  const prenda = data.prendas.find((x) => x.id === pedido.prenda_id);
  const proveedor = data.proveedores.find((x) => x.id === pedido.proveedor_id);
  const cortes = data.cortes.filter((c) => c.pedido_id === pedido.id);

  const cortesResumen: CorteResumen[] = cortes.map((c) => {
    const maquila = data.maquilas.find((m) => m.corte_id === c.id);
    return {
      corte: c,
      costoMaquilaUnitario: maquila ? Number(maquila.costo_unitario) : 0,
      // Fase 8r: cada parte de un conjunto con su precio de maquila.
      coloresMaquila: (maquila?.colores ?? []).map((col) => ({
        unidades: col.unidades, entregas: col.entregas, costoUnitario: col.costo_unitario, parte: col.parte,
      })),
      jornadas: c.jornadas,
      insumos: c.insumos,
      estampado: maquila
        ? data.lotesEstampado.filter((l) => l.maquila_id === maquila.id)
            .reduce((s, l) => s + Number(l.costo_total), 0)
        : 0,
    };
  });

  const r = resumenTela({
    pedido,
    unidadesEstimadas: estimarUnidades(prenda, Number(pedido.total_metros)),
    cortes: cortesResumen,
    // Por prenda, como en Envío y Resumen: la suma de todos los costos fijos.
    costoFijoPorUnidad: data.costosFijos.reduce((s, f) => s + Number(f.valor), 0),
  });
  const cortadaCompleta =
    cortes.length > 0 && avanceCorte(pedido.total_metros, pedido.colores ?? [], cortes).listo;
  const nombresMaquiladoras = [...new Set(
    cortes
      .map((c) => data.maquilas.find((m) => m.corte_id === c.id)?.maquiladora_id)
      .map((id) => data.maquiladoras.find((x) => x.id === id)?.nombre)
      .filter((n): n is string => !!n)
  )];

  const recibida = pedido.estado === "entregado";

  return (
    <Modal titulo={`Resumen — ${pedido.nombre_tela}`} abierto onCerrar={onCerrar} ancho={620}
      pie={<button className="btn" onClick={onCerrar}>Cerrar</button>}>
      {/* Lo que más se mira, arriba. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Cifra titulo="Gastado hasta ahora" valor={money(r.gastado)} />
        <Cifra titulo="Costo estimado final" valor={money(r.estimadoFinal)} />
        <Cifra
          titulo={`Costo por prenda${r.unidadesEstimadas ? " (estimado)" : ""}`}
          valor={r.costoUnitario != null ? money(r.costoUnitario) : "—"}
          resaltado
          nota={r.unidades != null ? `${r.unidades} prendas${r.unidadesEstimadas ? " estimadas" : ""}` : "sin prenda o consumo"}
        />
      </div>

      <Etapa icono="🧾" titulo="Tela" hecha valor={money(r.tela.total)}>
        {fmtFecha(pedido.fecha_pedido)} · {r.tela.metros.toFixed(1)} m × {money(r.tela.valorMetro)}
        {proveedor ? ` · ${proveedor.empresa}` : ""}
        {prenda ? ` · para ${prenda.nombre}` : ""}
        {r.telaPorUnidad != null && (
          <div className="sub" style={{ fontSize: 12 }}>
            Tela por prenda: {money(r.telaPorUnidad)}
            {r.unidadesEstimadas && " (con el consumo por prenda; se ajusta al cortar)"}
          </div>
        )}
      </Etapa>

      <Etapa icono="📦" titulo="Llegada" hecha={recibida}>
        {recibida
          ? <>Llegó el {fmtFecha(pedido.fecha_entrega_real)}{pedido.ancho_real != null && ` · ancho ${pedido.ancho_real} cm`}</>
          : pedido.estado === "en_camino" ? "En camino" : "Pedida, todavía no sale"}
      </Etapa>

      <Etapa icono="✂️" titulo="Corte" hecha={r.cortes > 0}
        valor={r.cortes > 0 ? money(r.corte.valor) : undefined}>
        {r.cortes === 0 ? "Todavía no se corta" : (
          <>
            {r.cortes} corte{r.cortes !== 1 ? "s" : ""} · {r.cortadas} prendas cortadas
            {r.corte.horas > 0 && ` · ${fmtHoras(r.corte.horas)} de corte`}
            {(r.insumos.valor > 0 || r.insumos.sinCosto > 0) && (
              <div style={{ marginTop: 3 }}>
                Insumos: {money(r.insumos.valor)}
                {r.insumos.sinCosto > 0 && (
                  <span style={{ color: "var(--warn)" }}> · {r.insumos.sinCosto} sin costo (ponlo en Corte)</span>
                )}
              </div>
            )}
          </>
        )}
      </Etapa>

      <Etapa icono="🧵" titulo="Maquila" hecha={r.cortes > 0}
        valor={r.cortes > 0 ? money(r.maquila.aPagar) : undefined}>
        {r.cortes === 0 ? "Todavía no va a maquila" : (
          <>
            {nombresMaquiladoras.length ? nombresMaquiladoras.join(", ") : "Maquiladora sin asignar"}
            {" · "}{r.maquila.buenas} entregadas bien
            {r.maquila.pendientes > 0 && ` · ${r.maquila.pendientes} en maquila`}
            {r.maquila.fallas > 0 && <span style={{ color: "var(--warn)" }}> · {r.maquila.fallas} con fallas</span>}
            {r.maquila.faltantes > 0 && <span style={{ color: "var(--warn)" }}> · {r.maquila.faltantes} no entregadas</span>}
            {r.maquila.pendientes > 0 && (
              <div className="sub" style={{ fontSize: 12 }}>
                Si entrega bien lo que falta: {money(r.maquila.esperado)} en total
              </div>
            )}
          </>
        )}
      </Etapa>

      <Etapa icono="🏷️" titulo="Costos fijos" hecha={r.fijos.porUnidad > 0}
        valor={r.fijos.porUnidad > 0 ? money(r.fijos.estimado) : undefined}>
        {r.fijos.porUnidad > 0 ? (
          <>
            Etiquetas, fundas… · {money(r.fijos.porUnidad)} por prenda
            {r.unidades != null && ` × ${r.unidades}${r.unidadesEstimadas ? " estimadas" : ""}`}
            {r.fijos.gastado !== r.fijos.estimado && (
              <div className="sub" style={{ fontSize: 12 }}>
                De lo ya entregado bien: {money(r.fijos.gastado)}
              </div>
            )}
          </>
        ) : "No hay costos fijos cargados (Producción → Costos)."}
      </Etapa>

      {r.estampado > 0 && (
        <Etapa icono="🎨" titulo="Estampado" hecha valor={money(r.estampado)}>
          Lotes enviados a estampar
        </Etapa>
      )}

      {/* Los avisos que cambian cómo leer los números. */}
      <div className="sub" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
        {r.cortes > 0 && !cortadaCompleta && (
          <div style={{ color: "var(--warn)" }}>
            ⚠️ La tela aún no se termina de cortar: el costo por prenda sale alto porque la tela entera
            se reparte entre las {r.unidades} prendas cortadas. Baja al cortar el resto.
          </div>
        )}
        <div>Los costos fijos se toman con su valor de hoy: si cambias uno, cambia también aquí.</div>
      </div>
    </Modal>
  );
}

function Cifra({ titulo, valor, nota, resaltado }: {
  titulo: string; valor: string; nota?: string; resaltado?: boolean;
}) {
  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="label" style={{ fontSize: 10.5 }}>{titulo}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: resaltado ? "var(--accent)" : undefined }}>{valor}</div>
      {nota && <div className="sub" style={{ fontSize: 11.5 }}>{nota}</div>}
    </div>
  );
}

/** Una fila de la línea de tiempo; las etapas aún no alcanzadas salen apagadas. */
function Etapa({ icono, titulo, hecha, valor, children }: {
  icono: string; titulo: string; hecha: boolean; valor?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid var(--border)",
      opacity: hecha ? 1 : 0.55, fontSize: 13,
    }}>
      <div style={{ fontSize: 18, lineHeight: 1.2 }}>{icono}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <b>{titulo}</b>
          {valor && <b className="num">{valor}</b>}
        </div>
        <div style={{ marginTop: 2 }}>{children}</div>
      </div>
    </div>
  );
}
