/**
 * "¿Qué hay que pagar?" — UNA sola función para la web (y en la fase 1C para el
 * bot, la alerta diaria y el resumen del lunes). Es pura: recibe los datos ya
 * cargados y no toca la base, así se puede probar sin conexión.
 *
 * Reglas (ver CLAUDE.md):
 *  - pagos: pagos programados PENDIENTES con fecha dentro del periodo. Suman.
 *  - vencidos: pendientes de periodos anteriores. Solo en el periodo que
 *    contiene hoy. Suman aparte.
 *  - posibles: deudas flexibles con fecha estimada en el periodo → línea gris,
 *    NO suman.
 *  - sinFecha: lo que se debe sin fecha (saldo sin programar de deudas, y pagos
 *    sin fecha). Suman al total adeudado, NUNCA al periodo.
 *  - rebotados: sección roja aparte, siempre visible hasta resolverse. NO suman
 *    al periodo.
 *  - proximos: pagos de los 3 días SIGUIENTES al periodo ("atento: se viene").
 *    El dueño pide a VATEX con unos 3 días de anticipación, así que un pago
 *    del 16 tiene que verlo ya en la quincena del 1 al 15. NO suman (se
 *    sumarán en su propio periodo).
 *  - gastos: por defecto solo ámbito empresa; personal solo si se pide.
 */
import { sumar } from "./formato";
import { contiene, sumarDias, type Periodo } from "./periodos";

/** Días después del periodo que se muestran como "atento: se viene". */
export const DIAS_ATENTO = 3;
import type { Ambito, Cheque, DatosFinanzas, Deuda, EstadoCheque, Exigibilidad, Medio } from "./tipos";

export interface ItemPago {
  chequeId: string;
  deudaId: string | null;
  fecha: string | null;
  monto: number;
  quien: string;
  concepto: string;
  medio: Medio;
  numero: string;
  ambito: Ambito;
  categoria: string;
  exigibilidad: Exigibilidad | null;
  reprogramado: boolean;
  fechaOriginal: string | null;
  estado: EstadoCheque;
  fechaPago: string | null;
  /** pendiente con fecha anterior a hoy */
  vencido: boolean;
}

export interface ItemPosible {
  deudaId: string;
  quien: string;
  concepto: string;
  fechaEstimada: string;
  monto: number;
  ambito: Ambito;
  /** la fecha estimada ya pasó (solo aparece en el periodo actual) */
  pasada: boolean;
}

export interface ItemSinFecha {
  deudaId: string | null;
  chequeId: string | null;
  quien: string;
  concepto: string;
  monto: number;
  ambito: Ambito;
  motivo: "deuda_sin_programar" | "pago_sin_fecha";
  exigibilidad: Exigibilidad | null;
}

export interface Agenda {
  periodo: Periodo;
  hoy: string;
  esActual: boolean;

  pagos: ItemPago[];
  totalPagos: number;
  totalPagosEmpresa: number;
  totalPagosPersonal: number;

  vencidos: ItemPago[];
  totalVencidos: number;

  pagados: ItemPago[];
  totalPagados: number;

  posibles: ItemPosible[];

  sinFecha: ItemSinFecha[];
  totalSinFecha: number;

  rebotados: ItemPago[];
  totalRebotados: number;

  /** pendientes de los DIAS_ATENTO días siguientes al periodo; NO suman */
  proximos: ItemPago[];
  totalProximos: number;

  gastos: {
    ambito: "empresa" | "todos";
    cantidad: number;
    total: number;
    totalRentabilidad: number;
    porCategoria: { categoria: string; total: number }[];
  };

  /** saldo de todas las deudas no anuladas + pagos sueltos abiertos */
  totalAdeudado: number;
}

function aItem(c: Cheque, hoy: string): ItemPago {
  return {
    chequeId: c.id,
    deudaId: c.cuenta_por_pagar_id,
    fecha: c.fecha_cobro,
    monto: c.monto,
    quien: c.deuda_proveedor || c.beneficiario || "—",
    concepto: c.deuda_concepto ?? c.notas ?? "",
    medio: c.medio,
    numero: c.numero ?? "",
    ambito: c.ambito_efectivo,
    categoria: c.categoria_efectiva,
    exigibilidad: c.deuda_exigibilidad,
    reprogramado: c.reprogramado,
    fechaOriginal: c.fecha_original,
    estado: c.estado,
    fechaPago: c.fecha_pago,
    vencido: c.estado === "pendiente" && c.fecha_cobro != null && c.fecha_cobro < hoy,
  };
}

const porFecha = (a: { fecha: string | null; quien: string }, b: { fecha: string | null; quien: string }) =>
  (a.fecha ?? "9999-99-99").localeCompare(b.fecha ?? "9999-99-99") || a.quien.localeCompare(b.quien);

export function armarAgenda(
  datos: DatosFinanzas,
  periodo: Periodo,
  opciones: { hoy: string; incluirPersonalEnGastos?: boolean }
): Agenda {
  const { hoy } = opciones;
  const esActual = contiene(periodo, hoy);

  const deudaPorId = new Map<string, Deuda>(datos.deudas.map((d) => [d.id, d]));
  const deudasVivas = datos.deudas.filter((d) => !d.anulada);
  // pagos de deudas anuladas no cuentan (deberían estar anulados también)
  const abiertos = datos.chequesAbiertos.filter((c) => {
    const d = c.cuenta_por_pagar_id ? deudaPorId.get(c.cuenta_por_pagar_id) : undefined;
    return !d?.anulada;
  });

  const pendientes = abiertos.filter((c) => c.estado === "pendiente");

  const pagos = pendientes
    .filter((c) => contiene(periodo, c.fecha_cobro))
    .map((c) => aItem(c, hoy))
    .sort(porFecha);

  const vencidos = esActual
    ? pendientes
        .filter((c) => c.fecha_cobro != null && c.fecha_cobro < periodo.desde)
        .map((c) => aItem(c, hoy))
        .sort(porFecha)
    : [];

  const pagados = datos.chequesPagados
    .filter((c) => contiene(periodo, c.fecha_pago))
    .map((c) => aItem(c, hoy))
    .sort((a, b) => (a.fechaPago ?? "").localeCompare(b.fechaPago ?? "") || a.quien.localeCompare(b.quien));

  const limiteAtento = sumarDias(periodo.hasta, DIAS_ATENTO);
  const proximos = pendientes
    .filter((c) => c.fecha_cobro != null && c.fecha_cobro > periodo.hasta && c.fecha_cobro <= limiteAtento)
    .map((c) => aItem(c, hoy))
    .sort(porFecha);

  const rebotados = abiertos
    .filter((c) => c.estado === "rebotado")
    .map((c) => aItem(c, hoy))
    .sort(porFecha);

  const posibles: ItemPosible[] = deudasVivas
    .filter(
      (d) =>
        d.exigibilidad === "flexible" &&
        d.fecha_estimada != null &&
        d.sin_programar > 0 &&
        (contiene(periodo, d.fecha_estimada) || (esActual && d.fecha_estimada < periodo.desde))
    )
    .map((d) => ({
      deudaId: d.id,
      quien: d.proveedor,
      concepto: d.concepto,
      fechaEstimada: d.fecha_estimada!,
      monto: d.sin_programar,
      ambito: d.ambito,
      pasada: d.fecha_estimada! < periodo.desde,
    }))
    .sort((a, b) => a.fechaEstimada.localeCompare(b.fechaEstimada));

  const sinFecha: ItemSinFecha[] = [
    ...deudasVivas
      .filter((d) => d.sin_programar > 0 && d.fecha_estimada == null)
      .map((d) => ({
        deudaId: d.id,
        chequeId: null,
        quien: d.proveedor,
        concepto: d.concepto,
        monto: d.sin_programar,
        ambito: d.ambito,
        motivo: "deuda_sin_programar" as const,
        exigibilidad: d.exigibilidad,
      })),
    ...pendientes
      .filter((c) => c.fecha_cobro == null)
      .map((c) => ({
        deudaId: c.cuenta_por_pagar_id,
        chequeId: c.id,
        quien: c.deuda_proveedor || c.beneficiario || "—",
        concepto: c.deuda_concepto ?? c.notas ?? "",
        monto: c.monto,
        ambito: c.ambito_efectivo,
        motivo: "pago_sin_fecha" as const,
        exigibilidad: c.deuda_exigibilidad,
      })),
  ].sort((a, b) => b.monto - a.monto);

  // gastos registrados (movimientos) del periodo, filtrados por ámbito
  const incluirPersonal = opciones.incluirPersonalEnGastos === true;
  const gastosPeriodo = datos.movimientos.filter(
    (m) => m.tipo === "gasto" && contiene(periodo, m.fecha) && (incluirPersonal || m.ambito === "empresa")
  );
  const porCat = new Map<string, number[]>();
  for (const g of gastosPeriodo) porCat.set(g.categoria, [...(porCat.get(g.categoria) ?? []), g.monto]);

  const sueltosAbiertos = abiertos.filter((c) => c.cuenta_por_pagar_id == null);

  return {
    periodo,
    hoy,
    esActual,
    pagos,
    totalPagos: sumar(pagos.map((p) => p.monto)),
    totalPagosEmpresa: sumar(pagos.filter((p) => p.ambito === "empresa").map((p) => p.monto)),
    totalPagosPersonal: sumar(pagos.filter((p) => p.ambito === "personal").map((p) => p.monto)),
    vencidos,
    totalVencidos: sumar(vencidos.map((p) => p.monto)),
    pagados,
    totalPagados: sumar(pagados.map((p) => p.monto)),
    posibles,
    sinFecha,
    totalSinFecha: sumar(sinFecha.map((s) => s.monto)),
    rebotados,
    totalRebotados: sumar(rebotados.map((p) => p.monto)),
    proximos,
    totalProximos: sumar(proximos.map((p) => p.monto)),
    gastos: {
      ambito: incluirPersonal ? "todos" : "empresa",
      cantidad: gastosPeriodo.length,
      total: sumar(gastosPeriodo.map((g) => g.monto)),
      totalRentabilidad: sumar(gastosPeriodo.filter((g) => g.cuenta_en_rentabilidad).map((g) => g.monto)),
      porCategoria: [...porCat.entries()]
        .map(([categoria, montos]) => ({ categoria, total: sumar(montos) }))
        .sort((a, b) => b.total - a.total),
    },
    totalAdeudado: sumar([...deudasVivas.map((d) => d.saldo), ...sueltosAbiertos.map((c) => c.monto)]),
  };
}
