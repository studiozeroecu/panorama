import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Herramientas que Claude puede invocar. La IA nunca toca la base
 * directamente: solo elige herramienta + parámetros; el backend valida
 * y ejecuta cada una. Cualquier parámetro inválido se rechaza aquí.
 */

export const CATEGORIAS = [
  "maquila",
  "estampado",
  "corte",
  "arriendo",
  "servicios",
  "transporte",
  "personal",
  "otros",
] as const;

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "registrar_movimiento",
    description:
      "Registra un pago/gasto o un ingreso del negocio. Úsala cuando el usuario diga que pagó, gastó o recibió dinero (ej. 'pagué $200 de maquila').",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gasto", "ingreso"], description: "gasto = salida de dinero; ingreso = entrada" },
        monto: { type: "number", description: "Monto en dólares, positivo" },
        concepto: { type: "string", description: "Descripción corta de qué fue el movimiento" },
        categoria: { type: "string", enum: [...CATEGORIAS], description: "Categoría del gasto; usa 'otros' si ninguna aplica" },
        fecha: { type: "string", description: "Fecha YYYY-MM-DD; omitir si es hoy" },
      },
      required: ["tipo", "monto", "concepto", "categoria"],
    },
  },
  {
    name: "consultar_movimientos",
    description:
      "Lista y suma los pagos/gastos e ingresos registrados en un rango de fechas, opcionalmente filtrado por categoría. Úsala para '¿cuánto he gastado este mes?', '¿qué pagué esta semana?'.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha YYYY-MM-DD inicio del rango" },
        hasta: { type: "string", description: "Fecha YYYY-MM-DD fin del rango" },
        categoria: { type: "string", enum: [...CATEGORIAS] },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "resumen_ventas",
    description:
      "Devuelve el resumen del último reporte de ventas cargado (o del periodo que cubra una fecha dada): unidades, ingreso neto post-comisión VATEX, top productos. Úsala para '¿cómo voy este mes?', '¿qué se vendió?'. Las ventas solo se actualizan cuando se carga un reporte de Adosoft.",
    input_schema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Fecha YYYY-MM-DD dentro del periodo buscado; omitir para el último reporte" },
      },
    },
  },
  {
    name: "stock_critico",
    description:
      "Lista productos con existencia baja (≤5) y movimiento real, del último reporte cargado. Opcionalmente filtra por local (ej. PK, LJ, GL, GT, BS, IBA, HUMZO, CV, HUMMER, QUITO, FRATELLI).",
    input_schema: {
      type: "object",
      properties: {
        local: { type: "string", description: "Código del local; omitir para todos" },
        limite: { type: "number", description: "Máximo de filas a devolver (default 15)" },
      },
    },
  },
  {
    name: "registrar_cheque",
    description:
      "Registra un cheque dictado por texto (no por foto). tipo: por_pagar = cheque que el negocio emitió y debe cubrir; por_cobrar = cheque que le deben al negocio.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["por_cobrar", "por_pagar"] },
        monto: { type: "number" },
        beneficiario: { type: "string", description: "A quién va dirigido / de quién viene" },
        banco: { type: "string" },
        numero: { type: "string", description: "Número del cheque" },
        fecha_cobro: { type: "string", description: "Fecha YYYY-MM-DD en que se cobra o vence" },
        notas: { type: "string" },
      },
      required: ["tipo", "monto", "beneficiario"],
    },
  },
  {
    name: "consultar_cheques",
    description:
      "Lista cheques registrados. Úsala para '¿qué tengo que pagar esta semana?', '¿qué cheques vencen pronto?', '¿cuánto me deben?'.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["por_cobrar", "por_pagar"] },
        estado: { type: "string", enum: ["pendiente", "cobrado", "rebotado", "anulado"], description: "Default: pendiente" },
        dias: { type: "number", description: "Solo cheques cuya fecha de cobro cae dentro de N días desde hoy" },
      },
    },
  },
  {
    name: "actualizar_cheque",
    description:
      "Cambia el estado de un cheque existente (ej. 'el cheque de la maquila ya se cobró', 'rebotó el cheque 1234'). Identifícalo por número, beneficiario o monto usando antes consultar_cheques si hay ambigüedad.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID del cheque (obtenido de consultar_cheques)" },
        estado: { type: "string", enum: ["pendiente", "cobrado", "rebotado", "anulado"] },
      },
      required: ["id", "estado"],
    },
  },
];

// ---------------------------------------------------------------
// Ejecutores
// ---------------------------------------------------------------

type ToolInput = Record<string, unknown>;

function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function money(n: number): string {
  return "$" + n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function executeTool(
  supabase: SupabaseClient,
  name: string,
  input: ToolInput
): Promise<string> {
  try {
    switch (name) {
      case "registrar_movimiento": {
        const tipo = input.tipo === "ingreso" ? "ingreso" : "gasto";
        const monto = Number(input.monto);
        if (!(monto > 0)) return "Error: el monto debe ser un número positivo.";
        const categoria = CATEGORIAS.includes(input.categoria as never)
          ? (input.categoria as string)
          : "otros";
        const fecha = isDate(input.fecha) ? input.fecha : new Date().toISOString().slice(0, 10);
        const { error } = await supabase.from("movimientos").insert({
          tipo,
          monto,
          concepto: String(input.concepto ?? "").slice(0, 300),
          categoria,
          fecha,
          origen: "telegram",
        });
        if (error) return `Error al guardar: ${error.message}`;
        return `Registrado: ${tipo} de ${money(monto)} en "${categoria}" (${input.concepto}), fecha ${fecha}.`;
      }

      case "consultar_movimientos": {
        if (!isDate(input.desde) || !isDate(input.hasta)) {
          return "Error: desde y hasta deben ser fechas YYYY-MM-DD.";
        }
        let q = supabase
          .from("movimientos")
          .select("fecha, tipo, monto, concepto, categoria")
          .gte("fecha", input.desde)
          .lte("fecha", input.hasta)
          .order("fecha", { ascending: false })
          .limit(100);
        if (CATEGORIAS.includes(input.categoria as never)) {
          q = q.eq("categoria", input.categoria as string);
        }
        const { data, error } = await q;
        if (error) return `Error: ${error.message}`;
        if (!data?.length) return "No hay movimientos registrados en ese rango.";
        const gastos = data.filter((m) => m.tipo === "gasto");
        const ingresos = data.filter((m) => m.tipo === "ingreso");
        const totalG = gastos.reduce((s, m) => s + Number(m.monto), 0);
        const totalI = ingresos.reduce((s, m) => s + Number(m.monto), 0);
        const porCat = new Map<string, number>();
        for (const g of gastos) porCat.set(g.categoria, (porCat.get(g.categoria) ?? 0) + Number(g.monto));
        const catLines = [...porCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c, t]) => `  ${c}: ${money(t)}`)
          .join("\n");
        const items = data
          .slice(0, 20)
          .map((m) => `${m.fecha} · ${m.tipo} · ${money(Number(m.monto))} · ${m.categoria} · ${m.concepto}`)
          .join("\n");
        return `Movimientos ${input.desde} a ${input.hasta}:\nTotal gastos: ${money(totalG)} (${gastos.length})\nTotal ingresos: ${money(totalI)} (${ingresos.length})\nGastos por categoría:\n${catLines || "  —"}\nÚltimos:\n${items}`;
      }

      case "resumen_ventas": {
        let q = supabase
          .from("snapshots")
          .select("id, periodo_desde, periodo_hasta, total_unidades, total_neto, num_alertas, num_lineas_venta, created_at")
          .order("periodo_hasta", { ascending: false })
          .limit(1);
        if (isDate(input.fecha)) {
          q = supabase
            .from("snapshots")
            .select("id, periodo_desde, periodo_hasta, total_unidades, total_neto, num_alertas, num_lineas_venta, created_at")
            .lte("periodo_desde", input.fecha)
            .gte("periodo_hasta", input.fecha)
            .order("created_at", { ascending: false })
            .limit(1);
        }
        const { data, error } = await q;
        if (error) return `Error: ${error.message}`;
        const s = data?.[0];
        if (!s) return "No hay ningún reporte de ventas cargado todavía (para ese periodo).";
        const { data: top } = await supabase
          .from("sales_lines")
          .select("codigo, descripcion, cantidad, neto")
          .eq("snapshot_id", s.id)
          .order("neto", { ascending: false })
          .limit(5);
        const topLines = (top ?? [])
          .map((t, i) => `${i + 1}. ${t.descripcion} — ${t.cantidad} u, ${money(Number(t.neto))}`)
          .join("\n");
        return `Reporte del ${s.periodo_desde} al ${s.periodo_hasta} (cargado ${String(s.created_at).slice(0, 10)}):\nUnidades vendidas: ${s.total_unidades}\nIngreso neto (post-comisión VATEX): ${money(Number(s.total_neto))}\nAlertas de stock: ${s.num_alertas}\nTop productos por neto:\n${topLines || "—"}`;
      }

      case "stock_critico": {
        const { data: snap } = await supabase
          .from("snapshots")
          .select("id, periodo_desde, periodo_hasta")
          .order("periodo_hasta", { ascending: false })
          .limit(1);
        const s = snap?.[0];
        if (!s) return "No hay ningún reporte cargado todavía.";
        const limite = Math.min(Math.max(Number(input.limite) || 15, 1), 40);
        let q = supabase
          .from("stock_lines")
          .select("codigo, descripcion, local, venta, exist")
          .eq("snapshot_id", s.id)
          .eq("es_alerta", true)
          .order("exist", { ascending: true })
          .limit(limite);
        if (typeof input.local === "string" && input.local.trim()) {
          q = q.eq("local", input.local.trim().toUpperCase());
        }
        const { data, error } = await q;
        if (error) return `Error: ${error.message}`;
        if (!data?.length) return "Sin alertas de stock para ese filtro en el último reporte.";
        const lines = data
          .map((x) => `${x.local} · ${x.descripcion} · exist: ${x.exist} · vendido: ${x.venta < 0 ? -x.venta : 0}`)
          .join("\n");
        return `Alertas de stock (reporte ${s.periodo_desde} a ${s.periodo_hasta}, ${data.length} mostradas):\n${lines}`;
      }

      case "registrar_cheque": {
        const tipo = input.tipo === "por_cobrar" ? "por_cobrar" : "por_pagar";
        const monto = Number(input.monto);
        if (!(monto > 0)) return "Error: el monto debe ser un número positivo.";
        const { error } = await supabase.from("cheques").insert({
          tipo,
          monto,
          beneficiario: String(input.beneficiario ?? "").slice(0, 200),
          banco: String(input.banco ?? "").slice(0, 100),
          numero: String(input.numero ?? "").slice(0, 50),
          fecha_cobro: isDate(input.fecha_cobro) ? input.fecha_cobro : null,
          notas: String(input.notas ?? "").slice(0, 500),
        });
        if (error) return `Error al guardar: ${error.message}`;
        return `Cheque ${tipo === "por_pagar" ? "por pagar" : "por cobrar"} registrado: ${money(monto)} a ${input.beneficiario}${isDate(input.fecha_cobro) ? `, se cobra el ${input.fecha_cobro}` : ""}.`;
      }

      case "consultar_cheques": {
        const estado = ["pendiente", "cobrado", "rebotado", "anulado"].includes(String(input.estado))
          ? String(input.estado)
          : "pendiente";
        let q = supabase
          .from("cheques")
          .select("id, tipo, monto, beneficiario, banco, numero, fecha_cobro, estado")
          .eq("estado", estado)
          .order("fecha_cobro", { ascending: true, nullsFirst: false })
          .limit(30);
        if (input.tipo === "por_cobrar" || input.tipo === "por_pagar") {
          q = q.eq("tipo", input.tipo);
        }
        if (Number(input.dias) > 0) {
          const hasta = new Date(Date.now() + Number(input.dias) * 86400000).toISOString().slice(0, 10);
          q = q.lte("fecha_cobro", hasta);
        }
        const { data, error } = await q;
        if (error) return `Error: ${error.message}`;
        if (!data?.length) return `No hay cheques en estado "${estado}" con ese filtro.`;
        const totalPagar = data.filter((c) => c.tipo === "por_pagar").reduce((s, c) => s + Number(c.monto), 0);
        const totalCobrar = data.filter((c) => c.tipo === "por_cobrar").reduce((s, c) => s + Number(c.monto), 0);
        const lines = data
          .map(
            (c) =>
              `[id:${String(c.id).slice(0, 8)}] ${c.tipo === "por_pagar" ? "PAGAR" : "COBRAR"} ${money(Number(c.monto))} · ${c.beneficiario}${c.numero ? ` · #${c.numero}` : ""}${c.fecha_cobro ? ` · cobro: ${c.fecha_cobro}` : ""}`
          )
          .join("\n");
        return `Cheques (${estado}): total por pagar ${money(totalPagar)}, total por cobrar ${money(totalCobrar)}\n${lines}\n(Para actualizar_cheque usa el id entre corchetes; es un prefijo válido.)`;
      }

      case "actualizar_cheque": {
        const estado = String(input.estado);
        if (!["pendiente", "cobrado", "rebotado", "anulado"].includes(estado)) {
          return "Error: estado inválido.";
        }
        const idPrefix = String(input.id ?? "").trim();
        if (idPrefix.length < 6) return "Error: id de cheque inválido.";
        // acepta prefijo de id (los listados muestran los primeros 8 caracteres)
        const { data: matches, error: findErr } = await supabase
          .from("cheques")
          .select("id, monto, beneficiario")
          .like("id", `${idPrefix}%`)
          .limit(2);
        if (findErr) return `Error: ${findErr.message}`;
        if (!matches?.length) return "No encontré un cheque con ese id.";
        if (matches.length > 1) return "El id es ambiguo; usa más caracteres.";
        const { error } = await supabase.from("cheques").update({ estado }).eq("id", matches[0].id);
        if (error) return `Error: ${error.message}`;
        return `Cheque de ${money(Number(matches[0].monto))} a ${matches[0].beneficiario} marcado como "${estado}".`;
      }

      default:
        return `Herramienta desconocida: ${name}`;
    }
  } catch (e) {
    return `Error interno ejecutando ${name}: ${e instanceof Error ? e.message : e}`;
  }
}
