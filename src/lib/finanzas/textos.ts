/**
 * Textos de la agenda para el bot (texto plano, lo lee Claude) y para los
 * mensajes de Telegram (HTML). Una sola forma de contar lo que hay que pagar.
 */
import { fmtFecha } from "@/lib/fechas";
import type { Agenda, ItemPago } from "./agenda";
import { money } from "./formato";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function lineaPago(p: ItemPago): string {
  return [
    fmtFecha(p.fecha),
    `${p.quien}${p.concepto ? ` (${p.concepto})` : ""}`,
    `${p.medio}${p.numero ? ` #${p.numero}` : ""}`,
    money(p.monto),
    p.ambito === "personal" ? "personal" : "",
    p.vencido ? "VENCIDO" : "",
    p.reprogramado ? `reprogramado, antes ${fmtFecha(p.fechaOriginal)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function lista(items: ItemPago[], max: number): string {
  const extra = items.length - max;
  return items
    .slice(0, max)
    .map((p) => `- ${lineaPago(p)}`)
    .concat(extra > 0 ? [`- … y ${extra} más`] : [])
    .join("\n");
}

/** Texto plano para el bot: qué hay que pagar en el periodo y lo que va aparte. */
export function textoAgenda(a: Agenda, max = 15): string {
  const partes: string[] = [];
  partes.push(`Periodo: ${a.periodo.etiqueta} (hoy ${fmtFecha(a.hoy)}).`);

  partes.push(
    `A PAGAR en el periodo: ${money(a.totalPagos)} en ${a.pagos.length} pago${a.pagos.length !== 1 ? "s" : ""}` +
      (a.totalPagosPersonal > 0
        ? ` (empresa ${money(a.totalPagosEmpresa)}, personal ${money(a.totalPagosPersonal)})`
        : "") +
      (a.pagos.length ? `:\n${lista(a.pagos, max)}` : ".")
  );

  if (a.proximos.length) {
    partes.push(
      `ATENTO, se viene justo después del periodo (no se suma arriba; avisar para pedir el dinero a tiempo): ` +
        `${money(a.totalProximos)}:\n${lista(a.proximos, max)}`
    );
  }
  if (a.vencidos.length) {
    partes.push(`VENCIDOS de antes, sin pagar: ${money(a.totalVencidos)}:\n${lista(a.vencidos, max)}`);
  }
  if (a.rebotados.length) {
    partes.push(
      `CHEQUES REBOTADOS (no se suman a lo de arriba; hay que resolverlos): ${money(a.totalRebotados)}:\n${lista(a.rebotados, max)}`
    );
  }
  if (a.posibles.length) {
    partes.push(
      `Posibles (deudas flexibles con fecha estimada; NO se suman):\n` +
        a.posibles
          .map((x) => `- ${fmtFecha(x.fechaEstimada)} · ${x.quien} · ${money(x.monto)}${x.pasada ? " · la fecha ya pasó" : ""}`)
          .join("\n")
    );
  }
  if (a.sinFecha.length) {
    partes.push(
      `Deudas sin fecha (no se suman al periodo): ${money(a.totalSinFecha)}:\n` +
        a.sinFecha
          .slice(0, 5)
          .map((s) => `- ${s.quien}${s.concepto ? ` (${s.concepto})` : ""} · ${money(s.monto)}${s.ambito === "personal" ? " · personal" : ""}`)
          .join("\n") +
        (a.sinFecha.length > 5 ? `\n- … y ${a.sinFecha.length - 5} más` : "")
    );
  }
  partes.push(`Total que se debe hoy (todas las deudas, empresa y personal): ${money(a.totalAdeudado)}.`);
  return partes.join("\n\n");
}

/** Bloque HTML corto para mensajes de Telegram (resumen del lunes). */
export function htmlAgenda(a: Agenda, titulo: string, max = 8): string {
  const filas = (items: ItemPago[]) =>
    items
      .slice(0, max)
      .map((p) => esc(lineaPago(p)))
      .concat(items.length > max ? [`… y ${items.length - max} más`] : [])
      .join("\n");

  const partes = [
    `📤 <b>${esc(titulo)}</b> — ${money(a.totalPagos)} en ${a.pagos.length} pago${a.pagos.length !== 1 ? "s" : ""}` +
      (a.pagos.length ? `\n${filas(a.pagos)}` : ""),
  ];
  if (a.vencidos.length) partes.push(`🔴 <b>Vencidos sin pagar</b> — ${money(a.totalVencidos)}\n${filas(a.vencidos)}`);
  if (a.rebotados.length) partes.push(`⛔ <b>Cheques rebotados</b> (sin resolver) — ${money(a.totalRebotados)}\n${filas(a.rebotados)}`);
  if (a.posibles.length) {
    partes.push(
      `⚪ Posibles (no se suman): ` +
        a.posibles.map((x) => `${esc(x.quien)} ${money(x.monto)} ~${fmtFecha(x.fechaEstimada)}`).join(" · ")
    );
  }
  if (a.totalSinFecha > 0) partes.push(`🗂 Deudas sin fecha: ${money(a.totalSinFecha)} (no se suman a la quincena)`);
  return partes.join("\n\n");
}
