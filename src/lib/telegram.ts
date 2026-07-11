/** Cliente mínimo de la Bot API de Telegram (sin dependencias). */

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export interface InlineButton {
  text: string;
  callback_data: string;
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${BASE()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error(`Telegram ${method} error:`, json.description);
      return null;
    }
    return json.result as T;
  } catch (e) {
    console.error(`Telegram ${method} failed:`, e);
    return null;
  }
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][]
) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

export async function editMessageText(chatId: string | number, messageId: number, text: string) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  });
}

/** Descarga un archivo de Telegram por file_id. Devuelve buffer o null. */
export async function downloadFile(fileId: string): Promise<Buffer | null> {
  const file = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file?.file_path) return null;
  try {
    const res = await fetch(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function setChatAction(chatId: string | number, action = "typing") {
  return call("sendChatAction", { chat_id: chatId, action });
}
