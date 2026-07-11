// Prueba en vivo: ¿la API key funciona y Haiku elige la herramienta correcta?
// Uso: node scripts/smoke-claude.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const l of readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0 && !l.trim().startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

const { toolDefinitions } = await import("../src/lib/bot/tools.ts").catch(() => ({ toolDefinitions: null }));
// fallback: definición mínima si no se puede importar TS directo
const tools = toolDefinitions ?? [
  {
    name: "registrar_movimiento",
    description: "Registra un pago/gasto o ingreso del negocio.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gasto", "ingreso"] },
        monto: { type: "number" },
        concepto: { type: "string" },
        categoria: {
          type: "string",
          enum: ["maquila", "estampado", "corte", "arriendo", "servicios", "transporte", "personal", "otros"],
        },
      },
      required: ["tipo", "monto", "concepto", "categoria"],
    },
  },
];

const client = new Anthropic();
const res = await client.messages.create({
  model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
  max_tokens: 512,
  tools,
  messages: [{ role: "user", content: "pagué $200 de maquila" }],
});

console.log("stop_reason:", res.stop_reason);
for (const b of res.content) {
  if (b.type === "tool_use") console.log("tool_use:", b.name, JSON.stringify(b.input));
  if (b.type === "text" && b.text.trim()) console.log("text:", b.text.slice(0, 200));
}
console.log("usage:", JSON.stringify(res.usage));
