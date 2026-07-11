import type { SupabaseClient } from "@supabase/supabase-js";
import { parseWorkbook, summarize, isStockAlert } from "@/lib/parser";

/**
 * Lógica de creación de snapshots, compartida entre la carga web
 * (/api/snapshots) y el bot de Telegram.
 */

const CHUNK = 500;

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ExistingSnapshot {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  archivo_nombre: string;
  created_at: string;
}

export type CreateSnapshotResult =
  | { ok: true; id: string; summary: ReturnType<typeof summarize>; locales: string[]; warnings: string[] }
  | { ok: false; conflict: true; existing: ExistingSnapshot[] }
  | { ok: false; conflict?: false; error: string; warnings?: string[] };

export async function createSnapshot(
  supabase: SupabaseClient,
  opts: {
    buffer: Buffer;
    filename: string;
    desde: string; // YYYY-MM-DD
    hasta: string;
    mode: "check" | "replace" | "keep";
  }
): Promise<CreateSnapshotResult> {
  const { buffer, filename, desde, hasta, mode } = opts;

  let parsed;
  try {
    parsed = parseWorkbook(buffer);
  } catch {
    return { ok: false, error: "No se pudo leer el archivo. ¿Es el Excel exportado de Adosoft?" };
  }

  if (!parsed.sales.length && !parsed.stock.length) {
    return {
      ok: false,
      error: "El archivo no contiene ni hoja de ventas ni hoja de existencia por local reconocibles.",
      warnings: parsed.warnings,
    };
  }

  // ¿Ya existe un snapshot que se solape con este periodo?
  const { data: existing, error: exErr } = await supabase
    .from("snapshots")
    .select("id, periodo_desde, periodo_hasta, archivo_nombre, created_at")
    .lte("periodo_desde", hasta)
    .gte("periodo_hasta", desde);
  if (exErr) return { ok: false, error: exErr.message };

  if (existing && existing.length > 0 && mode === "check") {
    return { ok: false, conflict: true, existing };
  }

  if (existing && existing.length > 0 && mode === "replace") {
    const ids = existing.map((s) => s.id);
    const { data: files } = await supabase
      .from("snapshots")
      .select("archivo_path")
      .in("id", ids);
    const paths = (files ?? []).map((f) => f.archivo_path).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("reportes").remove(paths);
    const { error: delErr } = await supabase.from("snapshots").delete().in("id", ids);
    if (delErr) return { ok: false, error: delErr.message };
  }

  const summary = summarize(parsed);

  const { data: snapshot, error: insErr } = await supabase
    .from("snapshots")
    .insert({
      periodo_desde: desde,
      periodo_hasta: hasta,
      archivo_nombre: filename,
      total_unidades: summary.totalUnidades,
      total_neto: Math.round(summary.totalNeto * 100) / 100,
      num_alertas: summary.numAlertas,
      num_lineas_venta: summary.numProductosVendidos,
      locales: parsed.locales,
      warnings: parsed.warnings,
    })
    .select("id")
    .single();
  if (insErr || !snapshot) return { ok: false, error: insErr?.message ?? "Error al guardar" };
  const snapshotId = snapshot.id as string;

  const storagePath = `${snapshotId}/${filename}`;
  const { error: upErr } = await supabase.storage
    .from("reportes")
    .upload(storagePath, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  if (!upErr) {
    await supabase.from("snapshots").update({ archivo_path: storagePath }).eq("id", snapshotId);
  }

  const productMap = new Map<string, string>();
  for (const s of parsed.stock) productMap.set(s.codigo, s.descripcion);
  for (const s of parsed.sales) productMap.set(s.codigo, s.descripcion || productMap.get(s.codigo) || "");
  const products = [...productMap].map(([codigo, descripcion]) => ({ codigo, descripcion }));

  try {
    for (const batch of chunked(products, CHUNK)) {
      const { error } = await supabase.from("products").upsert(batch, { onConflict: "codigo" });
      if (error) throw new Error(error.message);
    }
    for (const batch of chunked(parsed.sales, CHUNK)) {
      const { error } = await supabase.from("sales_lines").insert(
        batch.map((s) => ({ snapshot_id: snapshotId, ...s }))
      );
      if (error) throw new Error(error.message);
    }
    for (const batch of chunked(parsed.stock, CHUNK)) {
      const { error } = await supabase.from("stock_lines").insert(
        batch.map((s) => ({ snapshot_id: snapshotId, ...s, es_alerta: isStockAlert(s) }))
      );
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    // inserción parcial: elimina el snapshot para no dejar datos a medias
    await supabase.from("snapshots").delete().eq("id", snapshotId);
    await supabase.storage.from("reportes").remove([storagePath]);
    return {
      ok: false,
      error: `Error guardando los datos: ${e instanceof Error ? e.message : e}`,
    };
  }

  return { ok: true, id: snapshotId, summary, locales: parsed.locales, warnings: parsed.warnings };
}
