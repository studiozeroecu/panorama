import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Suma unidades al stock online (upsert por prenda+color+estampado+talla).
 * Volumen de un solo usuario: select→update/insert es suficiente.
 */
export async function sumarStock(
  supabase: SupabaseClient,
  fila: {
    prenda_id: string | null;
    prenda_nombre: string;
    color: string;
    estampado: string;
    talla: string;
    unidades: number;
  }
): Promise<string | null> {
  if (fila.unidades <= 0) return null;
  const { data: existente, error: selErr } = await supabase
    .from("prod_stock_online")
    .select("id, disponibles")
    .eq("prenda_nombre", fila.prenda_nombre)
    .eq("color", fila.color)
    .eq("estampado", fila.estampado)
    .eq("talla", fila.talla)
    .maybeSingle();
  if (selErr) return selErr.message;

  if (existente) {
    const { error } = await supabase
      .from("prod_stock_online")
      .update({ disponibles: existente.disponibles + fila.unidades })
      .eq("id", existente.id);
    return error?.message ?? null;
  }
  const { error } = await supabase.from("prod_stock_online").insert({
    prenda_id: fila.prenda_id,
    prenda_nombre: fila.prenda_nombre,
    color: fila.color,
    estampado: fila.estampado,
    talla: fila.talla,
    disponibles: fila.unidades,
    vendidas: 0,
  });
  return error?.message ?? null;
}
