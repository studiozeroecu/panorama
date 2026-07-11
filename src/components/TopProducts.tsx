"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/format";

export interface TopProductRow {
  codigo: string;
  descripcion: string;
  cantidad: number;
  pvp: number;
  neto: number | null;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

export default function TopProducts({ rows }: { rows: TopProductRow[] }) {
  const [term, setTerm] = useState("");

  const list = useMemo(() => {
    const t = norm(term);
    let l = rows;
    if (t) {
      l = l.filter((x) => norm(x.codigo).includes(t) || norm(x.descripcion).includes(t));
    }
    return l.slice(0, 25);
  }, [rows, term]);

  return (
    <section>
      <div className="section-head">
        <h2>Más vendidos (por ingreso neto)</h2>
        <input
          className="search"
          placeholder="Buscar producto o código…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      {!list.length ? (
        <div className="empty">Sin resultados.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th style={{ textAlign: "right" }}>Cant.</th>
                <th style={{ textAlign: "right" }}>PVP</th>
                <th style={{ textAlign: "right" }}>Neto (61.2%)</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x, i) => (
                <tr key={`${x.codigo}-${i}`}>
                  <td className="code">{x.codigo}</td>
                  <td>{x.descripcion}</td>
                  <td className="num">{x.cantidad}</td>
                  <td className="num">{money(x.pvp)}</td>
                  <td className="num">{x.neto != null ? money(x.neto) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
