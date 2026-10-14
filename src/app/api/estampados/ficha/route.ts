import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_FOTO, sendPhoto } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Manda la ficha visual de estampado al bot de fichas.
 *
 * Es un canal de un solo sentido: sin webhook, sin IA y sin base de datos. La
 * imagen llega ya compuesta desde el navegador (`lib/produccion/ficha.ts`), se
 * reenvía a Telegram y no se guarda en ninguna parte — el archivo de verdad
 * queda en el chat del bot.
 *
 * Usa su propio token y su propio chat, distintos de los del bot principal.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // El middleware ya saca a logística de /produccion, pero no impide un POST
  // directo a esta ruta. Misma regla que el middleware: sin fila en user_roles
  // se trata como admin, para no dejar fuera al dueño.
  const { data: rol } = await supabase
    .from("user_roles")
    .select("rol")
    .eq("user_id", user.id)
    .maybeSingle();
  if (rol?.rol === "logistica") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const token = process.env.TELEGRAM_FICHAS_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_FICHAS_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json(
      { error: "El bot de fichas no está configurado." },
      { status: 500 }
    );
  }

  const form = await req.formData();
  const foto = form.get("foto");
  const texto = String(form.get("texto") ?? "");

  if (!(foto instanceof File)) {
    return NextResponse.json({ error: "Falta la imagen de la ficha." }, { status: 400 });
  }
  if (foto.type !== "image/png") {
    return NextResponse.json({ error: "La ficha debe ser un PNG." }, { status: 400 });
  }
  if (foto.size > MAX_FOTO) {
    return NextResponse.json(
      { error: "La ficha pesa más de 10 MB y Telegram no la acepta." },
      { status: 400 }
    );
  }

  const res = await sendPhoto(token, chatId, foto, "ficha.png", texto);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
