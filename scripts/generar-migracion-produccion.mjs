// Lee los datos del proyecto Supabase VIEJO de Control de Producción
// (tabla app_data con blobs JSON) y genera supabase/migracion_produccion.sql
// con INSERTs hacia las tablas prod_* del proyecto de Panorama.
// Uso: node scripts/generar-migracion-produccion.mjs
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import path from "path";

const OLD_URL = "https://lmhmffwakfpctdlzyrjx.supabase.co";
const OLD_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaG1mZndha2ZwY3RkbHp5cmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzYyMDgsImV4cCI6MjA5NDg1MjIwOH0.eByP_bUYhnbwsKLg1u0eveg0_ukI2zkvLWJqPfCSX_E";

const res = await fetch(`${OLD_URL}/rest/v1/app_data?select=key,data`, {
  headers: { apikey: OLD_KEY },
});
if (!res.ok) {
  console.error("No se pudo leer el proyecto viejo:", res.status);
  process.exit(1);
}
const rows = await res.json();
const get = (k) => rows.find((r) => r.key === `mfg_${k}`)?.data ?? [];

const prendas = get("prendas");
const proveedores = get("proveedores");
const costos = get("costos_fijos");
const pedidos = get("pedidos");
const cortes = get("cortes");
const maquilas = get("maquilas");

// ── helpers SQL ──────────────────────────────────────────
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const num = (n, def = 0) => (n == null || isNaN(Number(n)) ? def : Number(n));
const date = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `'${s.slice(0, 10)}'` : "null");
const jsonb = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const arr = (a) => `'{${(a ?? []).map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}'`;

const lines = [
  "-- Migración de datos: Control de Producción (proyecto viejo) → tablas prod_*",
  "-- Generado automáticamente. Ejecutar UNA sola vez en el SQL Editor de Supabase,",
  "-- después de schema_fase3.sql.",
  "begin;",
];

// mapas legacy_id → uuid nuevo
const uid = () => randomUUID();
const mapPrenda = new Map(prendas.map((p) => [String(p.id), uid()]));
const mapProv = new Map(proveedores.map((p) => [String(p.id), uid()]));
const mapPedido = new Map(pedidos.map((p) => [String(p.id), uid()]));
const mapCorte = new Map(cortes.map((c) => [String(c.id), uid()]));

// catálogo de maquiladoras a partir de los textos libres existentes
const maquiladorasSet = new Set();
for (const c of cortes) if (c.maquiladora?.trim()) maquiladorasSet.add(c.maquiladora.trim());
for (const m of maquilas) if (m.maquiladora?.trim()) maquiladorasSet.add(m.maquiladora.trim());
const mapMaquiladora = new Map([...maquiladorasSet].map((n) => [n, uid()]));

for (const p of prendas) {
  lines.push(
    `insert into prod_prendas (id, nombre, consumo_metros, costo_maquila, precio_venta_local, precio_venta_online, lleva_estampado, tallas, notas, legacy_id) values (` +
      [
        q(mapPrenda.get(String(p.id))),
        q(p.nombre),
        num(p.consumoMetros),
        num(p.costoMaquila),
        num(p.precioVentaLocal ?? p.precioVentaSugerido),
        num(p.precioVentaOnline ?? p.precioVentaSugerido),
        p.llevamEstampado ? "true" : "false",
        arr(p.tallas),
        q(p.notas ?? ""),
        q(String(p.id)),
      ].join(", ") +
      ");"
  );
}

for (const p of proveedores) {
  lines.push(
    `insert into prod_proveedores (id, empresa, contacto_nombre, contacto, dias_entrega, legacy_id) values (` +
      [
        q(mapProv.get(String(p.id))),
        q(p.empresa ?? p.nombre ?? ""),
        q(p.nombre ?? ""),
        q(p.contacto ?? ""),
        Math.max(1, Math.round(num(p.diasEntrega, 1))),
        q(String(p.id)),
      ].join(", ") +
      ");"
  );
}

for (const c of costos) {
  lines.push(
    `insert into prod_costos_fijos (nombre, valor, legacy_id) values (${q(c.nombre)}, ${num(c.valor)}, ${q(String(c.id))});`
  );
}

for (const [nombre, id] of mapMaquiladora) {
  lines.push(`insert into prod_maquiladoras (id, nombre) values (${q(id)}, ${q(nombre)});`);
}

const ESTADOS = { Pendiente: "pendiente", "En camino": "en_camino", Entregado: "entregado" };
for (const p of pedidos) {
  const colores = (p.colores ?? []).map((c) => ({
    color: c.colorNombre ?? "",
    metros: num(c.cantidadMetros),
    ...(c.cantidadKilos != null ? { kilos: num(c.cantidadKilos) } : {}),
  }));
  lines.push(
    `insert into prod_pedidos_tela (id, nombre_tela, fecha_pedido, unidad, rendimiento, ancho_pedido, ancho_real, proveedor_id, prenda_id, colores, total_metros, valor_metro, total_pagar, estado, fecha_entrega_real, legacy_id) values (` +
      [
        q(mapPedido.get(String(p.id))),
        q(p.nombreTela),
        date(p.fechaPedido) === "null" ? "current_date" : date(p.fechaPedido),
        q(p.unidad === "kilos" ? "kilos" : "metros"),
        p.rendimientoMetrosPorKilo != null ? num(p.rendimientoMetrosPorKilo) : "null",
        p.anchoTela != null ? num(p.anchoTela) : "null",
        p.anchoRealTela != null ? num(p.anchoRealTela) : "null",
        q(mapProv.get(String(p.proveedorId)) ?? null),
        q(mapPrenda.get(String(p.propositoId)) ?? null),
        jsonb(colores),
        num(p.totalMetros),
        num(p.valorPorMetroConIVA),
        num(p.totalAPagar),
        q(ESTADOS[p.estado] ?? "pendiente"),
        date(p.fechaEntregaReal),
        q(String(p.id)),
      ].join(", ") +
      ");"
  );
}

for (const c of cortes) {
  const colores = (c.colores ?? []).map((col) => ({
    color: col.colorNombre ?? "",
    tallas: col.tallas ?? {},
    unidades: num(col.totalUnidades),
    metros_usados: null, // no registrado en la app vieja (mejora 1 aplica hacia adelante)
  }));
  const maqId = c.maquiladora?.trim() ? mapMaquiladora.get(c.maquiladora.trim()) : null;
  lines.push(
    `insert into prod_cortes (id, pedido_id, fecha, maquiladora_id, colores, total_unidades, metros_consumidos, observaciones, legacy_id) values (` +
      [
        q(mapCorte.get(String(c.id))),
        q(mapPedido.get(String(c.pedidoId))),
        date(c.fechaCorte) === "null" ? "current_date" : date(c.fechaCorte),
        q(maqId ?? null),
        jsonb(colores),
        num(c.totalUnidades),
        "null",
        q(c.observaciones ?? ""),
        q(String(c.id)),
      ].join(", ") +
      ");"
  );
}

const ESTADO_COLOR = { Pendiente: "pendiente", Enviado: "enviado", Entregado: "entregado" };
for (const m of maquilas) {
  const corteUuid = mapCorte.get(String(m.corteId));
  if (!corteUuid) continue; // maquila huérfana: no se puede migrar sin su corte
  const colores = (m.colores ?? []).map((col) => ({
    color: col.colorNombre ?? "",
    tallas: col.tallas ?? {},
    unidades: num(col.totalUnidades),
    estado: ESTADO_COLOR[col.estado] ?? "pendiente",
    fecha_envio: col.fechaEnvio ?? null,
    fecha_entrega: col.fechaEntrega ?? null,
    procesado: false,
  }));
  const maqId = m.maquiladora?.trim() ? mapMaquiladora.get(m.maquiladora.trim()) : null;
  lines.push(
    `insert into prod_maquilas (corte_id, maquiladora_id, costo_unitario, colores, total_unidades, legacy_id) values (` +
      [
        q(corteUuid),
        q(maqId ?? null),
        num(m.costoMaquilaUnitario),
        jsonb(colores),
        num(m.totalUnidades),
        q(String(m.id)),
      ].join(", ") +
      ");"
  );
}

lines.push("commit;");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "supabase", "migracion_produccion.sql");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`Generado: ${out}`);
console.log(
  `Filas: ${prendas.length} prendas, ${proveedores.length} proveedores, ${costos.length} costos, ` +
    `${mapMaquiladora.size} maquiladoras, ${pedidos.length} pedidos, ${cortes.length} cortes, ${maquilas.length} maquilas.`
);
