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

Tu rol: SOCIO de negocio, no base de datos. Reglas de comportamiento:
- Para cualquier dato o registro usa SIEMPRE las herramientas; nunca inventes cifras.
- Después de mostrar información, agrega SIEMPRE una recomendación concreta y accionable basada en los números (ej.: si hay pagos fuertes esta semana, compáralos con el ingreso del último reporte y estima el margen disponible combinando herramientas; si el stock crítico se concentra en un local, sugiere priorizarlo; si un producto domina las ventas, sugiere reponerlo).
- Termina SIEMPRE con una pregunta o siguiente paso sugerido ("¿Quieres que…?", "¿Te marco…?").
- Cifras clave en negrita (HTML <b>). Corto y directo; sin listas largas salvo que pidan detalle.
- Presenta lo negativo con contexto y opciones, sin dramatizar ni ocultar.
- Si el usuario registra un pago sin categoría clara, dedúcela (maquila, estampado, corte, arriendo, servicios, transporte, personal, otros); "otros" solo si nada aplica.
- Estampados DTF: los metros de claros y oscuros se redondean hacia arriba POR SEPARADO (nunca comparten metro). Tras usar registrar_estampado_dtf, informa el cálculo y di que confirme con el botón que aparece — el lote NO está guardado aún.
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

export interface GuiaItemExtraccion {
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number | null;
}

export interface GuiaExtraccion {
  legible: boolean;
  local_destino: string | null; // PK, LJ, GL, GT, BS, IBA, HUMZO, CV, HUMMER, QUITO, FRATELLI
  fecha: string | null; // YYYY-MM-DD
  items: GuiaItemExtraccion[];
}

const GUIA_SCHEMA = {
  type: "object",
  properties: {
    legible: { type: "boolean" },
    local_destino: {
      type: ["string", "null"],
      description: "Uno de: PK, LJ, GL, GT, BS, IBA, HUMZO, CV, HUMMER, QUITO, FRATELLI — o null si no se distingue",
    },
    fecha: { type: ["string", "null"], description: "YYYY-MM-DD" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          codigo: { type: ["string", "null"] },
          descripcion: { type: "string" },
          cantidad: { type: "number" },
          precio_unitario: { type: ["number", "null"] },
        },
        required: ["codigo", "descripcion", "cantidad", "precio_unitario"],
        additionalProperties: false,
      },
    },
  },
  required: ["legible", "local_destino", "fecha", "items"],
  additionalProperties: false,
} as const;

function parseGuiaRespuesta(response: Anthropic.Message): GuiaExtraccion | null {
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as GuiaExtraccion;
  } catch {
    return null;
  }
}

/** Lee una guía de transferencia desde una foto (visión + salida estructurada). */
export async function extractGuia(imageBuffer: Buffer, mime: string): Promise<GuiaExtraccion | null> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
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
            text: "Esta es una guía de transferencia de ropa a un local. Extrae el local destino (código corto como PK, LJ, QUITO...), la fecha si aparece, y CADA línea de producto con código (si hay), descripción, cantidad y precio unitario. Si la imagen no es una guía o es ilegible, legible=false.",
          },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: GUIA_SCHEMA } },
  });
  return parseGuiaRespuesta(response);
}

/** Aplica una corrección dictada por texto sobre una extracción previa. */
export async function corregirGuia(
  previa: GuiaExtraccion,
  correccion: string
): Promise<GuiaExtraccion | null> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content:
          `Datos extraídos de una guía de transferencia:\n${JSON.stringify(previa)}\n\n` +
          `La usuaria corrige: "${correccion}"\n\n` +
          `Devuelve la guía corregida aplicando SOLO lo que ella indica (mantén el resto igual). legible=true.`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: GUIA_SCHEMA } },
  });
  return parseGuiaRespuesta(response);
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
