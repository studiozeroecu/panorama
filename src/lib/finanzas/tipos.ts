/**
 * Tipos de Finanzas v2 — reflejan las vistas de supabase/finanzas_v2_sql1_ampliar.sql
 * (v_deudas, v_cheques, v_movimientos). Ver CLAUDE.md.
 */

export type Ambito = "empresa" | "personal";
export type Exigibilidad = "firme" | "flexible";
export type TipoDeuda = "proveedor" | "prestamo" | "tarjeta" | "familia" | "sueldo" | "otra";
export type Medio = "cheque" | "transferencia" | "efectivo";
export type EstadoCheque = "pendiente" | "pagado" | "cobrado" | "rebotado" | "anulado";

/** Fila de v_deudas: los totales los calcula la base, no se guardan. */
export interface Deuda {
  id: string;
  proveedor: string;
  concepto: string;
  tipo_deuda: TipoDeuda;
  exigibilidad: Exigibilidad;
  fecha_estimada: string | null;
  ambito: Ambito;
  categoria: string;
  monto: number;
  monto_original: number | null;
  cuota_mensual: number | null;
  saldo_al: string | null;
  es_saldo_inicial: boolean;
  anulada: boolean;
  documento_tipo: string | null;
  documento_numero: string;
  fecha_documento: string | null;
  notas: string;
  total_pagado: number;
  total_pendiente: number;
  total_rebotado: number;
  saldo: number;
  sin_programar: number;
  cuotas_pendientes: number;
  proxima_fecha: string | null;
  estado_calculado: "pendiente" | "pagada" | "anulada";
}

/** Fila de v_cheques (pago programado / cuota). */
export interface Cheque {
  id: string;
  tipo: "por_pagar" | "por_cobrar";
  medio: Medio;
  monto: number;
  beneficiario: string;
  banco: string;
  numero: string;
  fecha_original: string | null;
  fecha_cobro: string | null;
  reprogramado: boolean;
  estado: EstadoCheque;
  fecha_pago: string | null;
  cuenta_por_pagar_id: string | null;
  deuda_proveedor: string | null;
  deuda_concepto: string | null;
  deuda_exigibilidad: Exigibilidad | null;
  categoria_efectiva: string;
  ambito_efectivo: Ambito;
  /** silencio de la alerta diaria (null = no se ha avisado) */
  alertado_hasta: string | null;
  notas: string;
}

/** Fila de v_movimientos. */
export interface Movimiento {
  id: string;
  fecha: string;
  tipo: "gasto" | "ingreso";
  monto: number;
  concepto: string;
  categoria: string;
  ambito: Ambito;
  cheque_id: string | null;
  cuenta_por_pagar_id: string | null;
  cuenta_en_rentabilidad: boolean;
}

/** Lo que cargar.ts trae de la base para un periodo. */
export interface DatosFinanzas {
  deudas: Deuda[];
  /** cheques por pagar pendientes o rebotados (de cualquier fecha) */
  chequesAbiertos: Cheque[];
  /** cheques por pagar pagados con fecha de pago dentro del rango cargado */
  chequesPagados: Cheque[];
  /** movimientos con fecha dentro del rango cargado */
  movimientos: Movimiento[];
}
