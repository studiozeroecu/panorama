/**
 * Sueldo PERSONAL que VATEX le paga al dueño (no es de Bear & Trend: no toca
 * caja, gastos ni rentabilidad). Puro: recibe lo cargado y calcula.
 *
 * Lo que se debe no se guarda en la base (regla: no guardar derivados):
 *  - cada mes cuyo día de pago ya llegó suma el sueldo vigente ese mes
 *    (la última tarifa con `desde` ≤ ese mes; monto 0 = ya no hay sueldo);
 *  - los pagos recibidos se aplican al mes más antiguo primero.
 */
import { aCentavos } from "./formato";
import { diaDelMes } from "./plan";

export interface TarifaSueldoVatex {
  id: string;
  /** primer día del mes desde el que vale ("YYYY-MM-01") */
  desde: string;
  monto: number;
  dia_pago: number;
  notas: string;
}

export interface PagoSueldoVatex {
  id: string;
  fecha: string;
  monto: number;
  notas: string;
}

export interface MesSueldoVatex {
  /** "YYYY-MM" */
  mes: string;
  /** día en que VATEX debía pagarlo */
  fechaPago: string;
  sueldo: number;
  pagado: number;
  falta: number;
}

export interface ResumenSueldoVatex {
  meses: MesSueldoVatex[];
  totalSueldo: number;
  totalPagado: number;
  /** lo que VATEX debe hoy (nunca negativo) */
  teDebe: number;
  /** pagado de más (adelantos): se descuenta de los meses que vienen */
  aFavor: number;
  /** el mes que viene a pagarse, si hay sueldo vigente */
  proximo: { mes: string; fechaPago: string; monto: number } | null;
}

const c = aCentavos;
const d = (x: number) => x / 100;

function siguienteMes(mes: string): string {
  let [y, m] = mes.split("-").map(Number);
  [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return `${y}-${String(m).padStart(2, "0")}`;
}

function tarifaDe(tarifas: TarifaSueldoVatex[], mes: string): TarifaSueldoVatex | null {
  const vigentes = tarifas.filter((t) => t.desde.slice(0, 7) <= mes).sort((a, b) => (a.desde < b.desde ? 1 : -1));
  return vigentes[0] ?? null;
}

export function resumenSueldoVatex(
  tarifas: TarifaSueldoVatex[],
  pagos: PagoSueldoVatex[],
  hoy: string
): ResumenSueldoVatex {
  const meses: MesSueldoVatex[] = [];
  let proximo: ResumenSueldoVatex["proximo"] = null;
  if (tarifas.length) {
    let mes = tarifas.map((t) => t.desde.slice(0, 7)).sort()[0];
    // hasta el mes de hoy; el de hoy solo cuenta si ya llegó su día de pago
    while (mes <= hoy.slice(0, 7)) {
      const t = tarifaDe(tarifas, mes);
      if (t && t.monto > 0) {
        const [y, m] = mes.split("-").map(Number);
        const fechaPago = diaDelMes(y, m, t.dia_pago);
        if (fechaPago <= hoy) meses.push({ mes, fechaPago, sueldo: t.monto, pagado: 0, falta: t.monto });
        else proximo = { mes, fechaPago, monto: t.monto };
      }
      mes = siguienteMes(mes);
    }
    if (!proximo) {
      const t = tarifaDe(tarifas, mes);
      if (t && t.monto > 0) {
        const [y, m] = mes.split("-").map(Number);
        proximo = { mes, fechaPago: diaDelMes(y, m, t.dia_pago), monto: t.monto };
      }
    }
  }

  // pagos al mes más antiguo primero (en centavos para no perder nada)
  let disponible = pagos.reduce((s, p) => s + c(p.monto), 0);
  for (const x of meses) {
    const aplica = Math.min(disponible, c(x.sueldo));
    x.pagado = d(aplica);
    x.falta = d(c(x.sueldo) - aplica);
    disponible -= aplica;
  }
  const totalSueldo = d(meses.reduce((s, x) => s + c(x.sueldo), 0));
  const totalPagado = d(pagos.reduce((s, p) => s + c(p.monto), 0));
  return {
    meses,
    totalSueldo,
    totalPagado,
    teDebe: d(meses.reduce((s, x) => s + c(x.falta), 0)),
    aFavor: d(disponible),
    proximo,
  };
}
