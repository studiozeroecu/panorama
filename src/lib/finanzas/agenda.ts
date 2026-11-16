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
 *  - (fase 6) los GASTOS FIJOS de cada mes y lo que se piensa pagar de cada
 *    TARJETA entran como pagos más (suman, con sus vencidos y "atento").
 *  - (fase 6) estimados del mes (maquila, DTF…): aparte, NO suman a lo seguro.
 *    Lo pendiente de un estimado = estimado − lo ya gastado − lo ya programado
 *    de esa categoría en el mes (así nunca se cuenta dos veces).
 */
import { fmtFecha } from "@/lib/fechas";
import { money, sumar } from "./formato";
import { contiene, sumarDias, type Periodo } from "./periodos";
import { fechasDeFijo, gastosPorMes, valorEstimado, type FuenteEstimado } from "./plan";
import type { Ambito, Cheque, DatosFinanzas, Deuda, EstadoCheque, Exigibilidad, Medio } from "./tipos";

/** Días después del periodo que se muestran como "atento: se viene". */
export const DIAS_ATENTO = 3;

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
  /** de dónde sale: un cheque/cuota, un gasto fijo o el pago de una tarjeta */
  origen: "cheque" | "fijo" | "tarjeta";
  /** gasto fijo: cuál y qué fecha del calendario */
  fijoId?: string;
  fechaProgramada?: string;
  /** tarjeta: cuál y de qué corte */
  tarjetaId?: string;
  corteId?: string;
}

/** Un estimado del mes (maquila, DTF…) con lo gastado y lo que falta. */
export interface ItemEstimado {
  estimadoId: string;
  nombre: string;
  categoria: string;
  ambito: Ambito;
  /** "YYYY-MM" */
  mes: string;
  monto: number;
  fuente: FuenteEstimado;
  gastado: number;
  /** pagos ya programados de esa categoría en el mes (cheques, fijos) */
  programado: number;
  /** lo que todavía falta según el estimado (no suma a lo seguro) */
  pendiente: number;
  /** cuánto se pasó del estimado */
  pasado: number;
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

  /** estimados del mes del periodo; NO suman a los pagos seguros */
  estimados: ItemEstimado[];
  totalEstimadoPendiente: number;

  /** saldo de todas las deudas no anuladas + pagos sueltos abiertos + tarjetas */
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
    origen: "cheque",
  };
}

/**
 * Gastos fijos sin pagar y lo que falta de lo que se pensaba pagar de cada
 * tarjeta, con fecha hasta `hasta`. Se reparten después en el periodo, los
 * vencidos y el "atento".
 */
function pagosPlanificados(datos: DatosFinanzas, hasta: string, hoy: string): ItemPago[] {
  const pagadas = new Set((datos.pagosFijos ?? []).map((p) => `${p.gasto_fijo_id}|${p.fecha_programada}`));
  const fijos: ItemPago[] = (datos.fijos ?? [])
    .filter((f) => f.activo)
    .flatMap((f) =>
      fechasDeFijo(f, f.fecha_inicio, hasta)
        .filter((fecha) => !pagadas.has(`${f.id}|${fecha}`))
        .map((fecha): ItemPago => ({
          chequeId: `fijo:${f.id}:${fecha}`,
          deudaId: null,
          fecha,
          monto: f.monto,
          quien: f.nombre,
          concepto: f.frecuencia === "quincenal" ? "gasto fijo quincenal" : "gasto fijo mensual",
          medio: f.medio,
          numero: "",
          ambito: f.ambito,
          categoria: f.categoria,
          exigibilidad: "firme",
          reprogramado: false,
          fechaOriginal: null,
          estado: "pendiente",
          fechaPago: null,
          vencido: fecha < hoy,
          origen: "fijo",
          fijoId: f.id,
          fechaProgramada: fecha,
        }))
    );
  const tarjetas: ItemPago[] = (datos.cortes ?? [])
    .filter((c) => c.falta_de_lo_estimado > 0 && c.fecha_pago <= hasta)
    .map((c): ItemPago => ({
      chequeId: `tarjeta:${c.id}`,
      deudaId: null,
      fecha: c.fecha_pago,
      monto: c.falta_de_lo_estimado,
      quien: `Tarjeta ${c.tarjeta}`,
      concepto: `corte del ${fmtFecha(c.fecha_corte)} · mínimo ${money(c.pago_minimo)} · saldo ${money(c.saldo_total)}`,
      medio: "transferencia",
      numero: "",
      ambito: "empresa",
      categoria: "tarjeta",
      exigibilidad: "firme",
      reprogramado: false,
      fechaOriginal: null,
      estado: "pendiente",
      fechaPago: null,
      vencido: c.fecha_pago < hoy,
      origen: "tarjeta",
      tarjetaId: c.tarjeta_id,
      corteId: c.id,
    }));
  return [...fijos, ...tarjetas];
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
  const limiteAtento = sumarDias(periodo.hasta, DIAS_ATENTO);
  const conFecha = [
    ...pendientes.filter((c) => c.fecha_cobro != null).map((c) => aItem(c, hoy)),
    ...pagosPlanificados(datos, limiteAtento, hoy),
  ];

  const pagos = conFecha.filter((p) => contiene(periodo, p.fecha)).sort(porFecha);

  const vencidos = esActual ? conFecha.filter((p) => p.fecha! < periodo.desde).sort(porFecha) : [];

  const fijoPorId = new Map((datos.fijos ?? []).map((f) => [f.id, f]));
  const tarjetaPorId = new Map((datos.tarjetas ?? []).map((t) => [t.id, t]));
  const pagados = [
    ...datos.chequesPagados.filter((c) => contiene(periodo, c.fecha_pago)).map((c) => aItem(c, hoy)),
    ...(datos.pagosFijos ?? [])
      .filter((p) => contiene(periodo, p.fecha_pago))
      .map((p): ItemPago => {
        const f = fijoPorId.get(p.gasto_fijo_id);
        return {
          chequeId: `fijo-pago:${p.id}`, deudaId: null, fecha: p.fecha_programada, monto: p.monto,
          quien: f?.nombre ?? "Gasto fijo", concepto: "gasto fijo", medio: f?.medio ?? "transferencia", numero: "",
          ambito: f?.ambito ?? "empresa", categoria: f?.categoria ?? "otros", exigibilidad: "firme", reprogramado: false,
          fechaOriginal: null, estado: "pagado", fechaPago: p.fecha_pago, vencido: false, origen: "fijo",
          fijoId: p.gasto_fijo_id, fechaProgramada: p.fecha_programada,
        };
      }),
    ...(datos.pagosTarjeta ?? [])
      .filter((p) => contiene(periodo, p.fecha))
      .map((p): ItemPago => ({
        chequeId: `tarjeta-pago:${p.id}`, deudaId: null, fecha: p.fecha, monto: p.monto,
        quien: `Tarjeta ${tarjetaPorId.get(p.tarjeta_id)?.nombre ?? ""}`.trim(), concepto: "pago de tarjeta",
        medio: "transferencia", numero: "", ambito: "empresa", categoria: "tarjeta", exigibilidad: "firme",
        reprogramado: false, fechaOriginal: null, estado: "pagado", fechaPago: p.fecha, vencido: false,
        origen: "tarjeta", tarjetaId: p.tarjeta_id, corteId: p.corte_id ?? undefined,
      })),
  ].sort((a, b) => (a.fechaPago ?? "").localeCompare(b.fechaPago ?? "") || a.quien.localeCompare(b.quien));

  const proximos = conFecha.filter((p) => p.fecha! > periodo.hasta && p.fecha! <= limiteAtento).sort(porFecha);

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

  // estimados del mes del periodo (para la quincena, el de su mes)
  const mes = periodo.desde.slice(0, 7);
  const historial = datos.historialGastos ?? gastosPorMes(datos.movimientos);
  const pendientesDelMes = [
    ...pendientes.filter((c) => c.fecha_cobro?.startsWith(mes)).map((c) => aItem(c, hoy)),
    ...pagosPlanificados(datos, `${mes}-31`, hoy).filter((p) => p.fecha?.startsWith(mes)),
  ];
  const estimados: ItemEstimado[] = (datos.estimados ?? [])
    .filter((e) => e.activo)
    .map((e) => {
      const { monto, fuente } = valorEstimado(e, mes, datos.estimadosMes ?? [], historial, datos.temporadas ?? []);
      const gastado = sumar(
        historial.filter((h) => h.mes === mes && h.categoria === e.categoria && h.ambito === e.ambito).map((h) => h.total)
      );
      const programado = sumar(
        pendientesDelMes.filter((p) => p.categoria === e.categoria && p.ambito === e.ambito).map((p) => p.monto)
      );
      return {
        estimadoId: e.id, nombre: e.nombre, categoria: e.categoria, ambito: e.ambito, mes, monto, fuente,
        gastado, programado,
        pendiente: Math.max(0, sumar([monto, -gastado, -programado])),
        pasado: Math.max(0, sumar([gastado, -monto])),
      };
    });
  const deudaTarjetas = (datos.tarjetas ?? []).map((t) => Math.max(0, t.saldo_estimado_hoy ?? 0));

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
    estimados,
    totalEstimadoPendiente: sumar(estimados.map((e) => e.pendiente)),
    totalAdeudado: sumar([...deudasVivas.map((d) => d.saldo), ...sueltosAbiertos.map((c) => c.monto), ...deudaTarjetas]),
  };
}
