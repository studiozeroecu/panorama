import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMessage } from "@/lib/telegram";
import { hoyEcuador } from "@/lib/fechas";
import { cargarFinanzas, ErrorCarga } from "@/lib/finanzas/cargar";
import { armarAgenda } from "@/lib/finanzas/agenda";
import { quincenaDe, siguiente, sumarDias } from "@/lib/finanzas/periodos";
import { money, sumar } from "@/lib/finanzas/formato";
import { esc, htmlAgenda } from "@/lib/finanzas/textos";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const hoy = hoyEcuador();
  const hace7 = sumarDias(hoy, -7);
  const en7 = sumarDias(hoy, 7);

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

  // Movimientos de la semana: gastos de la EMPRESA (lo personal va aparte)
  const { data: movs, error: errMovs } = await supabase
    .from("v_movimientos")
    .select("tipo, monto, categoria, ambito, cuenta_en_rentabilidad")
    .gte("fecha", hace7)
    .lte("fecha", hoy);
  if (errMovs) {
    secciones.push("💸 <b>Movimientos de la semana</b>: ⚠ no se pudieron cargar — los totales no son confiables.");
  } else if (movs?.length) {
    const gastos = movs.filter((m) => m.tipo === "gasto" && m.ambito === "empresa");
    const personales = movs.filter((m) => m.tipo === "gasto" && m.ambito === "personal");
    const totalG = sumar(gastos.map((m) => Number(m.monto)));
    const totalP = sumar(personales.map((m) => Number(m.monto)));
    const totalI = sumar(movs.filter((m) => m.tipo === "ingreso").map((m) => Number(m.monto)));
    const porCat = new Map<string, number[]>();
    for (const g of gastos) porCat.set(g.categoria, [...(porCat.get(g.categoria) ?? []), Number(g.monto)]);
    const topCats = [...porCat.entries()]
      .map(([c, ms]) => [c, sumar(ms)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, t]) => `${c} ${money(t)}`)
      .join(" · ");
    secciones.push(
      `💸 <b>Movimientos de la semana</b>\nGastos de la empresa: ${money(totalG)}${topCats ? ` (${topCats})` : ""}` +
        `${totalP > 0 ? `\nGastos personales (aparte): ${money(totalP)}` : ""}${totalI > 0 ? `\nIngresos: ${money(totalI)}` : ""}`
    );
  } else {
    secciones.push("💸 <b>Movimientos de la semana</b>: sin registros.");
  }

  // Pagos: la quincena actual con la misma lógica que la web (armarAgenda)
  const quincena = quincenaDe(hoy);
  try {
    const datos = await cargarFinanzas(supabase, quincena);
    const agenda = armarAgenda(datos, quincena, { hoy });
    secciones.push(htmlAgenda(agenda, `Pagos de la quincena ${quincena.etiqueta}`));
    const proxima = siguiente(quincena);
    const agendaProx = armarAgenda(datos, proxima, { hoy });
    secciones.push(
      `Próxima quincena (${proxima.etiqueta}): ${money(agendaProx.totalPagos)} en ${agendaProx.pagos.length} pago${agendaProx.pagos.length !== 1 ? "s" : ""}.\n` +
        `Total que se debe hoy (todas las deudas): ${money(agenda.totalAdeudado)}.`
    );
  } catch (e) {
    secciones.push(
      `📤 <b>Pagos</b>: ⚠ ${esc(e instanceof ErrorCarga ? e.message : "No se pudo cargar Finanzas — los totales no son confiables.")}`
    );
  }

  // Por cobrar (versión simple hasta la fase 5): facturas vencidas y cheques que me pagan en 7 días
  const [cxcR, chqCobrar] = await Promise.all([
    supabase
      .from("cuentas_por_cobrar")
      .select("cliente, monto, fecha_vencimiento")
      .eq("estado", "pendiente")
      .not("fecha_vencimiento", "is", null)
      .lt("fecha_vencimiento", hoy)
      .order("fecha_vencimiento"),
    supabase
      .from("cheques")
      .select("monto, beneficiario, fecha_cobro")
      .eq("tipo", "por_cobrar")
      .eq("estado", "pendiente")
      .not("fecha_cobro", "is", null)
      .lte("fecha_cobro", en7)
      .order("fecha_cobro"),
  ]);
  if (cxcR.data?.length) {
    const total = sumar(cxcR.data.map((x) => Number(x.monto)));
    secciones.push(
      `📥 <b>Facturas por cobrar vencidas</b> (${money(total)})\n` +
        cxcR.data.slice(0, 8).map((x) => `${esc(x.cliente)} · ${money(Number(x.monto))} · venció ${x.fecha_vencimiento}`).join("\n")
    );
  }
  if (chqCobrar.data?.length) {
    secciones.push(
      `🟢 <b>Cheques por cobrar (7 días)</b>\n` +
        chqCobrar.data.slice(0, 8).map((c) => `${money(Number(c.monto))} · ${esc(c.beneficiario)} · ${c.fecha_cobro}`).join("\n")
    );
  }

  // Pedidos de tela atrasados (producción)
  const { data: pedidosPend } = await supabase
    .from("prod_pedidos_tela")
    .select("nombre_tela, fecha_pedido, estado, proveedor_id")
    .in("estado", ["pendiente", "en_camino"]);
  if (pedidosPend?.length) {
    const { data: provs } = await supabase.from("prod_proveedores").select("id, empresa, dias_entrega");
    const atrasados: string[] = [];
    for (const p of pedidosPend) {
      const prov = provs?.find((x) => x.id === p.proveedor_id);
      if (!prov || !p.fecha_pedido) continue;
      // fecha estimada: días laborables desde el pedido
      const d = new Date(`${p.fecha_pedido}T12:00:00Z`);
      let sumados = 0;
      while (sumados < prov.dias_entrega) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) sumados++;
      }
      const estimada = d.toISOString().slice(0, 10);
      if (estimada < hoy) {
        const dias = Math.round((new Date(`${hoy}T12:00Z`).getTime() - d.getTime()) / 86400000);
        atrasados.push(`🔴 ${p.nombre_tela} (${prov.empresa}) — atrasado ${dias} día${dias !== 1 ? "s" : ""}`);
      }
    }
    if (atrasados.length) {
      secciones.push(`🧵 <b>Pedidos de tela atrasados</b>\n${atrasados.join("\n")}`);
    }
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
