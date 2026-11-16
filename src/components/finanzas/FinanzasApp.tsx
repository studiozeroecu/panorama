"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import VistaPeriodo from "./VistaPeriodo";
import Deudas from "./Deudas";
import PorCobrar from "./PorCobrar";
import VentasDirectas from "./VentasDirectas";
import MiSueldo from "./MiSueldo";
import FijosEstimados from "./FijosEstimados";
import Tarjetas, { AvisoCortes } from "./Tarjetas";
import Caja from "./Caja";

const TABS = [
  { id: "quincena", label: "Quincena" },
  { id: "mes", label: "Mes" },
  { id: "deudas", label: "Deudas" },
  { id: "fijos", label: "Fijos y estimados" },
  { id: "tarjetas", label: "Tarjetas" },
  { id: "caja", label: "Caja" },
  { id: "cobrar", label: "Por cobrar" },
  { id: "ventas", label: "Ventas directas" },
  { id: "sueldo", label: "Mi sueldo" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Finanzas v2. Cada pestaña carga sus propios datos (src/lib/finanzas/cargar.ts)
 * y si algo falla lo muestra en vez de enseñar totales incompletos.
 */
export default function FinanzasApp() {
  const [tab, setTab] = useState<TabId>("quincena");
  const [toast, setToast] = useState<string | null>(null);
  // sube cuando algo de afuera de la pestaña cambia datos (aviso de cortes): la pestaña se vuelve a cargar
  const [version, setVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback((m: string) => {
    setToast(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            <Link href="/" style={{ color: "var(--accent)" }}>← Panorama</Link>
          </p>
          <h1>Finanzas</h1>
          <p className="sub">Qué hay que pagar por quincena y por mes: deudas, gastos fijos, tarjetas y estimados; y si la caja cuadra.</p>
        </div>
      </header>

      <AvisoCortes avisar={avisar} onCambio={() => setVersion((v) => v + 1)} />

      <nav className="prod-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`prod-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div key={version}>
        {tab === "quincena" && <VistaPeriodo key="quincena" tipo="quincena" avisar={avisar} />}
        {tab === "mes" && <VistaPeriodo key="mes" tipo="mes" avisar={avisar} />}
        {tab === "deudas" && <Deudas avisar={avisar} />}
        {tab === "fijos" && <FijosEstimados avisar={avisar} />}
        {tab === "tarjetas" && <Tarjetas avisar={avisar} />}
        {tab === "caja" && <Caja avisar={avisar} />}
        {tab === "cobrar" && <PorCobrar avisar={avisar} />}
        {tab === "ventas" && <VentasDirectas avisar={avisar} />}
        {tab === "sueldo" && <MiSueldo avisar={avisar} />}
      </div>

      {toast && <div className="prod-toast">✓ {toast}</div>}
    </div>
  );
}
