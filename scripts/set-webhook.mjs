// Registra el webhook del bot de Telegram apuntando a tu deploy.
// Uso:  node scripts/set-webhook.mjs https://tu-app.vercel.app
// Lee TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET de .env.local
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const baseUrl = process.argv[2];
if (!baseUrl?.startsWith("https://")) {
  console.error("Uso: node scripts/set-webhook.mjs https://tu-app.vercel.app");
  process.exit(1);
}
const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) {
  console.error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET en .env.local");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  }),
});
console.log(JSON.stringify(await res.json(), null, 2));
