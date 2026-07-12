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

  const [chq, cxp] = await Promise.all([
    supabase
      .from("cheques")
      .select("tipo, monto, beneficiario, fecha_cobro")
      .eq("estado", "pendiente")
      .eq("tipo", "por_pagar")
      .not("fecha_cobro", "is", null)
      .lt("fecha_cobro", limite),
    supabase
      .from("cuentas_por_pagar")
      .select("proveedor, concepto, monto, fecha_vencimiento")
      .eq("estado", "pendiente")
      .not("fecha_vencimiento", "is", null)
      .lt("fecha_vencimiento", limite),
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
    // sin urgencias, sin mensaje — no molestar
    return NextResponse.json({ ok: true, urgencias: 0 });
  }

  await sendMessage(
    chatId,
    `⚠️ <b>Urgencias de pago</b> (${hoy})\n\n${urgencias.join("\n")}\n\nMárcalos desde /finanzas o dime por aquí cuando estén resueltos.`
  );
  return NextResponse.json({ ok: true, urgencias: urgencias.length });
}
