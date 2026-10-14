import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMessage } from "@/lib/telegram";
import { hoyEcuador, fmtFecha } from "@/lib/fechas";
import { cargarFinanzas, ErrorCarga } from "@/lib/finanzas/cargar";
import { armarAgenda } from "@/lib/finanzas/agenda";
import { seleccionarUrgencias, etiquetaUrgencia } from "@/lib/finanzas/alertas";
import { quincenaDe, sumarDias } from "@/lib/finanzas/periodos";
import { money, sumar } from "@/lib/finanzas/formato";
import { esc } from "@/lib/finanzas/textos";
import type { Cheque } from "@/lib/finanzas/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Días de silencio para un ítem ya avisado (se vuelve a avisar pasado ese plazo). */
const DIAS_SILENCIO = 7;
/** Avisa lo que vence en menos de estos días (o ya venció). */
const DIAS_AVISO = 3;

/**
 * Alerta diaria de pagos (Finanzas v2).
 *
 * - Lee los pagos programados (tabla cheques: cheques, cuotas y transferencias)
 *   con la misma carga y reglas que la web (src/lib/finanzas).
 * - Avisa SOLO de lo que no se ha avisado (alertado_hasta). Si no hay nada
 *   nuevo, el bot NO escribe.
 * - Primero "toma" los ítems marcándolos como avisados (solo los que siguen
 *   sin avisar → si el cron corre dos veces, el segundo no repite) y COMPRUEBA
 *   que se guardó. Si el envío a Telegram falla, deshace esa marca para que
 *   mañana se vuelva a intentar.
 * - Si falla cualquier carga, no envía nada (mejor callar que dar totales falsos).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!chatId) return NextResponse.json({ ok: false, error: "sin chat id" });

  const supabase = createServiceClient();
  const hoy = hoyEcuador();
  const silencioHasta = sumarDias(hoy, DIAS_SILENCIO);
  const quincena = quincenaDe(hoy);

  let datos;
  try {
    datos = await cargarFinanzas(supabase, quincena);
  } catch (e) {
    const msg = e instanceof ErrorCarga ? e.message : String(e);
    return NextResponse.json({ ok: false, enviado: false, error: msg }, { status: 500 });
  }

  const candidatos = seleccionarUrgencias(datos, hoy, DIAS_AVISO);
  const idsCandidatos = [...candidatos.pagos, ...candidatos.rebotados].map((c) => c.id);
  if (!idsCandidatos.length) {
    return NextResponse.json({ ok: true, enviado: false, nuevas: 0 });
  }

  // 1) Tomar: marcar como avisados SOLO los que siguen sin avisar
  const { data: tomados, error: errTomar } = await supabase
    .from("cheques")
    .update({ alertado_hasta: silencioHasta })
    .in("id", idsCandidatos)
    .or(`alertado_hasta.is.null,alertado_hasta.lt.${hoy}`)
    .select("id");
  if (errTomar) {
    return NextResponse.json(
      { ok: false, enviado: false, error: `No se pudo marcar los avisos: ${errTomar.message}` },
      { status: 500 }
    );
  }
  const idsTomados = new Set((tomados ?? []).map((t) => t.id as string));
  const pagos = candidatos.pagos.filter((c) => idsTomados.has(c.id));
  const rebotados = candidatos.rebotados.filter((c) => idsTomados.has(c.id));
  if (!pagos.length && !rebotados.length) {
    // otro envío ya los avisó
    return NextResponse.json({ ok: true, enviado: false, nuevas: 0 });
  }

  // 2) Armar el mensaje
  const quien = (c: Cheque) => esc(c.deuda_proveedor || c.beneficiario || "—");
  const linea = (c: Cheque) =>
    `${etiquetaUrgencia(c.fecha_cobro, hoy)} · ${quien(c)} · ${c.medio}${c.numero ? ` #${esc(c.numero)}` : ""} · ` +
    `${money(c.monto)} · ${fmtFecha(c.fecha_cobro)}${c.ambito_efectivo === "personal" ? " · 👤 personal" : ""}`;
  const total = sumar(pagos.map((c) => c.monto));
  const agenda = armarAgenda(datos, quincena, { hoy });

  const partes: string[] = [];
  if (pagos.length) {
    partes.push(
      `⚠️ <b>${pagos.length}</b> pago${pagos.length !== 1 ? "s" : ""} por atender (${money(total)}):\n\n` +
        pagos.map(linea).join("\n")
    );
  }
  if (rebotados.length) {
    partes.push(
      `⛔ <b>Cheques rebotados sin resolver</b> (${money(sumar(rebotados.map((c) => c.monto)))}):\n` +
        rebotados.map((c) => `${quien(c)} · ${money(c.monto)}${c.numero ? ` · #${esc(c.numero)}` : ""}`).join("\n")
    );
  }
  partes.push(
    `En esta quincena (${quincena.etiqueta}) tienes <b>${money(agenda.totalPagos)}</b> en ${agenda.pagos.length} pago${agenda.pagos.length !== 1 ? "s" : ""} programado${agenda.pagos.length !== 1 ? "s" : ""}.`
  );
  partes.push(`No te vuelvo a escribir de esto en ${DIAS_SILENCIO} días. ¿Qué hacemos?`);

  const { data: pending } = await supabase
    .from("bot_pending_actions")
    .insert({
      chat_id: String(chatId),
      kind: "urgencias",
      payload: { cheque_ids: pagos.map((c) => c.id), rebotado_ids: rebotados.map((c) => c.id) },
    })
    .select("id")
    .single();

  const botones = pending
    ? [
        ...(pagos.length ? [[{ text: "✅ Marcar todos como pagados", callback_data: `urg:pagar:${pending.id}` }]] : []),
        [
          { text: "📋 Ver detalle", callback_data: `urg:detalle:${pending.id}` },
          { text: "🔕 Silenciar 30 días", callback_data: `urg:posponer:${pending.id}` },
        ],
      ]
    : undefined;

  // 3) Enviar; si falla, deshacer la marca para reintentar mañana
  const enviado = await sendMessage(chatId, partes.join("\n\n"), botones);
  if (!enviado) {
    await supabase.from("cheques").update({ alertado_hasta: null }).in("id", [...idsTomados]);
    return NextResponse.json({ ok: false, enviado: false, error: "Telegram no aceptó el mensaje" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, enviado: true, nuevas: pagos.length + rebotados.length });
}
