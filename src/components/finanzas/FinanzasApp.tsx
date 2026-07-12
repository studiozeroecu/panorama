"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { hoyEcuador, fmtFecha, diasHasta } from "@/lib/produccion/fechas";
import { Modal, Campo, Fila, Badge } from "@/components/produccion/ui";

const money = (n: number | null | undefined) =>
  n == null || isNaN(Number(n))
    ? "—"
    : "$" + Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CATEGORIAS = ["maquila", "estampado", "corte", "arriendo", "servicios", "transporte", "personal", "otros"];

interface CxC {
  id: string; cliente: string; concepto: string; monto: number;
  fecha_factura: string; fecha_vencimiento: string | null;
  estado: "pendiente" | "cobrado"; fecha_cobro: string | null; notas: string;
}
interface CxP {
  id: string; proveedor: string; concepto: string; monto: number;
  fecha_factura: string; fecha_vencimiento: string | null;
  tipo_pago: string; categoria: string;
  estado: "pendiente" | "pagado"; fecha_pago: string | null; notas: string;
}
interface Cheque {
  id: string; tipo: "por_cobrar" | "por_pagar"; monto: number;
  beneficiario: string; fecha_cobro: string | null; estado: string;
}

/** Semáforo por días al vencimiento (negativo = vencido). */
function Semaforo({ fecha }: { fecha: string | null }) {
  if (!fecha) return <Badge>sin fecha</Badge>;
  const d = diasHasta(fecha);
  if (d < 0) return <Badge color="rojo">vencido {-d} día{d !== -1 ? "s" : ""}</Badge>;
  if (d <= 3) return <Badge color="ambar">vence en {d === 0 ? "HOY" : `${d} día${d !== 1 ? "s" : ""}`}</Badge>;
  return <Badge color="verde">en {d} días</Badge>;
}

export default function FinanzasApp() {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<"cobrar" | "pagar" | "flujo">("cobrar");
  const [cxc, setCxc] = useState<CxC[]>([]);
  const [cxp, setCxp] = useState<CxP[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [formCobrar, setFormCobrar] = useState(false);
  const [formPagar, setFormPagar] = useState(false);

  const avisar = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const reload = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from("cuentas_por_cobrar").select("*").order("fecha_vencimiento", { ascending: true, nullsFirst: false }),
      supabase.from("cuentas_por_pagar").select("*").order("fecha_vencimiento", { ascending: true, nullsFirst: false }),
      supabase.from("cheques").select("id, tipo, monto, beneficiario, fecha_cobro, estado").eq("estado", "pendiente"),
    ]);
    if (a.error) {
      setError(
        a.error.message.includes("does not exist") || a.error.message.includes("schema cache")
          ? "Faltan las tablas de finanzas. Ejecuta supabase/schema_fase5.sql."
          : a.error.message
      );
      setCargando(false);
      return;
    }
    setCxc((a.data ?? []) as CxC[]);
    setCxp((b.data ?? []) as CxP[]);
    setCheques((c.data ?? []) as Cheque[]);
    setError(null);
    setCargando(false);
  }, [supabase]);

  useEffect(() => { reload(); }, [reload]);

  async function marcarCobrado(x: CxC) {
    const { error } = await supabase
      .from("cuentas_por_cobrar")
      .update({ estado: "cobrado", fecha_cobro: hoyEcuador() })
      .eq("id", x.id);
    if (error) return avisar(`Error: ${error.message}`);
    avisar(`Cobrado: ${money(Number(x.monto))} de ${x.cliente}`);
    await reload();
  }

  /** Marcar pagada registra automáticamente el gasto en movimientos (decisión del dueño). */
  async function marcarPagado(x: CxP) {
    const hoy = hoyEcuador();
    const { error: e1 } = await supabase
      .from("cuentas_por_pagar")
      .update({ estado: "pagado", fecha_pago: hoy })
      .eq("id", x.id);
    if (e1) return avisar(`Error: ${e1.message}`);
    const { error: e2 } = await supabase.from("movimientos").insert({
      tipo: "gasto",
      monto: Number(x.monto),
      concepto: `${x.proveedor}${x.concepto ? ` — ${x.concepto}` : ""} (cuenta por pagar)`,
      categoria: x.categoria,
      fecha: hoy,
      origen: "web",
    });
    if (e2) avisar(`Pagada, pero no se registró el gasto: ${e2.message}`);
    else avisar(`Pagada y registrada como gasto (${x.categoria})`);
    await reload();
  }

  const pendCobrar = cxc.filter((x) => x.estado === "pendiente");
  const pendPagar = cxp.filter((x) => x.estado === "pendiente");
  const en7 = (f: string | null) => f != null && diasHasta(f) <= 7;
  const totalSemanaPagar =
    pendPagar.filter((x) => en7(x.fecha_vencimiento)).reduce((s, x) => s + Number(x.monto), 0) +
    cheques.filter((c) => c.tipo === "por_pagar" && en7(c.fecha_cobro)).reduce((s, c) => s + Number(c.monto), 0);

  return (
    <div className="wrap">
      <header className="page">
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            <Link href="/" style={{ color: "var(--accent)" }}>← Panorama</Link>
          </p>
          <h1>Finanzas</h1>
          <p className="sub">Cuentas por cobrar y por pagar, cheques y flujo de los próximos 30 días.</p>
        </div>
      </header>

      {error ? (
        <div className="error-banner">{error}</div>
      ) : cargando ? (
        <div className="empty">Cargando…</div>
      ) : (
        <>
          <div className="cards" style={{ marginBottom: 26 }}>
            <div className="card">
              <div className="label">Por cobrar</div>
              <div className="value">{money(pendCobrar.reduce((s, x) => s + Number(x.monto), 0))}</div>
              <div className="hint">{pendCobrar.length} factura{pendCobrar.length !== 1 ? "s" : ""} pendiente{pendCobrar.length !== 1 ? "s" : ""}</div>
            </div>
            <div className="card">
              <div className="label">Por pagar</div>
              <div className="value">{money(pendPagar.reduce((s, x) => s + Number(x.monto), 0))}</div>
              <div className="hint">{pendPagar.length} obligación{pendPagar.length !== 1 ? "es" : ""} pendiente{pendPagar.length !== 1 ? "s" : ""}</div>
            </div>
            <div className="card">
              <div className="label">A pagar esta semana</div>
              <div className="value" style={{ color: totalSemanaPagar > 0 ? "var(--warn)" : undefined }}>
                {money(totalSemanaPagar)}
              </div>
              <div className="hint">cuentas + cheques que vencen en 7 días</div>
            </div>
          </div>

          <nav className="prod-tabs">
            {([["cobrar", "Por cobrar"], ["pagar", "Por pagar"], ["flujo", "Flujo de caja (30 días)"]] as const).map(([id, label]) => (
              <button key={id} className={`prod-tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>

          {tab === "cobrar" && (
            <section>
              <div className="section-head">
                <h2>Facturas por cobrar</h2>
                <button className="btn primary" onClick={() => setFormCobrar(true)}>+ Nueva por cobrar</button>
              </div>
              <TablaCuentas
                filas={cxc}
                cols={(x: CxC) => [x.cliente, x.concepto]}
                onResolver={marcarCobrado}
                labelResolver="✓ Cobrada"
                labelResuelto="Cobrada"
              />
            </section>
          )}

          {tab === "pagar" && (
            <section>
              <div className="section-head">
                <h2>Obligaciones por pagar</h2>
                <button className="btn primary" onClick={() => setFormPagar(true)}>+ Nueva por pagar</button>
              </div>
              <TablaCuentas
                filas={cxp}
                cols={(x: CxP) => [x.proveedor, `${x.concepto}${x.concepto ? " · " : ""}${x.tipo_pago} · ${x.categoria}`]}
                onResolver={marcarPagado}
                labelResolver="✓ Pagada"
                labelResuelto="Pagada"
              />
              <p className="sub" style={{ fontSize: 12, marginTop: 10 }}>
                Al marcar como pagada se registra el gasto automáticamente en movimientos con su categoría.
              </p>
            </section>
          )}

          {tab === "flujo" && <Flujo cxc={pendCobrar} cxp={pendPagar} cheques={cheques} />}
        </>
      )}

      <FormCuenta
        abierto={formCobrar}
        onCerrar={() => setFormCobrar(false)}
        tipo="cobrar"
        onGuardado={async () => { setFormCobrar(false); avisar("Factura por cobrar registrada"); await reload(); }}
      />
      <FormCuenta
        abierto={formPagar}
        onCerrar={() => setFormPagar(false)}
        tipo="pagar"
        onGuardado={async () => { setFormPagar(false); avisar("Obligación por pagar registrada"); await reload(); }}
      />

      {toast && <div className="prod-toast">✓ {toast}</div>}
    </div>
  );
}

function TablaCuentas<T extends { id: string; monto: number; fecha_factura: string; fecha_vencimiento: string | null; estado: string; notas: string }>({
  filas, cols, onResolver, labelResolver, labelResuelto,
}: {
  filas: T[];
  cols: (x: T) => [string, string];
  onResolver: (x: T) => void;
  labelResolver: string;
  labelResuelto: string;
}) {
  if (!filas.length) return <div className="card empty">Sin registros aún.</div>;
  const pendientes = filas.filter((x) => x.estado === "pendiente");
  const resueltas = filas.filter((x) => x.estado !== "pendiente").slice(0, 10);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Quién / concepto</th>
            <th style={{ textAlign: "right" }}>Monto</th>
            <th>Factura</th>
            <th>Vencimiento</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...pendientes, ...resueltas].map((x) => {
            const [titulo, sub] = cols(x);
            const pendiente = x.estado === "pendiente";
            return (
              <tr key={x.id} style={!pendiente ? { opacity: 0.5 } : undefined}>
                <td>
                  <strong>{titulo}</strong>
                  {sub && <div className="sub" style={{ fontSize: 11.5 }}>{sub}</div>}
                  {x.notas && <div className="sub" style={{ fontSize: 11 }}>{x.notas}</div>}
                </td>
                <td className="num">{money(Number(x.monto))}</td>
                <td style={{ fontSize: 12.5 }}>{fmtFecha(x.fecha_factura)}</td>
                <td>
                  {pendiente
                    ? <Semaforo fecha={x.fecha_vencimiento} />
                    : <span className="sub" style={{ fontSize: 12 }}>{fmtFecha(x.fecha_vencimiento)}</span>}
                </td>
                <td style={{ textAlign: "right" }}>
                  {pendiente
                    ? <button className="btn" style={{ fontSize: 12 }} onClick={() => onResolver(x)}>{labelResolver}</button>
                    : <Badge color="verde">{labelResuelto}</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FormCuenta({
  abierto, onCerrar, tipo, onGuardado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  tipo: "cobrar" | "pagar";
  onGuardado: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [quien, setQuien] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [factura, setFactura] = useState(hoyEcuador());
  const [vence, setVence] = useState("");
  const [tipoPago, setTipoPago] = useState("efectivo");
  const [categoria, setCategoria] = useState("otros");
  const [notas, setNotas] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setQuien(""); setConcepto(""); setMonto(""); setFactura(hoyEcuador());
      setVence(""); setTipoPago("efectivo"); setCategoria("otros"); setNotas(""); setErr(null);
    }
  }, [abierto]);

  async function guardar() {
    const m = parseFloat(monto);
    if (!quien.trim()) return setErr(tipo === "cobrar" ? "El cliente es requerido." : "El proveedor es requerido.");
    if (!(m > 0)) return setErr("El monto debe ser mayor a 0.");
    const base = {
      concepto: concepto.trim(),
      monto: m,
      fecha_factura: factura,
      fecha_vencimiento: vence || null,
      notas: notas.trim(),
    };
    const { error } =
      tipo === "cobrar"
        ? await supabase.from("cuentas_por_cobrar").insert({ ...base, cliente: quien.trim() })
        : await supabase.from("cuentas_por_pagar").insert({ ...base, proveedor: quien.trim(), tipo_pago: tipoPago, categoria });
    if (error) return setErr(error.message);
    onGuardado();
  }

  return (
    <Modal
      titulo={tipo === "cobrar" ? "Nueva factura por cobrar" : "Nueva obligación por pagar"}
      abierto={abierto}
      onCerrar={onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" onClick={guardar}>Guardar</button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}
      <Fila>
        <Campo label={tipo === "cobrar" ? "Cliente" : "Proveedor"} requerido>
          <input className="pinput" value={quien} onChange={(e) => setQuien(e.target.value)} />
        </Campo>
        <Campo label="Monto ($)" requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
      </Fila>
      <Campo label="Concepto">
        <input className="pinput" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      </Campo>
      <Fila>
        <Campo label="Fecha factura" requerido>
          <input className="pinput" type="date" value={factura} onChange={(e) => setFactura(e.target.value)} />
        </Campo>
        <Campo label="Fecha vencimiento">
          <input className="pinput" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </Campo>
      </Fila>
      {tipo === "pagar" && (
        <Fila>
          <Campo label="Tipo de pago">
            <select className="pinput" value={tipoPago} onChange={(e) => setTipoPago(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="cheque">Cheque</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </Campo>
          <Campo label="Categoría (para el gasto)">
            <select className="pinput" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Campo>
        </Fila>
      )}
      <Campo label="Notas">
        <textarea className="pinput" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
    </Modal>
  );
}

function Flujo({ cxc, cxp, cheques }: { cxc: CxC[]; cxp: CxP[]; cheques: Cheque[] }) {
  const en30 = (f: string | null) => f != null && diasHasta(f) <= 30;

  const entradas = [
    ...cxc.filter((x) => en30(x.fecha_vencimiento)).map((x) => ({
      fecha: x.fecha_vencimiento!, texto: `Cobrar a ${x.cliente}${x.concepto ? ` (${x.concepto})` : ""}`, monto: Number(x.monto),
    })),
    ...cheques.filter((c) => c.tipo === "por_cobrar" && en30(c.fecha_cobro)).map((c) => ({
      fecha: c.fecha_cobro!, texto: `Cheque por cobrar · ${c.beneficiario}`, monto: Number(c.monto),
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const salidas = [
    ...cxp.filter((x) => en30(x.fecha_vencimiento)).map((x) => ({
      fecha: x.fecha_vencimiento!, texto: `Pagar a ${x.proveedor}${x.concepto ? ` (${x.concepto})` : ""}`, monto: Number(x.monto),
    })),
    ...cheques.filter((c) => c.tipo === "por_pagar" && en30(c.fecha_cobro)).map((c) => ({
      fecha: c.fecha_cobro!, texto: `Cheque por pagar · ${c.beneficiario}`, monto: Number(c.monto),
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const totalIn = entradas.reduce((s, e) => s + e.monto, 0);
  const totalOut = salidas.reduce((s, e) => s + e.monto, 0);
  const neto = totalIn - totalOut;

  const Col = ({ titulo, items, color }: { titulo: string; items: typeof entradas; color: string }) => (
    <div>
      <div className="label" style={{ marginBottom: 10 }}>{titulo}</div>
      {!items.length ? (
        <div className="card empty" style={{ padding: 22 }}>Nada en los próximos 30 días.</div>
      ) : (
        <div className="card" style={{ padding: "6px 16px" }}>
          {items.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
              <span>
                <span className="sub" style={{ marginRight: 8 }}>{fmtFecha(e.fecha)}</span>
                {e.texto}
                {diasHasta(e.fecha) < 0 && <Badge color="rojo">vencido</Badge>}
              </span>
              <span className="num" style={{ color, whiteSpace: "nowrap" }}>{money(e.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section>
      <div className="cards" style={{ marginBottom: 22 }}>
        <div className="card"><div className="label">Entra (30 días)</div><div className="value" style={{ color: "var(--good)" }}>{money(totalIn)}</div></div>
        <div className="card"><div className="label">Sale (30 días)</div><div className="value" style={{ color: "var(--bad)" }}>{money(totalOut)}</div></div>
        <div className="card">
          <div className="label">Neto proyectado</div>
          <div className="value" style={{ color: neto >= 0 ? "var(--good)" : "var(--bad)" }}>{neto >= 0 ? "+" : ""}{money(neto)}</div>
          <div className="hint">solo vencimientos registrados; no incluye ventas futuras</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <Col titulo="Entradas" items={entradas} color="var(--good)" />
        <Col titulo="Salidas" items={salidas} color="var(--bad)" />
      </div>
    </section>
  );
}
