import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSnapshot, type ExistingSnapshot } from "@/lib/snapshots";
import { handleText, extractCheque } from "@/lib/bot/claude";
import { parsePeriodo } from "@/lib/bot/periodo";
import {
  sendMessage,
  downloadFile,
  answerCallbackQuery,
  editMessageText,
  setChatAction,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TgUpdate {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    caption?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string };
    photo?: { file_id: string; width: number; height: number }[];
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

function money(n: number): string {
  return "$" + n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  // 1) Autenticidad: el secreto que registramos con setWebhook
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!chatId) return NextResponse.json({ ok: true });

  // 2) Un solo usuario autorizado
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowed) {
    await sendMessage(
      chatId,
      `Tu chat_id es <code>${chatId}</code>.\nAgrégalo como variable de entorno <code>TELEGRAM_ALLOWED_CHAT_ID</code> y vuelve a desplegar para activar el bot.`
    );
    return NextResponse.json({ ok: true });
  }
  if (String(chatId) !== String(allowed)) {
    // silencio total para desconocidos
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.document) {
      await handleDocument(chatId, update.message.document, update.message.caption ?? "");
    } else if (update.message?.photo?.length) {
      await handlePhoto(chatId, update.message.photo);
    } else if (update.message?.text) {
      await handleTextMessage(chatId, update.message.text);
    }
  } catch (e) {
    console.error("webhook error:", e);
    await sendMessage(chatId, "⚠️ Algo falló procesando eso. Inténtalo de nuevo.");
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------
// Texto → Claude con herramientas
// ---------------------------------------------------------------

async function handleTextMessage(chatId: number, text: string) {
  if (text === "/start" || text === "/ayuda" || text === "/help") {
    await sendMessage(
      chatId,
      [
        "Hola 👋 Soy el asistente de Bear &amp; Trend. Puedo:",
        "📄 Procesar el Excel de Adosoft — envíalo con el periodo en el caption (ej. <i>1/6 al 30/6</i>)",
        "💸 Registrar pagos/gastos — <i>“pagué $200 de maquila”</i>",
        "🧾 Registrar cheques por foto — mándame la foto y te pido confirmación",
        "❓ Responder sobre tus números — <i>“¿cómo voy este mes?”, “¿qué tengo que pagar esta semana?”</i>",
      ].join("\n")
    );
    return;
  }

  await setChatAction(chatId);
  const supabase = createServiceClient();
  const reply = await handleText(supabase, text);
  await sendMessage(chatId, esc(reply));
}

// ---------------------------------------------------------------
// Documento .xlsx → flujo de snapshot (idéntico a la web)
// ---------------------------------------------------------------

async function handleDocument(
  chatId: number,
  doc: { file_id: string; file_name?: string },
  caption: string
) {
  const name = doc.file_name ?? "reporte.xlsx";
  if (!/\.xlsx?$/i.test(name)) {
    await sendMessage(chatId, "Solo proceso archivos Excel (.xlsx) del reporte de Adosoft.");
    return;
  }

  const periodo = parsePeriodo(caption);
  if (!periodo) {
    await sendMessage(
      chatId,
      "¿Qué periodo cubre este reporte? Reenvía el archivo con el rango en el caption, por ejemplo:\n<i>1/6 al 30/6</i>  o  <i>01/06/2026 - 15/06/2026</i>"
    );
    return;
  }

  await setChatAction(chatId, "upload_document");
  const buffer = await downloadFile(doc.file_id);
  if (!buffer) {
    await sendMessage(chatId, "No pude descargar el archivo de Telegram. Inténtalo de nuevo.");
    return;
  }

  const supabase = createServiceClient();
  const result = await createSnapshot(supabase, {
    buffer,
    filename: name,
    desde: periodo.desde,
    hasta: periodo.hasta,
    mode: "check",
  });

  if (!result.ok && result.conflict) {
    // guarda la acción pendiente y pregunta con botones
    const { data: pending, error } = await supabase
      .from("bot_pending_actions")
      .insert({
        chat_id: String(chatId),
        kind: "snapshot_conflict",
        payload: { file_id: doc.file_id, filename: name, ...periodo },
      })
      .select("id")
      .single();
    if (error || !pending) {
      await sendMessage(chatId, `Error guardando la acción pendiente: ${error?.message}`);
      return;
    }
    const lista = result.existing
      .map((e: ExistingSnapshot) => `• ${e.periodo_desde} a ${e.periodo_hasta} (${esc(e.archivo_nombre)})`)
      .join("\n");
    await sendMessage(
      chatId,
      `Ya existe un reporte que se cruza con ${periodo.desde} a ${periodo.hasta}:\n${lista}\n\n¿Qué hago?`,
      [
        [
          { text: "🔄 Reemplazar", callback_data: `snap:replace:${pending.id}` },
          { text: "➕ Guardar aparte", callback_data: `snap:keep:${pending.id}` },
        ],
        [{ text: "✖️ Cancelar", callback_data: `snap:cancel:${pending.id}` }],
      ]
    );
    return;
  }

  await reportSnapshotResult(chatId, result, periodo);
}

async function reportSnapshotResult(
  chatId: number,
  result: Awaited<ReturnType<typeof createSnapshot>>,
  periodo: { desde: string; hasta: string }
) {
  if (!result.ok) {
    await sendMessage(chatId, `⚠️ ${esc("error" in result ? result.error : "Error desconocido")}`);
    return;
  }
  const warn = result.warnings.length ? `\n⚠️ ${esc(result.warnings.join(" · "))}` : "";
  await sendMessage(
    chatId,
    [
      `✅ Reporte guardado (${periodo.desde} a ${periodo.hasta})`,
      `Unidades vendidas: <b>${result.summary.totalUnidades}</b>`,
      `Ingreso neto (post-comisión): <b>${money(result.summary.totalNeto)}</b>`,
      `Alertas de stock: <b>${result.summary.numAlertas}</b>`,
      `Locales: ${result.locales.join(", ")}${warn}`,
    ].join("\n")
  );
}

// ---------------------------------------------------------------
// Foto → lectura de cheque + confirmación
// ---------------------------------------------------------------

async function handlePhoto(chatId: number, photos: { file_id: string; width: number }[]) {
  await setChatAction(chatId);
  const best = photos[photos.length - 1]; // Telegram ordena de menor a mayor resolución
  const buffer = await downloadFile(best.file_id);
  if (!buffer) {
    await sendMessage(chatId, "No pude descargar la foto. Inténtalo de nuevo.");
    return;
  }

  const extraction = await extractCheque(buffer, "image/jpeg");
  if (!extraction || !extraction.legible) {
    await sendMessage(
      chatId,
      "No pude leer un cheque en esa foto. Prueba con más luz y el cheque completo en el encuadre, o dímelo por texto: <i>“cheque por pagar de $500 a X, se cobra el 20/7”</i>."
    );
    return;
  }

  const supabase = createServiceClient();
  const { data: pending, error } = await supabase
    .from("bot_pending_actions")
    .insert({
      chat_id: String(chatId),
      kind: "cheque",
      payload: { ...extraction, file_id: best.file_id },
    })
    .select("id")
    .single();
  if (error || !pending) {
    await sendMessage(chatId, `Error guardando la lectura: ${error?.message}`);
    return;
  }

  const filas = [
    `Monto: <b>${extraction.monto != null ? money(extraction.monto) : "—"}</b>`,
    `Beneficiario: ${esc(extraction.beneficiario ?? "—")}`,
    `Banco: ${esc(extraction.banco ?? "—")}`,
    `Número: ${esc(extraction.numero ?? "—")}`,
    `Fecha de cobro: ${extraction.fecha_cobro ?? "—"}`,
    extraction.notas ? `Notas: ${esc(extraction.notas)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await sendMessage(chatId, `Leí esto del cheque:\n${filas}\n\n¿Es por pagar o por cobrar?`, [
    [
      { text: "💸 Por pagar", callback_data: `chq:por_pagar:${pending.id}` },
      { text: "💰 Por cobrar", callback_data: `chq:por_cobrar:${pending.id}` },
    ],
    [{ text: "✖️ Cancelar (datos mal leídos)", callback_data: `chq:cancel:${pending.id}` }],
  ]);
}

// ---------------------------------------------------------------
// Botones (callbacks): confirmaciones de cheque y de snapshot
// ---------------------------------------------------------------

async function handleCallback(cb: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const [prefix, action, pendingId] = (cb.data ?? "").split(":");
  await answerCallbackQuery(cb.id);
  if (!chatId || !messageId || !pendingId) return;

  const supabase = createServiceClient();
  const { data: pending } = await supabase
    .from("bot_pending_actions")
    .select("id, kind, payload, resolved")
    .eq("id", pendingId)
    .single();

  if (!pending || pending.resolved) {
    await editMessageText(chatId, messageId, "Esta acción ya fue resuelta o expiró.");
    return;
  }
  await supabase.from("bot_pending_actions").update({ resolved: true }).eq("id", pendingId);

  // --- cheques ---
  if (prefix === "chq" && pending.kind === "cheque") {
    if (action === "cancel") {
      await editMessageText(chatId, messageId, "Cancelado — no registré nada. Puedes dictarme el cheque por texto si prefieres.");
      return;
    }
    const tipo = action === "por_cobrar" ? "por_cobrar" : "por_pagar";
    const p = pending.payload as {
      monto: number | null;
      beneficiario: string | null;
      banco: string | null;
      numero: string | null;
      fecha_cobro: string | null;
      notas: string | null;
      file_id: string;
    };
    if (!(Number(p.monto) > 0)) {
      await editMessageText(chatId, messageId, "El monto no se leyó bien — regístralo por texto: “cheque por pagar de $X a Y”.");
      return;
    }

    // guarda la foto como respaldo
    let fotoPath: string | null = null;
    const buffer = await downloadFile(p.file_id);
    if (buffer) {
      const path = `${pendingId}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("cheques")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
      if (!upErr) fotoPath = path;
    }

    const { error } = await supabase.from("cheques").insert({
      tipo,
      monto: Number(p.monto),
      beneficiario: p.beneficiario ?? "",
      banco: p.banco ?? "",
      numero: p.numero ?? "",
      fecha_cobro: p.fecha_cobro && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha_cobro) ? p.fecha_cobro : null,
      notas: p.notas ?? "",
      foto_path: fotoPath,
    });
    if (error) {
      await editMessageText(chatId, messageId, `⚠️ Error al guardar el cheque: ${esc(error.message)}`);
      return;
    }
    await editMessageText(
      chatId,
      messageId,
      `✅ Cheque ${tipo === "por_pagar" ? "por pagar" : "por cobrar"} registrado: <b>${money(Number(p.monto))}</b> · ${esc(p.beneficiario ?? "")}${p.fecha_cobro ? ` · cobro ${p.fecha_cobro}` : ""}`
    );
    return;
  }

  // --- conflicto de snapshot ---
  if (prefix === "snap" && pending.kind === "snapshot_conflict") {
    if (action === "cancel") {
      await editMessageText(chatId, messageId, "Cancelado — no cargué el reporte.");
      return;
    }
    const p = pending.payload as { file_id: string; filename: string; desde: string; hasta: string };
    await editMessageText(chatId, messageId, "Procesando el reporte…");
    const buffer = await downloadFile(p.file_id);
    if (!buffer) {
      await sendMessage(chatId, "No pude volver a descargar el archivo; reenvíalo por favor.");
      return;
    }
    const result = await createSnapshot(supabase, {
      buffer,
      filename: p.filename,
      desde: p.desde,
      hasta: p.hasta,
      mode: action === "replace" ? "replace" : "keep",
    });
    await reportSnapshotResult(chatId, result, { desde: p.desde, hasta: p.hasta });
  }
}
