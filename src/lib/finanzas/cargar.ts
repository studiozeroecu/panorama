/**
 * ÚNICO lugar que consulta la base para Finanzas.
 * - Lee por páginas: nunca se queda corto por el límite de filas de PostgREST.
 * - Si CUALQUIER consulta falla, lanza ErrorCarga: la pantalla debe mostrarlo
 *   en vez de enseñar totales incompletos como si fueran ciertos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cheque, DatosFinanzas, Deuda, Movimiento } from "./tipos";

export class ErrorCarga extends Error {
  constructor(public fallos: string[]) {
    super(fallos.map((f) => `No se pudo cargar ${f} — los totales no son confiables.`).join("\n"));
    this.name = "ErrorCarga";
  }
}

type RespuestaPagina = { data: unknown[] | null; error: { message: string } | null };
export type LeerPagina = (desde: number, hasta: number) => PromiseLike<RespuestaPagina>;

/**
 * Pide páginas hasta que una venga vacía. Avanza según las filas que llegaron
 * (no según las pedidas), así funciona aunque el servidor devuelva menos por
 * página de lo que se pidió.
 */
export async function leerTodo<T>(que: string, pagina: LeerPagina, tam = 1000): Promise<T[]> {
  const out: T[] = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await pagina(desde, desde + tam - 1);
    if (error) throw new ErrorCarga([`${que} (${error.message})`]);
    const filas = (data ?? []) as T[];
    if (filas.length === 0) return out;
    out.push(...filas);
    desde += filas.length;
  }
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numONull = (v: unknown) => (v == null ? null : Number(v));

function normDeuda(r: Record<string, unknown>): Deuda {
  return {
    ...(r as unknown as Deuda),
    monto: num(r.monto),
    monto_original: numONull(r.monto_original),
    cuota_mensual: numONull(r.cuota_mensual),
    total_pagado: num(r.total_pagado),
    total_pendiente: num(r.total_pendiente),
    total_rebotado: num(r.total_rebotado),
    saldo: num(r.saldo),
    sin_programar: num(r.sin_programar),
    cuotas_pendientes: num(r.cuotas_pendientes),
  };
}

function normCheque(r: Record<string, unknown>): Cheque {
  return { ...(r as unknown as Cheque), monto: num(r.monto) };
}

function normMovimiento(r: Record<string, unknown>): Movimiento {
  return { ...(r as unknown as Movimiento), monto: num(r.monto) };
}

/**
 * Carga lo necesario para ver un rango de fechas (una quincena o un mes):
 * todas las deudas, todos los pagos abiertos (pendientes y rebotados, de
 * cualquier fecha) y lo pagado / gastado dentro del rango.
 */
export async function cargarFinanzas(
  supabase: SupabaseClient,
  rango: { desde: string; hasta: string }
): Promise<DatosFinanzas> {
  const tareas = [
    leerTodo<Record<string, unknown>>("las deudas", (a, b) =>
      supabase.from("v_deudas").select("*").order("id").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("los pagos pendientes", (a, b) =>
      supabase
        .from("v_cheques")
        .select("*")
        .eq("tipo", "por_pagar")
        .in("estado", ["pendiente", "rebotado"])
        .order("id")
        .range(a, b)
    ),
    leerTodo<Record<string, unknown>>("los pagos hechos", (a, b) =>
      supabase
        .from("v_cheques")
        .select("*")
        .eq("tipo", "por_pagar")
        .in("estado", ["pagado", "cobrado"])
        .gte("fecha_pago", rango.desde)
        .lte("fecha_pago", rango.hasta)
        .order("id")
        .range(a, b)
    ),
    leerTodo<Record<string, unknown>>("los gastos registrados", (a, b) =>
      supabase
        .from("v_movimientos")
        .select("*")
        .gte("fecha", rango.desde)
        .lte("fecha", rango.hasta)
        .order("id")
        .range(a, b)
    ),
  ] as const;

  const res = await Promise.allSettled(tareas);
  const fallos = res.flatMap((r) =>
    r.status === "rejected" ? (r.reason instanceof ErrorCarga ? r.reason.fallos : [String(r.reason)]) : []
  );
  if (fallos.length) throw new ErrorCarga(fallos);

  const [deudas, abiertos, pagados, movimientos] = res.map((r) =>
    r.status === "fulfilled" ? r.value : []
  );
  return {
    deudas: deudas.map(normDeuda),
    chequesAbiertos: abiertos.map(normCheque),
    chequesPagados: pagados.map(normCheque),
    movimientos: movimientos.map(normMovimiento),
  };
}

/** Todos los pagos de una deuda (para el detalle en la pantalla Deudas). */
export async function cargarPagosDeDeuda(supabase: SupabaseClient, deudaId: string): Promise<Cheque[]> {
  const filas = await leerTodo<Record<string, unknown>>("los pagos de esta deuda", (a, b) =>
    supabase
      .from("v_cheques")
      .select("*")
      .eq("cuenta_por_pagar_id", deudaId)
      .order("fecha_cobro", { ascending: true, nullsFirst: false })
      .order("id")
      .range(a, b)
  );
  return filas.map(normCheque);
}
