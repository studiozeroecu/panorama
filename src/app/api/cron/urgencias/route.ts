import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Días de silencio para un ítem ya avisado (se vuelve a avisar pasado ese plazo). */
const DIAS_SILENCIO = 7;

function money(n: number): string {
  return "$" + n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Alerta de urgencias de pago.
 *
 * Regla (corregida): avisa SOLO de lo que no se ha avisado antes. Cada ítem
 * queda en silencio `DIAS_SILENCIO` días tras avisarse (columna
 * `alertado_hasta`), así una deuda vencida sin resolver no repite el mismo
 * mensaje cada mañana. Si no hay nada nuevo, el bot NO escribe.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!chatId) return NextResponse.json({ ok: false, error: "sin chat id" });

  const supabase = createServiceClient();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const limite = sumarDias(hoy, 3);
  const silencioHasta = sumarDias(hoy, DIAS_SILENCIO);
  const sinAvisar = `alertado_hasta.is.null,alertado_hasta.lt.${hoy}`;

  const [chq, cxp] = await Promise.all([
    supabase
      .from("cheques")
      .select("id, monto, beneficiario, fecha_cobro")
      .eq("estado", "pendiente")
      .eq("tipo", "por_pagar")
      .not("fecha_cobro", "is", null)
      .lt("fecha_cobro", limite)
      .or(sinAvisar),
    supabase
      .from("cuentas_por_pagar")
      .select("id, proveedor, concepto, monto, fecha_vencimiento")
      .eq("estado", "pendiente")
      .not("fecha_vencimiento", "is", null)
      .lt("fecha_vencimiento", limite)
      .or(sinAvisar),
  ]);

  // Si falta la columna de control, NO enviar: sin ella no hay forma de evitar
  // repetir el mismo aviso a diario (que es justo lo que hay que impedir).
  const faltaMigracion = [chq.error, cxp.error].some(
    (e) => e && (/alertado_hasta/.test(e.message) || e.code === "42703")
  );
  if (faltaMigracion) {
    return NextResponse.json({
      ok: false,
      enviado: false,
      error: "Falta ejecutar supabase/actualizacion_alertas.sql — alertas en pausa para no repetir mensajes.",
    });
  }
  if (chq.error || cxp.error) {
    return NextResponse.json({ ok: false, error: chq.error?.message ?? cxp.error?.message }, { status: 500 });
  }

  const cheques = chq.data ?? [];
  const cuentas = cxp.data ?? [];
  if (!cheques.length && !cuentas.length) {
    // nada nuevo que avisar → el bot no escribe
    return NextResponse.json({ ok: true, enviado: false, nuevas: 0 });
  }

  const etiqueta = (fecha: string) =>
    fecha < hoy ? "🔴 VENCIDO" : fecha === hoy ? "🔴 vence HOY" : "🟠 vence pronto";

  const urgencias = [
    ...cheques.map((c) => `${etiqueta(c.fecha_cobro!)} · cheque a ${c.beneficiario} · ${money(Number(c.monto))} · ${c.fecha_cobro}`),
    ...cuentas.map(
      (x) =>
        `${etiqueta(x.fecha_vencimiento!)} · ${x.proveedor}${x.concepto ? ` (${x.concepto})` : ""} · ${money(Number(x.monto))} · ${x.fecha_vencimiento}`
    ),
  ];
  const total =
    cheques.reduce((s, c) => s + Number(c.monto), 0) + cuentas.reduce((s, x) => s + Number(x.monto), 0);

  // Recomendación de socio: contrastar con el ingreso del último reporte
  const { data: snap } = await supabase
    .from("snapshots")
    .select("total_neto")
    .order("periodo_hasta", { ascending: false })
    .limit(1);
  const neto = snap?.[0] ? Number(snap[0].total_neto) : null;
  const contexto =
    neto == null
      ? ""
      : neto >= total
        ? `Tu último reporte dejó <b>${money(neto)}</b> netos — alcanza, te quedarían ${money(neto - total)}.`
        : `⚠ Tu último reporte dejó <b>${money(neto)}</b> netos y esto suma más. Prioriza los vencidos.`;

  const chequeIds = cheques.map((c) => c.id);
  const cuentaIds = cuentas.map((x) => x.id);

  const { data: pending } = await supabase
    .from("bot_pending_actions")
    .insert({
      chat_id: String(chatId),
      kind: "urgencias",
      payload: { cheque_ids: chequeIds, cxp_ids: cuentaIds },
    })
    .select("id")
    .single();

  const botones = pending
    ? [
        [{ text: "✅ Marcar todos como pagados", callback_data: `urg:pagar:${pending.id}` }],
        [
          { text: "📋 Ver detalle", callback_data: `urg:detalle:${pending.id}` },
          { text: "🔕 Silenciar 30 días", callback_data: `urg:posponer:${pending.id}` },
        ],
      ]
    : undefined;

  await sendMessage(
    chatId,
    `⚠️ <b>${urgencias.length}</b> pago${urgencias.length !== 1 ? "s" : ""} por atender (${money(total)}):\n\n${urgencias.join("\n")}\n\n${contexto}\nNo te vuelvo a escribir de esto en ${DIAS_SILENCIO} días. ¿Qué hacemos?`,
    botones
  );

  // Silenciar estos ítems para que el aviso no se repita mañana
  if (chequeIds.length) {
    await supabase.from("cheques").update({ alertado_hasta: silencioHasta }).in("id", chequeIds);
  }
  if (cuentaIds.length) {
    await supabase.from("cuentas_por_pagar").update({ alertado_hasta: silencioHasta }).in("id", cuentaIds);
  }

  return NextResponse.json({ ok: true, enviado: true, nuevas: urgencias.length });
}
