"use client";

import { useEffect, useMemo, useState } from "react";
import { nuevoId } from "@/lib/id";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "@/components/ui";
import { money, type PedidoTela, type EstadoPedido } from "@/lib/produccion/types";
import { estimar } from "@/lib/produccion/estimacion";
import { leerMesas } from "@/lib/produccion/corrida";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { validarAnchoCm, textoRecepcionCortadora } from "@/lib/produccion/recepcion";

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
  const [ocupado, setOcupado] = useState(false);
  const [idemId, setIdemId] = useState("");
  const [borrar, setBorrar] = useState<PedidoTela | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const [form, setForm] = useState({
    nombre_tela: "",
    fecha_pedido: hoyEcuador(),
    unidad: "metros" as "metros" | "kilos",
    rendimiento: "",
    ancho_pedido: "",
    proveedor_id: "",
    prenda_id: "",
    valor_metro: "",
    /** Fase 8l: solo se edita en pedidos ya entregados. */
    ancho_real: "",
  });
  const [colores, setColores] = useState<ColorForm[]>([{ color: "", cant: "" }]);

  const esKilos = form.unidad === "kilos";
  const rend = parseFloat(form.rendimiento) || 0;

  const totalMetros = useMemo(() => {
    const suma = colores.reduce((s, c) => s + (parseFloat(c.cant) || 0), 0);
    return esKilos ? (rend > 0 ? suma * rend : 0) : suma;
  }, [colores, esKilos, rend]);

  /**
   * Fase 8g: cortes ya registrados por pedido. `data.cortes` ya está cargado, así
   * que esto no añade ninguna consulta — pero es una FOTO del momento en que se
   * abrió /produccion. La autoridad real es trg_proteger_pedido_con_cortes, que
   * corre dentro del propio update y ve el estado de verdad.
   */
  const cortesPorPedido = useMemo(() => {
    const m = new Map<string, { n: number; metros: number }>();
    for (const c of data.cortes) {
      const prev = m.get(c.pedido_id) ?? { n: 0, metros: 0 };
      m.set(c.pedido_id, {
        n: prev.n + 1,
        metros: prev.metros + Number(c.metros_consumidos ?? 0),
      });
    }
    return m;
  }, [data.cortes]);

  const pedidoEdit = editId ? data.pedidos.find((p) => p.id === editId) : undefined;
  const cortesEdit = editId ? cortesPorPedido.get(editId) : undefined;

  /**
   * Con cortes registrados se congelan los TRES campos que alimentan total_metros:
   * colores, unidad y rendimiento. Bloquear solo los colores no bastaría — bajar el
   * rendimiento hace caer el total sin tocar ni un color, y el saldo de tela
   * quedaría negativo.
   */
  const bloqueado = !!cortesEdit?.n;

  // Fase 8e: los archivados se filtran SOLO aquí, donde se ELIGE. Todo `find()`
  // que resuelve un id ya guardado sigue viendo el catálogo completo.
  const proveedoresActivos = data.proveedores.filter((p) => !p.archivada_en);
  const prendasActivas = data.prendas.filter((p) => !p.archivada_en);

  /**
   * Con los campos de tela bloqueados el total sale del valor GUARDADO, no del que
   * rearma el formulario: reconstruir kilos→metros puede dejar una diferencia de
   * céntimos por redondeo, y `valor_metro` sí es editable, así que total_pagar se
   * recalcula y se guarda.
   */
  const metrosEfectivos = bloqueado && pedidoEdit ? Number(pedidoEdit.total_metros) : totalMetros;

  const valorMetro = parseFloat(form.valor_metro) || 0;
  const totalPagar = metrosEfectivos * valorMetro;
  const prendaSel = data.prendas.find((p) => p.id === form.prenda_id);

  /**
   * Fase 8h: la mesa más larga de las dos configuradas. No se pregunta cuál es
   * la grande — se toma la mayor y ya. Si las dos están vacías vale 0 y la
   * estimación cae sola a la fórmula lineal.
   *
   * En estado y no en useMemo porque leerMesas() toca localStorage, que no
   * existe durante el render del servidor.
   */
  const [largoMesaGrande, setLargoMesaGrande] = useState(0);
  useEffect(() => {
    setLargoMesaGrande(Math.max(0, ...leerMesas().map((m) => parseFloat(m.largo) || 0)));
  }, []);

  const estimacion = estimar(prendaSel, metrosEfectivos, parseFloat(form.ancho_pedido) || 0, largoMesaGrande);
  const unidadesEstimadas = estimacion.unidades;

  /** Sin pedido abre en alta; con pedido, en edición con los datos precargados. */
  function abrir(p?: PedidoTela) {
    setErr(null);
    if (p) {
      setEditId(p.id);
      // La idempotencia identifica un intento de ALTA. En una edición no aplica, y
      // mandarla en el update solo podría chocar con su propio índice único.
      setIdemId("");
      setForm({
        nombre_tela: p.nombre_tela,
        fecha_pedido: p.fecha_pedido,
        unidad: p.unidad,
        rendimiento: p.rendimiento == null ? "" : String(p.rendimiento),
        ancho_pedido: p.ancho_pedido == null ? "" : String(p.ancho_pedido),
        proveedor_id: p.proveedor_id ?? "",
        prenda_id: p.prenda_id ?? "",
        valor_metro: String(p.valor_metro),
        ancho_real: p.ancho_real == null ? "" : String(p.ancho_real),
      });
      // El formulario pide la cantidad en la UNIDAD DE COMPRA; la base guarda
      // siempre metros, y kilos solo cuando aplica. Hay que deshacer la conversión,
      // no leer `metros` a secas, o un pedido en kilos se precargaría con los
      // metros ya multiplicados y al guardar se multiplicarían otra vez.
      setColores(
        (p.colores ?? []).map((c) => ({
          color: c.color,
          cant: String(p.unidad === "kilos" ? c.kilos ?? 0 : c.metros),
        }))
      );
    } else {
      setEditId(null);
      // Fase 8b: el id de idempotencia nace AL ABRIR el formulario, no al guardar.
      // Si naciera en el handler del clic, cada intento traería un id distinto y el
      // `on conflict do nothing` del servidor no deduplicaría nada.
      setIdemId(nuevoId());
      setForm({
        nombre_tela: "", fecha_pedido: hoyEcuador(), unidad: "metros",
        rendimiento: "", ancho_pedido: "", proveedor_id: "", prenda_id: "", valor_metro: "",
        ancho_real: "",
      });
      setColores([{ color: "", cant: "" }]);
    }
    setAbierto(true);
  }

  async function guardar() {
    if (!form.nombre_tela.trim()) return setErr("El nombre de la tela es requerido.");
    if (!form.proveedor_id) return setErr("Selecciona un proveedor.");
    const ancho = parseFloat(form.ancho_pedido);
    if (!(ancho > 0)) return setErr("Ingresa un ancho válido (cm).");
    if (!(valorMetro > 0)) return setErr("Ingresa el valor por metro.");

    // Fase 8l: corregir el ancho real de una tela ya recibida (por la cortadora o
    // por Mateo). Solo viaja si CAMBIÓ: muchos pedidos migrados traen el ancho en
    // metros (1.05), y exigir que pase la validación aunque nadie lo tocara
    // dejaría esos pedidos imposibles de editar — p. ej. para cambiar el proveedor.
    // `ancho_recibido` y `recibido_por_rol` NO se tocan: son la foto de la recepción.
    let anchoRealCorregido: number | undefined;
    if (pedidoEdit?.estado === "entregado") {
      const original = pedidoEdit.ancho_real == null ? "" : String(pedidoEdit.ancho_real);
      if (form.ancho_real.trim() !== original) {
        const v = validarAnchoCm(form.ancho_real);
        if ("error" in v) return setErr(v.error);
        anchoRealCorregido = v.cm;
      }
    }

    // Con los campos de tela bloqueados no viajan al servidor, así que exigirles
    // nada sería pedirle al usuario que arregle algo que ni siquiera se va a
    // guardar. Importa de verdad: un pedido migrado en kilos y sin rendimiento
    // quedaría imposible de editar, justo el caso de corregir un proveedor.
    if (!bloqueado) {
      if (esKilos && !(rend > 0)) return setErr("Ingresa el rendimiento (metros por kilo).");
    }
    const filas = colores.filter((c) => c.color.trim() || parseFloat(c.cant) > 0);
    if (!bloqueado) {
      if (!filas.length) return setErr("Agrega al menos un color.");
      if (filas.some((c) => !c.color.trim() || !(parseFloat(c.cant) > 0)))
        return setErr("Completa nombre y cantidad en todos los colores.");
    }

    // La base considera el mismo color a "Negro" y "negro": el índice único de
    // prod_pedido_colores normaliza con lower(btrim(color)). Sin este chequeo, el
    // trigger revienta con un error nativo de Postgres ilegible ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"). Mismo criterio que la base,
    // para que cliente y servidor no discrepen.
    const grupos = new Map<string, string[]>();
    for (const c of bloqueado ? [] : filas) {
      const clave = c.color.trim().toLowerCase();
      grupos.set(clave, [...(grupos.get(clave) ?? []), c.color.trim()]);
    }
    const repetidos = [...grupos.values()].filter((nombres) => nombres.length > 1);
    if (repetidos.length) {
      const detalle = repetidos
        .map((nombres) => nombres.map((n) => `«${n}»`).join(" y "))
        .join(" · ");
      return setErr(
        `Colores repetidos: ${detalle}. Para el sistema son el mismo color — no ` +
          `distingue mayúsculas ni espacios. Deja uno solo, o cámbiale el nombre a uno de ellos.`
      );
    }

    const coloresJson = filas.map((c) => {
      const cant = parseFloat(c.cant);
      return esKilos
        ? { color: c.color.trim(), metros: +(cant * rend).toFixed(2), kilos: cant }
        : { color: c.color.trim(), metros: cant };
    });

    // El pedido se sigue insertando con su `colores` jsonb: el trigger
    // trg_sync_pedido_colores (fase 7) crea las filas de prod_pedido_colores solo.
    // Fase 8b: upsert con `ignoreDuplicates`, que se traduce a
    // `insert ... on conflict (idempotencia_id) do nothing`. Un reintento con el
    // mismo id no inserta nada — y como no hay insert, el trigger de colores
    // tampoco se dispara, así que no se duplican las filas de prod_pedido_colores.
    // Un conflicto devuelve un array vacío: así se distingue de un alta real.
    setOcupado(true);

    // Campos LIBRES: se corrigen siempre, tenga o no cortes el pedido. Ninguno lo
    // copia nada downstream, y la fecha de entrega estimada no se guarda — se
    // recalcula desde proveedor.dias_entrega cada vez que se muestra, así que
    // corregir el proveedor la arregla sola.
    const libres = {
      nombre_tela: form.nombre_tela.trim(),
      fecha_pedido: form.fecha_pedido,
      ancho_pedido: ancho,
      proveedor_id: form.proveedor_id || null,
      prenda_id: form.prenda_id || null,
      valor_metro: valorMetro,
      total_pagar: +totalPagar.toFixed(2),
    };
    // Campos de TELA: los que mueven el saldo y la trazabilidad de colores.
    const tela = {
      unidad: form.unidad,
      rendimiento: esKilos ? rend : null,
      colores: coloresJson,
      total_metros: +totalMetros.toFixed(2),
    };

    if (editId) {
      // Bloqueado ⇒ los campos de tela NO viajan, en vez de reenviarse iguales.
      // Reenviarlos obligaría a que el jsonb rearmado coincidiera exactamente con
      // el guardado, y no tiene por qué: en metros el cliente escribe
      // {color, metros} sin la clave `kilos`, y los datos migrados pueden traer
      // más decimales. Al no ir la columna, el trigger ni siquiera dispara para
      // ella y no hay comparación que pueda salir mal.
      //
      // `estado` no viaja NUNCA en una edición: el alta lo fija en "pendiente", y
      // reusarlo aquí devolvería a pendiente un pedido ya entregado, borrando el
      // trabajo de LlegadaTab sin decir nada.
      const { error } = await supabase
        .from("prod_pedidos_tela")
        .update({
          ...(bloqueado ? libres : { ...libres, ...tela }),
          ...(anchoRealCorregido != null ? { ancho_real: anchoRealCorregido } : {}),
        })
        .eq("id", editId);
      setOcupado(false);
      if (error) return setErr(error.message);
      toast("Pedido actualizado");
    } else {
      const { data: insertadas, error } = await supabase
        .from("prod_pedidos_tela")
        .upsert(
          { ...libres, ...tela, estado: "pendiente", idempotencia_id: idemId || null },
          { onConflict: "idempotencia_id", ignoreDuplicates: true }
        )
        .select("id");
      setOcupado(false);
      if (error) return setErr(error.message);
      toast((insertadas?.length ?? 0) === 0 ? "Este pedido ya estaba registrado." : "Pedido guardado");
    }

    setAbierto(false);
    await reload();
  }

  /**
   * Fase 8o: qué hacer con la tela al volver de maquila. Es SOLO un aviso para la
   * cortadora — no cambia nada en Envío, que sigue decidiendo el destino real.
   * Se guarda al elegir, sin abrir el formulario.
   */
  async function cambiarDestino(p: PedidoTela, valor: string) {
    const destino = valor === "" ? null : (valor as "locales" | "estampado");
    const { error } = await supabase
      .from("prod_pedidos_tela")
      .update({ destino_indicado: destino })
      .eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(destino ? `«${p.nombre_tela}»: indicado ${destino === "locales" ? "directo a locales" : "a bodega de estampados"}` : `«${p.nombre_tela}»: sin indicación`);
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
          <button className="btn primary" onClick={() => abrir()}>+ Nuevo pedido</button>
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
                    <td>
                      <Badge color={est.color}>{est.txt}</Badge>
                      {textoRecepcionCortadora(p) && (
                        <div className="sub" style={{ fontSize: 11.5, marginTop: 3 }}>{textoRecepcionCortadora(p)}</div>
                      )}
                      <select
                        className="pinput"
                        title="Indicación para la cortadora: qué hacer con la tela al volver de maquila"
                        style={{ marginTop: 5, padding: "3px 6px", fontSize: 11.5, width: "auto" }}
                        value={p.destino_indicado ?? ""}
                        onChange={(e) => cambiarDestino(p, e.target.value)}
                      >
                        <option value="">👉 Sin indicación</option>
                        <option value="locales">👉 Directo a locales</option>
                        <option value="estampado">👉 Bodega de estampados</option>
                      </select>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {/* Visible en los tres estados: el proveedor mal puesto se
                          descubre casi siempre DESPUÉS de que la tela llegó. */}
                      <button className="btn" style={{ padding: "4px 9px", marginRight: 6, fontSize: 12 }}
                        onClick={() => abrir(p)}>✏️ Editar</button>
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
        titulo={editId ? "Editar pedido de tela" : "Nuevo pedido de tela"}
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        ancho={700}
        pie={
          <>
            <button className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary" disabled={ocupado} onClick={guardar}>
              {ocupado ? "Guardando…" : editId ? "Guardar cambios" : "Guardar pedido"}
            </button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        {bloqueado && cortesEdit && (
          <div className="warning-banner">
            <b>
              Este pedido ya tiene {cortesEdit.n} corte{cortesEdit.n !== 1 ? "s" : ""}{" "}
              registrado{cortesEdit.n !== 1 ? "s" : ""}.
            </b>{" "}
            Los colores, la unidad y el rendimiento quedan bloqueados: cambiarlos
            desvincularía los colores del corte de los del pedido, y el sistema perdería
            el rastro de qué tela se usó en qué corte. Todo lo demás —proveedor, nombre,
            fecha, prenda, ancho y valor por metro— sí se puede corregir.
          </div>
        )}
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
                  <input type="radio" checked={form.unidad === u} disabled={bloqueado}
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
        {pedidoEdit?.estado === "entregado" && (
          <Fila>
            <Campo label="Ancho real medido (cm)">
              <input className="pinput" type="number" inputMode="decimal" min="10" max="400" step="0.5"
                value={form.ancho_real}
                onChange={(e) => setForm({ ...form, ancho_real: e.target.value })} />
            </Campo>
            <Campo label="Recepción">
              <div className="pinput" style={{ color: "var(--muted)", fontSize: 12.5 }}>
                {textoRecepcionCortadora(pedidoEdit) ??
                  (pedidoEdit.recibido_por_rol === "admin" ? "Confirmada por admin" : "Sin registro de quién la recibió")}
              </div>
            </Campo>
          </Fila>
        )}
        {esKilos && (
          <Fila>
            <Campo label="Rendimiento (metros por kilo)" requerido>
              <input className="pinput" type="number" step="0.01" min="0.01" placeholder="Ej: 3.50" value={form.rendimiento}
                disabled={bloqueado}
                onChange={(e) => setForm({ ...form, rendimiento: e.target.value })} />
            </Campo>
            <Campo label="Total en metros (calculado)">
              <div className="pinput" style={{ color: "var(--muted)" }}>
                {metrosEfectivos > 0 ? `${metrosEfectivos.toFixed(2)} m` : "— m"}
              </div>
            </Campo>
          </Fila>
        )}
        <Fila>
          <Campo label="Proveedor" requerido>
            <select className="pinput" value={form.proveedor_id}
              onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
              <option value="">— Selecciona —</option>
              {proveedoresActivos.map((p) => <option key={p.id} value={p.id}>{p.empresa}</option>)}
            </select>
            {!proveedoresActivos.length && (
              <span style={{ color: "var(--warn)", fontSize: 12 }}>No hay proveedores; agrega uno primero.</span>
            )}
          </Campo>
          <Campo label="Propósito (prenda)">
            <select className="pinput" value={form.prenda_id}
              onChange={(e) => setForm({ ...form, prenda_id: e.target.value })}>
              <option value="">— Sin especificar —</option>
              {prendasActivas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
        </Fila>
        {prendaSel && (
          <div style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, marginBottom: 12, color: "var(--accent)" }}>
            {estimacion.metodo === "area" && estimacion.tendido ? (
              <>
                <div>
                  Consumo por unidad: <b>{prendaSel.consumo_m2} m²</b> · mesa de{" "}
                  {largoMesaGrande} m → <b>{estimacion.tendido.capas} capas</b> (
                  {estimacion.tendido.metrosUsables.toFixed(1)} m tendidos,{" "}
                  {estimacion.tendido.desperdicioDobleces.toFixed(2)} m en dobleces)
                </div>
                <div style={{ marginTop: 3 }}>
                  ≈ <b>{estimacion.areaUsableM2?.toFixed(1)} m²</b> aprovechables → saldrían ≈{" "}
                  <b>{unidadesEstimadas} unidades</b>
                  {estimacion.tendido.sobra > 0.05 && (
                    <span style={{ color: "var(--muted)" }}>
                      {" · sobran "}
                      {estimacion.tendido.sobra.toFixed(1)} m a retazos
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                Consumo por unidad: {prendaSel.consumo_metros} m
                {unidadesEstimadas != null && <> · con {metrosEfectivos.toFixed(1)} m saldrían ≈ <b>{unidadesEstimadas} unidades</b></>}
                {prendaSel.consumo_m2 == null && (
                  <div style={{ marginTop: 3, color: "var(--muted)", fontSize: 11.5 }}>
                    Estimación lineal. Anota el consumo en m² de esta prenda para contar capas
                    y dobleces.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <Campo label={`Colores del pedido (cantidad en ${esKilos ? "kilos" : "metros"})`} requerido>
          {bloqueado ? (
            // En gris y no escondidos: hay que poder VER los colores del pedido
            // aunque no se puedan tocar.
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
              {colores.length ? (
                colores.map((c, i) => (
                  <Badge key={i}>
                    {c.color}: {c.cant} {esKilos ? "kg" : "m"}
                  </Badge>
                ))
              ) : (
                <span className="sub">Sin colores registrados</span>
              )}
            </div>
          ) : (
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
          )}
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
            <span className="num">{metrosEfectivos > 0 ? `${metrosEfectivos.toFixed(2)} m` : "—"}</span>
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
