import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

function money(n: number): string {
  return "$" + n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Resumen semanal proactivo (lunes por la mañana). Sin IA — se arma con
 * código puro desde la base, costo $0.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!chatId) return NextResponse.json({ ok: false, error: "TELEGRAM_ALLOWED_CHAT_ID no configurado" });

  const supabase = createServiceClient();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const en7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const secciones: string[] = [`📊 <b>Resumen semanal — Bear &amp; Trend</b> (${hoy})`];

  // Ventas: último snapshot
  const { data: snaps } = await supabase
    .from("snapshots")
    .select("periodo_desde, periodo_hasta, total_unidades, total_neto, num_alertas, created_at")
    .order("periodo_hasta", { ascending: false })
    .limit(1);
  const s = snaps?.[0];
  if (s) {
    secciones.push(
      `🛍 <b>Ventas</b> (último reporte: ${s.periodo_desde} a ${s.periodo_hasta})\n` +
        `${s.total_unidades} unidades · neto ${money(Number(s.total_neto))}`
    );
  } else {
    secciones.push("🛍 <b>Ventas</b>: aún no hay reportes cargados.");
  }

  // Movimientos de la semana
  const { data: movs } = await supabase
    .from("movimientos")
    .select("tipo, monto, categoria")
    .gte("fecha", hace7);
  if (movs?.length) {
    const gastos = movs.filter((m) => m.tipo === "gasto");
    const totalG = gastos.reduce((sum, m) => sum + Number(m.monto), 0);
    const totalI = movs.filter((m) => m.tipo === "ingreso").reduce((sum, m) => sum + Number(m.monto), 0);
    const porCat = new Map<string, number>();
    for (const g of gastos) porCat.set(g.categoria, (porCat.get(g.categoria) ?? 0) + Number(g.monto));
    const topCats = [...porCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, t]) => `${c} ${money(t)}`)
      .join(" · ");
    secciones.push(
      `💸 <b>Movimientos de la semana</b>\nGastos: ${money(totalG)}${topCats ? ` (${topCats})` : ""}${totalI > 0 ? `\nIngresos: ${money(totalI)}` : ""}`
    );
  } else {
    secciones.push("💸 <b>Movimientos de la semana</b>: sin registros.");
  }

  // Cheques próximos (7 días) — pendientes
  const { data: cheques } = await supabase
    .from("cheques")
    .select("tipo, monto, beneficiario, fecha_cobro")
    .eq("estado", "pendiente")
    .not("fecha_cobro", "is", null)
    .lte("fecha_cobro", en7)
    .order("fecha_cobro", { ascending: true })
    .limit(10);
  if (cheques?.length) {
    const lines = cheques
      .map(
        (c) =>
          `${c.tipo === "por_pagar" ? "🔴 pagar" : "🟢 cobrar"} ${money(Number(c.monto))} · ${c.beneficiario} · ${c.fecha_cobro}`
      )
      .join("\n");
    secciones.push(`🧾 <b>Cheques próximos (7 días)</b>\n${lines}`);
  } else {
    secciones.push("🧾 <b>Cheques próximos (7 días)</b>: ninguno pendiente.");
  }

  // Stock crítico (del último snapshot)
  if (s) {
    secciones.push(
      `📦 <b>Stock</b>: ${s.num_alertas} alertas reales en el último reporte. Pregúntame "stock crítico" para el detalle.`
    );
  }

  await sendMessage(chatId, secciones.join("\n\n"));
  return NextResponse.json({ ok: true });
}
