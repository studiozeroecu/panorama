/**
 * Planificación (fase 6): gastos fijos, estimados del mes, cortes de tarjeta y
 * cuadre de caja. Puro: recibe lo cargado y no toca la base.
 *
 * Nada de esto se guarda en la base: las fechas de cada mes de un gasto fijo,
 * la sugerencia de un estimado, el corte que falta llenar y el descuadre de
 * caja se CALCULAN cada vez (regla del proyecto: no guardar derivados).
 */
import { aCentavos, sumar } from "./formato";
import { ultimoDiaDelMes } from "./periodos";
import type {
  CorteTarjeta,
  CuentaDinero,
  EstimadoGasto,
  EstimadoMes,
  GastoFijo,
  GastoMes,
  Movimiento,
  SaldoCaja,
  Tarjeta,
  Temporada,
} from "./tipos";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const partes = (f: string) => f.slice(0, 10).split("-").map(Number) as [number, number, number];

/** El día pedido en ese mes, o el último si el mes es más corto (31 en febrero → 28). */
export function diaDelMes(anio: number, mes: number, dia: number): string {
  return iso(anio, mes, Math.min(dia, ultimoDiaDelMes(anio, mes)));
}

function siguienteMes(anio: number, mes: number): [number, number] {
  return mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
}

// ------------------------------------------------------------
// Gastos fijos
// ------------------------------------------------------------

/** Las fechas de un gasto fijo entre `desde` y `hasta` (dentro de su inicio y fin). */
export function fechasDeFijo(
  f: Pick<GastoFijo, "dias" | "fecha_inicio" | "fecha_fin">,
  desde: string,
  hasta: string
): string[] {
  const ini = f.fecha_inicio > desde ? f.fecha_inicio : desde;
  const fin = f.fecha_fin && f.fecha_fin < hasta ? f.fecha_fin : hasta;
  if (ini > fin) return [];
  const out = new Set<string>();
  let [y, m] = partes(ini);
  const [yf, mf] = partes(fin);
  while (y < yf || (y === yf && m <= mf)) {
    for (const d of f.dias) {
      const fecha = diaDelMes(y, m, d);
      if (fecha >= ini && fecha <= fin) out.add(fecha);
    }
    [y, m] = siguienteMes(y, m);
  }
  return [...out].sort();
}

/**
 * Fechas para cuotas de un préstamo: mensual (el mismo día cada mes) o
 * quincenal (el 15 y el último día de cada mes), empezando en `primera`.
 */
export function fechasPeriodicas(primera: string, n: number, frecuencia: "mensual" | "quincenal"): string[] {
  const out: string[] = [];
  let [y, m, d] = partes(primera);
  if (frecuencia === "mensual") {
    for (let i = 0; i < n; i++) {
      out.push(diaDelMes(y, m, d));
      [y, m] = siguienteMes(y, m);
    }
    return out;
  }
  // quincenal: 15 y fin de mes; la primera es la que toca desde `primera`
  let mitad = d <= 15 ? 15 : 31;
  while (out.length < n) {
    out.push(diaDelMes(y, m, mitad));
    if (mitad === 15) mitad = 31;
    else {
      mitad = 15;
      [y, m] = siguienteMes(y, m);
    }
  }
  return out;
}

// ------------------------------------------------------------
// Estimados del mes
// ------------------------------------------------------------

export type FuenteEstimado = "a_mano" | "mismo_mes_anio_pasado" | "promedio" | "base";

const mesAnterior = (mes: string, k: number) => {
  let [y, m] = partes(`${mes}-01`);
  for (let i = 0; i < k; i++) [y, m] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${y}-${pad(m)}`;
};

/**
 * Cuánto se espera gastar en un mes ("YYYY-MM") para un estimado:
 *  1. si se fijó a mano para ese mes, eso;
 *  2. si hay gasto real del MISMO mes del año pasado, eso (ya trae la temporada);
 *  3. si hay gasto real en alguno de los 3 meses anteriores: su promedio
 *     "sin temporada" × la temporada del mes (detecta si los costos suben);
 *  4. si no hay historia: la base × la temporada del mes.
 */
export function valorEstimado(
  est: Pick<EstimadoGasto, "id" | "categoria" | "base" | "ambito">,
  mes: string,
  estimadosMes: EstimadoMes[],
  historial: GastoMes[],
  temporadas: Temporada[]
): { monto: number; fuente: FuenteEstimado } {
  const aMano = estimadosMes.find((e) => e.estimado_id === est.id && e.mes.slice(0, 7) === mes);
  if (aMano) return { monto: aMano.monto, fuente: "a_mano" };

  const factor = (m: string) => temporadas.find((t) => t.mes === Number(m.slice(5, 7)))?.factor ?? 1;
  const gastoDe = (m: string) =>
    sumar(historial.filter((h) => h.mes === m && h.categoria === est.categoria && h.ambito === est.ambito).map((h) => h.total));

  const anioPasado = gastoDe(mesAnterior(mes, 12));
  if (anioPasado > 0) return { monto: Math.round(anioPasado), fuente: "mismo_mes_anio_pasado" };

  const previos = [1, 2, 3].map((k) => mesAnterior(mes, k)).filter((m) => gastoDe(m) > 0);
  if (previos.length) {
    const sinTemporada = previos.reduce((s, m) => s + gastoDe(m) / factor(m), 0) / previos.length;
    return { monto: Math.round(sinTemporada * factor(mes)), fuente: "promedio" };
  }
  return { monto: Math.round(est.base * factor(mes)), fuente: "base" };
}

/** Gasto real por mes y categoría a partir de los movimientos (solo gastos). */
export function gastosPorMes(movs: Pick<Movimiento, "fecha" | "tipo" | "categoria" | "ambito" | "monto">[]): GastoMes[] {
  const m = new Map<string, GastoMes>();
  for (const x of movs) {
    if (x.tipo !== "gasto") continue;
    const k = `${x.fecha.slice(0, 7)}|${x.categoria}|${x.ambito}`;
    const g = m.get(k) ?? { mes: x.fecha.slice(0, 7), categoria: x.categoria, ambito: x.ambito, total: 0 };
    g.total = sumar([g.total, x.monto]);
    m.set(k, g);
  }
  return [...m.values()];
}

// ------------------------------------------------------------
// Tarjetas de crédito
// ------------------------------------------------------------

/**
 * Si una tarjeta ya cortó y falta anotar ese corte, devuelve la fecha del
 * corte y la de pago (el siguiente día de pago después del corte).
 */
export function cortePendiente(
  t: Pick<Tarjeta, "id" | "dia_corte" | "dia_pago" | "activa">,
  cortes: Pick<CorteTarjeta, "tarjeta_id" | "fecha_corte">[],
  hoy: string
): { fechaCorte: string; fechaPago: string } | null {
  if (!t.activa) return null;
  const [y, m] = partes(hoy);
  let fechaCorte = diaDelMes(y, m, t.dia_corte);
  if (fechaCorte > hoy) {
    const [ya, ma] = m === 1 ? [y - 1, 12] : [y, m - 1];
    fechaCorte = diaDelMes(ya, ma, t.dia_corte);
  }
  if (cortes.some((c) => c.tarjeta_id === t.id && c.fecha_corte === fechaCorte)) return null;
  return { fechaCorte, fechaPago: fechaPagoDeCorte(fechaCorte, t.dia_pago) };
}

/** El primer día de pago después del corte (mismo mes si cabe, si no el siguiente). */
export function fechaPagoDeCorte(fechaCorte: string, diaPago: number): string {
  const [y, m] = partes(fechaCorte);
  const mismoMes = diaDelMes(y, m, diaPago);
  if (mismoMes > fechaCorte) return mismoMes;
  const [ys, ms] = siguienteMes(y, m);
  return diaDelMes(ys, ms, diaPago);
}

// ------------------------------------------------------------
// Cuadre de caja
// ------------------------------------------------------------

export interface Cuadre {
  /** fecha de la foto anterior y de la última */
  desde: string;
  hasta: string;
  /** lo que había en la foto anterior (todas las cuentas) */
  anterior: number;
  entradas: number;
  salidas: number;
  /** lo que DEBERÍA haber según lo registrado */
  esperado: number;
  /** lo que anotaste en la última foto */
  real: number;
  /** real − esperado: negativo = falta plata (gastos sin anotar); positivo = sobra */
  diferencia: number;
}

/** Total de todas las cuentas activas en una fecha (la última foto de cada una hasta ese día). */
export function totalCaja(cuentas: CuentaDinero[], saldos: SaldoCaja[], fecha: string): number {
  const activas = new Set(cuentas.filter((c) => c.activa).map((c) => c.id));
  const ultimo = new Map<string, SaldoCaja>();
  for (const s of saldos) {
    if (!activas.has(s.cuenta_id) || s.fecha > fecha) continue;
    const ya = ultimo.get(s.cuenta_id);
    if (!ya || s.fecha > ya.fecha) ultimo.set(s.cuenta_id, s);
  }
  return sumar([...ultimo.values()].map((s) => s.monto));
}

/**
 * Compara las dos últimas fechas en que se anotaron saldos: lo que había +
 * lo que entró − lo que salió (todo lo registrado, empresa y personal, porque
 * sale de las mismas cuentas) contra lo que realmente hay.
 */
export function cuadreCaja(
  cuentas: CuentaDinero[],
  saldos: SaldoCaja[],
  movimientos: Pick<Movimiento, "fecha" | "tipo" | "monto">[]
): Cuadre | null {
  const activas = new Set(cuentas.filter((c) => c.activa).map((c) => c.id));
  const fechas = [...new Set(saldos.filter((s) => activas.has(s.cuenta_id)).map((s) => s.fecha))].sort();
  if (fechas.length < 2) return null;
  const hasta = fechas[fechas.length - 1];
  const desde = fechas[fechas.length - 2];
  const entre = movimientos.filter((x) => x.fecha > desde && x.fecha <= hasta);
  const entradas = sumar(entre.filter((x) => x.tipo === "ingreso").map((x) => x.monto));
  const salidas = sumar(entre.filter((x) => x.tipo === "gasto").map((x) => x.monto));
  const anterior = totalCaja(cuentas, saldos, desde);
  const esperado = (aCentavos(anterior) + aCentavos(entradas) - aCentavos(salidas)) / 100;
  const real = totalCaja(cuentas, saldos, hasta);
  return { desde, hasta, anterior, entradas, salidas, esperado, real, diferencia: (aCentavos(real) - aCentavos(esperado)) / 100 };
}
