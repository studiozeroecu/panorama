"use client";

import { useState } from "react";
import { useProd } from "./useProduccion";
import { Modal, Campo, Fila, Badge, Vacio } from "@/components/ui";
import { money, TALLA_ORDER, type Prenda } from "@/lib/produccion/types";
import { PARTES, NOMBRE_PARTE_GENERICO, type Parte } from "@/lib/produccion/conjuntos";
import { nuevoId } from "@/lib/id";

/** Fase 8r: lo que se teclea de cada parte de un conjunto. */
interface FormParte {
  nombre: string;
  consumo_metros: string;
  costo_maquila: string;
  precio_venta_local: string;
  precio_venta_online: string;
}
const PARTE_VACIA: FormParte = {
  nombre: "", consumo_metros: "", costo_maquila: "", precio_venta_local: "", precio_venta_online: "",
};

const FORM_VACIO = {
  nombre: "",
  consumo_metros: "",
  consumo_m2: "",
  costo_maquila: "",
  precio_venta_local: "",
  precio_venta_online: "",
  lleva_estampado: false,
  tallas: [] as string[],
  notas: "",
  /** Fase 8r: se MARCA, no se deduce del nombre. */
  es_conjunto: false,
  partes: { superior: { ...PARTE_VACIA }, inferior: { ...PARTE_VACIA } } as Record<Parte, FormParte>,
};

export default function PrendasTab() {
  const { data, supabase, reload, toast } = useProd();
  const [abierto, setAbierto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [err, setErr] = useState<string | null>(null);

  const activas = data.prendas.filter((p) => !p.archivada_en);
  const archivadas = data.prendas.filter((p) => p.archivada_en);

  function abrir(p?: Prenda) {
    setErr(null);
    if (p) {
      setEditId(p.id);
      setForm({
        nombre: p.nombre,
        consumo_metros: String(p.consumo_metros),
        consumo_m2: p.consumo_m2 == null ? "" : String(p.consumo_m2),
        costo_maquila: String(p.costo_maquila),
        precio_venta_local: String(p.precio_venta_local),
        precio_venta_online: String(p.precio_venta_online),
        lleva_estampado: p.lleva_estampado,
        tallas: p.tallas ?? [],
        notas: p.notas ?? "",
        es_conjunto: p.es_conjunto,
        partes: Object.fromEntries(
          PARTES.map((parte) => {
            const x = p.partes.find((y) => y.parte === parte);
            return [parte, x ? {
              nombre: x.nombre,
              consumo_metros: x.consumo_metros == null ? "" : String(x.consumo_metros),
              costo_maquila: String(x.costo_maquila),
              precio_venta_local: String(x.precio_venta_local),
              precio_venta_online: String(x.precio_venta_online),
            } : { ...PARTE_VACIA }];
          })
        ) as Record<Parte, FormParte>,
      });
    } else {
      setEditId(null);
      setForm(FORM_VACIO);
    }
    setAbierto(true);
  }

  async function guardar() {
    // Fase 8r: en un conjunto el consumo y la maquila de la prenda son la SUMA de
    // sus dos partes. Se guardan así a propósito (no es un derivado gratuito): la
    // estimación de unidades de Pedidos y Corte lee consumo_metros de la prenda, y
    // así estima SETS sin tener que saber de conjuntos.
    const partes = form.es_conjunto
      ? PARTES.map((parte) => {
          const x = form.partes[parte];
          return {
            parte,
            nombre: x.nombre.trim(),
            consumo_metros: parseFloat(x.consumo_metros),
            costo_maquila: parseFloat(x.costo_maquila),
            precio_venta_local: parseFloat(x.precio_venta_local),
            precio_venta_online: parseFloat(x.precio_venta_online),
          };
        })
      : [];
    for (const x of partes) {
      const cual = NOMBRE_PARTE_GENERICO[x.parte].toLowerCase();
      if (!x.nombre) return setErr(`Ponle nombre a la ${cual} (ej. Blusa, Pantalón).`);
      if (!(x.consumo_metros > 0)) return setErr(`El consumo de tela de la ${cual} debe ser mayor a 0.`);
      if (!(x.costo_maquila > 0)) return setErr(`El costo de maquila de la ${cual} debe ser mayor a 0.`);
      if (!(x.precio_venta_local > 0) || !(x.precio_venta_online > 0))
        return setErr(`Los precios sueltos de la ${cual} deben ser mayores a 0.`);
    }
    const consumo = form.es_conjunto
      ? partes.reduce((s, x) => s + x.consumo_metros, 0)
      : parseFloat(form.consumo_metros);
    const costo = form.es_conjunto
      ? partes.reduce((s, x) => s + x.costo_maquila, 0)
      : parseFloat(form.costo_maquila);
    const pl = parseFloat(form.precio_venta_local);
    const po = parseFloat(form.precio_venta_online);
    if (!form.nombre.trim()) return setErr("El nombre es requerido.");
    if (!(consumo > 0)) return setErr("El consumo de tela debe ser mayor a 0.");
    if (!(costo > 0)) return setErr("El costo de maquila debe ser mayor a 0.");
    if (!(pl > 0) || !(po > 0))
      return setErr(form.es_conjunto ? "Los precios del set deben ser mayores a 0." : "Los precios deben ser mayores a 0.");
    if (!form.tallas.length) return setErr("Selecciona al menos una talla.");
    // Opcional, pero si se escribe algo tiene que ser > 0: el check de la base
    // solo admite null o positivo, para que un 0 no se confunda con "sin medir".
    const m2 = form.consumo_m2.trim() === "" ? null : parseFloat(form.consumo_m2);
    if (m2 !== null && !(m2 > 0))
      return setErr("El consumo en m² debe ser mayor a 0, o déjalo vacío si no lo has medido.");

    const fila = {
      nombre: form.nombre.trim(),
      consumo_metros: consumo,
      consumo_m2: m2,
      costo_maquila: costo,
      precio_venta_local: pl,
      precio_venta_online: po,
      lleva_estampado: form.lleva_estampado,
      tallas: form.tallas,
      notas: form.notas.trim(),
      es_conjunto: form.es_conjunto,
    };
    // El id nace aquí para poder guardar las partes de una prenda nueva.
    const id = editId ?? nuevoId();
    const { error } = editId
      ? await supabase.from("prod_prendas").update(fila).eq("id", id)
      : await supabase.from("prod_prendas").insert({ ...fila, id });
    if (error) return setErr(error.message);

    if (partes.length) {
      // Si al marcarla como sola se quitan las partes, NO se borran: los cortes
      // de conjunto que ya existan siguen sabiendo cómo se llamaba cada parte.
      const { error: e2 } = await supabase
        .from("prod_prenda_partes")
        .upsert(partes.map((x) => ({ ...x, prenda_id: id })), { onConflict: "prenda_id,parte" });
      if (e2) {
        return setErr(
          e2.message.includes("prod_prenda_partes") || e2.message.includes("schema cache")
            ? "La prenda se guardó, pero faltan las partes: aplica la fase 8r en la base y vuelve a guardar."
            : `La prenda se guardó, pero no las partes: ${e2.message}`
        );
      }
    }
    toast(editId ? "Prenda actualizada" : "Prenda guardada");
    setAbierto(false);
    await reload();
  }

  /**
   * Fase 8e: archivar en vez de borrar. Todas las FK hacia prod_prendas son
   * `on delete set null`, así que borrar nunca fallaba pero desvinculaba el
   * historial en silencio: un corte registrado después entraba con costo_maquila 0,
   * congelado para siempre en prod_maquilas. Archivar la saca de los desplegables
   * sin tocar ningún vínculo, y es reversible.
   */
  async function archivar(p: Prenda) {
    const { error } = await supabase
      .from("prod_prendas")
      .update({ archivada_en: new Date().toISOString() })
      .eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`«${p.nombre}» archivada. Ya no aparecerá al crear pedidos; su historial se conserva intacto.`);
    await reload();
  }

  async function desarchivar(p: Prenda) {
    const { error } = await supabase
      .from("prod_prendas")
      .update({ archivada_en: null })
      .eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`«${p.nombre}» vuelve a estar disponible.`);
    await reload();
  }

  return (
    <section>
      <div className="section-head">
        <h2>Prendas <span className="sub" style={{ fontWeight: 400 }}>· consumos, costos y precios</span></h2>
        <button className="btn primary" onClick={() => abrir()}>+ Nueva prenda</button>
      </div>

      {!data.prendas.length ? (
        <Vacio titulo="No hay prendas registradas aún" hint="Comienza agregando tu primera prenda" />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th style={{ textAlign: "right" }}>Consumo</th>
                <th style={{ textAlign: "right" }}>Maquila</th>
                <th style={{ textAlign: "right" }}>P. local</th>
                <th style={{ textAlign: "right" }}>P. online</th>
                <th>Estampado</th>
                <th>Tallas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...activas, ...archivadas].map((p) => (
                <tr key={p.id} style={p.archivada_en ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{p.nombre}</strong>
                    {p.es_conjunto && <Badge color="azul">Conjunto</Badge>}
                    {p.archivada_en && <Badge>Archivada</Badge>}
                    {p.es_conjunto && p.partes.length > 0 && (
                      <div className="sub" style={{ fontSize: 11.5 }}>
                        {[...p.partes]
                          .sort((a, b) => PARTES.indexOf(a.parte) - PARTES.indexOf(b.parte))
                          .map((x) => `${x.nombre}: ${x.consumo_metros ?? "—"} m · maquila ${money(x.costo_maquila)} · suelta ${money(x.precio_venta_online)}`)
                          .join("  ·  ")}
                      </div>
                    )}
                    {p.notas && <div className="sub" style={{ fontSize: 11.5 }}>{p.notas}</div>}
                  </td>
                  <td className="num">{p.consumo_metros} m</td>
                  <td className="num">{money(p.costo_maquila)}</td>
                  <td className="num">{money(p.precio_venta_local)}</td>
                  <td className="num">{money(p.precio_venta_online)}</td>
                  <td>{p.lleva_estampado ? <Badge color="azul">Sí</Badge> : <Badge>No</Badge>}</td>
                  <td>{(p.tallas ?? []).map((t) => <Badge key={t}>{t}</Badge>)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ padding: "4px 9px", marginRight: 6 }} onClick={() => abrir(p)}>✏</button>
                    {p.archivada_en ? (
                      <button className="btn" style={{ padding: "4px 9px", fontSize: 12 }}
                        onClick={() => desarchivar(p)}>↩ Desarchivar</button>
                    ) : (
                      <button className="btn" style={{ padding: "4px 9px", fontSize: 12 }}
                        onClick={() => archivar(p)}>📦 Archivar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        titulo={editId ? "Editar prenda" : "Nueva prenda"}
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        pie={
          <>
            <button className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary" onClick={guardar}>Guardar prenda</button>
          </>
        }
      >
        {err && <div className="error-banner">{err}</div>}
        <Campo label="Nombre" requerido>
          <input className="pinput" value={form.nombre} placeholder="Ej: Camiseta básica"
            onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </Campo>
        <Campo label="Tipo de prenda" requerido>
          <div style={{ display: "flex", gap: 8 }}>
            {([[false, "Prenda sola"], [true, "Conjunto / set (2 partes)"]] as const).map(([v, t]) => (
              <button key={t} type="button" className={form.es_conjunto === v ? "btn primary" : "btn"}
                onClick={() => setForm({ ...form, es_conjunto: v })}>{t}</button>
            ))}
          </div>
          {form.es_conjunto && (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              Sale de una sola tela y un solo corte, pero cada parte lleva su consumo, su maquila y su
              precio suelto. Los precios de abajo son los del SET completo.
            </span>
          )}
        </Campo>
        {form.es_conjunto && PARTES.map((parte) => {
          const x = form.partes[parte];
          const poner = (k: keyof FormParte, v: string) =>
            setForm({ ...form, partes: { ...form.partes, [parte]: { ...x, [k]: v } } });
          return (
            <div key={parte} className="card" style={{ padding: 12, marginBottom: 10 }}>
              <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>{NOMBRE_PARTE_GENERICO[parte]}</div>
              <Fila>
                <Campo label="Nombre" requerido>
                  <input className="pinput" value={x.nombre}
                    placeholder={parte === "superior" ? "Ej: Blusa" : "Ej: Pantalón"}
                    onChange={(e) => poner("nombre", e.target.value)} />
                </Campo>
                <Campo label="Consumo de tela (m/unidad)" requerido>
                  <input className="pinput" type="number" step="0.01" min="0" value={x.consumo_metros}
                    onChange={(e) => poner("consumo_metros", e.target.value)} />
                </Campo>
                <Campo label="Costo maquila ($/unidad)" requerido>
                  <input className="pinput" type="number" step="0.01" min="0" value={x.costo_maquila}
                    onChange={(e) => poner("costo_maquila", e.target.value)} />
                </Campo>
              </Fila>
              <Fila>
                <Campo label="Precio suelta local" requerido>
                  <input className="pinput" type="number" step="0.01" min="0" value={x.precio_venta_local}
                    onChange={(e) => poner("precio_venta_local", e.target.value)} />
                </Campo>
                <Campo label="Precio suelta online" requerido>
                  <input className="pinput" type="number" step="0.01" min="0" value={x.precio_venta_online}
                    onChange={(e) => poner("precio_venta_online", e.target.value)} />
                </Campo>
              </Fila>
            </div>
          );
        })}
        {!form.es_conjunto && <Fila>
          <Campo label="Consumo de tela (m/unidad)" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.consumo_metros}
              onChange={(e) => setForm({ ...form, consumo_metros: e.target.value })} />
          </Campo>
          <Campo label="Consumo en área (m²/unidad)">
            <input className="pinput" type="number" step="0.001" min="0" placeholder="Opcional"
              value={form.consumo_m2}
              onChange={(e) => setForm({ ...form, consumo_m2: e.target.value })} />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              Se mide aparte, no se calcula del consumo en metros. Mejora la estimación de
              unidades al crear un pedido de tela.
            </span>
          </Campo>
          <Campo label="Costo maquila ($/unidad)" requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.costo_maquila}
              onChange={(e) => setForm({ ...form, costo_maquila: e.target.value })} />
          </Campo>
        </Fila>}
        <Fila>
          <Campo label={form.es_conjunto ? "Precio del SET local" : "Precio venta local"} requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.precio_venta_local}
              onChange={(e) => setForm({ ...form, precio_venta_local: e.target.value })} />
          </Campo>
          <Campo label={form.es_conjunto ? "Precio del SET online" : "Precio venta online"} requerido>
            <input className="pinput" type="number" step="0.01" min="0" value={form.precio_venta_online}
              onChange={(e) => setForm({ ...form, precio_venta_online: e.target.value })} />
          </Campo>
        </Fila>
        <Campo label="Tallas disponibles" requerido>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TALLA_ORDER.map((t) => {
              const activa = form.tallas.includes(t);
              return (
                <button key={t} type="button"
                  className="btn"
                  style={activa ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                  onClick={() =>
                    setForm({
                      ...form,
                      tallas: activa ? form.tallas.filter((x) => x !== t) : [...form.tallas, t],
                    })
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Campo>
        <Campo label="¿Lleva estampado?">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={form.lleva_estampado}
              onChange={(e) => setForm({ ...form, lleva_estampado: e.target.checked })}
              style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
            {form.lleva_estampado ? "Sí" : "No"}
          </label>
        </Campo>
        <Campo label="Notas (opcional)">
          <textarea className="pinput" rows={2} value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </Campo>
      </Modal>

    </section>
  );
}
