"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Modal, Campo, Fila } from "@/components/ui";
import { hoyEcuador } from "@/lib/fechas";
import { money, sumar, aCentavos } from "@/lib/finanzas/formato";
import {
  AMBITOS,
  CATEGORIAS_GASTO,
  DOCUMENTO_TIPOS,
  EXIGIBILIDADES,
  MEDIOS,
  TIPOS_DEUDA,
} from "@/lib/finanzas/categorias";
import { parsePlazos, repartirCuotas, validarCuotas, type CuotaBorrador } from "@/lib/finanzas/cuotas";
import type { Ambito, Exigibilidad, Medio, TipoDeuda } from "@/lib/finanzas/tipos";
import { mensajeError, nuevoId } from "./comunes";

/** Cuota editable en pantalla (montos como texto para poder escribir). */
interface FilaCuota {
  key: string;
  fecha: string;
  monto: string;
  medio: Medio;
  numero: string;
  banco: string;
}

const aFila = (c: CuotaBorrador): FilaCuota => ({
  key: nuevoId(),
  fecha: c.fecha,
  monto: c.monto.toFixed(2),
  medio: c.medio,
  numero: c.numero,
  banco: c.banco,
});

/**
 * Nueva deuda con sus pagos programados. Se guarda con crear_deuda: la deuda
 * y todos sus pagos juntos o nada. El id se genera al abrir el formulario, así
 * un doble clic en "Guardar" no crea dos deudas.
 */
export default function FormDeuda({
  supabase,
  abierto,
  onCerrar,
  onGuardado,
}: {
  supabase: SupabaseClient;
  abierto: boolean;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const [id, setId] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [tipoDeuda, setTipoDeuda] = useState<TipoDeuda>("proveedor");
  const [exigibilidad, setExigibilidad] = useState<Exigibilidad>("firme");
  const [fechaEstimada, setFechaEstimada] = useState("");
  const [ambito, setAmbito] = useState<Ambito>("empresa");
  const [categoria, setCategoria] = useState("otros");
  const [esSaldoInicial, setEsSaldoInicial] = useState(false);
  const [montoOriginal, setMontoOriginal] = useState("");
  const [cuotaMensual, setCuotaMensual] = useState("");
  const [saldoAl, setSaldoAl] = useState("");
  const [docTipo, setDocTipo] = useState("");
  const [docNumero, setDocNumero] = useState("");
  const [docFecha, setDocFecha] = useState("");
  const [notas, setNotas] = useState("");
  const [cuotas, setCuotas] = useState<FilaCuota[]>([]);
  // generador
  const [plazos, setPlazos] = useState("30/60/90/120");
  const [fechaBase, setFechaBase] = useState(hoyEcuador());
  const [genMedio, setGenMedio] = useState<Medio>("cheque");
  const [genNumero, setGenNumero] = useState("");
  const [genBanco, setGenBanco] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setId(nuevoId());
    setProveedor(""); setConcepto(""); setMonto("");
    setTipoDeuda("proveedor"); setExigibilidad("firme"); setFechaEstimada("");
    setAmbito("empresa"); setCategoria("otros");
    setEsSaldoInicial(false); setMontoOriginal(""); setCuotaMensual(""); setSaldoAl("");
    setDocTipo(""); setDocNumero(""); setDocFecha(""); setNotas("");
    setCuotas([]);
    setPlazos("30/60/90/120"); setFechaBase(hoyEcuador()); setGenMedio("cheque"); setGenNumero(""); setGenBanco("");
    setGuardando(false); setErr(null);
  }, [abierto]);

  // los días se cuentan desde la fecha del documento si existe
  useEffect(() => {
    if (docFecha) setFechaBase(docFecha);
  }, [docFecha]);

  const montoNum = parseFloat(monto);
  const cuotasNum = cuotas.map((c) => ({ monto: parseFloat(c.monto), fecha: c.fecha }));
  const suma = sumar(cuotasNum.map((c) => (isNaN(c.monto) ? 0 : c.monto)));
  const diferencia = (aCentavos(isNaN(montoNum) ? 0 : montoNum) - aCentavos(suma)) / 100;
  const problemaCuotas =
    montoNum > 0
      ? validarCuotas({ monto: montoNum, exigibilidad, esSaldoInicial, cuotas: cuotasNum })
      : null;

  function generar() {
    const dias = parsePlazos(plazos);
    if (!dias) return setErr('Escribe los plazos en días, por ejemplo "30/60/90/120".');
    if (!(montoNum > 0)) return setErr("Primero escribe el monto de la deuda.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaBase)) return setErr("Falta la fecha desde la que se cuentan los días.");
    setErr(null);
    setCuotas(
      repartirCuotas({
        total: montoNum,
        plazosDias: dias,
        fechaBase,
        medio: genMedio,
        numeroInicial: genNumero,
        banco: genBanco.trim(),
      }).map(aFila)
    );
  }

  function cambiarCuota(key: string, campo: keyof FilaCuota, valor: string) {
    setCuotas((cs) => cs.map((c) => (c.key === key ? { ...c, [campo]: valor } : c)));
  }

  async function guardar() {
    if (guardando) return;
    if (!proveedor.trim()) return setErr("Falta a quién se le debe.");
    if (!(montoNum > 0)) return setErr("El monto debe ser mayor a 0.");
    if (problemaCuotas) return setErr(problemaCuotas);
    setGuardando(true);
    setErr(null);
    const num = (s: string) => (s.trim() === "" ? null : parseFloat(s));
    const { error } = await supabase.rpc("crear_deuda", {
      p_deuda: {
        id,
        proveedor: proveedor.trim(),
        concepto: concepto.trim(),
        monto: montoNum,
        tipo_deuda: tipoDeuda,
        exigibilidad,
        fecha_estimada: exigibilidad === "flexible" && fechaEstimada ? fechaEstimada : null,
        ambito,
        categoria,
        es_saldo_inicial: esSaldoInicial,
        monto_original: num(montoOriginal),
        cuota_mensual: num(cuotaMensual),
        saldo_al: saldoAl || null,
        documento_tipo: docTipo || null,
        documento_numero: docNumero.trim(),
        fecha_documento: docFecha || null,
        notas: notas.trim(),
      },
      p_cuotas: cuotas.map((c) => ({
        monto: parseFloat(c.monto),
        fecha: c.fecha,
        medio: c.medio,
        numero: c.numero.trim(),
        banco: c.banco.trim(),
      })),
    });
    setGuardando(false);
    if (error) return setErr(mensajeError(error));
    onGuardado(`Deuda con ${proveedor.trim()} registrada${cuotas.length ? ` con ${cuotas.length} pago${cuotas.length !== 1 ? "s" : ""}` : ""}`);
  }

  const muestraPrestamo = tipoDeuda === "prestamo" || tipoDeuda === "tarjeta" || esSaldoInicial;

  return (
    <Modal
      titulo="Nueva deuda"
      abierto={abierto}
      onCerrar={guardando ? () => {} : onCerrar}
      ancho={760}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar deuda"}
          </button>
        </>
      }
    >
      {err && <div className="error-banner">{err}</div>}

      <Fila>
        <Campo label="A quién se le debe" requerido>
          <input className="pinput" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
        </Campo>
        <Campo label={esSaldoInicial ? "Saldo al 1 de octubre ($)" : "Monto total ($)"} requerido>
          <input className="pinput" type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
      </Fila>
      <Campo label="Concepto">
        <input className="pinput" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      </Campo>
      <Fila>
        <Campo label="Tipo de deuda">
          <select className="pinput" value={tipoDeuda} onChange={(e) => setTipoDeuda(e.target.value as TipoDeuda)}>
            {TIPOS_DEUDA.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Campo>
        <Campo label="Exigibilidad">
          <select className="pinput" value={exigibilidad} onChange={(e) => setExigibilidad(e.target.value as Exigibilidad)}>
            {EXIGIBILIDADES.map((x) => <option key={x.id} value={x.id}>{x.label} — {x.ayuda}</option>)}
          </select>
        </Campo>
        {exigibilidad === "flexible" && (
          <Campo label="Fecha estimada (opcional)">
            <input className="pinput" type="date" value={fechaEstimada} onChange={(e) => setFechaEstimada(e.target.value)} />
          </Campo>
        )}
      </Fila>
      <Fila>
        <Campo label="Ámbito">
          <select className="pinput" value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)}>
            {AMBITOS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Campo>
        <Campo label="Categoría (para el gasto)">
          <select className="pinput" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS_GASTO.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
      </Fila>

      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "4px 0 12px" }}>
        <input type="checkbox" checked={esSaldoInicial} onChange={(e) => setEsSaldoInicial(e.target.checked)} />
        Viene de antes del 1 de octubre de 2026 (el monto es lo que se debía ese día)
      </label>

      {muestraPrestamo && (
        <Fila>
          {esSaldoInicial && (
            <Campo label="Monto original (opcional)">
              <input className="pinput" type="number" step="0.01" min="0" value={montoOriginal}
                onChange={(e) => setMontoOriginal(e.target.value)} />
            </Campo>
          )}
          <Campo label="Cuota mensual (opcional)">
            <input className="pinput" type="number" step="0.01" min="0" value={cuotaMensual}
              onChange={(e) => setCuotaMensual(e.target.value)} />
          </Campo>
          <Campo label="Saldo informado al (fecha)">
            <input className="pinput" type="date" value={saldoAl} onChange={(e) => setSaldoAl(e.target.value)} />
          </Campo>
        </Fila>
      )}

      <details style={{ marginBottom: 12 }}>
        <summary className="sub" style={{ cursor: "pointer", fontSize: 13 }}>Documento (opcional)</summary>
        <Fila>
          <Campo label="Tipo">
            <select className="pinput" value={docTipo} onChange={(e) => setDocTipo(e.target.value)}>
              <option value="">— sin documento —</option>
              {DOCUMENTO_TIPOS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </Campo>
          <Campo label="Número">
            <input className="pinput" value={docNumero} onChange={(e) => setDocNumero(e.target.value)} />
          </Campo>
          <Campo label="Fecha del documento">
            <input className="pinput" type="date" value={docFecha} onChange={(e) => setDocFecha(e.target.value)} />
          </Campo>
        </Fila>
      </details>

      <h4 style={{ margin: "8px 0 6px" }}>Pagos programados (cheques / cuotas)</h4>
      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <Fila>
          <Campo label="Plazos en días">
            <input className="pinput" value={plazos} onChange={(e) => setPlazos(e.target.value)} placeholder="30/60/90/120" />
          </Campo>
          <Campo label="Contar desde">
            <input className="pinput" type="date" value={fechaBase} onChange={(e) => setFechaBase(e.target.value)} />
          </Campo>
          <Campo label="Medio">
            <select className="pinput" value={genMedio} onChange={(e) => setGenMedio(e.target.value as Medio)}>
              {MEDIOS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Campo>
        </Fila>
        <Fila>
          <Campo label="N.º del primer cheque (opcional)">
            <input className="pinput" value={genNumero} onChange={(e) => setGenNumero(e.target.value)} />
          </Campo>
          <Campo label="Banco (opcional)">
            <input className="pinput" value={genBanco} onChange={(e) => setGenBanco(e.target.value)} />
          </Campo>
          <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 12 }}>
            <button className="btn" type="button" onClick={generar}>Generar pagos</button>
          </div>
        </Fila>
        <p className="sub" style={{ fontSize: 11.5, margin: 0 }}>
          Reparte el monto en partes iguales; los centavos que sobran van en el último pago.
        </p>
      </div>

      {cuotas.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th>Medio</th>
                <th>N.º</th>
                <th>Banco</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cuotas.map((c) => (
                <tr key={c.key}>
                  <td><input className="pinput" type="date" value={c.fecha} onChange={(e) => cambiarCuota(c.key, "fecha", e.target.value)} /></td>
                  <td><input className="pinput" type="number" step="0.01" min="0" style={{ textAlign: "right", maxWidth: 120 }}
                    value={c.monto} onChange={(e) => cambiarCuota(c.key, "monto", e.target.value)} /></td>
                  <td>
                    <select className="pinput" value={c.medio} onChange={(e) => cambiarCuota(c.key, "medio", e.target.value)}>
                      {MEDIOS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </td>
                  <td><input className="pinput" style={{ maxWidth: 90 }} value={c.numero} onChange={(e) => cambiarCuota(c.key, "numero", e.target.value)} /></td>
                  <td><input className="pinput" style={{ maxWidth: 120 }} value={c.banco} onChange={(e) => cambiarCuota(c.key, "banco", e.target.value)} /></td>
                  <td>
                    <button className="btn" type="button" style={{ padding: "4px 9px" }} aria-label="Quitar pago"
                      onClick={() => setCuotas((cs) => cs.filter((x) => x.key !== c.key))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          type="button"
          onClick={() =>
            setCuotas((cs) => [
              ...cs,
              { key: nuevoId(), fecha: "", monto: diferencia > 0 ? diferencia.toFixed(2) : "", medio: genMedio, numero: "", banco: "" },
            ])
          }
        >
          + Agregar un pago
        </button>
        {cuotas.length > 0 && (
          <span style={{ fontSize: 13, color: problemaCuotas ? "var(--bad)" : "var(--good)" }}>
            Pagos: {money(suma)} de {money(isNaN(montoNum) ? null : montoNum)}
            {diferencia !== 0 && !isNaN(montoNum) ? ` · ${diferencia > 0 ? "faltan" : "sobran"} ${money(Math.abs(diferencia))}` : " ✓"}
          </span>
        )}
      </div>
      {problemaCuotas && montoNum > 0 && (
        <p style={{ color: "var(--bad)", fontSize: 12.5, marginBottom: 0 }}>{problemaCuotas}</p>
      )}

      <Campo label="Notas">
        <textarea className="pinput" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
    </Modal>
  );
}
