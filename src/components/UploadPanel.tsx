"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { periodo } from "@/lib/format";

interface Conflict {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  archivo_nombre: string;
  created_at: string;
}

export default function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);

  async function submit(mode: "check" | "replace" | "keep") {
    if (!file || !desde || !hasta) {
      setError("Selecciona el archivo y el periodo que cubre el reporte.");
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("desde", desde);
    form.append("hasta", hasta);
    form.append("mode", mode);

    try {
      const res = await fetch("/api/snapshots", { method: "POST", body: form });
      const body = await res.json();
      if (res.status === 409 && body.conflict) {
        setConflicts(body.existing);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Error al procesar el archivo.");
        setBusy(false);
        return;
      }
      setConflicts(null);
      router.push(`/snapshots/${body.id}`);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
      setBusy(false);
    }
  }

  function onFile(f: File | undefined) {
    if (f) {
      setFile(f);
      setError(null);
    }
  }

  return (
    <>
      <div
        className={`upload-zone${drag ? " drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFile(e.dataTransfer.files[0]);
        }}
      >
        <p>
          Arrastra aquí el Excel de <strong>Adosoft/VATEX</strong> (trae las hojas de
          ventas y existencia por local) e indica qué periodo cubre.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="upload-row">
          <button
            type="button"
            className="btn"
            style={file ? { borderColor: "var(--good)", color: "var(--good)" } : undefined}
            onClick={() => inputRef.current?.click()}
          >
            {file ? `✓ ${file.name}` : "Elegir archivo Excel"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <div className="field">
            <label htmlFor="desde">Desde</label>
            <input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="hasta">Hasta</label>
            <input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !file || !desde || !hasta}
            onClick={() => submit("check")}
          >
            {busy ? "Procesando…" : "Cargar reporte"}
          </button>
        </div>
      </div>

      {conflicts && (
        <div className="dialog-backdrop">
          <div className="dialog">
            <h3>Ya existe un reporte de este periodo</h3>
            <p>
              {conflicts.length === 1 ? "Hay un snapshot que se cruza" : `Hay ${conflicts.length} snapshots que se cruzan`}{" "}
              con las fechas que indicaste:
            </p>
            <ul style={{ color: "var(--muted)", fontSize: 13, paddingLeft: 18 }}>
              {conflicts.map((c) => (
                <li key={c.id}>
                  {periodo(c.periodo_desde, c.periodo_hasta)} · {c.archivo_nombre}
                </li>
              ))}
            </ul>
            <p>¿Quieres reemplazarlo con este archivo, o guardar este como una carga aparte?</p>
            <div className="actions">
              <button className="btn danger" disabled={busy} onClick={() => submit("replace")}>
                Reemplazar
              </button>
              <button className="btn" disabled={busy} onClick={() => submit("keep")}>
                Guardar aparte
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => setConflicts(null)}
                style={{ marginLeft: "auto" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
