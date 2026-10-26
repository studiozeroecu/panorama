import type { SupabaseClient } from "@supabase/supabase-js";
import { nuevoId } from "@/lib/id";
import { pendientesPorTalla, sumaTallas, type EntregaBreve, type Tallas } from "./entregas";

/**
 * "Todo enviado" / "Todo recibido" de un lote de maquila — un corte con todos
 * sus colores (y, en un conjunto, sus dos partes).
 *
 * No hay función nueva en la base: se usan las mismas que marcan un color a la
 * vez (fn_marcar_enviado_maquila, fn_registrar_entrega_maquila), una llamada
 * por color. Cada una es atómica e idempotente, así que si algo falla a mitad
 * basta con volver a pulsar: lo ya hecho no se repite y lo que falta se hace.
 * No hace falta que el lote entero sea todo-o-nada — cada color es independiente.
 */

export interface ColorLote {
  id: string;
  estado: "pendiente" | "enviado" | "entregado";
  tallas: Tallas;
  entregas: EntregaBreve[];
}

/** Los colores que todavía no salieron a la maquiladora. */
export function planTodoEnviado(colores: ColorLote[]): string[] {
  return colores.filter((c) => c.estado === "pendiente").map((c) => c.id);
}

/**
 * Lo que falta por recibir de cada color: lo cortado menos lo ya entregado o
 * justificado. Los colores ya completos no entran.
 */
export function planTodoRecibido(colores: ColorLote[]): { id: string; tallas: Tallas; unidades: number }[] {
  return colores
    .filter((c) => c.estado !== "entregado")
    .map((c) => {
      const tallas = pendientesPorTalla(c.tallas, c.entregas);
      return { id: c.id, tallas, unidades: sumaTallas(tallas) };
    })
    .filter((x) => x.unidades > 0);
}

export interface ResultadoLote {
  hechos: number;
  fallos: string[];
}

export async function ejecutarTodoEnviado(
  supabase: SupabaseClient,
  ids: string[],
  fecha: string
): Promise<ResultadoLote> {
  const r: ResultadoLote = { hechos: 0, fallos: [] };
  for (const id of ids) {
    const { error } = await supabase.rpc("fn_marcar_enviado_maquila", { p_maquila_color_id: id, p_fecha: fecha });
    if (error) r.fallos.push(error.message);
    else r.hechos++;
  }
  return r;
}

export async function ejecutarTodoRecibido(
  supabase: SupabaseClient,
  plan: { id: string; tallas: Tallas }[],
  fecha: string
): Promise<ResultadoLote> {
  const r: ResultadoLote = { hechos: 0, fallos: [] };
  for (const x of plan) {
    const { error } = await supabase.rpc("fn_registrar_entrega_maquila", {
      p_maquila_color_id: x.id,
      p_fecha: fecha,
      p_tallas: x.tallas,
      // Un id por intento: un doble toque no registra la entrega dos veces.
      p_idem_id: nuevoId(),
    });
    if (error) r.fallos.push(error.message);
    else r.hechos++;
  }
  return r;
}
