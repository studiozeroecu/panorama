"use client";

import { useMemo, useState } from "react";

export interface StockAlertRow {
  codigo: string;
  descripcion: string;
  local: string;
  venta: number;
  exist: number;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function StockPill({ exist }: { exist: number }) {
  let cls = "stock-ok";
  let label: string | number = exist;
  if (exist <= 0) {
    cls = "stock-crit";
    label = exist < 0 ? exist : "0 · agotado";
  } else if (exist <= 3) {
    cls = "stock-low";
  }
  return (
    <span className={`stock-pill ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export default function StockAlerts({
  rows,
  locales,
}: {
  rows: StockAlertRow[];
  locales: string[];
}) {
  const [term, setTerm] = useState("");
  const [local, setLocal] = useState("");

  const list = useMemo(() => {
    const t = norm(term);
    let l = rows;
    if (local) l = l.filter((x) => x.local === local);
    if (t) {
      l = l.filter((x) => norm(x.codigo).includes(t) || norm(x.descripcion).includes(t));
    }
    return l.slice(0, 100);
  }, [rows, term, local]);

  return (
    <section>
      <div className="section-head">
        <h2>
          Alertas de stock{" "}
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            · existencia ≤ 5 con movimiento en el periodo
          </span>
        </h2>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={local} onChange={(e) => setLocal(e.target.value)}>
            <option value="">Todos los locales</option>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            className="search"
            placeholder="Buscar producto o código…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      </div>
      {!list.length ? (
        <div className="empty">Sin alertas de stock bajo para este filtro.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Local</th>
                <th style={{ textAlign: "right" }}>Vendido (periodo)</th>
                <th style={{ textAlign: "right" }}>Existencia</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x, i) => (
                <tr key={`${x.codigo}-${x.local}-${i}`}>
                  <td className="code">{x.codigo}</td>
                  <td>{x.descripcion}</td>
                  <td>
                    <span className="local-tag">{x.local}</span>
                  </td>
                  <td className="num">{x.venta < 0 ? Math.abs(x.venta) : 0}</td>
                  <td className="num">
                    <StockPill exist={x.exist} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
