import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

function money(n: number): string {
  return "$" + n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Alerta crítica diaria (8:00 Ecuador): avisa SOLO si hay cheques o pagos que
 * vencen en menos de 3 días (o ya vencidos y pendientes). Se repite cada
 * mañana mientras la urgencia siga sin resolver — decisión del dueño.
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
  const limite = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const [chq, cxp, snap] = await Promise.all([
    supabase
      .from("cheques")
      .select("id, tipo, monto, beneficiario, fecha_cobro")
      .eq("estado", "pendiente")
      .eq("tipo", "por_pagar")
      .not("fecha_cobro", "is", null)
      .lt("fecha_cobro", limite),
    supabase
      .from("cuentas_por_pagar")
      .select("id, proveedor, concepto, monto, fecha_vencimiento")
      .eq("estado", "pendiente")
      .not("fecha_vencimiento", "is", null)
      .lt("fecha_vencimiento", limite),
    supabase
      .from("snapshots")
      .select("total_neto, periodo_desde, periodo_hasta")
      .order("periodo_hasta", { ascending: false })
      .limit(1),
  ]);

  const urgencias: string[] = [];
  const etiqueta = (fecha: string) =>
    fecha < hoy ? "🔴 VENCIDO" : fecha === hoy ? "🔴 vence HOY" : "🟠 vence pronto";

  for (const c of chq.data ?? []) {
    urgencias.push(`${etiqueta(c.fecha_cobro!)} · cheque a ${c.beneficiario} · ${money(Number(c.monto))} · ${c.fecha_cobro}`);
  }
  for (const x of cxp.data ?? []) {
    urgencias.push(
      `${etiqueta(x.fecha_vencimiento!)} · ${x.proveedor}${x.concepto ? ` (${x.concepto})` : ""} · ${money(Number(x.monto))} · ${x.fecha_vencimiento}`
    );
  }

  if (!urgencias.length) {
    // sin urgencias, sin mensaje — el bot solo habla cuando hace falta
    return NextResponse.json({ ok: true, urgencias: 0 });
  }

  const total =
    (chq.data ?? []).reduce((s, c) => s + Number(c.monto), 0) +
    (cxp.data ?? []).reduce((s, x) => s + Number(x.monto), 0);

  // recomendación de socio: comparar contra el ingreso del último reporte
  const s = snap.data?.[0];
  const contexto = s
    ? Number(s.total_neto) >= total
      ? `Tu último reporte dejó <b>${money(Number(s.total_neto))}</b> netos — cubre estas urgencias con margen de ${money(Number(s.total_neto) - total)}.`
      : `⚠ Ojo: tu último reporte dejó <b>${money(Number(s.total_neto))}</b> netos y estas urgencias suman más. Prioriza los vencidos y revisa qué puedes posponer.`
    : "";

  // acción pendiente para los botones (marcar todos / detalle / posponer)
  const { data: pending } = await supabase
    .from("bot_pending_actions")
    .insert({
      chat_id: String(chatId),
      kind: "urgencias",
      payload: {
        cheque_ids: (chq.data ?? []).map((c) => c.id),
        cxp_ids: (cxp.data ?? []).map((x) => x.id),
      },
    })
    .select("id")
    .single();

  const botones = pending
    ? [
        [{ text: "✅ Marcar todos como pagados", callback_data: `urg:pagar:${pending.id}` }],
        [
          { text: "📋 Ver detalle", callback_data: `urg:detalle:${pending.id}` },
          { text: "⏰ Posponer", callback_data: `urg:posponer:${pending.id}` },
        ],
      ]
    : undefined;

  await sendMessage(
    chatId,
    `⚠️ Tienes <b>${urgencias.length}</b> pago${urgencias.length !== 1 ? "s" : ""} urgente${urgencias.length !== 1 ? "s" : ""} por <b>${money(total)}</b>:\n\n${urgencias.join("\n")}\n\n${contexto}\n¿Qué quieres hacer?`,
    botones
  );
  return NextResponse.json({ ok: true, urgencias: urgencias.length });
}
