"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Vacio, Tallas } from "@/components/ui";
import LogoutButton from "@/components/LogoutButton";
import { fmtFecha } from "@/lib/fechas";
import { ordenarTallas } from "@/lib/produccion/types";
import RegistrarCorte from "./RegistrarCorte";
import ExtrasCorte from "./ExtrasCorte";
import Jornadas from "./Jornadas";

/**
 * Pantalla de la cortadora — fase 8i, modo SOLO LECTURA.
 *
 * Sigue el patrón de LogisticaApp y no el de producción: su propio cliente de
 * Supabase y su propio `reload()`, sin `useProduccion`. El hook de producción
 * carga trece consultas de las que ella no puede leer ni la mitad, y con sus
 * políticas RLS la mayoría volverían vacías — parecería un fallo sin serlo.
 *
 * Pensada para el teléfono: una sola columna, tarjetas apiladas y nada de
 * tablas, que es lo que usa el resto de la app en escritorio.
 *
 * Lo que todavía NO hace (necesita tablas que no existen — ver
 * docs/plan_cortadora.md, piezas 4, 7 y 8): registrar capas, retazos, horas e
 * insumos, y ver el destino que decidió Mateo.
 */

interface ColorPedido {
  color: string;
  metros: number | string;
  orden: number;
}

interface Pedido {
  id: string;
  nombre_tela: string;
  prenda_id: string | null;
  corrida_base: Record<string, number> | null;
  ancho_real: number | string | null;
  ancho_pedido: number | string | null;
  total_metros: number | string;
  fecha_entrega_real: string | null;
  colores: ColorPedido[] | null;
}

interface TallaCorte {
  talla: string;
  unidades: number;
}

interface ColorCorte {
  color: string;
  unidades: number;
  orden: number;
  tallas: TallaCorte[] | null;
}

interface Corte {
  id: string;
  pedido_id: string;
  fecha: string;
  total_unidades: number;
  metros_consumidos: number | string | null;
  colores: ColorCorte[] | null;
}

interface Prenda {
  id: string;
  nombre: string;
  tallas: string[] | null;
}

export default function CortadoraApp() {
  const supabase = useMemo(() => createClient(), []);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [prendas, setPrendas] = useState<Prenda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [pedR, corR, prendaR] = await Promise.all([
      supabase
        .from("prod_pedidos_tela")
        .select(
          `id, nombre_tela, prenda_id, ancho_real, ancho_pedido, total_metros,
           fecha_entrega_real, corrida_base,
           colores:prod_pedido_colores (color, metros, orden)`
        )
        .eq("estado", "entregado")
        .order("fecha_entrega_real", { ascending: false }),
      supabase
        .from("prod_cortes")
        .select(
          `id, pedido_id, fecha, total_unidades, metros_consumidos,
           colores:prod_corte_colores (
             color, unidades, orden,
             tallas:prod_corte_color_tallas (talla, unidades)
           )`
        )
        .order("fecha", { ascending: false }),
      supabase.from("prod_prendas").select("id, nombre, tallas"),
    ]);

    if (pedR.error) {
      // Con el rol mal configurado esto vuelve vacío en vez de fallar, así que
      // el mensaje distingue el caso "falta el SQL" del resto.
      setError(
        pedR.error.message.includes("does not exist") ||
          pedR.error.message.includes("schema cache")
          ? "Falta ejecutar supabase/schema_fase8i_rol_cortadora.sql."
          : pedR.error.message
      );
      setCargando(false);
      return;
    }

    setPedidos((pedR.data ?? []) as unknown as Pedido[]);
    setCortes((corR.data ?? []) as unknown as Corte[]);
    setPrendas((prendaR.data ?? []) as Prenda[]);
    setError(null);
    setCargando(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Metros ya consumidos por pedido. Los cortes sin metros cuentan 0, igual
   *  que en CorteTab y en fn_registrar_corte. */
  const consumido = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cortes) {
      m.set(c.pedido_id, (m.get(c.pedido_id) ?? 0) + Number(c.metros_consumidos ?? 0));
    }
    return m;
  }, [cortes]);

  const prendaDe = (p: Pedido) => prendas.find((x) => x.id === p.prenda_id)?.nombre;
  const tallasDe = (p: Pedido) => {
    const pr = prendas.find((x) => x.id === p.prenda_id);
    return ordenarTallas(pr?.tallas?.length ? pr.tallas : ["XS", "S", "M", "L", "XL", "XXL"]);
  };

  async function trasRegistrar(mensaje: string) {
    setRegistrando(null);
    setAviso(mensaje);
    setTimeout(() => setAviso(null), 4000);
    await reload();
  }
  const saldoDe = (p: Pedido) => Number(p.total_metros) - (consumido.get(p.id) ?? 0);
  const cortesDe = (p: Pedido) => cortes.filter((c) => c.pedido_id === p.id);

  const pendientes = pedidos.filter((p) => saldoDe(p) > 0.5);
  const listos = pedidos.filter((p) => saldoDe(p) <= 0.5);

  if (cargando) {
    return (
      <main style={ENVOLTORIO}>
        <p style={{ color: "var(--muted)" }}>Cargando…</p>
      </main>
    );
  }

  return (
    <main style={ENVOLTORIO}>
      <header
        style={{
          marginBottom: 18, display: "flex",
          justifyContent: "space-between", alignItems: "flex-start", gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontFamily: "var(--font-grotesk), sans-serif" }}>
            Corte
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13.5 }}>
            Telas entregadas y lo que ya se cortó de cada una.
          </p>
        </div>
        {/* Sin esto no hay forma de salir: el middleware manda a /cortadora
            cualquier ruta, incluida /login. */}
        <LogoutButton />
      </header>

      {error && <div className="error-banner">{error}</div>}
      {aviso && <div className="prod-toast">✓ {aviso}</div>}

      {!pedidos.length && !error && (
        <Vacio
          titulo="No hay telas para cortar"
          hint="Aquí aparecen las telas cuya llegada ya se confirmó."
        />
      )}

      {pendientes.length > 0 && (
        <>
          <h2 style={ROTULO}>Por cortar ({pendientes.length})</h2>
          {pendientes.map((p) => (
            <TarjetaTela
              key={p.id}
              pedido={p}
              prenda={prendaDe(p)}
              saldo={saldoDe(p)}
              cortes={cortesDe(p)}
              pendiente
              supabase={supabase}
              tallas={tallasDe(p)}
              registrando={registrando === p.id}
              onRegistrar={() => setRegistrando(p.id)}
              onCancelar={() => setRegistrando(null)}
              onListo={trasRegistrar}
            />
          ))}
        </>
      )}

      {listos.length > 0 && (
        <>
          <h2 style={ROTULO}>Ya cortadas ({listos.length})</h2>
          {listos.map((p) => (
            <TarjetaTela
              key={p.id}
              pedido={p}
              prenda={prendaDe(p)}
              saldo={saldoDe(p)}
              cortes={cortesDe(p)}
              supabase={supabase}
              tallas={tallasDe(p)}
              registrando={registrando === p.id}
              onRegistrar={() => setRegistrando(p.id)}
              onCancelar={() => setRegistrando(null)}
              onListo={trasRegistrar}
            />
          ))}
        </>
      )}
      <Jornadas supabase={supabase} cortes={cortes} onListo={trasRegistrar} />
    </main>
  );
}

function TarjetaTela({
  pedido,
  prenda,
  saldo,
  cortes,
  pendiente,
  supabase,
  tallas,
  registrando,
  onRegistrar,
  onCancelar,
  onListo,
}: {
  pedido: Pedido;
  prenda: string | undefined;
  saldo: number;
  cortes: Corte[];
  pendiente?: boolean;
  supabase: SupabaseClient;
  tallas: string[];
  registrando: boolean;
  onRegistrar: () => void;
  onCancelar: () => void;
  onListo: (mensaje: string) => void;
}) {
  // El ancho real es el que manda al tender; si no se confirmó, se enseña el del
  // pedido pero DICIENDO que lo es — mismo criterio que el documento de corrida.
  const anchoReal = Number(pedido.ancho_real) > 0 ? Number(pedido.ancho_real) : null;
  const anchoPed = Number(pedido.ancho_pedido) > 0 ? Number(pedido.ancho_pedido) : null;

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 15,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>{pedido.nombre_tela}</h3>
        <Badge color={pendiente ? "verde" : "gris"}>
          {pendiente ? `${saldo.toFixed(1)} m` : "sin saldo"}
        </Badge>
      </div>

      <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
        {prenda ?? "Sin prenda asignada"}
        {pedido.fecha_entrega_real && ` · llegó ${fmtFecha(pedido.fecha_entrega_real)}`}
      </p>

      <p style={{ margin: "7px 0 0", fontSize: 14 }}>
        Ancho{" "}
        {anchoReal != null ? (
          <b>{anchoReal} cm</b>
        ) : anchoPed != null ? (
          <>
            <b>{anchoPed} cm</b>
            <span style={{ color: "var(--warn)" }}> (del pedido, sin confirmar)</span>
          </>
        ) : (
          <span style={{ color: "var(--warn)" }}>sin registrar</span>
        )}
        {" · "}
        {Number(pedido.total_metros).toFixed(1)} m comprados
      </p>

      {pedido.corrida_base && Object.keys(pedido.corrida_base).length > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 14 }}>
          Corrida por capa:{" "}
          {Object.entries(pedido.corrida_base)
            .map(([t, n]) => `${t}:${n}`)
            .join("  ")}
        </p>
      )}

      {!!pedido.colores?.length && (
        <div style={{ marginTop: 8 }}>
          {[...pedido.colores]
            .sort((a, b) => a.orden - b.orden)
            .map((c) => (
              <Badge key={c.color}>
                {c.color}: {Number(c.metros).toFixed(1)} m
              </Badge>
            ))}
        </div>
      )}

      {pendiente && !registrando && (
        <button
          className="btn primary"
          style={{ width: "100%", padding: "12px", fontSize: 15, marginTop: 12 }}
          onClick={onRegistrar}
        >
          Registrar corte
        </button>
      )}

      {registrando && (
        <RegistrarCorte
          supabase={supabase}
          pedidoId={pedido.id}
          nombreTela={pedido.nombre_tela}
          colores={pedido.colores ?? []}
          corridaBase={pedido.corrida_base}
          tallas={tallas}
          onListo={onListo}
          onCancelar={onCancelar}
        />
      )}

      {cortes.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div className="label" style={{ fontSize: 10.5, marginBottom: 6 }}>
            Cortes registrados
          </div>
          {cortes.map((c) => (
            <div key={c.id} style={{ fontSize: 13.5, marginBottom: 9 }}>
              <div>
                <b>{c.total_unidades} und.</b>
                <span style={{ color: "var(--muted)" }}>
                  {" · "}
                  {fmtFecha(c.fecha)}
                  {c.metros_consumidos != null &&
                    ` · ${Number(c.metros_consumidos).toFixed(1)} m usados`}
                </span>
              </div>
              {[...(c.colores ?? [])]
                .sort((a, b) => a.orden - b.orden)
                .map((col) => (
                  <div key={col.color} style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 13 }}>{col.color}</span>{" "}
                    <Tallas tallas={tallasDeColor(col)} />
                  </div>
                ))}
              <ExtrasCorte
                supabase={supabase}
                corteId={c.id}
                tallas={tallas}
                onListo={onListo}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Las tallas llegan como filas; `Tallas` las espera como objeto, en orden. */
function tallasDeColor(col: ColorCorte): Record<string, number> {
  const out: Record<string, number> = {};
  const filas = col.tallas ?? [];
  for (const t of ordenarTallas(filas.map((x) => x.talla))) {
    const f = filas.find((x) => x.talla === t);
    if (f && f.unidades > 0) out[t] = f.unidades;
  }
  return out;
}

const ENVOLTORIO: React.CSSProperties = {
  // Pensada para el teléfono: una columna, y centrada si se abre en escritorio.
  maxWidth: 560,
  margin: "0 auto",
  padding: "18px 14px 60px",
};

const ROTULO: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted)",
  margin: "20px 0 9px",
  fontWeight: 600,
};
