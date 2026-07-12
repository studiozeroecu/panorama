// Lee "costos 2026.xlsx" y genera supabase/migracion_costos.sql con los
// INSERTs para costos_prendas. Ignora filas de totales y celdas #DIV/0!.
// Uso: node scripts/generar-migracion-costos.mjs "D:\ZXY\costos 2026.xlsx"
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import * as XLSX from "xlsx";

const src = process.argv[2] ?? "D:\\ZXY\\costos 2026.xlsx";
const wb = XLSX.read(readFileSync(src), { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  header: 1,
  raw: true,
  defval: null,
});

// Columnas (índice 0-based): A=0 prefijo producto (ej. "conjunto"), B=1 producto,
// C=2 tela, D=3 costo tela, E=4 maquila, F=5 dtf, G=6 corte, H=7 insumos,
// I=8 etiqueta, J=9 costo total (generado — no se migra), K=10 pvp vatex,
// P=15 precio online, S=18 mayoreo 1-2, V=21 mayoreo 3-5, Y=24 mayoreo 6+
const num = (v) => (typeof v === "number" && isFinite(v) ? +v.toFixed(4) : null);
const precio = (v) => {
  const n = num(v);
  return n && n > 0 ? n : null; // 0 o vacío = precio sin definir
};

// Keywords iniciales según la regla del dueño:
// básica = "COLOR ENTERO" (sin estampado); estampada = resto.
// Los ambiguos (dos blusas, dos pantalones) quedan sin keywords → vínculo manual.
const KEYWORDS = {
  "hoddies": ["HODDIE"],
  "hoddie basica": ["HODDIE", "COLOR ENTERO"],
  "camiseta": ["CAMISETA"],
  "camiseta basica": ["CAMISETA", "COLOR ENTERO"],
  "cuello chino": ["CUELLO CHINO"],
  "buzo cuello chino": ["BUZO", "CUELLO CHINO"],
  "pant mujer": ["PANT"],
  "polo mujer": ["POLO"],
  "conjunto pantalon": ["CONJUNTO"],
  "bluza": ["BLUSA"],
  "BLUZA": [],      // HANDEL — ambigua con bluza nayara: vincular a mano
  "PANTALON": [],   // HANDEL — ambigua con conjunto pantalon: vincular a mano
};

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (a) => `'{${a.map((x) => `"${x}"`).join(",")}}'`;
const lines = [
  "-- Migración de costos desde costos 2026.xlsx — ejecutar UNA vez tras schema_fase4.sql",
  "begin;",
];

let migradas = 0;
const vistos = new Set();
for (const row of rows) {
  const prefijo = String(row?.[0] ?? "").trim();
  let producto = String(row?.[1] ?? "").trim();
  if (!producto) continue;
  if (prefijo) producto = `${prefijo} ${producto}`;
  const costoTela = num(row[3]);
  const pvp = num(row[10]);
  // fila de datos real = tiene producto + costo de tela + pvp (los totales no)
  if (costoTela == null || pvp == null) continue;

  const tela = String(row[2] ?? "").trim();
  const clave = producto.toLowerCase().includes("handel") ? producto : producto;
  let key = producto;
  if (!(key in KEYWORDS)) {
    // tolera espacios finales del Excel
    key = Object.keys(KEYWORDS).find((k) => k === producto.trim()) ?? producto;
  }
  const kw = KEYWORDS[producto] ?? KEYWORDS[producto.trim()] ?? [];
  // desambiguar nombres duplicados agregando la tela
  let nombreFinal = producto;
  if (vistos.has(producto.toLowerCase())) nombreFinal = `${producto} (${tela})`.trim();
  vistos.add(producto.toLowerCase());
  void clave; void key;

  lines.push(
    `insert into costos_prendas (producto, nombre_tela, costo_tela, maquila, dtf, corte, insumos, etiqueta, pvp_vatex, precio_online, precio_mayoreo_1_2, precio_mayoreo_3_5, precio_mayoreo_6plus, match_keywords) values (` +
      [
        q(nombreFinal),
        q(tela),
        costoTela ?? 0,
        num(row[4]) ?? 0,
        num(row[5]) ?? 0,
        num(row[6]) ?? 0,
        num(row[7]) ?? 0,
        num(row[8]) ?? 0,
        precio(row[10]) ?? "null",
        precio(row[15]) ?? "null",
        precio(row[18]) ?? "null",
        precio(row[21]) ?? "null",
        precio(row[24]) ?? "null",
        arr(kw),
      ].join(", ") +
      ");"
  );
  migradas++;
}

lines.push("commit;");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "supabase", "migracion_costos.sql");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`Generado: ${out} (${migradas} prendas)`);
