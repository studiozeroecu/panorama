"use client";

import { useEffect } from "react";

export function Modal({
  titulo,
  abierto,
  onCerrar,
  children,
  ancho,
  pie,
}: {
  titulo: string;
  abierto: boolean;
  onCerrar: () => void;
  children: React.ReactNode;
  ancho?: number;
  pie?: React.ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialog" style={{ maxWidth: ancho ?? 560, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{titulo}</h3>
          <button className="btn" style={{ padding: "4px 10px" }} onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
        {pie && <div className="actions" style={{ marginTop: 18 }}>{pie}</div>}
      </div>
    </div>
  );
}

export function Campo({
  label,
  requerido,
  error,
  children,
  ancho,
}: {
  label: string;
  requerido?: boolean;
  error?: string;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div className="field" style={{ flex: 1, minWidth: ancho ?? 140, marginBottom: 12 }}>
      <label>
        {label}
        {requerido && <span style={{ color: "var(--bad)" }}> *</span>}
      </label>
      {children}
      {error && <span style={{ color: "var(--bad)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}

export function Fila({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>;
}

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  gris: { bg: "var(--surface-2)", fg: "var(--muted)" },
  azul: { bg: "var(--accent-soft)", fg: "var(--accent)" },
  verde: { bg: "rgba(107,169,124,0.14)", fg: "var(--good)" },
  ambar: { bg: "rgba(217,164,65,0.14)", fg: "var(--warn)" },
  rojo: { bg: "var(--bad-soft)", fg: "var(--bad)" },
};

export function Badge({
  color = "gris",
  children,
}: {
  color?: keyof typeof BADGE_COLORS;
  children: React.ReactNode;
}) {
  const c = BADGE_COLORS[color] ?? BADGE_COLORS.gris;
  return (
    <span
      style={{
        display: "inline-block",
        background: c.bg,
        color: c.fg,
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 11.5,
        fontFamily: "var(--font-mono), monospace",
        margin: 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Vacio({ titulo, hint }: { titulo: string; hint?: string }) {
  return (
    <div className="card empty" style={{ padding: 36 }}>
      <p style={{ margin: 0 }}>{titulo}</p>
      {hint && <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>{hint}</p>}
    </div>
  );
}

/** Distribución de tallas como badges (S:6 M:4 …). */
export function Tallas({ tallas }: { tallas: Record<string, number> }) {
  const entries = Object.entries(tallas ?? {}).filter(([, v]) => v > 0);
  if (!entries.length) return <span className="sub">—</span>;
  return (
    <>
      {entries.map(([t, v]) => (
        <Badge key={t}>{t}:{v}</Badge>
      ))}
    </>
  );
}
