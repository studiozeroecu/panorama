/**
 * Qué avisa la alerta diaria (cron /api/cron/urgencias). Pura: sin base.
 *  - pagos pendientes que vencen en menos de `dias` días (o ya vencieron);
 *  - cheques rebotados (sección roja, hasta que se resuelvan).
 * Solo lo que no está "silenciado" (alertado_hasta vacío o ya pasado).
 * Los pagos de deudas anuladas no se avisan.
 */
import { sumarDias } from "./periodos";
import type { Cheque, DatosFinanzas } from "./tipos";

export interface Urgencias {
  pagos: Cheque[];
  rebotados: Cheque[];
}

export function seleccionarUrgencias(
  datos: Pick<DatosFinanzas, "deudas" | "chequesAbiertos">,
  hoy: string,
  dias = 3
): Urgencias {
  const limite = sumarDias(hoy, dias);
  const anuladas = new Set(datos.deudas.filter((d) => d.anulada).map((d) => d.id));
  const vivos = datos.chequesAbiertos.filter(
    (c) =>
      c.tipo === "por_pagar" &&
      !(c.cuenta_por_pagar_id && anuladas.has(c.cuenta_por_pagar_id)) &&
      (c.alertado_hasta == null || c.alertado_hasta < hoy)
  );
  const porFecha = (a: Cheque, b: Cheque) => (a.fecha_cobro ?? "9999").localeCompare(b.fecha_cobro ?? "9999");
  return {
    pagos: vivos
      .filter((c) => c.estado === "pendiente" && c.fecha_cobro != null && c.fecha_cobro < limite)
      .sort(porFecha),
    rebotados: vivos.filter((c) => c.estado === "rebotado").sort(porFecha),
  };
}

export function etiquetaUrgencia(fecha: string | null, hoy: string): string {
  if (!fecha) return "🟠 sin fecha";
  if (fecha < hoy) return "🔴 VENCIDO";
  if (fecha === hoy) return "🔴 vence HOY";
  return "🟠 vence pronto";
}
