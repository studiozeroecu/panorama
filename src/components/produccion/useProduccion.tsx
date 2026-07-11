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
} from "@/lib/produccion/types";

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
      sel("prod_pedidos_tela", "fecha_pedido"),
      sel("prod_cortes", "fecha"),
      sel("prod_maquilas", "created_at"),
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
        failed.error.message.includes("schema cache")
          ? "Faltan las tablas de producción. Ejecuta supabase/schema_fase3.sql en el SQL Editor de Supabase."
          : failed.error.message
      );
      setCargando(false);
      return;
    }

    setData({
      prendas: (prendas.data ?? []) as Prenda[],
      proveedores: (proveedores.data ?? []) as Proveedor[],
      costosFijos: (costosFijos.data ?? []) as CostoFijo[],
      maquiladoras: (maquiladoras.data ?? []) as Catalogo[],
      talleres: (talleres.data ?? []) as Catalogo[],
      pedidos: (pedidos.data ?? []) as PedidoTela[],
      cortes: (cortes.data ?? []) as Corte[],
      maquilas: (maquilas.data ?? []) as Maquila[],
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
