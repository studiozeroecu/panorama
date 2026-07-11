"use client";

import { useState } from "react";
import Link from "next/link";
import { ProdProvider, useProd } from "./useProduccion";
import PrendasTab from "./PrendasTab";
import ProveedoresTab from "./ProveedoresTab";
import CostosTab from "./CostosTab";
import PedidosTab from "./PedidosTab";
import LlegadaTab from "./LlegadaTab";
import CorteTab from "./CorteTab";
import MaquilaTab from "./MaquilaTab";
import EnvioTab from "./EnvioTab";
import EstampadosTab from "./EstampadosTab";
import StockTab from "./StockTab";
import ResumenTab from "./ResumenTab";

const TABS = [
  { id: "pedidos", label: "Pedidos de tela" },
  { id: "llegada", label: "Llegada" },
  { id: "corte", label: "Corte" },
  { id: "maquila", label: "Maquila" },
  { id: "envio", label: "Envío" },
  { id: "estampados", label: "Estampados" },
  { id: "stock", label: "Venta online" },
  { id: "resumen", label: "Resumen" },
  { id: "prendas", label: "Prendas" },
  { id: "proveedores", label: "Proveedores" },
  { id: "costos", label: "Costos fijos" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ProduccionApp() {
  return (
    <ProdProvider>
      <Shell />
    </ProdProvider>
  );
}

function Shell() {
  const { cargando, error, data } = useProd();
  const [tab, setTab] = useState<TabId>("pedidos");

  const contadores: Partial<Record<TabId, number>> = {
    llegada: data.pedidos.filter((p) => p.estado !== "entregado").length,
    envio: data.maquilas.reduce(
      (s, m) => s + m.colores.filter((c) => c.estado === "entregado" && !c.procesado).length,
      0
    ),
    estampados: data.lotesEstampado.filter((l) => l.estado !== "retornado").length,
  };

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            <Link href="/" style={{ color: "var(--accent)" }}>← Panorama</Link>
          </p>
          <h1>Producción — Bear &amp; Trend</h1>
          <p className="sub">Prendas, tela, corte, maquila, estampado y stock — misma base que ventas y el bot.</p>
        </div>
      </header>

      {error ? (
        <div className="error-banner">{error}</div>
      ) : cargando ? (
        <div className="empty">Cargando datos de producción…</div>
      ) : (
        <>
          <nav className="prod-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`prod-tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {(contadores[t.id] ?? 0) > 0 && <span className="count">{contadores[t.id]}</span>}
              </button>
            ))}
          </nav>

          {tab === "prendas" && <PrendasTab />}
          {tab === "proveedores" && <ProveedoresTab />}
          {tab === "costos" && <CostosTab />}
          {tab === "pedidos" && <PedidosTab />}
          {tab === "llegada" && <LlegadaTab />}
          {tab === "corte" && <CorteTab />}
          {tab === "maquila" && <MaquilaTab />}
          {tab === "envio" && <EnvioTab />}
          {tab === "estampados" && <EstampadosTab />}
          {tab === "stock" && <StockTab />}
          {tab === "resumen" && <ResumenTab />}
        </>
      )}
    </div>
  );
}
