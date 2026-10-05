"use client";

import {
  validarHoras, costoHoras, fmtHoras, MINUTOS_PERMITIDOS, TARIFA_HORA_CORTADORA,
} from "@/lib/produccion/horas";

/**
 * Horas ENTERAS + minutos de una lista, con el costo al lado. Lo usan el
 * registro del corte y "+ Horas", para que las dos pidan las horas igual.
 *
 * Sin decimales a propósito: "2.9" no es algo que alguien lea en un reloj.
 */
export default function CampoHoras({
  horas,
  minutos,
  onHoras,
  onMinutos,
}: {
  horas: string;
  minutos: string;
  onHoras: (v: string) => void;
  onMinutos: (v: string) => void;
}) {
  const v = validarHoras(horas, minutos);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        className="pinput" style={{ width: 70, textAlign: "center", fontSize: 16 }}
        type="number" inputMode="numeric" min={0} max={16} step={1} placeholder="0"
        aria-label="Horas"
        value={horas}
        // El teclado numérico del teléfono deja poner coma o punto: se bloquean
        // al teclear. Si solo se limpiaran después, "2.9" se volvería "29".
        onKeyDown={(e) => {
          if ([".", ",", "e", "E", "-", "+"].includes(e.key)) e.preventDefault();
        }}
        onChange={(e) => onHoras(/^\d*$/.test(e.target.value) ? e.target.value : horas)}
      />
      <span style={{ fontSize: 14 }}>h</span>
      <select
        className="pinput" style={{ width: 80, fontSize: 16 }}
        aria-label="Minutos"
        value={minutos} onChange={(e) => onMinutos(e.target.value)}
      >
        {MINUTOS_PERMITIDOS.map((m) => (
          <option key={m} value={String(m)}>{m}</option>
        ))}
      </select>
      <span style={{ fontSize: 14 }}>min</span>
      {/* El error se ve AL TECLEAR, no al guardar: si intentó "2.9", el punto se
          bloquea y queda "29", que aquí ya avisa. */}
      <span style={{ fontSize: 13, color: "error" in v ? "var(--warn)" : "var(--muted)" }}>
        {"error" in v
          ? `⚠️ ${v.error}`
          : v.horas != null
            ? `= ${fmtHoras(v.horas)} × $${TARIFA_HORA_CORTADORA} = $${costoHoras(v.horas).toFixed(2)}`
            : `a $${TARIFA_HORA_CORTADORA} la hora`}
      </span>
    </div>
  );
}
