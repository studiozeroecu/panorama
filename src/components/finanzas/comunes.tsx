"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cargarFinanzas, cargarIngresos, ErrorCarga } from "@/lib/finanzas/cargar";
import { anterior, contiene, periodoDe, siguiente, type Periodo } from "@/lib/finanzas/periodos";
import type { Ambito, DatosFinanzas, DatosIngresos, Exigibilidad } from "@/lib/finanzas/tipos";
import { Badge } from "@/components/ui";

/** Carga los datos de un rango. Si algo falla, `error` trae el mensaje y NO hay datos. */
export function useDatosFinanzas(rango: { desde: string; hasta: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [datos, setDatos] = useState<DatosFinanzas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const { desde, hasta } = rango;

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const d = await cargarFinanzas(supabase, { desde, hasta });
      setDatos(d);
      setError(null);
    } catch (e) {
      setDatos(null);
      setError(
        e instanceof ErrorCarga
          ? e.message
          : `No se pudo cargar Finanzas — los totales no son confiables. (${e instanceof Error ? e.message : String(e)})`
      );
    } finally {
      setCargando(false);
    }
  }, [supabase, desde, hasta]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { supabase, datos, error, cargando, recargar };
}

export function BannerError({ texto }: { texto: string }) {
  return (
    <div className="error-banner" style={{ whiteSpace: "pre-line" }}>
      {texto}
    </div>
  );
}

export function EtiquetaAmbito({ ambito }: { ambito: Ambito }) {
  return ambito === "personal" ? <Badge color="ambar">👤 personal</Badge> : <Badge color="azul">empresa</Badge>;
}

export function EtiquetaExigibilidad({ exigibilidad }: { exigibilidad: Exigibilidad | null }) {
  if (exigibilidad === "flexible") return <Badge>flexible</Badge>;
  return null;
}

/** Mensaje legible de un error de Supabase / de la base. */
export function mensajeError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/**
 * Identificador para protección contra doble clic (lo exige la base).
 * El del proyecto (src/lib/id.ts): crypto.randomUUID() solo existe en https o
 * localhost y revienta al abrir la app desde el teléfono por la IP local.
 */
export { nuevoId } from "@/lib/id";

/** Carga todo lo de ingresos (Por cobrar, Ventas directas, Mi sueldo). */
export function useIngresos() {
  const supabase = useMemo(() => createClient(), []);
  const [datos, setDatos] = useState<DatosIngresos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await cargarIngresos(supabase));
      setError(null);
    } catch (e) {
      setDatos(null);
      setError(
        e instanceof ErrorCarga
          ? e.message
          : `No se pudo cargar Finanzas — los totales no son confiables. (${e instanceof Error ? e.message : String(e)})`
      );
    } finally {
      setCargando(false);
    }
  }, [supabase]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { supabase, datos, error, cargando, recargar };
}

/** ◀ periodo ▶ [Hoy] — la misma navegación en todas las pestañas. */
export function NavPeriodo({
  periodo,
  onCambiar,
  hoy,
}: {
  periodo: Periodo;
  onCambiar: (p: Periodo) => void;
  hoy: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" onClick={() => onCambiar(anterior(periodo))} aria-label="Periodo anterior">◀</button>
      <h2 style={{ margin: 0, minWidth: 150, textAlign: "center" }}>{periodo.etiqueta}</h2>
      <button className="btn" onClick={() => onCambiar(siguiente(periodo))} aria-label="Periodo siguiente">▶</button>
      {!contiene(periodo, hoy) && (
        <button className="btn" onClick={() => onCambiar(periodoDe(periodo.tipo, hoy))}>Hoy</button>
      )}
    </div>
  );
}
