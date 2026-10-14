import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { hoyEcuador } from "@/lib/fechas";
import { CATEGORIAS_GASTO } from "@/lib/finanzas/categorias";
import { cargarFinanzas, leerTodo } from "@/lib/finanzas/cargar";
import { armarAgenda } from "@/lib/finanzas/agenda";
import { mesDe, quincenaDe, siguiente, sumarDias, type Periodo } from "@/lib/finanzas/periodos";
import { rangoUuidPorPrefijo } from "@/lib/finanzas/ids";
import { sumar } from "@/lib/finanzas/formato";
import { textoAgenda } from "@/lib/finanzas/textos";

/**
 * Herramientas que Claude puede invocar. La IA nunca toca la base
 * directamente: solo elige herramienta + parámetros; el backend valida
 * y ejecuta cada una. Cualquier parámetro inválido se rechaza aquí.
 */

/** Lista única de Finanzas ("personal" como categoría ahora es "sueldos"). */
export const CATEGORIAS = CATEGORIAS_GASTO;

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
        categoria: { type: "string", enum: [...CATEGORIAS], description: "Categoría del gasto; usa 'otros' si ninguna aplica. Sueldos de empleados = 'sueldos'" },
        ambito: {
          type: "string",
          enum: ["empresa", "personal"],
          description: "empresa (default) = gasto del negocio; personal = gasto personal del dueño, no entra a la rentabilidad",
        },
        fecha: { type: "string", description: "Fecha YYYY-MM-DD; omitir si es hoy" },
      },
      required: ["tipo", "monto", "concepto", "categoria"],
    },
  },
  {
    name: "consultar_movimientos",
    description:
      "Lista y suma los pagos/gastos e ingresos registrados en un rango de fechas, opcionalmente filtrado por categoría. Por defecto SOLO cuenta lo de la empresa; lo personal solo si el usuario lo pide (incluir_personal). Úsala para '¿cuánto he gastado este mes?', '¿qué pagué esta semana?'.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha YYYY-MM-DD inicio del rango" },
        hasta: { type: "string", description: "Fecha YYYY-MM-DD fin del rango" },
        categoria: { type: "string", enum: [...CATEGORIAS] },
        incluir_personal: { type: "boolean", description: "true solo si el usuario pide incluir gastos personales" },
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
        categoria: { type: "string", enum: [...CATEGORIAS], description: "Solo por_pagar: categoría del gasto cuando se pague" },
        ambito: { type: "string", enum: ["empresa", "personal"], description: "Solo por_pagar; default empresa" },
      },
      required: ["tipo", "monto", "beneficiario"],
    },
  },
  {
    name: "consultar_cheques",
    description:
      "Lista cheques y pagos programados registrados (con su id corto). Úsala para '¿qué cheques vencen pronto?', '¿cuánto me deben en cheques?' y para encontrar el id antes de actualizar_cheque. Para '¿qué tengo que pagar esta semana/quincena?' usa flujo_semana.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["por_cobrar", "por_pagar"] },
        estado: { type: "string", enum: ["pendiente", "pagado", "cobrado", "rebotado", "anulado"], description: "Default: pendiente" },
        dias: { type: "number", description: "Solo cheques cuya fecha de cobro cae dentro de N días desde hoy" },
      },
    },
  },
  {
    name: "actualizar_cheque",
    description:
      "Cambia el estado de un cheque o pago programado (ej. 'ya pagué el cheque 902', 'rebotó el cheque 1234'). Si es un pago POR PAGAR y se marca pagado (o 'cobrado'), registra el gasto automáticamente. Identifícalo antes con consultar_cheques y usa su id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID del cheque (el id corto de consultar_cheques sirve)" },
        estado: { type: "string", enum: ["pendiente", "pagado", "cobrado", "rebotado", "anulado"] },
        fecha: { type: "string", description: "Solo al pagar: fecha YYYY-MM-DD del pago; omitir si es hoy" },
      },
      required: ["id", "estado"],
    },
  },
  {
    name: "registrar_estampado_dtf",
    description:
      "Prepara un lote de estampado DTF para confirmación: calcula metros de film (claros y oscuros se redondean hacia arriba POR SEPARADO) y el costo. Úsala cuando el usuario dicte un lote: 'registrar estampado camiseta básica, modelo El Cajas, 20 negras oscuras y 20 blancas claras, 4 por metro a $8'. NO guarda directo: el usuario confirma con un botón que aparece después de tu respuesta.",
    input_schema: {
      type: "object",
      properties: {
        prenda: { type: "string", description: "Prenda del lote (ej. camiseta básica)" },
        modelo: { type: "string", description: "Nombre del diseño/modelo (ej. El Cajas)" },
        unidades_claras: { type: "number", description: "Unidades en prendas CLARAS (tinta para claros)" },
        unidades_oscuras: { type: "number", description: "Unidades en prendas OSCURAS" },
        por_metro: { type: "number", description: "Cuántos estampados entran por metro" },
        precio_metro: { type: "number", description: "Precio por metro del proveedor en dólares" },
        tecnica: { type: "string", enum: ["DTF", "Serigrafía", "Sublimación"], description: "Default DTF" },
        fecha: { type: "string", description: "YYYY-MM-DD; omitir si es hoy" },
      },
      required: ["prenda", "unidades_claras", "unidades_oscuras", "por_metro", "precio_metro"],
    },
  },
  {
    name: "flujo_semana",
    description:
      "Qué hay que pagar (y cobrar) por quincena, por mes o en los próximos N días: pagos programados con fecha, vencidos, cheques rebotados aparte, posibles (flexibles, no se suman) y deudas sin fecha (no se suman al periodo). Úsala para '¿qué tengo que pagar esta semana / quincena / mes?'.",
    input_schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["quincena", "proxima_quincena", "mes", "proximo_mes"],
          description: "Quincena = 1-15 o 16-fin de mes. Si se da, manda sobre 'dias'.",
        },
        dias: { type: "number", description: "Horizonte en días desde hoy (default 7) si no se da periodo" },
      },
    },
  },
  {
    name: "margen_producto",
    description:
      "Costo, precios y ganancia real de una prenda ('¿cuánto me deja la camiseta?'). Devuelve costo total desglosado, PVP VATEX, ingreso neto post-comisión y ganancia por unidad.",
    input_schema: {
      type: "object",
      properties: {
        producto: { type: "string", description: "Nombre de la prenda (ej. camiseta, hoddie, polo mujer)" },
      },
      required: ["producto"],
    },
  },
  {
    name: "stock_telas",
    description:
      "Inventario de tela: pedidos de tela entregados con su saldo disponible (metros comprados menos metros consumidos en cortes). Úsala para '¿cuánta tela me queda?', '¿qué telas tengo?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ordenes_en_proceso",
    description:
      "Estado de la producción en curso: pedidos de tela pendientes/en camino (con atraso si lo hay), lotes en maquila con su avance, y lotes en taller de estampado. Úsala para '¿qué tengo en maquila?', '¿cómo va la producción?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "stock_online_produccion",
    description:
      "Stock online de producción propia (prenda/color/estampado/talla) y ventas online recientes. Distinto del stock de los locales VATEX (para eso usa stock_critico).",
    input_schema: { type: "object", properties: {} },
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
        const ambito = input.ambito === "personal" ? "personal" : "empresa";
        const fecha = isDate(input.fecha) ? input.fecha : hoyEcuador();
        const { error } = await supabase.from("movimientos").insert({
          tipo,
          monto,
          concepto: String(input.concepto ?? "").slice(0, 300),
          categoria,
          ambito,
          fecha,
          origen: "telegram",
        });
        if (error) return `Error al guardar: ${error.message}`;
        return `Registrado: ${tipo} de ${money(monto)} en "${categoria}" (${input.concepto}), ámbito ${ambito}, fecha ${fecha}.`;
      }

      case "consultar_movimientos": {
        if (!isDate(input.desde) || !isDate(input.hasta)) {
          return "Error: desde y hasta deben ser fechas YYYY-MM-DD.";
        }
        const desde = input.desde;
        const hasta = input.hasta;
        const incluirPersonal = input.incluir_personal === true;
        const categoria = CATEGORIAS.includes(input.categoria as never) ? (input.categoria as string) : null;
        type Fila = { fecha: string; tipo: string; monto: number; concepto: string; categoria: string; ambito: string; cuenta_en_rentabilidad: boolean };
        // por páginas: los totales cuentan TODAS las filas, no solo las primeras
        const data = await leerTodo<Fila>("los movimientos", (a, b) => {
          let q = supabase
            .from("v_movimientos")
            .select("id, fecha, tipo, monto, concepto, categoria, ambito, cuenta_en_rentabilidad")
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("fecha", { ascending: false })
            .order("id")
            .range(a, b);
          if (!incluirPersonal) q = q.eq("ambito", "empresa");
          if (categoria) q = q.eq("categoria", categoria);
          return q;
        });
        const alcance = incluirPersonal ? "empresa + personal" : "solo empresa";
        if (!data.length) return `No hay movimientos registrados en ese rango (${alcance}).`;
        const gastos = data.filter((m) => m.tipo === "gasto");
        const ingresos = data.filter((m) => m.tipo === "ingreso");
        const totalG = sumar(gastos.map((m) => Number(m.monto)));
        const totalI = sumar(ingresos.map((m) => Number(m.monto)));
        const totalRent = sumar(gastos.filter((m) => m.cuenta_en_rentabilidad).map((m) => Number(m.monto)));
        const porCat = new Map<string, number[]>();
        for (const g of gastos) porCat.set(g.categoria, [...(porCat.get(g.categoria) ?? []), Number(g.monto)]);
        const catLines = [...porCat.entries()]
          .map(([c, ms]) => [c, sumar(ms)] as const)
          .sort((a, b) => b[1] - a[1])
          .map(([c, t]) => `  ${c}: ${money(t)}`)
          .join("\n");
        const items = data
          .slice(0, 20)
          .map((m) => `${m.fecha} · ${m.tipo} · ${money(Number(m.monto))} · ${m.categoria}${m.ambito === "personal" ? " · personal" : ""} · ${m.concepto}`)
          .join("\n");
        return (
          `Movimientos ${desde} a ${hasta} (${alcance}):\n` +
          `Total gastos: ${money(totalG)} (${gastos.length}) — de ellos cuentan para rentabilidad ${money(totalRent)}\n` +
          `Total ingresos: ${money(totalI)} (${ingresos.length})\n` +
          `Gastos por categoría:\n${catLines || "  —"}\n` +
          `Últimos${data.length > 20 ? ` 20 de ${data.length}` : ""}:\n${items}`
        );
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
          // categoría y ámbito solo aplican a lo que YO pago (se usan al registrar el gasto)
          ...(tipo === "por_pagar"
            ? {
                categoria: CATEGORIAS.includes(input.categoria as never) ? (input.categoria as string) : "otros",
                ambito: input.ambito === "personal" ? "personal" : "empresa",
              }
            : {}),
        });
        if (error) return `Error al guardar: ${error.message}`;
        return `Cheque ${tipo === "por_pagar" ? "por pagar" : "por cobrar"} registrado: ${money(monto)} a ${input.beneficiario}${isDate(input.fecha_cobro) ? `, se cobra el ${input.fecha_cobro}` : ""}.`;
      }

      case "consultar_cheques": {
        const estados = ["pendiente", "pagado", "cobrado", "rebotado", "anulado"];
        const estado = estados.includes(String(input.estado)) ? String(input.estado) : "pendiente";
        // "pagado" y "cobrado" son lo mismo para un pago hecho (el código viejo usaba "cobrado")
        const estadosBuscar = estado === "pagado" || estado === "cobrado" ? ["pagado", "cobrado"] : [estado];
        const tipoFiltro = input.tipo === "por_cobrar" || input.tipo === "por_pagar" ? input.tipo : null;
        const hastaDias = Number(input.dias) > 0 ? sumarDias(hoyEcuador(), Math.round(Number(input.dias))) : null;
        type Fila = {
          id: string; tipo: string; monto: number; beneficiario: string; numero: string; fecha_cobro: string | null;
          estado: string; deuda_proveedor: string | null; ambito_efectivo: string; reprogramado: boolean; fecha_original: string | null;
        };
        // por páginas: los totales cuentan TODOS los cheques del filtro
        const data = await leerTodo<Fila>("los cheques", (a, b) => {
          let q = supabase
            .from("v_cheques")
            .select("id, tipo, monto, beneficiario, numero, fecha_cobro, estado, deuda_proveedor, ambito_efectivo, reprogramado, fecha_original")
            .in("estado", estadosBuscar)
            .order("fecha_cobro", { ascending: true, nullsFirst: false })
            .order("id")
            .range(a, b);
          if (tipoFiltro) q = q.eq("tipo", tipoFiltro);
          if (hastaDias) q = q.lte("fecha_cobro", hastaDias);
          return q;
        });
        if (!data.length) return `No hay cheques en estado "${estado}" con ese filtro.`;
        const totalPagar = sumar(data.filter((c) => c.tipo === "por_pagar").map((c) => Number(c.monto)));
        const totalCobrar = sumar(data.filter((c) => c.tipo === "por_cobrar").map((c) => Number(c.monto)));
        const lines = data
          .slice(0, 30)
          .map(
            (c) =>
              `[id:${String(c.id).slice(0, 8)}] ${c.tipo === "por_pagar" ? "PAGAR" : "COBRAR"} ${money(Number(c.monto))} · ${c.deuda_proveedor || c.beneficiario}${c.numero ? ` · #${c.numero}` : ""}${c.fecha_cobro ? ` · fecha: ${c.fecha_cobro}` : ""}${c.reprogramado ? ` (antes ${c.fecha_original})` : ""}${c.ambito_efectivo === "personal" ? " · personal" : ""}`
          )
          .join("\n");
        return (
          `Cheques (${estado}): total por pagar ${money(totalPagar)}, total por cobrar ${money(totalCobrar)} (${data.length})\n${lines}` +
          `${data.length > 30 ? `\n… y ${data.length - 30} más` : ""}\n(Para actualizar_cheque usa el id entre corchetes; es un prefijo válido.)`
        );
      }

      case "actualizar_cheque": {
        const estado = String(input.estado);
        if (!["pendiente", "pagado", "cobrado", "rebotado", "anulado"].includes(estado)) {
          return "Error: estado inválido.";
        }
        // acepta prefijo de id (los listados muestran los primeros 8 caracteres).
        // La base no permite "like" sobre un uuid: se busca por rango.
        const rango = rangoUuidPorPrefijo(String(input.id ?? ""));
        if (!rango) return "Error: id de cheque inválido (usa el id entre corchetes de consultar_cheques).";
        const { data: matches, error: findErr } = await supabase
          .from("v_cheques")
          .select("id, tipo, monto, beneficiario, deuda_proveedor, estado")
          .gte("id", rango.desde)
          .lte("id", rango.hasta)
          .limit(2);
        if (findErr) return `Error: ${findErr.message}`;
        if (!matches?.length) return "No encontré un cheque con ese id.";
        if (matches.length > 1) return "El id es ambiguo; usa más caracteres.";
        const c = matches[0];
        const quien = c.deuda_proveedor || c.beneficiario;
        const yaPagado = c.estado === "pagado" || (c.tipo === "por_pagar" && c.estado === "cobrado");

        // Pagar algo que YO debo: todo o nada, con su gasto (función de la base)
        if (c.tipo === "por_pagar" && (estado === "pagado" || estado === "cobrado")) {
          const fecha = isDate(input.fecha) ? input.fecha : hoyEcuador();
          const { data: r, error } = await supabase.rpc("pagar_cuota", {
            p_cheque_id: c.id,
            p_fecha: fecha,
            p_origen: "telegram",
          });
          if (error) return `No se pudo marcar como pagado: ${error.message}`;
          if ((r as { resultado?: string } | null)?.resultado === "ya_pagado") {
            return `El pago de ${money(Number(c.monto))} a ${quien} ya estaba pagado; no registré nada nuevo.`;
          }
          return `Pagado: ${money(Number(c.monto))} a ${quien} el ${fecha}. Quedó registrado como gasto.`;
        }
        if (yaPagado) {
          return `Ese pago a ${quien} ya está pagado y tiene su gasto registrado; no lo cambio desde aquí (deshacer pagos llegará más adelante).`;
        }
        // rebotado / anulado / pendiente, o cobrar un cheque que me deben
        const { error } = await supabase.from("cheques").update({ estado }).eq("id", c.id);
        if (error) return `No se pudo cambiar el estado: ${error.message}`;
        return `Cheque de ${money(Number(c.monto))} (${quien}) marcado como "${estado}".${
          estado === "rebotado" ? " Queda en la sección roja hasta que se reprograme o se cambie el cheque." : ""
        }`;
      }

      case "registrar_estampado_dtf": {
        const { calcularLoteDtf } = await import("@/lib/dtf/calculo");
        const claras = Math.max(0, Math.round(Number(input.unidades_claras) || 0));
        const oscuras = Math.max(0, Math.round(Number(input.unidades_oscuras) || 0));
        const porMetro = Math.round(Number(input.por_metro) || 0);
        const precioMetro = Number(input.precio_metro) || 0;
        if (claras + oscuras <= 0) return "Error: indica cuántas unidades claras y/u oscuras.";
        if (porMetro <= 0) return "Error: indica cuántos estampados entran por metro.";
        if (!(precioMetro > 0)) return "Error: indica el precio por metro.";
        const calc = calcularLoteDtf({
          unidades_claras: claras,
          unidades_oscuras: oscuras,
          por_metro: porMetro,
          precio_metro: precioMetro,
        });
        const fecha = isDate(input.fecha) ? input.fecha : new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
        const payload = {
          prenda: String(input.prenda ?? "").slice(0, 120),
          modelo: String(input.modelo ?? "").slice(0, 120),
          tecnica: ["DTF", "Serigrafía", "Sublimación"].includes(String(input.tecnica)) ? String(input.tecnica) : "DTF",
          fecha,
          unidades_claras: claras,
          unidades_oscuras: oscuras,
          por_metro: porMetro,
          precio_metro: precioMetro,
          ...calc,
        };
        const { error } = await supabase.from("bot_pending_actions").insert({
          chat_id: "pendiente", // el webhook lo reasigna al chat correcto
          kind: "dtf_lote",
          payload,
        });
        if (error) return `Error interno: ${error.message}`;
        return (
          `Lote listo para confirmar (el usuario verá botones):\n` +
          `${payload.prenda}${payload.modelo ? ` · ${payload.modelo}` : ""} (${payload.tecnica})\n` +
          `${claras} claras → ${calc.metros_claros} m · ${oscuras} oscuras → ${calc.metros_oscuros} m\n` +
          `Total: ${calc.metros} m × ${money(precioMetro)} = ${money(calc.valor_total)} (${money(calc.valor_unitario)}/unidad)`
        );
      }

      case "flujo_semana": {
        // Misma lógica que la web: armarAgenda (src/lib/finanzas/agenda.ts)
        const hoy = hoyEcuador();
        let periodo: Periodo;
        if (input.periodo === "quincena") periodo = quincenaDe(hoy);
        else if (input.periodo === "proxima_quincena") periodo = siguiente(quincenaDe(hoy));
        else if (input.periodo === "mes") periodo = mesDe(hoy);
        else if (input.periodo === "proximo_mes") periodo = siguiente(mesDe(hoy));
        else {
          const dias = Math.min(Math.max(Math.round(Number(input.dias)) || 7, 1), 60);
          periodo = { tipo: "quincena", desde: hoy, hasta: sumarDias(hoy, dias - 1), etiqueta: `próximos ${dias} días` };
        }
        const datos = await cargarFinanzas(supabase, periodo);
        const texto = textoAgenda(armarAgenda(datos, periodo, { hoy }));

        // Por cobrar (versión simple hasta la fase 5: aún no son dinero seguro)
        const [cxc, chq] = await Promise.all([
          supabase
            .from("cuentas_por_cobrar")
            .select("cliente, concepto, monto, fecha_vencimiento")
            .eq("estado", "pendiente")
            .lte("fecha_vencimiento", periodo.hasta)
            .order("fecha_vencimiento"),
          supabase
            .from("cheques")
            .select("monto, beneficiario, fecha_cobro")
            .eq("tipo", "por_cobrar")
            .eq("estado", "pendiente")
            .lte("fecha_cobro", periodo.hasta)
            .order("fecha_cobro"),
        ]);
        if (cxc.error || chq.error) {
          return `${texto}\n\nPOR COBRAR: no se pudo cargar (${cxc.error?.message ?? chq.error?.message}).`;
        }
        const cobrar = [
          ...(cxc.data ?? []).map((x) => ({
            fecha: x.fecha_vencimiento as string,
            texto: `${x.cliente}${x.concepto ? ` (${x.concepto})` : ""}`,
            monto: Number(x.monto),
          })),
          ...(chq.data ?? []).map((c) => ({ fecha: c.fecha_cobro as string, texto: `cheque de ${c.beneficiario}`, monto: Number(c.monto) })),
        ].sort((a, b) => a.fecha.localeCompare(b.fecha));
        const lineasCobrar = cobrar
          .map((i) => `- ${i.fecha}${i.fecha < hoy ? " (VENCIDO)" : ""}: ${i.texto} — ${money(i.monto)}`)
          .join("\n");
        return (
          `${texto}\n\nPOR COBRAR hasta ${periodo.hasta} (facturas y cheques pendientes; no es dinero hasta que se cobre): ` +
          `${money(sumar(cobrar.map((i) => i.monto)))}${cobrar.length ? `\n${lineasCobrar}` : " — nada"}`
        );
      }

      case "margen_producto": {
        const buscado = String(input.producto ?? "").trim();
        if (!buscado) return "Error: indica el nombre de la prenda.";
        const { data: costos, error } = await supabase.from("costos_prendas").select("*");
        if (error) return `Error: ${error.message}`;
        if (!costos?.length) return "No hay costos cargados todavía (falta ejecutar la migración de Fase 4).";
        const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const b = norm(buscado);
        const candidatos = costos.filter(
          (c) => norm(c.producto).includes(b) || b.includes(norm(c.producto))
        );
        if (!candidatos.length) {
          return `No encontré "${buscado}". Prendas disponibles: ${costos.map((c) => c.producto).join(", ")}.`;
        }
        if (candidatos.length > 1) {
          return `Hay varias que coinciden: ${candidatos.map((c) => c.producto).join(", ")}. ¿Cuál?`;
        }
        const c = candidatos[0];
        const costoTotal = Number(c.costo_total);
        const pvp = c.pvp_vatex != null ? Number(c.pvp_vatex) : null;
        const neto = pvp != null ? pvp * 0.612 : null;
        const ganancia = neto != null ? neto - costoTotal : null;
        const desglose = `tela ${money(Number(c.costo_tela))} + maquila ${money(Number(c.maquila))} + dtf ${money(Number(c.dtf))} + corte ${money(Number(c.corte))} + insumos ${money(Number(c.insumos))} + etiqueta ${money(Number(c.etiqueta))}`;
        const online = c.precio_online != null
          ? `\nOnline: precio ${money(Number(c.precio_online))} → ganancia ${money(Number(c.precio_online) - costoTotal)} (sin comisión VATEX)`
          : "";
        return (
          `${c.producto} (tela ${c.nombre_tela}):\n` +
          `Costo total: ${money(costoTotal)} (${desglose})\n` +
          (pvp != null
            ? `VATEX: PVP ${money(pvp)} → neto ${money(neto!)} (post-comisión 38.8%) → ganancia ${money(ganancia!)} por unidad (margen ${((ganancia! / neto!) * 100).toFixed(1)}%)`
            : "Sin PVP VATEX definido.") +
          online
        );
      }

      case "stock_telas": {
        const [{ data: pedidos, error: e1 }, { data: cortes, error: e2 }] = await Promise.all([
          supabase
            .from("prod_pedidos_tela")
            .select("id, nombre_tela, colores, total_metros, fecha_entrega_real")
            .eq("estado", "entregado")
            .order("fecha_entrega_real", { ascending: false })
            .limit(30),
          supabase.from("prod_cortes").select("pedido_id, metros_consumidos"),
        ]);
        if (e1 || e2) return `Error: ${e1?.message ?? e2?.message}`;
        if (!pedidos?.length) return "No hay pedidos de tela entregados registrados.";
        const consumido = new Map<string, number>();
        for (const c of cortes ?? []) {
          consumido.set(c.pedido_id, (consumido.get(c.pedido_id) ?? 0) + Number(c.metros_consumidos ?? 0));
        }
        const lines = pedidos.map((p) => {
          const saldo = Number(p.total_metros) - (consumido.get(p.id) ?? 0);
          const colores = (p.colores as { color: string; metros: number }[])
            .map((c) => c.color)
            .join(", ");
          return `${p.nombre_tela}: saldo ${saldo.toFixed(1)} m de ${Number(p.total_metros).toFixed(1)} m (colores: ${colores})`;
        });
        return `Inventario de tela (pedidos entregados):\n${lines.join("\n")}\nNota: los cortes sin metros registrados no descuentan saldo.`;
      }

      case "ordenes_en_proceso": {
        const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
        const [pedidosR, maquilasR, cortesR, lotesR] = await Promise.all([
          supabase
            .from("prod_pedidos_tela")
            .select("nombre_tela, estado, fecha_pedido, proveedor_id, total_metros")
            .in("estado", ["pendiente", "en_camino"]),
          supabase.from("prod_maquilas").select("id, corte_id, colores, total_unidades, costo_unitario"),
          supabase.from("prod_cortes").select("id, pedido_id, fecha"),
          supabase
            .from("prod_lotes_estampado")
            .select("prenda_nombre, color, total_unidades, estado, fecha_envio")
            .in("estado", ["pendiente", "en_taller"]),
        ]);
        const secciones: string[] = [];
        if (pedidosR.data?.length) {
          secciones.push(
            "Pedidos de tela pendientes:\n" +
              pedidosR.data
                .map((p) => `- ${p.nombre_tela} (${p.estado === "en_camino" ? "en camino" : "pendiente"}, pedido ${p.fecha_pedido}, ${Number(p.total_metros).toFixed(0)} m)`)
                .join("\n")
          );
        }
        const activas = (maquilasR.data ?? []).filter((m) =>
          (m.colores as { estado: string }[]).some((c) => c.estado !== "entregado")
        );
        if (activas.length) {
          secciones.push(
            "En maquila:\n" +
              activas
                .map((m) => {
                  const cols = m.colores as { color: string; estado: string; unidades: number }[];
                  const entregados = cols.filter((c) => c.estado === "entregado").length;
                  const detalle = cols.map((c) => `${c.color}(${c.estado})`).join(", ");
                  return `- ${m.total_unidades} und., ${entregados}/${cols.length} colores entregados: ${detalle}`;
                })
                .join("\n")
          );
        }
        const porProcesar = (maquilasR.data ?? []).reduce(
          (s, m) =>
            s + (m.colores as { estado: string; procesado?: boolean }[]).filter((c) => c.estado === "entregado" && !c.procesado).length,
          0
        );
        if (porProcesar > 0) secciones.push(`Lotes entregados por maquila esperando destino en Envío: ${porProcesar}.`);
        if (lotesR.data?.length) {
          secciones.push(
            "Estampados:\n" +
              lotesR.data
                .map((l) => `- ${l.prenda_nombre} ${l.color}, ${l.total_unidades} und. (${l.estado === "en_taller" ? `en taller desde ${l.fecha_envio}` : "pendiente de enviar al taller"})`)
                .join("\n")
          );
        }
        void cortesR;
        void hoy;
        return secciones.length ? secciones.join("\n\n") : "No hay órdenes de producción en proceso ahora mismo.";
      }

      case "stock_online_produccion": {
        const [{ data: stock, error: e1 }, { data: ventas }] = await Promise.all([
          supabase
            .from("prod_stock_online")
            .select("prenda_nombre, color, estampado, talla, disponibles, vendidas")
            .gt("disponibles", 0)
            .order("prenda_nombre")
            .limit(60),
          supabase
            .from("prod_ventas_online")
            .select("fecha, prenda_nombre, talla, cantidad, total")
            .order("fecha", { ascending: false })
            .limit(5),
        ]);
        if (e1) return `Error: ${e1.message}`;
        if (!stock?.length) return "No hay stock online de producción disponible.";
        const grupos = new Map<string, { disp: number; tallas: string[] }>();
        for (const s of stock) {
          const k = `${s.prenda_nombre} · ${s.color}${s.estampado ? ` · ${s.estampado}` : ""}`;
          const g = grupos.get(k) ?? { disp: 0, tallas: [] };
          g.disp += s.disponibles;
          g.tallas.push(`${s.talla}:${s.disponibles}`);
          grupos.set(k, g);
        }
        const lines = [...grupos.entries()].map(([k, g]) => `${k}: ${g.disp} und. (${g.tallas.join(" ")})`);
        const ventasTxt = ventas?.length
          ? "\nÚltimas ventas online:\n" +
            ventas.map((v) => `${v.fecha}: ${v.prenda_nombre} ${v.talla} × ${v.cantidad} = ${money(Number(v.total))}`).join("\n")
          : "";
        return `Stock online (producción):\n${lines.join("\n")}${ventasTxt}`;
      }

      default:
        return `Herramienta desconocida: ${name}`;
    }
  } catch (e) {
    return `Error interno ejecutando ${name}: ${e instanceof Error ? e.message : e}`;
  }
}
