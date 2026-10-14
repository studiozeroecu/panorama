"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cargarFinanzas, ErrorCarga } from "@/lib/finanzas/cargar";
import type { Ambito, DatosFinanzas, Exigibilidad } from "@/lib/finanzas/tipos";
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

/** Identificador para protección contra doble clic (lo exige la base). */
export function nuevoId(): string {
  return crypto.randomUUID();
}
