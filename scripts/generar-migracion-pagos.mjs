// Lee "pagos por hacer julio,agosto,septimebre.xlsx" (3 hojas, bloque
// personal a la izquierda y empresa a la derecha) y genera
// supabase/migracion_pagos.sql: cuentas_por_pagar (+ambito personal/empresa)
// y cheques vinculados. Ejecutar el SQL UNA sola vez.
// Uso: node scripts/generar-migracion-pagos.mjs "D:\ZXY\pagos por hacer julio,agosto,septimebre.xlsx"
import { readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import * as XLSX from "xlsx";

const src = process.argv[2] ?? "D:\\ZXY\\pagos por hacer julio,agosto,septimebre.xlsx";
const wb = XLSX.read(readFileSync(src), { type: "buffer", cellDates: true });

const MESES = { julio: "2026-07", agosto: "2026-08", septiembre: "2026-09" };
const DIAS_MES = { "2026-07": 31, "2026-08": 31, "2026-09": 30 };

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isFinite(n) ? +n.toFixed(2) : null;
};

/**
 * Las hojas son plantillas mensuales: la FECHA suele arrastrar el mes anterior
 * (ej. "2026-06-05" en la hoja de julio). El dato fiable es el DÍA del mes.
 * Regla: vencimiento = mes de la hoja + día de la celda. "MES ENTERO" → fin de mes.
 */
function vencimiento(celda, mesHoja) {
  if (celda instanceof Date) {
    const dia = Math.min(celda.getUTCDate(), DIAS_MES[mesHoja]);
    return `${mesHoja}-${String(dia).padStart(2, "0")}`;
  }
  const s = String(celda ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const dia = Math.min(Number(m[3]), DIAS_MES[mesHoja]);
    return `${mesHoja}-${String(dia).padStart(2, "0")}`;
  }
  return `${mesHoja}-${String(DIAS_MES[mesHoja]).padStart(2, "0")}`; // MES ENTERO / vacío → fin de mes
}

function categoriaEmpresa(gasto) {
  const g = gasto.toUpperCase();
  if (g.includes("CORTE")) return "corte";
  if (g.includes("DTF")) return "estampado";
  if (g.includes("MAQUILA")) return "maquila";
  if (g.includes("SUELDO") || g.includes("KATYCITA")) return "personal";
  if (g.includes("ARRIENDO")) return "arriendo";
  return "otros";
}

function esCheque(gasto, tipo) {
  return /cheque/i.test(gasto) || /cheque/i.test(tipo);
}

function limpiarBeneficiario(gasto) {
  return gasto
    .replace(/^cheques?\s+/i, "")
    .replace(/\bPAR PRIMO\b/i, "PAT PRIMO") // typo recurrente del Excel
    .trim()
    .toUpperCase();
}

function numeroCheque(tipo) {
  const m = String(tipo ?? "").match(/cheque\s*(\d+)/i);
  return m ? m[1] : "";
}

const lines = [
  "-- Migración de pagos (julio–septiembre 2026) desde el Excel de pagos por hacer.",
  "-- Ejecutar UNA sola vez, después de schema_fase5.sql. No toca datos existentes:",
  "-- solo inserta. Los cheques quedan vinculados a su cuenta por pagar.",
  "begin;",
  "",
  "-- Separación personal/empresa sin romper la categoría del gasto automático:",
  "alter table cuentas_por_pagar add column if not exists ambito text not null default 'empresa'",
  "  check (ambito in ('personal', 'empresa'));",
  "",
];

let cuentas = 0;
let cheques = 0;

for (const [hoja, mesHoja] of Object.entries(MESES)) {
  const ws = wb.Sheets[hoja];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  lines.push(`-- ─── ${hoja} (${mesHoja}) ───`);

  // bloques: personal cols 0..6, empresa cols 8..14; datos desde la fila 5 (idx 4+1)
  for (const [offset, ambito] of [[0, "personal"], [8, "empresa"]]) {
    for (let r = 4; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const gasto = String(row[offset] ?? "").trim();
      if (!gasto || /^total/i.test(gasto)) continue;
      const monto = num(row[offset + 4]); // VALOR ESTIMADO (VALOR REAL viene vacío)
      if (!monto || monto <= 0) continue;

      const fecha = row[offset + 1];
      const tipo = String(row[offset + 2] ?? "").trim();
      const cuota = String(row[offset + 3] ?? "").trim();
      const vence = vencimiento(fecha, mesHoja);
      const concepto = [tipo, cuota && cuota !== "mensualmente" ? `cuota ${cuota}` : cuota]
        .filter(Boolean)
        .join(" · ");
      const cheque = ambito === "empresa" && esCheque(gasto, tipo);
      const cuentaId = randomUUID();

      lines.push(
        `insert into cuentas_por_pagar (id, proveedor, concepto, monto, fecha_factura, fecha_vencimiento, tipo_pago, categoria, ambito, notas) values (` +
          [
            q(cuentaId),
            q(gasto),
            q(concepto),
            monto,
            q(`${mesHoja}-01`),
            q(vence),
            q(cheque ? "cheque" : /transferencia/i.test(tipo) ? "transferencia" : "efectivo"),
            q(ambito === "empresa" ? categoriaEmpresa(gasto) : "otros"),
            q(ambito),
            q(`Migrado del Excel de pagos (${hoja})`),
          ].join(", ") +
          ");"
      );
      cuentas++;

      if (cheque) {
        lines.push(
          `insert into cheques (tipo, monto, beneficiario, numero, fecha_cobro, estado, notas, cuenta_por_pagar_id) values (` +
            [
              q("por_pagar"),
              monto,
              q(limpiarBeneficiario(gasto)),
              q(numeroCheque(tipo)),
              q(vence),
              q("pendiente"),
              q(cuota ? `cuota ${cuota} · migrado del Excel (${hoja})` : `migrado del Excel (${hoja})`),
              q(cuentaId),
            ].join(", ") +
            ");"
        );
        cheques++;
      }
    }
  }
  lines.push("");
}

lines.push("commit;");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "supabase", "migracion_pagos.sql");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`Generado: ${out}`);
console.log(`Cuentas por pagar: ${cuentas} (personales + empresa) · Cheques vinculados: ${cheques}`);
