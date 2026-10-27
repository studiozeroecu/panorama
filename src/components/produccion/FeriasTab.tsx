"use client";

import { useCallback, useEffect, useState } from "react";
import { useProd } from "./useProduccion";
import { Campo, Fila, Badge, Vacio } from "@/components/ui";
import { money, ordenarTallas, TALLA_ORDER, type Feria, type IngresoFeria } from "@/lib/produccion/types";
import { fmtFecha, hoyEcuador } from "@/lib/fechas";
import { COSTO_OPERATIVO, tallasLimpias, sumaTallas, type TallasTexto } from "@/lib/produccion/reparto";
import {
  lineasFeria,
  resumenFeria,
  problemasCierre,
  retornosParaBase,
  vendidasPorTalla,
  type CierreForm,
  type LineaFeria,
  type RetornoFeria,
} from "@/lib/produccion/ferias";

/**
 * Ferias — fase 8u. Lo que fue a cada feria (desde Envío, del taller de
 * estampado o mercadería estancada), su cierre y lo vendido.
 *
 * Lo vendido se CALCULA (fue − regresó); las ganancias las anota el dueño en
 * Finanzas. Los regresos se cargan aquí y no en useProduccion: así, si la
 * fase 8u faltara en la base, solo esta pestaña lo dice y el resto sigue.
 */
export default function FeriasTab() {
  const { data, supabase } = useProd();
  const [retornos, setRetornos] = useState<RetornoFeria[] | null>(null);
  const [errorRetornos, setErrorRetornos] = useState<string | null>(null);

  const cargarRetornos = useCallback(async () => {
    const { data: r, error } = await supabase.from("prod_feria_retornos").select("*");
    if (error) setErrorRetornos(error.message);
    else setRetornos((r ?? []) as RetornoFeria[]);
  }, [supabase]);

  useEffect(() => {
    cargarRetornos();
  }, [cargarRetornos, data]);

  const ferias = [...data.ferias].sort((a, b) =>
    a.cerrada_en && !b.cerrada_en ? 1 : !a.cerrada_en && b.cerrada_en ? -1 : b.fecha.localeCompare(a.fecha)
  );

  return (
    <section>
      <div className="section-head">
        <h2>Ferias <span className="sub" style={{ fontWeight: 400 }}>· lo que va, lo que regresa y lo vendido, con su costo</span></h2>
      </div>

      {errorRetornos && (
        <div className="error-banner" style={{ marginBottom: 12 }}>
          Falta aplicar la fase 8u en la base (cierre de ferias). Detalle: {errorRetornos}
        </div>
      )}

      <NuevaFeria />

      {!ferias.length ? (
        <Vacio titulo="Sin ferias todavía" hint='Créala aquí o desde Envío, marcando el destino "Feria".' />
      ) : (
        ferias.map((f) => <FeriaCard key={f.id} feria={f} retornos={retornos ?? []} alCambiar={cargarRetornos} />)
      )}
    </section>
  );
}

function NuevaFeria() {
  const { supabase, reload, toast } = useProd();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    if (!nombre.trim() || ocupado) return;
    setOcupado(true);
    const { error } = await supabase.from("prod_ferias").insert({ nombre: nombre.trim(), fecha });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    toast("Feria creada");
    setNombre("");
    setAbierto(false);
    await reload();
  }

  if (!abierto) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setAbierto(true)}>+ Nueva feria</button>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <Fila>
        <Campo label="Nombre de la feria">
          <input className="pinput" placeholder="Ej: Feria Navideña CCI" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Campo>
        <Campo label="Fecha">
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <div style={{ alignSelf: "flex-end", paddingBottom: 14, display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={!nombre.trim() || ocupado} onClick={crear}>{ocupado ? "Creando…" : "Crear feria"}</button>
          <button className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
        </div>
      </Fila>
    </div>
  );
}

const ORIGEN: Record<IngresoFeria["origen"], { texto: string; color: "azul" | "ambar" | "gris" }> = {
  envio: { texto: "Producción", color: "azul" },
  estampado: { texto: "Del taller", color: "ambar" },
  estancada: { texto: "Estancada", color: "gris" },
};

const CELDA = { padding: "6px 8px", textAlign: "center" as const };

function FeriaCard({ feria, retornos, alCambiar }: { feria: Feria; retornos: RetornoFeria[]; alCambiar: () => Promise<void> }) {
  const { data } = useProd();
  const [modo, setModo] = useState<"ver" | "estancada" | "cerrar">("ver");
  const cerrada = !!feria.cerrada_en;
  const ingresos = data.feriaIngresos.filter((i) => i.feria_id === feria.id);
  const lineas = lineasFeria(ingresos, retornos.filter((r) => r.feria_id === feria.id));
  const r = resumenFeria(lineas);
  // Estampadas que van a esta feria y siguen en el taller: si se cerrara ahora,
  // llegarían a una feria ya cerrada.
  const enTaller = data.lotesEstampado.filter((l) => l.destino === "feria" && l.feria_id === feria.id && l.estado !== "retornado");
  const unidadesEnTaller = enTaller.reduce((s, l) => s + Number(l.total_unidades), 0);

  return (
    <div className="prod-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h4>
            {feria.nombre}{" "}
            {cerrada ? <Badge color="gris">Cerrada</Badge> : <Badge color="verde">Abierta</Badge>}
          </h4>
          <div className="prod-meta">
            {fmtFecha(feria.fecha)}
            {cerrada && ` · cerrada ${fmtFecha(feria.cerrada_en!.slice(0, 10))}`}
          </div>
        </div>
        {!cerrada && modo === "ver" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setModo("estancada")}>+ Mercadería estancada</button>
            <button className="btn primary" disabled={!ingresos.length || enTaller.length > 0} onClick={() => setModo("cerrar")}>
              Cerrar feria
            </button>
          </div>
        )}
      </div>

      {/* Las cifras de la feria, grandes y aparte, como en Bodega. */}
      <div className="cards" style={{ margin: "12px 0" }}>
        <div className="card">
          <div className="label">Fueron</div>
          <div className="value">{r.fueron}</div>
          <div className="hint">{unidadesEnTaller > 0 ? `+ ${unidadesEnTaller} aún en el taller` : "prendas"}</div>
        </div>
        <div className="card">
          <div className="label">Costo de lo que fue</div>
          <div className="value">{money(r.costoEnviado)}</div>
          <div className="hint">producción + estampado + operativo</div>
        </div>
        {cerrada ? (
          <>
            <div className="card">
              <div className="label">Vendidas</div>
              <div className="value" style={{ color: "var(--good)" }}>{r.vendidas}</div>
              <div className="hint">regresaron {r.regresaron}</div>
            </div>
            <div className="card">
              <div className="label">Costo de lo vendido</div>
              <div className="value">{money(r.costoVendido)}</div>
              <div className="hint">compáralo con lo que anotaste en Finanzas</div>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="label">Estado</div>
            <div className="value" style={{ fontSize: 18 }}>En curso</div>
            <div className="hint">al terminar, ciérrala para saber lo vendido</div>
          </div>
        )}
      </div>

      {unidadesEnTaller > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 10 }}>
          ⏳ {unidadesEnTaller} estampadas para esta feria siguen en el taller. Regístralas de vuelta en Estampados
          (entran solas aquí) antes de cerrar.
        </div>
      )}

      {!lineas.length ? (
        <div className="empty" style={{ padding: 18 }}>Todavía no ha ido nada a esta feria.</div>
      ) : (
        porPrenda(lineas).map(({ prenda, filas }) => <PrendaEnFeria key={prenda} prenda={prenda} filas={filas} cerrada={cerrada} />)
      )}

      {modo === "estancada" && <Estancada feria={feria} alTerminar={() => setModo("ver")} />}
      {modo === "cerrar" && (
        <Cierre feria={feria} ingresos={ingresos} alTerminar={async () => { setModo("ver"); await alCambiar(); }} />
      )}
    </div>
  );
}

/** Las líneas de la feria agrupadas por prenda, en orden alfabético. */
function porPrenda(lineas: LineaFeria[]): { prenda: string; filas: LineaFeria[] }[] {
  const m = new Map<string, LineaFeria[]>();
  for (const l of lineas) {
    const k = l.ingreso.prenda_nombre || "Sin nombre";
    m.set(k, [...(m.get(k) ?? []), l]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prenda, filas]) => ({
      prenda,
      // Por color, y dentro de cada color primero las básicas y luego los estampados.
      filas: [...filas].sort((a, b) =>
        a.ingreso.color.localeCompare(b.ingreso.color) || a.ingreso.estampado.localeCompare(b.ingreso.estampado)),
    }));
}

/**
 * Una prenda dentro de la feria: colores en filas y tallas en columnas, como
 * en Envío. Cada fila dice si es básica o con qué estampado, y de dónde vino.
 */
function PrendaEnFeria({ prenda, filas, cerrada }: { prenda: string; filas: LineaFeria[]; cerrada: boolean }) {
  const tallas = ordenarTallas([...new Set(filas.flatMap((l) => Object.keys(l.ingreso.tallas).filter((t) => (l.ingreso.tallas[t] ?? 0) > 0)))]);
  const total = filas.reduce((s, l) => s + l.fueron, 0);
  const costo = filas.reduce((s, l) => s + l.fueron * Number(l.ingreso.costo_unitario), 0);
  const vendidas = filas.reduce((s, l) => s + l.vendidas, 0);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{prenda}</span>
        <span className="sub" style={{ fontSize: 12.5 }}>
          {total} und. · costo {money(costo)}{cerrada ? ` · vendidas ${vendidas}` : ""}
        </span>
      </div>
      <div className="table-scroll">
        <table style={{ width: "auto", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...CELDA, textAlign: "left" }}>Color</th>
              <th style={{ ...CELDA, textAlign: "left" }}>Va</th>
              {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
              <th style={CELDA}>Total</th>
              <th style={CELDA}>Costo c/u</th>
              {cerrada && <th style={CELDA}>Regresaron</th>}
              {cerrada && <th style={CELDA}>Vendidas</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((l) => (
              <tr key={l.ingreso.id}>
                <td style={{ ...CELDA, textAlign: "left", fontWeight: 600 }}>{l.ingreso.color || "—"}</td>
                <td style={{ ...CELDA, textAlign: "left" }}>
                  {l.ingreso.estampado ? <b>{l.ingreso.estampado}</b> : <span className="sub">Básica</span>}{" "}
                  <Badge color={ORIGEN[l.ingreso.origen].color}>{ORIGEN[l.ingreso.origen].texto}</Badge>
                </td>
                {tallas.map((t) => <td key={t} style={CELDA} className="num">{l.ingreso.tallas[t] || <span className="sub">—</span>}</td>)}
                <td style={{ ...CELDA, fontWeight: 700 }} className="num">{l.fueron}</td>
                <td style={CELDA} className="num">{money(Number(l.ingreso.costo_unitario))}</td>
                {cerrada && <td style={CELDA} className="num">{l.regresaron}</td>}
                {cerrada && <td style={{ ...CELDA, fontWeight: 700, color: "var(--good)" }} className="num">{l.vendidas}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Mercadería estancada: lo que se saca de los locales para venderlo con
 * descuento. Muchas son de antes de la app, así que se escribe a mano. El
 * costo que se pone es el de la prenda; la base le suma el operativo de feria.
 */
function Estancada({ feria, alTerminar }: { feria: Feria; alTerminar: () => void }) {
  const { supabase, reload, toast } = useProd();
  const [prenda, setPrenda] = useState("");
  const [color, setColor] = useState("");
  const [estampado, setEstampado] = useState("");
  const [tallas, setTallas] = useState<TallasTexto>({});
  const [costo, setCosto] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const n = sumaTallas(tallasLimpias(tallas));
  const c = parseFloat(costo);
  const valido = prenda.trim() && n > 0 && Number.isFinite(c) && c >= 0;

  async function guardar() {
    if (!valido || ocupado) return;
    setOcupado(true);
    const { error } = await supabase.rpc("fn_agregar_estancada", {
      p_feria_id: feria.id,
      p_prenda: prenda.trim(),
      p_color: color.trim(),
      p_estampado: estampado.trim(),
      p_tallas: tallasLimpias(tallas),
      p_costo: c,
    });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    toast(`${n} und. agregadas a ${feria.nombre}`);
    await reload();
    alTerminar();
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>Mercadería estancada (sacada de los locales)</div>
      <Fila>
        <Campo label="Prenda" requerido>
          <input className="pinput" placeholder="Ej: Jean clásico" value={prenda} onChange={(e) => setPrenda(e.target.value)} />
        </Campo>
        <Campo label="Color">
          <input className="pinput" placeholder="Ej: Azul" value={color} onChange={(e) => setColor(e.target.value)} />
        </Campo>
        <Campo label="Estampado (vacío = básica)">
          <input className="pinput" value={estampado} onChange={(e) => setEstampado(e.target.value)} />
        </Campo>
      </Fila>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {TALLA_ORDER.map((t) => (
          <div key={t} style={{ textAlign: "center" }}>
            <div className="sub" style={{ fontSize: 11 }}>{t}</div>
            <input className="pinput" type="number" min="0" inputMode="numeric" style={{ width: 58, textAlign: "center" }}
              value={tallas[t] ?? ""} onChange={(e) => setTallas({ ...tallas, [t]: e.target.value })} />
          </div>
        ))}
      </div>
      <Fila>
        <Campo label="Costo por prenda ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={costo} onChange={(e) => setCosto(e.target.value)} />
        </Campo>
        <div className="sub" style={{ flex: 2, alignSelf: "flex-end", fontSize: 12.5, paddingBottom: 14 }}>
          {Number.isFinite(c) && c >= 0
            ? <>+ operativo de feria {money(COSTO_OPERATIVO.feria)} = <b>{money(c + COSTO_OPERATIVO.feria)}</b> c/u · {n} und.</>
            : <>Se le suma el operativo de feria ({money(COSTO_OPERATIVO.feria)}).</>}
        </div>
      </Fila>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={alTerminar}>Cancelar</button>
        <button className="btn primary" disabled={!valido || ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Agregar a la feria"}</button>
      </div>
    </div>
  );
}

/**
 * Cierre: por cada línea y talla, cuántas regresan a la bodega y cuántas a los
 * locales (sin decir a cuál). Lo que no regresa se vendió. El operativo se
 * reemplaza: locales $2,50, bodega $0.
 */
function Cierre({ feria, ingresos, alTerminar }: { feria: Feria; ingresos: IngresoFeria[]; alTerminar: () => Promise<void> }) {
  const { supabase, reload, toast } = useProd();
  const [form, setForm] = useState<CierreForm>(() =>
    Object.fromEntries(ingresos.map((i) => [i.id, { bodega: {}, local: {} }]))
  );
  const [fecha, setFecha] = useState(hoyEcuador());
  const [ocupado, setOcupado] = useState(false);

  const problemas = problemasCierre(ingresos, form);
  const vendidas = ingresos.reduce(
    (s, i) => s + Object.values(vendidasPorTalla(i, form)).reduce((a, n) => a + Math.max(0, n), 0),
    0
  );
  const costoVendido = ingresos.reduce(
    (s, i) => s + Object.values(vendidasPorTalla(i, form)).reduce((a, n) => a + Math.max(0, n), 0) * Number(i.costo_unitario),
    0
  );

  const escribir = (id: string, lado: "bodega" | "local", talla: string, v: string) =>
    setForm((f) => ({ ...f, [id]: { ...f[id], [lado]: { ...f[id][lado], [talla]: v } } }));

  async function cerrar() {
    if (problemas.length || ocupado) return;
    setOcupado(true);
    const { data: res, error } = await supabase.rpc("fn_cerrar_feria", {
      p_feria_id: feria.id,
      p_retornos: retornosParaBase(form),
      p_fecha: fecha,
    });
    setOcupado(false);
    if (error) return toast(error.message, "error");
    const x = (res ?? {}) as { ya_cerrada?: boolean; vendidas?: number; regresan?: number };
    toast(x.ya_cerrada ? "Esta feria ya estaba cerrada." : `Feria cerrada · ${x.vendidas ?? 0} vendidas · ${x.regresan ?? 0} regresan`);
    await reload();
    await alTerminar();
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <div className="label" style={{ fontSize: 10.5, marginBottom: 4 }}>Cerrar la feria · ¿qué regresa y a dónde?</div>
      <p className="sub" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        Lo que no escribas como regreso cuenta como vendido. Lo que vuelve a locales pasa a costo operativo de locales
        ({money(COSTO_OPERATIVO.local)}); lo que vuelve a la bodega, sin operativo.
      </p>

      {ingresos.map((i) => {
        const tallas = ordenarTallas(Object.keys(i.tallas).filter((t) => (i.tallas[t] ?? 0) > 0));
        const vend = vendidasPorTalla(i, form);
        return (
          <div key={i.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {i.prenda_nombre} · {i.color} <span className="sub" style={{ fontWeight: 400 }}>· {i.estampado || "Básica"}</span>
            </div>
            <div className="table-scroll">
              <table style={{ width: "auto", minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ ...CELDA, textAlign: "left" }}></th>
                    {tallas.map((t) => <th key={t} style={CELDA}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...CELDA, textAlign: "left" }} className="sub">Fueron</td>
                    {tallas.map((t) => <td key={t} style={CELDA} className="num">{i.tallas[t]}</td>)}
                  </tr>
                  {(["bodega", "local"] as const).map((lado) => (
                    <tr key={lado}>
                      <td style={{ ...CELDA, textAlign: "left" }}>Regresa a {lado === "bodega" ? "bodega" : "locales"}</td>
                      {tallas.map((t) => (
                        <td key={t} style={CELDA}>
                          <input className="pinput" type="number" min="0" max={i.tallas[t]} inputMode="numeric"
                            style={{ width: 56, textAlign: "center", padding: "6px 4px" }}
                            value={form[i.id]?.[lado][t] ?? ""} onChange={(e) => escribir(i.id, lado, t, e.target.value)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...CELDA, textAlign: "left", fontWeight: 600 }}>Vendidas</td>
                    {tallas.map((t) => (
                      <td key={t} style={{ ...CELDA, fontWeight: 600, color: (vend[t] ?? 0) < 0 ? "var(--bad)" : undefined }} className="num">
                        {vend[t] ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <Fila>
        <Campo label="Fecha de cierre">
          <input className="pinput" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <div style={{ flex: 2, alignSelf: "flex-end", fontSize: 13, paddingBottom: 14 }}>
          Vendidas: <b className="num">{vendidas}</b> · costo de lo vendido <b className="num">{money(costoVendido)}</b>
        </div>
      </Fila>

      {problemas.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 10 }}>
          {problemas.map((p) => <div key={p}>⚠ {p}</div>)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => alTerminar()}>Cancelar</button>
        <button className="btn primary" disabled={!!problemas.length || ocupado || !fecha} onClick={cerrar}>
          {ocupado ? "Cerrando…" : "Cerrar feria"}
        </button>
      </div>
    </div>
  );
}

