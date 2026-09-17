"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Badge } from "@/components/ui";
import { useProd } from "./useProduccion";
import type { LoteEstampado } from "@/lib/produccion/types";
import { hoyEcuador } from "@/lib/fechas";
import {
  ACLARACION_LADOS,
  TIPOS_PRENDA,
  adivinarTipo,
  posicionPorId,
  posicionesDe,
  rutaSilueta,
  type Lado,
  type TipoPrenda,
} from "@/lib/produccion/posiciones";
import {
  ANCHO_FICHA,
  aPng,
  altoFicha,
  cargarImagen,
  descripcion,
  dibujarFicha,
  textoFicha,
  type DatosFicha,
  type DisenoFicha,
} from "@/lib/produccion/ficha";

/**
 * Ficha visual de estampado: arma una imagen con la prenda y sus diseños y la
 * manda a un bot de Telegram aparte.
 *
 * Nada de esto se guarda: ni el archivo del diseño, ni la colocación, ni la
 * ficha. Las imágenes viven en memoria mientras el modal está abierto y se
 * liberan al cerrarlo. El archivo de verdad queda en el chat del bot, y se
 * busca ahí por la fecha.
 */

interface Fila {
  key: string;
  nombre: string;
  unidades: string;
  archivo: File | null;
  /** Para la miniatura del formulario; se revoca al quitar la fila. */
  url: string | null;
  /** Ya decodificada: `drawImage` con una imagen a medio cargar pinta en blanco. */
  img: HTMLImageElement | null;
  posicionId: string;
  lado: Lado;
}

let contador = 0;
const nuevaFila = (nombre = "", unidades = ""): Fila => ({
  key: `f${++contador}`,
  nombre,
  unidades,
  archivo: null,
  url: null,
  img: null,
  posicionId: "",
  lado: "izquierda",
});

export default function FichaEstampadoModal({
  lote,
  abierto,
  onCerrar,
}: {
  lote: LoteEstampado;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const { data, toast } = useProd();
  const taller = data.talleres.find((t) => t.id === lote.taller_id);

  const [tipo, setTipo] = useState<TipoPrenda>(() => adivinarTipo(lote.prenda_nombre));
  const [filas, setFilas] = useState<Fila[]>(() =>
    (lote.disenos ?? []).length
      ? lote.disenos.map((d) => nuevaFila(d.nombre, String(d.unidades)))
      : [nuevaFila()]
  );
  const [nota, setNota] = useState("");
  const [guias, setGuias] = useState(false);
  const [siluetas, setSiluetas] = useState<DatosFicha["siluetas"] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const posiciones = useMemo(() => posicionesDe(tipo), [tipo]);

  // Las siluetas se recargan al cambiar de prenda. Son del mismo origen, así
  // que el canvas no se contamina y toBlob() siempre puede exportar.
  useEffect(() => {
    let vigente = true;
    setSiluetas(null);
    Promise.all([
      cargarImagen(rutaSilueta(tipo, "frente")),
      cargarImagen(rutaSilueta(tipo, "espalda")),
    ])
      .then(([frente, espalda]) => vigente && setSiluetas({ frente, espalda }))
      .catch(() => vigente && toast("No se pudieron cargar los dibujos de la prenda.", "error"));
    return () => {
      vigente = false;
    };
  }, [tipo, toast]);

  // Al cambiar de prenda, una posición que ya no existe (el antebrazo de la
  // camiseta) dejaría la fila apuntando a la nada: se limpia en vez de fallar.
  useEffect(() => {
    setFilas((prev) =>
      prev.map((f) =>
        f.posicionId && !posiciones.some((p) => p.id === f.posicionId)
          ? { ...f, posicionId: "" }
          : f
      )
    );
  }, [posiciones]);

  // Las miniaturas son object URLs: sin revocarlas quedan retenidas en memoria.
  useEffect(() => {
    return () => {
      for (const f of filas) if (f.url) URL.revokeObjectURL(f.url);
    };
    // Solo al desmontar: revocar en cada cambio rompería las miniaturas vivas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disenos: DisenoFicha[] = useMemo(
    () =>
      filas.flatMap((f) => {
        const pos = f.posicionId ? posicionPorId(tipo, f.posicionId) : undefined;
        if (!pos) return [];
        return [
          {
            nombre: f.nombre.trim(),
            unidades: Number(f.unidades) || 0,
            imagen: f.img,
            posicion: pos,
            lado: f.lado,
          },
        ];
      }),
    [filas, tipo]
  );

  const datos: DatosFicha | null = useMemo(
    () =>
      siluetas && {
        tipo,
        prendaNombre: lote.prenda_nombre,
        color: lote.color,
        totalUnidades: lote.total_unidades,
        tallas: lote.tallas,
        fecha: lote.fecha_envio || hoyEcuador(),
        taller: taller?.nombre ?? "",
        nota: nota.trim(),
        siluetas,
        disenos,
      },
    [siluetas, tipo, lote, taller, nota, disenos]
  );

  // Se redibuja entero en cada cambio. A esta escala cuesta milisegundos y
  // evita tener que razonar sobre qué parte del lienzo quedó sucia.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !datos) return;
    const alto = altoFicha(datos.disenos.length);
    canvas.width = ANCHO_FICHA;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (ctx) dibujarFicha(ctx, datos, { guias });
  }, [datos, guias]);

  const cambiar = useCallback((key: string, cambios: Partial<Fila>) => {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  }, []);

  async function elegirArchivo(key: string, archivo: File | null) {
    const anterior = filas.find((f) => f.key === key);
    if (anterior?.url) URL.revokeObjectURL(anterior.url);
    if (!archivo) return cambiar(key, { archivo: null, url: null, img: null });
    try {
      const img = await cargarImagen(archivo);
      cambiar(key, {
        archivo,
        url: URL.createObjectURL(archivo),
        img,
        // Solo rellena el nombre si está vacío: no pisa lo que ya escribiste.
        ...(anterior?.nombre.trim() ? {} : { nombre: archivo.name.replace(/\.[^.]+$/, "") }),
      });
    } catch {
      toast("Ese archivo no se pudo leer como imagen.", "error");
    }
  }

  function quitar(key: string) {
    const f = filas.find((x) => x.key === key);
    if (f?.url) URL.revokeObjectURL(f.url);
    setFilas((prev) => prev.filter((x) => x.key !== key));
  }

  /** Devuelve el primer problema encontrado, o null si se puede enviar. */
  function revisar(): string | null {
    if (!datos) return "Los dibujos de la prenda todavía se están cargando.";
    if (!filas.length) return "Agrega al menos un diseño.";
    for (const f of filas) {
      if (!f.img) return `Falta la imagen de «${f.nombre.trim() || "un diseño"}».`;
      if (!f.posicionId) return `Falta elegir dónde va «${f.nombre.trim() || "un diseño"}».`;
    }
    // Dos diseños en el mismo sitio se pisarían, y en la ficha se vería uno solo.
    const vistos = new Set<string>();
    for (const d of datos.disenos) {
      const sitio = `${d.posicion.id}|${d.posicion.esManga ? d.lado : ""}`;
      if (vistos.has(sitio)) return `Hay dos diseños en ${descripcion(d)}.`;
      vistos.add(sitio);
    }
    return null;
  }

  async function enviar() {
    const problema = revisar();
    if (problema) return toast(problema, "error");
    const canvas = canvasRef.current;
    if (!canvas || !datos) return;

    setOcupado(true);
    try {
      // Sin guías: son una ayuda para calibrar, no algo que el taller deba ver.
      const ctx = canvas.getContext("2d");
      if (ctx) dibujarFicha(ctx, datos, { guias: false });

      const png = await aPng(canvas);
      const form = new FormData();
      form.append("foto", png, "ficha.png");
      form.append("texto", textoFicha(datos));

      const res = await fetch("/api/estampados/ficha", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      // No basta con res.ok: si la sesión caducó, el middleware redirige al
      // login y fetch sigue la redirección, devolviendo un 200 con HTML. Sin
      // exigir el ok:true del JSON, eso se leería como "enviada" sin haberlo
      // hecho — y al cerrarse el modal se perdería todo lo colocado.
      if (!res.ok || !json?.ok) {
        throw new Error(
          json?.error ||
            (res.redirected
              ? "Tu sesión caducó. Vuelve a entrar e inténtalo otra vez."
              : "No se pudo enviar la ficha.")
        );
      }

      toast("Ficha enviada a Telegram");
      onCerrar();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      // Se restaura la vista previa tal como estaba, con guías si las tenías.
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && datos) dibujarFicha(ctx, datos, { guias });
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo="Ficha visual de estampado"
      abierto={abierto}
      onCerrar={onCerrar}
      ancho={980}
      pie={
        <>
          <button className="btn" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </button>
          <button className="btn primary" onClick={enviar} disabled={ocupado || !siluetas}>
            {ocupado ? "Enviando…" : "Generar y enviar a Telegram"}
          </button>
        </>
      }
    >
      <div className="prod-meta" style={{ marginBottom: 14 }}>
        {lote.prenda_nombre} <Badge color="azul">{lote.color}</Badge> · {lote.total_unidades} und.
        {taller && ` · taller: ${taller.nombre}`}
      </div>

      <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>Prenda</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {TIPOS_PRENDA.map((t) => (
          <button
            key={t.tipo}
            className={`btn ${tipo === t.tipo ? "primary" : ""}`}
            style={{ fontSize: 12.5 }}
            onClick={() => setTipo(t.tipo)}
          >
            {t.etiqueta}
          </button>
        ))}
        <span style={{ fontSize: 11.5, color: "var(--muted)", alignSelf: "center" }}>
          Sugerida por el nombre — cámbiala si no corresponde.
        </span>
      </div>

      <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>
        Diseños <span style={{ fontWeight: 400, textTransform: "none" }}>· {ACLARACION_LADOS}</span>
      </div>

      {filas.map((f, i) => {
        const pos = f.posicionId ? posicionPorId(tipo, f.posicionId) : undefined;
        return (
          <div
            key={f.key}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              flexWrap: "wrap",
              padding: "10px 0",
              borderTop: i ? "1px solid var(--border)" : undefined,
            }}
          >
            <label
              style={{
                width: 72,
                height: 72,
                flexShrink: 0,
                border: "1px dashed var(--border)",
                borderRadius: 8,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                overflow: "hidden",
                background: "var(--surface-2)",
              }}
              title="Elegir imagen"
            >
              {f.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.url}
                  alt=""
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              ) : (
                <span style={{ fontSize: 22, color: "var(--muted)" }}>+</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                onChange={(e) => elegirArchivo(f.key, e.target.files?.[0] ?? null)}
              />
            </label>

            <div style={{ flex: "2 1 180px", minWidth: 160 }}>
              <div className="label" style={{ fontSize: 10 }}>Nombre</div>
              <input
                className="pinput"
                value={f.nombre}
                placeholder="Logo pecho"
                onChange={(e) => cambiar(f.key, { nombre: e.target.value })}
              />
            </div>

            <div style={{ flex: "3 1 240px", minWidth: 200 }}>
              <div className="label" style={{ fontSize: 10 }}>Posición</div>
              <select
                className="pinput"
                value={f.posicionId}
                onChange={(e) => cambiar(f.key, { posicionId: e.target.value })}
              >
                <option value="">— Elegir —</option>
                <optgroup label="Frente">
                  {posiciones
                    .filter((p) => p.vista === "frente")
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                </optgroup>
                <optgroup label="Espalda">
                  {posiciones
                    .filter((p) => p.vista === "espalda")
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                </optgroup>
              </select>
            </div>

            {/* El lado solo aplica a las mangas; en el resto no significa nada. */}
            {pos?.esManga && (
              <div style={{ flex: "1 1 130px", minWidth: 120 }}>
                <div className="label" style={{ fontSize: 10 }}>Manga</div>
                <select
                  className="pinput"
                  value={f.lado}
                  onChange={(e) => cambiar(f.key, { lado: e.target.value as Lado })}
                >
                  <option value="izquierda">Izquierda</option>
                  <option value="derecha">Derecha</option>
                  <option value="ambas">Las dos</option>
                </select>
              </div>
            )}

            <div style={{ width: 92 }}>
              <div className="label" style={{ fontSize: 10 }}>Unidades</div>
              <input
                className="pinput"
                type="number"
                min={0}
                value={f.unidades}
                onChange={(e) => cambiar(f.key, { unidades: e.target.value })}
              />
            </div>

            <button
              className="btn"
              style={{ padding: "6px 10px", marginTop: 18 }}
              onClick={() => quitar(f.key)}
              aria-label="Quitar diseño"
              title="Quitar diseño"
            >
              ✕
            </button>
          </div>
        );
      })}

      <button
        className="btn"
        style={{ fontSize: 12.5, marginTop: 10 }}
        onClick={() => setFilas((prev) => [...prev, nuevaFila()])}
      >
        + Agregar diseño
      </button>

      <div className="section-head" style={{ marginTop: 22 }}>
        <div className="label" style={{ fontSize: 10.5 }}>Vista previa</div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={guias} onChange={(e) => setGuias(e.target.checked)} />
          Ver todas las posiciones
        </label>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "#fff",
          minHeight: 120,
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
      {guias && (
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>
          Las guías son solo para ubicarte — no salen en la ficha que se envía.
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="label" style={{ fontSize: 10.5 }}>Nota para el taller (opcional)</div>
        <input
          className="pinput"
          value={nota}
          placeholder="Ej.: el logo va centrado con el cuello"
          onChange={(e) => setNota(e.target.value)}
        />
      </div>
    </Modal>
  );
}
