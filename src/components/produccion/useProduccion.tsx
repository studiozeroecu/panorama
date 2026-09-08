"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TALLA_ORDER } from "@/lib/produccion/types";
import type {
  Prenda,
  Proveedor,
  CostoFijo,
  Catalogo,
  PedidoTela,
  Corte,
  Maquila,
  LoteEstampado,
  StockOnline,
  VentaOnline,
  EnvioLocal,
  EstadoPedido,
  EstadoColorMaquila,
} from "@/lib/produccion/types";

// ── Formas crudas que devuelve PostgREST con los embeds de la fase 7 ──
// Los `numeric` de Postgres llegan como string, por eso se pasan por Number().

interface FilaTalla {
  talla: string;
  unidades: number;
}

/**
 * Aplana las filas de talla al Record<talla, unidades> que ya usaban los
 * componentes. Inserta en orden XS→XXL a propósito: fn_repartir_por_talla
 * reparte en ese mismo orden y hay código que recorre el objeto tal cual.
 */
function aTallas(filas: FilaTalla[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const orden = [...(filas ?? [])].sort(
    (a, b) => (TALLA_ORDER.indexOf(a.talla) + 1 || 99) - (TALLA_ORDER.indexOf(b.talla) + 1 || 99)
  );
  for (const f of orden) out[f.talla] = Number(f.unidades);
  return out;
}

interface FilaPedido {
  id: string;
  nombre_tela: string;
  fecha_pedido: string;
  unidad: "metros" | "kilos";
  rendimiento: number | null;
  ancho_pedido: number | null;
  ancho_real: number | null;
  proveedor_id: string | null;
  prenda_id: string | null;
  total_metros: number | string;
  valor_metro: number | string;
  total_pagar: number | string;
  estado: EstadoPedido;
  fecha_entrega_real: string | null;
  colores:
    | { id: string; color: string; metros: number | string; kilos: number | string | null; orden: number }[]
    | null;
}

interface FilaCorte {
  id: string;
  pedido_id: string;
  fecha: string;
  maquiladora_id: string | null;
  total_unidades: number | string;
  metros_consumidos: number | string | null;
  observaciones: string;
  colores:
    | {
        id: string;
        pedido_color_id: string | null;
        color: string;
        unidades: number | string;
        metros_usados: number | string | null;
        orden: number;
        tallas: FilaTalla[] | null;
      }[]
    | null;
}

interface FilaMaquila {
  id: string;
  corte_id: string;
  maquiladora_id: string | null;
  costo_unitario: number | string;
  total_unidades: number | string;
  colores:
    | {
        id: string;
        corte_color_id: string;
        estado: EstadoColorMaquila;
        fecha_envio: string | null;
        fecha_entrega: string | null;
        procesado: boolean;
        corte_color: { color: string; unidades: number; orden: number; tallas: FilaTalla[] | null } | null;
      }[]
    | null;
}

export interface ProdData {
  prendas: Prenda[];
  proveedores: Proveedor[];
  costosFijos: CostoFijo[];
  maquiladoras: Catalogo[];
  talleres: Catalogo[];
  pedidos: PedidoTela[];
  cortes: Corte[];
  maquilas: Maquila[];
  lotesEstampado: LoteEstampado[];
  stock: StockOnline[];
  ventasOnline: VentaOnline[];
  enviosLocales: EnvioLocal[];
  productosVatex: { codigo: string; descripcion: string }[];
}

const VACIO: ProdData = {
  prendas: [],
  proveedores: [],
  costosFijos: [],
  maquiladoras: [],
  talleres: [],
  pedidos: [],
  cortes: [],
  maquilas: [],
  lotesEstampado: [],
  stock: [],
  ventasOnline: [],
  enviosLocales: [],
  productosVatex: [],
};

interface Ctx {
  data: ProdData;
  cargando: boolean;
  error: string | null;
  supabase: SupabaseClient;
  reload: () => Promise<void>;
  toast: (msg: string, tipo?: "ok" | "error") => void;
}

const ProdContext = createContext<Ctx | null>(null);

export function useProd(): Ctx {
  const ctx = useContext(ProdContext);
  if (!ctx) throw new Error("useProd fuera de ProdProvider");
  return ctx;
}

export function ProdProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<ProdData>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; tipo: "ok" | "error" } | null>(null);

  const reload = useCallback(async () => {
    const sel = (tabla: string, orden: string) =>
      supabase.from(tabla).select("*").order(orden, { ascending: false });
    const [
      prendas, proveedores, costosFijos, maquiladoras, talleres,
      pedidos, cortes, maquilas, lotesEstampado, stock, ventasOnline, enviosLocales, productos,
    ] = await Promise.all([
      supabase.from("prod_prendas").select("*").order("nombre"),
      supabase.from("prod_proveedores").select("*").order("empresa"),
      supabase.from("prod_costos_fijos").select("*").order("nombre"),
      supabase.from("prod_maquiladoras").select("*").order("nombre"),
      supabase.from("prod_talleres").select("*").order("nombre"),
      // Fase 7: los colores llegan anidados desde sus tablas, no del jsonb.
      // Las columnas jsonb siguen existiendo como respaldo pero ya no se leen.
      supabase
        .from("prod_pedidos_tela")
        .select(
          `id, nombre_tela, fecha_pedido, unidad, rendimiento, ancho_pedido, ancho_real,
           proveedor_id, prenda_id, total_metros, valor_metro, total_pagar, estado,
           fecha_entrega_real,
           colores:prod_pedido_colores (id, color, metros, kilos, orden)`
        )
        .order("fecha_pedido", { ascending: false }),
      supabase
        .from("prod_cortes")
        .select(
          `id, pedido_id, fecha, maquiladora_id, total_unidades, metros_consumidos,
           observaciones,
           colores:prod_corte_colores (
             id, pedido_color_id, color, unidades, metros_usados, orden,
             tallas:prod_corte_color_tallas (talla, unidades)
           )`
        )
        .order("fecha", { ascending: false }),
      supabase
        .from("prod_maquilas")
        .select(
          `id, corte_id, maquiladora_id, costo_unitario, total_unidades,
           colores:prod_maquila_colores (
             id, corte_color_id, estado, fecha_envio, fecha_entrega, procesado,
             corte_color:prod_corte_colores (
               color, unidades, orden,
               tallas:prod_corte_color_tallas (talla, unidades)
             )
           )`
        )
        .order("created_at", { ascending: false }),
      sel("prod_lotes_estampado", "created_at"),
      supabase.from("prod_stock_online").select("*").order("prenda_nombre"),
      sel("prod_ventas_online", "fecha"),
      sel("prod_envios_locales", "fecha"),
      supabase.from("products").select("codigo, descripcion").order("codigo"),
    ]);

    const failed = [prendas, proveedores, costosFijos, maquiladoras, talleres, pedidos, cortes,
      maquilas, lotesEstampado, stock, ventasOnline, enviosLocales].find((r) => r.error);
    if (failed?.error) {
      setError(
        failed.error.message.includes("does not exist") ||
        failed.error.message.includes("schema cache") ||
        failed.error.message.includes("relationship")
          ? "Faltan tablas de producción. Ejecuta supabase/schema_fase3.sql y supabase/schema_fase7_colores.sql en el SQL Editor de Supabase."
          : failed.error.message
      );
      setCargando(false);
      return;
    }

    // El cliente de Supabase no está tipado contra el esquema, así que infiere la
    // forma de los embeds a partir del texto del select — y da array donde la
    // relación es muchos-a-uno. Afirmamos la forma real.
    const pedidosMap: PedidoTela[] = ((pedidos.data ?? []) as unknown as FilaPedido[]).map((p) => ({
      id: p.id,
      nombre_tela: p.nombre_tela,
      fecha_pedido: p.fecha_pedido,
      unidad: p.unidad,
      rendimiento: p.rendimiento,
      ancho_pedido: p.ancho_pedido,
      ancho_real: p.ancho_real,
      proveedor_id: p.proveedor_id,
      prenda_id: p.prenda_id,
      total_metros: Number(p.total_metros),
      valor_metro: Number(p.valor_metro),
      total_pagar: Number(p.total_pagar),
      estado: p.estado,
      fecha_entrega_real: p.fecha_entrega_real,
      colores: [...(p.colores ?? [])]
        .sort((a, b) => a.orden - b.orden)
        .map((c) => ({
          id: c.id,
          color: c.color,
          metros: Number(c.metros),
          kilos: c.kilos == null ? null : Number(c.kilos),
          orden: c.orden,
        })),
    }));

    const cortesMap: Corte[] = ((cortes.data ?? []) as unknown as FilaCorte[]).map((k) => ({
      id: k.id,
      pedido_id: k.pedido_id,
      fecha: k.fecha,
      maquiladora_id: k.maquiladora_id,
      total_unidades: Number(k.total_unidades),
      metros_consumidos: k.metros_consumidos == null ? null : Number(k.metros_consumidos),
      observaciones: k.observaciones,
      colores: [...(k.colores ?? [])]
        .sort((a, b) => a.orden - b.orden)
        .map((c) => ({
          id: c.id,
          pedido_color_id: c.pedido_color_id,
          color: c.color,
          unidades: Number(c.unidades),
          metros_usados: c.metros_usados == null ? null : Number(c.metros_usados),
          orden: c.orden,
          tallas: aTallas(c.tallas),
        })),
    }));

    const maquilasMap: Maquila[] = ((maquilas.data ?? []) as unknown as FilaMaquila[]).map((m) => ({
      id: m.id,
      corte_id: m.corte_id,
      maquiladora_id: m.maquiladora_id,
      costo_unitario: Number(m.costo_unitario),
      total_unidades: Number(m.total_unidades),
      colores: [...(m.colores ?? [])]
        .sort((a, b) => (a.corte_color?.orden ?? 0) - (b.corte_color?.orden ?? 0))
        .map((c) => ({
          id: c.id,
          corte_color_id: c.corte_color_id,
          color: c.corte_color?.color ?? "",
          unidades: Number(c.corte_color?.unidades ?? 0),
          tallas: aTallas(c.corte_color?.tallas),
          estado: c.estado,
          fecha_envio: c.fecha_envio,
          fecha_entrega: c.fecha_entrega,
          procesado: c.procesado,
        })),
    }));

    setData({
      prendas: (prendas.data ?? []) as Prenda[],
      proveedores: (proveedores.data ?? []) as Proveedor[],
      costosFijos: (costosFijos.data ?? []) as CostoFijo[],
      maquiladoras: (maquiladoras.data ?? []) as Catalogo[],
      talleres: (talleres.data ?? []) as Catalogo[],
      pedidos: pedidosMap,
      cortes: cortesMap,
      maquilas: maquilasMap,
      lotesEstampado: (lotesEstampado.data ?? []) as LoteEstampado[],
      stock: (stock.data ?? []) as StockOnline[],
      ventasOnline: (ventasOnline.data ?? []) as VentaOnline[],
      enviosLocales: (enviosLocales.data ?? []) as EnvioLocal[],
      productosVatex: (productos.data ?? []) as { codigo: string; descripcion: string }[],
    });
    setError(null);
    setCargando(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toast = useCallback((msg: string, tipo: "ok" | "error" = "ok") => {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), tipo === "error" ? 5000 : 3000);
  }, []);

  return (
    <ProdContext.Provider value={{ data, cargando, error, supabase, reload, toast }}>
      {children}
      {toastMsg && (
        <div className={`prod-toast ${toastMsg.tipo === "error" ? "prod-toast-error" : ""}`}>
          {toastMsg.tipo === "error" ? "✕ " : "✓ "}
          {toastMsg.msg}
        </div>
      )}
    </ProdContext.Provider>
  );
}
