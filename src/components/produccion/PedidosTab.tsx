"use client";

import { useMemo, useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "./ui";
import { money, type PedidoTela, type EstadoPedido } from "@/lib/produccion/types";
import { hoyEcuador, fmtFecha } from "@/lib/produccion/fechas";

const ESTADO_LABEL: Record<EstadoPedido, { txt: string; color: "ambar" | "azul" | "verde" }> = {
  pendiente: { txt: "Pendiente", color: "ambar" },
  en_camino: { txt: "En camino", color: "azul" },
  entregado: { txt: "Entregado", color: "verde" },
};

interface ColorForm {
  color: string;
  cant: string;
}

export default function PedidosTab() {
  const { data, supabase, reload, toast } = useProd();
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState<"todos" | EstadoPedido>("todos");
  const [err, setErr] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<PedidoTela | null>(null);

  const [form, setForm] = useState({
    nombre_tela: "",
    fecha_pedido: hoyEcuador(),
    unidad: "metros" as "metros" | "kilos",
    rendimiento: "",
    ancho_pedido: "",
    proveedor_id: "",
    prenda_id: "",
    valor_metro: "",
  });
  const [colores, setColores] = useState<ColorForm[]>([{ color: "", cant: "" }]);

  const esKilos = form.unidad === "kilos";
  const rend = parseFloat(form.rendimiento) || 0;

  const totalMetros = useMemo(() => {
    const suma = colores.reduce((s, c) => s + (parseFloat(c.cant) || 0), 0);
    return esKilos ? (rend > 0 ? suma * rend : 0) : suma;
  }, [colores, esKilos, rend]);

  const valorMetro = parseFloat(form.valor_metro) || 0;
  const totalPagar = totalMetros * valorMetro;
  const prendaSel = data.prendas.find((p) => p.id === form.prenda_id);
  const unidadesEstimadas =
    prendaSel && prendaSel.consumo_metros > 0 && totalMetros > 0
      ? Math.floor(totalMetros / prendaSel.consumo_metros)
      : null;

  function abrir() {
    setErr(null);
    setForm({
      nombre_tela: "", fecha_pedido: hoyEcuador(), unidad: "metros",
      rendimiento: "", ancho_pedido: "", proveedor_id: "", prenda_id: "", valor_metro: "",
    });
    setColores([{ color: "", cant: "" }]);
    setAbierto(true);
  }

  async function guardar() {
    if (!form.nombre_tela.trim()) return setErr("El nombre de la tela es requerido.");
    if (!form.proveedor_id) return setErr("Selecciona un proveedor.");
    const ancho = parseFloat(form.ancho_pedido);
    if (!(ancho > 0)) return setErr("Ingresa un ancho válido (cm).");
    if (!(valorMetro > 0)) return setErr("Ingresa el valor por metro.");
    if (esKilos && !(rend > 0)) return setErr("Ingresa el rendimiento (metros por kilo).");
    const filas = colores.filter((c) => c.color.trim() || parseFloat(c.cant) > 0);
    if (!filas.length) return setErr("Agrega al menos un color.");
    if (filas.some((c) => !c.color.trim() || !(parseFloat(c.cant) > 0)))
      return setErr("Completa nombre y cantidad en todos los colores.");

    const coloresJson = filas.map((c) => {
      const cant = parseFloat(c.cant);
      return esKilos
        ? { color: c.color.trim(), metros: +(cant * rend).toFixed(2), kilos: cant }
        : { color: c.color.trim(), metros: cant };
    });

    const { error } = await supabase.from("prod_pedidos_tela").insert({
      nombre_tela: form.nombre_tela.trim(),
      fecha_pedido: form.fecha_pedido,
      unidad: form.unidad,
      rendimiento: esKilos ? rend : null,
      ancho_pedido: ancho,
      proveedor_id: form.proveedor_id || null,
      prenda_id: form.prenda_id || null,
      colores: coloresJson,
      total_metros: +totalMetros.toFixed(2),
      valor_metro: valorMetro,
      total_pagar: +totalPagar.toFixed(2),
      estado: "pendiente",
    });
    if (error) return setErr(error.message);
    toast("Pedido guardado");
    setAbierto(false);
    await reload();
  }

  async function marcarEnCamino(p: PedidoTela) {
    const { error } = await supabase.from("prod_pedidos_tela").update({ estado: "en_camino" }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`"${p.nombre_tela}" marcado en camino`);
    await reload();
  }

  async function eliminar() {
    if (!borrar) return;
    const { error } = await supabase.from("prod_pedidos_tela").delete().eq("id", borrar.id);
    if (error) toast("No se pudo eliminar: el pedido tiene cortes registrados.", "error");
    else {
      toast(`"${borrar.nombre_tela}" eliminado`);
      await reload();
    }
    setBorrar(null);
  }

  const pedidos = filtro === "todos" ? data.pedidos : data.pedidos.filter((p) => p.estado === filtro);

  return (
    <section>
      <div className="section-head">
        <h2>Pedidos de tela</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
            <option value="todos">Todos</option>
            <option value="pendiente">Pendientes</option>
            <option value="en_camino">En camino</option>
            <option value="entregado">Entregados</option>
          </select>
          <button className="btn primary" onClick={abrir}>+ Nuevo pedido</button>
        </div>
      </div>

      {!pedidos.length ? (
        <Vacio titulo={filtro === "todos" ? "Sin pedidos aún" : "Sin pedidos con ese estado"} />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tela / Fecha</th>
                <th>Proveedor</th>
                <th>Colores</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => {
                const prov = data.proveedores.find((x) => x.id === p.proveedor_id);
                const prenda = data.prendas.find((x) => x.id === p.prenda_id);
                const est = ESTADO_LABEL[p.estado];
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.nombre_tela}</strong>
                      <div className="sub" style={{ fontSize: 11.5 }}>{fmtFecha(p.fecha_pedido)}</div>
                    </td>
                    <td>{prov?.empresa ?? "—"}</td>
                    <td style={{ maxWidth: 260 }}>
                      <span style={{ fontSize: 12.5 }}>
                        {(p.colores ?? []).map((c) => `${c.color} (${Number(c.metros).toFixed(1)} m)`).join(", ")}
                      </span>
                      {prenda && <div className="sub" style={{ fontSize: 11.5 }}>Para: {prenda.nombre}</div>}
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {Number(p.total_metros).toFixed(1)} m
                      <div className="sub" style={{ fontSize: 11.5 }}>{money(Number(p.total_pagar))}</div>
                    </td>
                    <td><Badge color={est.color}>{est.txt}</Badge></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {p.estado === "pendiente" && (
                        <button className="btn" style={{ padding: "4px 9px", marginRight: 6, fontSize: 12 }}
                          onClick={() => marcarEnCamino(p)}>📦 En camino</button>
                      )}
                      {p.estado !== "entregado" && (
                        <button className="btn danger" style={{ padding: "4px 9px" }} onClick={() => setBorrar(p)}>🗑</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        titulo="Nuevo pedido de tela"
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        ancho={700}
        pie={
          <>
            <button className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary" onClick={guardar}>Guardar pedido</button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        <Fila>
          <Campo label="Nombre de la tela" requerido>
            <input className="pinput" placeholder="Ej: Jersey algodón 30/1" value={form.nombre_tela}
              onChange={(e) => setForm({ ...form, nombre_tela: e.target.value })} />
          </Campo>
          <Campo label="Fecha del pedido" requerido>
            <input className="pinput" type="date" value={form.fecha_pedido}
              onChange={(e) => setForm({ ...form, fecha_pedido: e.target.value })} />
          </Campo>
        </Fila>
        <Fila>
          <Campo label="Unidad de compra" requerido>
            <div style={{ display: "flex", gap: 18, padding: "9px 0" }}>
              {(["metros", "kilos"] as const).map((u) => (
                <label key={u} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                  <input type="radio" checked={form.unidad === u}
                    onChange={() => setForm({ ...form, unidad: u })}
                    style={{ accentColor: "var(--accent)" }} />
                  {u === "metros" ? "Metros" : "Kilos"}
                </label>
              ))}
            </div>
          </Campo>
          <Campo label="Ancho de tela pedido (cm)" requerido>
            <input className="pinput" type="number" min="1" step="1" placeholder="150" value={form.ancho_pedido}
              onChange={(e) => setForm({ ...form, ancho_pedido: e.target.value })} />
          </Campo>
        </Fila>
        {esKilos && (
          <Fila>
            <Campo label="Rendimiento (metros por kilo)" requerido>
              <input className="pinput" type="number" step="0.01" min="0.01" placeholder="Ej: 3.50" value={form.rendimiento}
                onChange={(e) => setForm({ ...form, rendimiento: e.target.value })} />
            </Campo>
            <Campo label="Total en metros (calculado)">
              <div className="pinput" style={{ color: "var(--muted)" }}>
                {totalMetros > 0 ? `${totalMetros.toFixed(2)} m` : "— m"}
              </div>
            </Campo>
          </Fila>
        )}
        <Fila>
          <Campo label="Proveedor" requerido>
            <select className="pinput" value={form.proveedor_id}
              onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
              <option value="">— Selecciona —</option>
              {data.proveedores.map((p) => <option key={p.id} value={p.id}>{p.empresa}</option>)}
            </select>
            {!data.proveedores.length && (
              <span style={{ color: "var(--warn)", fontSize: 12 }}>No hay proveedores; agrega uno primero.</span>
            )}
          </Campo>
          <Campo label="Propósito (prenda)">
            <select className="pinput" value={form.prenda_id}
              onChange={(e) => setForm({ ...form, prenda_id: e.target.value })}>
              <option value="">— Sin especificar —</option>
              {data.prendas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
        </Fila>
        {prendaSel && (
          <div style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, marginBottom: 12, color: "var(--accent)" }}>
            Consumo por unidad: {prendaSel.consumo_metros} m
            {unidadesEstimadas != null && <> · con {totalMetros.toFixed(1)} m saldrían ≈ <b>{unidadesEstimadas} unidades</b></>}
          </div>
        )}

        <Campo label={`Colores del pedido (cantidad en ${esKilos ? "kilos" : "metros"})`} requerido>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {colores.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input className="pinput" style={{ flex: 2 }} placeholder="Ej: Negro" value={c.color}
                  onChange={(e) => setColores(colores.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
                <input className="pinput" style={{ flex: 1 }} type="number" step="0.01" min="0"
                  placeholder={esKilos ? "kg" : "m"} value={c.cant}
                  onChange={(e) => setColores(colores.map((x, j) => (j === i ? { ...x, cant: e.target.value } : x)))} />
                <button className="btn" style={{ padding: "4px 10px" }}
                  onClick={() => setColores(colores.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn" style={{ alignSelf: "flex-start", fontSize: 12 }}
              onClick={() => setColores([...colores, { color: "", cant: "" }])}>+ Agregar color</button>
          </div>
        </Campo>

        <Fila>
          <Campo label="Valor por metro con IVA ($)" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.valor_metro}
              onChange={(e) => setForm({ ...form, valor_metro: e.target.value })} />
          </Campo>
        </Fila>

        <div className="card" style={{ padding: 14, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
            <span className="sub">Total metros</span>
            <span className="num">{totalMetros > 0 ? `${totalMetros.toFixed(2)} m` : "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
            <span className="sub">Total a pagar</span>
            <span className="num" style={{ fontWeight: 600 }}>{totalPagar > 0 ? money(totalPagar) : "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
            <span className="sub">Cuota sugerida (÷ 4)</span>
            <span className="num">{totalPagar > 0 ? money(totalPagar / 4) : "—"}</span>
          </div>
        </div>
      </Modal>

      <Modal
        titulo="Confirmar eliminación"
        abierto={!!borrar}
        onCerrar={() => setBorrar(null)}
        pie={
          <>
            <button className="btn" onClick={() => setBorrar(null)}>Cancelar</button>
            <button className="btn danger" onClick={eliminar}>Eliminar</button>
          </>
        }
      >
        <p className="sub">¿Eliminar el pedido “{borrar?.nombre_tela}”?</p>
      </Modal>
    </section>
  );
}
