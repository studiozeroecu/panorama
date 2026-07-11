import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toolDefinitions, executeTool } from "./tools";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const MAX_ITERATIONS = 6;

const client = new Anthropic();

function systemPrompt(): string {
  return `Eres el asistente de negocio de Bear & Trend, una marca de ropa streetwear de Cuenca, Ecuador. Hablas con su dueño por Telegram.

Contexto del negocio:
- Vende a consignación en locales VATEX, que retienen 38.8% de comisión. El "ingreso neto" ya viene calculado post-comisión en los reportes — nunca lo recalcules.
- Las ventas se actualizan solo cuando el dueño carga un reporte de Adosoft; si pregunta por ventas, aclara de qué periodo es el dato.
- Moneda: dólares (USD).
- El dueño también fabrica: hay herramientas de producción (tela, maquila, estampado, stock online propio). "Stock" puede ser el de locales VATEX (stock_critico) o el de producción/online (stock_online_produccion, stock_telas) — elige por contexto o pregunta.

Reglas:
- Para cualquier dato o registro usa SIEMPRE las herramientas; nunca inventes cifras.
- Si el usuario registra un pago sin categoría clara, dedúcela de la lista (maquila, estampado, corte, arriendo, servicios, transporte, personal, otros); usa "otros" solo si nada aplica.
- Responde corto y directo, como un asistente de confianza, en español. Sin listas largas innecesarias; máximo unas pocas líneas salvo que pidan detalle.
- Presenta lo negativo con contexto, sin dramatizar ni ocultar.
- Si falta un dato imprescindible (ej. el monto), pregunta en vez de adivinar.
- No ofrezcas funciones que no tienes. No hables de temas ajenos al negocio.

Fecha de hoy: ${new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" })} (zona horaria de Ecuador).`;
}

/** Conversación con herramientas: bucle manual de tool use. */
export async function handleText(supabase: SupabaseClient, userText: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
      tools: toolDefinitions,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text || "No entendí — ¿me lo repites de otra forma?";
    }

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await executeTool(supabase, tu.name, tu.input as Record<string, unknown>);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }

  return "La consulta se volvió demasiado larga; intenta preguntarlo de forma más directa.";
}

export interface ChequeExtraction {
  legible: boolean;
  monto: number | null;
  beneficiario: string | null;
  banco: string | null;
  numero: string | null;
  fecha_cobro: string | null;
  notas: string | null;
}

/** Lee los datos de un cheque desde una foto (visión + salida estructurada). */
export async function extractCheque(imageBuffer: Buffer, mime: string): Promise<ChequeExtraction | null> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mime as "image/jpeg" | "image/png" | "image/webp",
              data: imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Extrae los datos de este cheque ecuatoriano. Si la imagen no es un cheque o es ilegible, marca legible=false. fecha_cobro es la fecha escrita en el cheque, formato YYYY-MM-DD.",
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            legible: { type: "boolean" },
            monto: { type: ["number", "null"] },
            beneficiario: { type: ["string", "null"] },
            banco: { type: ["string", "null"] },
            numero: { type: ["string", "null"] },
            fecha_cobro: { type: ["string", "null"], description: "YYYY-MM-DD" },
            notas: { type: ["string", "null"], description: "Cualquier otro dato relevante visible" },
          },
          required: ["legible", "monto", "beneficiario", "banco", "numero", "fecha_cobro", "notas"],
          additionalProperties: false,
        },
      },
    },
  });

  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as ChequeExtraction;
  } catch {
    return null;
  }
}
