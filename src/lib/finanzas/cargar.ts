/**
 * ÚNICO lugar que consulta la base para Finanzas.
 * - Lee por páginas: nunca se queda corto por el límite de filas de PostgREST.
 * - Si CUALQUIER consulta falla, lanza ErrorCarga: la pantalla debe mostrarlo
 *   en vez de enseñar totales incompletos como si fueran ciertos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { gastosPorMes } from "./plan";
import type {
  Cheque,
  Cobro,
  CorteTarjeta,
  CuentaCobrar,
  CuentaDinero,
  DatosFinanzas,
  DatosIngresos,
  Deuda,
  EstimadoGasto,
  EstimadoMes,
  FacturaCobrar,
  GastoFijo,
  GastoMes,
  Movimiento,
  PagoFijo,
  PagoSueldo,
  PagoTarjeta,
  RegistroSueldo,
  SaldoCaja,
  Tarjeta,
  Temporada,
  VentaDirecta,
} from "./tipos";

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
  // planificación (fase 6): gastos fijos, tarjetas y estimados entran a la agenda
  const plan = await cargarPlanBase(supabase, rango);
  return {
    deudas: deudas.map(normDeuda),
    chequesAbiertos: abiertos.map(normCheque),
    chequesPagados: pagados.map(normCheque),
    movimientos: movimientos.map(normMovimiento),
    ...plan,
  };
}

// ------------------------------------------------------------
// Planificación (fase 6A): gastos fijos, estimados, tarjetas, caja
// ------------------------------------------------------------

/** Corre varias lecturas y, si CUALQUIERA falla, lanza un solo ErrorCarga con todas. */
async function todasOFalla(tareas: Promise<Record<string, unknown>[]>[]): Promise<Record<string, unknown>[][]> {
  const res = await Promise.allSettled(tareas);
  const fallos = res.flatMap((r) =>
    r.status === "rejected" ? (r.reason instanceof ErrorCarga ? r.reason.fallos : [String(r.reason)]) : []
  );
  if (fallos.length) throw new ErrorCarga(fallos);
  return res.map((r) => (r.status === "fulfilled" ? r.value : []));
}

/** Primer día del mes, `meses` meses antes del mes de `fecha`. */
function inicioMesAntes(fecha: string, meses: number): string {
  let [y, m] = fecha.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < meses; i++) [y, m] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Último día del mes de `fecha`. */
function finDeMes(fecha: string): string {
  const [y, m] = fecha.slice(0, 7).split("-").map(Number);
  const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${fecha.slice(0, 7)}-${String(ult).padStart(2, "0")}`;
}

/**
 * Lo de planificación que necesita la agenda para un rango: todos los gastos
 * fijos y sus pagos, todos los cortes y tarjetas, los pagos de tarjeta del
 * rango, los estimados con sus temporadas, y el gasto real por mes desde 12
 * meses antes (para sugerir estimados) hasta el fin del mes del rango.
 */
async function cargarPlanBase(
  supabase: SupabaseClient,
  rango: { desde: string; hasta: string }
): Promise<Required<Pick<DatosFinanzas,
  "fijos" | "pagosFijos" | "cortes" | "tarjetas" | "pagosTarjeta" | "estimados" | "estimadosMes" | "temporadas" | "historialGastos"
>>> {
  const desdeHistorial = inicioMesAntes(rango.desde, 12);
  const hastaHistorial = finDeMes(rango.desde) > rango.hasta ? finDeMes(rango.desde) : rango.hasta;
  const [fijos, pagosFijos, cortes, tarjetas, pagosTarjeta, estimados, estimadosMes, temporadas, gastos] = await todasOFalla([
    leerTodo<Record<string, unknown>>("los gastos fijos", (a, b) =>
      supabase.from("gastos_fijos").select("*").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("los pagos de gastos fijos", (a, b) =>
      supabase.from("gastos_fijos_pagos").select("*").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("los cortes de tarjeta", (a, b) =>
      supabase.from("v_tarjeta_cortes").select("*").order("fecha_corte").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("las tarjetas", (a, b) =>
      supabase.from("v_tarjetas").select("*").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("los pagos de tarjeta", (a, b) =>
      supabase.from("tarjeta_pagos").select("*").gte("fecha", rango.desde).lte("fecha", rango.hasta).order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("los estimados", (a, b) =>
      supabase.from("estimados_gasto").select("*").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("los estimados por mes", (a, b) =>
      supabase.from("estimados_mes").select("*").order("mes").order("estimado_id").range(a, b)),
    leerTodo<Record<string, unknown>>("las temporadas", (a, b) =>
      supabase.from("temporadas_mes").select("*").order("mes").range(a, b)),
    leerTodo<Record<string, unknown>>("el historial de gastos", (a, b) =>
      supabase.from("v_movimientos").select("fecha, tipo, categoria, ambito, monto")
        .eq("tipo", "gasto").gte("fecha", desdeHistorial).lte("fecha", hastaHistorial)
        .order("fecha").order("id").range(a, b)),
  ]);
  return {
    fijos: fijos.map((r) => numeros<GastoFijo>(r, ["monto"])).map((f) => ({ ...f, dias: (f.dias ?? []).map(Number) })),
    pagosFijos: pagosFijos.map((r) => numeros<PagoFijo>(r, ["monto"])),
    cortes: cortes.map((r) => ({
      ...numeros<CorteTarjeta>(r, ["saldo_total", "pago_minimo", "pago_estimado", "pagos_entre_cortes", "pagado_del_corte", "falta_de_lo_estimado"]),
      saldo_anterior: numONull(r.saldo_anterior),
      consumo: numONull(r.consumo),
    })),
    tarjetas: tarjetas.map((r) => ({
      ...numeros<Tarjeta>(r, ["dia_corte", "dia_pago", "pagado_despues_del_corte"]),
      saldo_ultimo_corte: numONull(r.saldo_ultimo_corte),
      saldo_estimado_hoy: numONull(r.saldo_estimado_hoy),
    })),
    pagosTarjeta: pagosTarjeta.map((r) => numeros<PagoTarjeta>(r, ["monto"])),
    estimados: estimados.map((r) => numeros<EstimadoGasto>(r, ["base"])),
    estimadosMes: estimadosMes.map((r) => numeros<EstimadoMes>(r, ["monto"])),
    temporadas: temporadas.map((r) => numeros<Temporada>(r, ["mes", "factor"])),
    historialGastos: gastosPorMes(gastos.map((r) => numeros<Movimiento>(r, ["monto"]))),
  };
}

/** Solo tarjetas y cortes: para el aviso "falta anotar el corte" de la página principal. */
export async function cargarTarjetasYCortes(
  supabase: SupabaseClient
): Promise<{ tarjetas: Tarjeta[]; cortes: Pick<CorteTarjeta, "tarjeta_id" | "fecha_corte">[] }> {
  const [tarjetas, cortes] = await todasOFalla([
    leerTodo<Record<string, unknown>>("las tarjetas", (a, b) =>
      supabase.from("tarjetas").select("id, nombre, banco, dia_corte, dia_pago, activa, notas").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("los cortes de tarjeta", (a, b) =>
      supabase.from("tarjeta_cortes").select("tarjeta_id, fecha_corte").order("id").range(a, b)),
  ]);
  return {
    tarjetas: tarjetas.map((r) => numeros<Tarjeta>(r, ["dia_corte", "dia_pago"])),
    cortes: cortes as unknown as Pick<CorteTarjeta, "tarjeta_id" | "fecha_corte">[],
  };
}

export interface DatosPlan {
  fijos: GastoFijo[];
  pagosFijos: PagoFijo[];
  estimados: EstimadoGasto[];
  estimadosMes: EstimadoMes[];
  temporadas: Temporada[];
  historialGastos: GastoMes[];
  tarjetas: Tarjeta[];
  cortes: CorteTarjeta[];
  pagosTarjeta: PagoTarjeta[];
  cuentas: CuentaDinero[];
  saldos: SaldoCaja[];
  /** movimientos desde la penúltima foto de caja (para el cuadre) */
  movimientosCuadre: Pick<Movimiento, "fecha" | "tipo" | "monto">[];
}

/**
 * Todo lo de las pantallas de planificación (Fijos y estimados, Tarjetas,
 * Caja). Si cualquier lectura falla, lanza ErrorCarga.
 */
export async function cargarPlan(supabase: SupabaseClient, hoy: string): Promise<DatosPlan> {
  const base = await cargarPlanBase(supabase, { desde: `${hoy.slice(0, 7)}-01`, hasta: finDeMes(hoy) });
  const [todosPagosTarjeta, cuentas, saldos] = await todasOFalla([
    leerTodo<Record<string, unknown>>("los pagos de tarjeta", (a, b) =>
      supabase.from("tarjeta_pagos").select("*").order("fecha").order("id").range(a, b)),
    leerTodo<Record<string, unknown>>("las cuentas de dinero", (a, b) =>
      supabase.from("cuentas_dinero").select("*").order("nombre").range(a, b)),
    leerTodo<Record<string, unknown>>("los saldos de caja", (a, b) =>
      supabase.from("saldos_caja").select("*").order("fecha").order("id").range(a, b)),
  ]);
  const saldosN = saldos.map((r) => numeros<SaldoCaja>(r, ["monto"]));
  // mismas fechas que mira cuadreCaja: solo las de cuentas activas
  const activas = new Set((cuentas as unknown as CuentaDinero[]).filter((c) => c.activa).map((c) => c.id));
  const fechas = [...new Set(saldosN.filter((x) => activas.has(x.cuenta_id)).map((x) => x.fecha))].sort();
  const desdeCuadre = fechas.length >= 2 ? fechas[fechas.length - 2] : null;
  const movs = desdeCuadre
    ? await leerTodo<Record<string, unknown>>("los movimientos para el cuadre", (a, b) =>
        supabase.from("movimientos").select("id, fecha, tipo, monto").gt("fecha", desdeCuadre).order("fecha").order("id").range(a, b))
    : [];
  return {
    ...base,
    pagosTarjeta: todosPagosTarjeta.map((r) => numeros<PagoTarjeta>(r, ["monto"])),
    cuentas: cuentas as unknown as CuentaDinero[],
    saldos: saldosN,
    movimientosCuadre: movs.map((r) => numeros<Movimiento>(r, ["monto"])),
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

// ------------------------------------------------------------
// Ingresos (fase 5A): facturas por cobrar, abonos, ventas directas y "Mi sueldo"
// ------------------------------------------------------------

/** Convierte a número las columnas numéricas (PostgREST puede mandarlas como texto). */
function numeros<T>(r: Record<string, unknown>, campos: string[]): T {
  const out: Record<string, unknown> = { ...r };
  for (const c of campos) out[c] = num(r[c]);
  return out as T;
}

/**
 * Todo lo de ingresos de una vez. Son pocas filas por mes y las tres pantallas
 * (Por cobrar, Ventas directas, Mi sueldo) usan las mismas: así no se
 * contradicen entre ellas. Si CUALQUIER consulta falla, lanza ErrorCarga.
 */
export async function cargarIngresos(supabase: SupabaseClient): Promise<DatosIngresos> {
  const tareas = [
    leerTodo<Record<string, unknown>>("las facturas por cobrar", (a, b) =>
      supabase.from("v_cxc").select("*").order("fecha_factura").order("id").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("lo que te debe cada cliente", (a, b) =>
      supabase.from("v_cxc_cuentas").select("*").order("cuenta").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("los abonos recibidos", (a, b) =>
      supabase.from("cobros").select("*").eq("anulado", false).order("fecha").order("id").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("las ventas directas", (a, b) =>
      supabase.from("ventas_directas").select("*").eq("anulada", false).order("fecha").order("id").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("las ganancias de tu sueldo", (a, b) =>
      supabase.from("v_sueldo_dueno_registros").select("*").order("fecha").order("fuente_id").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("los pagos de tu sueldo", (a, b) =>
      supabase.from("sueldo_dueno_pagos").select("*").eq("anulado", false).order("fecha").order("id").range(a, b)
    ),
    leerTodo<Record<string, unknown>>("el resumen de tu sueldo", (a, b) =>
      supabase.from("v_sueldo_dueno").select("*").range(a, b)
    ),
  ] as const;

  const res = await Promise.allSettled(tareas);
  const fallos = res.flatMap((r) =>
    r.status === "rejected" ? (r.reason instanceof ErrorCarga ? r.reason.fallos : [String(r.reason)]) : []
  );
  if (fallos.length) throw new ErrorCarga(fallos);

  const [facturas, cuentas, cobros, ventas, registros, pagos, sueldo] = res.map((r) =>
    r.status === "fulfilled" ? r.value : []
  );
  const s = sueldo[0] ?? {};
  return {
    facturas: facturas.map((r) =>
      numeros<FacturaCobrar>(r, ["monto", "prendas", "ganancia_por_prenda", "ganancia_dueno", "cobrado", "saldo", "dias_atraso"])
    ),
    cuentas: cuentas.map((r) =>
      numeros<CuentaCobrar>(r, ["total_facturado", "total_cobrado", "saldo", "facturas_abiertas", "dias_atraso_max", "prendas"])
    ),
    cobros: cobros.map((r) => numeros<Cobro>(r, ["monto"])),
    ventas: ventas.map((r) => numeros<VentaDirecta>(r, ["monto", "prendas", "ganancia_por_prenda"])),
    registrosSueldo: registros.map((r) =>
      numeros<RegistroSueldo>(r, ["prendas", "ganancia_por_prenda", "monto", "pagado", "saldo"])
    ),
    pagosSueldo: pagos.map((r) => numeros<PagoSueldo>(r, ["monto"])),
    sueldo: { ganado: num(s.ganado), pagado: num(s.pagado), saldo: num(s.saldo) },
  };
}
