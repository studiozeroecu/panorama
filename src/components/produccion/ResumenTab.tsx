"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { money } from "@/lib/produccion/types";
import { mesActual, enMes } from "@/lib/produccion/fechas";

/**
 * Resumen mensual coherente (bug corregido de la app vieja): ingresos y
 * costos son DEL MISMO PERIODO. Antes se restaban costos del mes contra
 * ventas históricas acumuladas a precio equivocado.
 */
export default function ResumenTab() {
  const { data } = useProd();
  const [mes, setMes] = useState(mesActual());

  const mesLabel = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("es-EC", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // ── costos del periodo ──────────────────────────────
  const pedidosMes = data.pedidos.filter((p) => enMes(p.fecha_pedido, mes));
  const costoTela = pedidosMes.reduce((s, p) => s + Number(p.total_pagar), 0);

  const cortesMes = data.cortes.filter((c) => enMes(c.fecha, mes));
  const unidadesCortadas = cortesMes.reduce((s, c) => s + c.total_unidades, 0);
  const corteIds = new Set(cortesMes.map((c) => c.id));
  const costoMaquila = data.maquilas
    .filter((m) => corteIds.has(m.corte_id))
    .reduce((s, m) => s + Number(m.costo_unitario) * m.total_unidades, 0);

  const cfPorUnidad = data.costosFijos.reduce((s, c) => s + Number(c.valor), 0);
  const costoFijos = cfPorUnidad * unidadesCortadas;

  const lotesMes = data.lotesEstampado.filter((l) => enMes(l.fecha_envio, mes));
  const costoEstampado = lotesMes.reduce((s, l) => s + Number(l.costo_total), 0);
  const unidadesEstampadas = lotesMes.reduce((s, l) => s + l.total_unidades, 0);

  const costoTotal = costoTela + costoMaquila + costoFijos + costoEstampado;

  // ── ingresos del periodo ────────────────────────────
  const ventasMes = data.ventasOnline.filter((v) => enMes(v.fecha, mes));
  const ingresoOnline = ventasMes.reduce((s, v) => s + Number(v.total), 0);
  const unidadesVendidas = ventasMes.reduce((s, v) => s + v.cantidad, 0);

  const envLocMes = data.enviosLocales.filter((e) => enMes(e.fecha, mes));
  const ingresoLocales = envLocMes.reduce((s, e) => s + Number(e.ingreso), 0);
  const unidadesLocales = envLocMes.reduce((s, e) => s + e.unidades, 0);

  const ingresoTotal = ingresoOnline + ingresoLocales;
  const resultado = ingresoTotal - costoTotal;

  const stockActual = data.stock.reduce((s, v) => s + v.disponibles, 0);

  const filaCosto = (concepto: string, base: string, total: number) => (
    <tr>
      <td>{concepto}<div className="sub" style={{ fontSize: 11.5 }}>{base}</div></td>
      <td className="num">{money(total)}</td>
    </tr>
  );

  return (
    <section>
      <div className="section-head">
        <h2>Resumen mensual</h2>
        <input className="pinput" type="month" style={{ width: 170 }} value={mes}
          onChange={(e) => setMes(e.target.value)} />
      </div>

      <div className="cards" style={{ marginBottom: 24 }}>
        <div className="card"><div className="label">Pedidos de tela</div><div className="value">{pedidosMes.length}</div><div className="hint">{money(costoTela)} en tela</div></div>
        <div className="card"><div className="label">Unidades cortadas</div><div className="value">{unidadesCortadas}</div><div className="hint">{cortesMes.length} corte{cortesMes.length !== 1 ? "s" : ""}</div></div>
        <div className="card"><div className="label">Vendidas en el mes</div><div className="value">{unidadesVendidas + unidadesLocales}</div><div className="hint">{unidadesVendidas} online · {unidadesLocales} a locales</div></div>
        <div className="card"><div className="label">Stock online actual</div><div className="value">{stockActual}</div><div className="hint">unidades disponibles hoy</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <div>
          <div className="label" style={{ marginBottom: 10 }}>Costos de {mesLabel}</div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Concepto</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
              <tbody>
                {filaCosto("Tela", `${pedidosMes.length} pedido${pedidosMes.length !== 1 ? "s" : ""} del mes`, costoTela)}
                {filaCosto("Maquila", `${unidadesCortadas} und. cortadas × costo/und.`, costoMaquila)}
                {filaCosto("Costos fijos", `${money(cfPorUnidad)}/und. × ${unidadesCortadas} und.`, costoFijos)}
                {filaCosto("Estampado", lotesMes.length ? `${unidadesEstampadas} und. enviadas al taller` : "sin lotes en el mes", costoEstampado)}
                <tr>
                  <td style={{ fontWeight: 600 }}>COSTO TOTAL</td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(costoTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: 10 }}>Ingresos de {mesLabel}</div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Fuente</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
              <tbody>
                {filaCosto("Ventas online", `${unidadesVendidas} und. con precio real`, ingresoOnline)}
                {filaCosto("Envíos a locales", `${unidadesLocales} und. a precio local`, ingresoLocales)}
                <tr>
                  <td style={{ fontWeight: 600 }}>INGRESO TOTAL</td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(ingresoTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 14, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
              <span className="sub">Ingresos del mes</span><span className="num">{money(ingresoTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
              <span className="sub">Costos del mes</span>
              <span className="num" style={{ color: "var(--bad)" }}>−{money(costoTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>RESULTADO DE {mesLabel.toUpperCase()}</span>
              <span className="num" style={{ fontWeight: 600, fontSize: 19, color: resultado >= 0 ? "var(--good)" : "var(--bad)" }}>
                {resultado >= 0 ? "+" : ""}{money(resultado)}
              </span>
            </div>
            <p className="sub" style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
              Ingresos y costos corresponden al mismo mes. Ojo: la tela comprada en un mes puede
              producir ventas en meses siguientes — el resultado por mes es flujo, no margen por prenda.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
