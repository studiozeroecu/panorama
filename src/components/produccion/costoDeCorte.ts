import type { ProdData } from "./useProduccion";
import type { Corte } from "@/lib/produccion/types";
import { costoCorte, type CostoCorte } from "@/lib/produccion/costoCorte";
import type { Parte } from "@/lib/produccion/conjuntos";

/**
 * Arma los datos de costoCorte para un corte a partir de lo que carga
 * useProduccion. Lo usan el panel de costo de CorteTab y Envío, para que los
 * dos digan el mismo número.
 *
 * `sinEstampado` (Envío, fase 8t): el estampado ya no se reparte entre todas
 * las prendas del corte — se le suma solo a las que van estampadas.
 */
export function costoDeCorte(data: ProdData, corte: Corte, opciones?: { sinEstampado?: boolean }): CostoCorte | null {
  const pedido = data.pedidos.find((p) => p.id === corte.pedido_id);
  if (!pedido) return null;
  const maquila = data.maquilas.find((m) => m.corte_id === corte.id);
  const prenda = data.prendas.find((x) => x.id === pedido.prenda_id);
  const consumoParte = (parte: Parte) => prenda?.partes.find((x) => x.parte === parte)?.consumo_metros ?? null;
  const estampado =
    maquila && !opciones?.sinEstampado
      ? data.lotesEstampado
          .filter((l) => l.maquila_id === maquila.id)
          .reduce((s, l) => s + Number(l.costo_total), 0)
      : 0;

  return costoCorte({
    corte,
    pedido,
    cortesDelPedido: data.cortes.filter((c) => c.pedido_id === pedido.id),
    costoMaquilaUnitario: maquila ? Number(maquila.costo_unitario) : 0,
    coloresMaquila: (maquila?.colores ?? []).map((col) => ({
      unidades: col.unidades,
      entregas: col.entregas,
      // Fase 8r: cada parte de un conjunto con su precio de maquila.
      costoUnitario: col.costo_unitario,
      parte: col.parte,
    })),
    jornadas: corte.jornadas,
    insumos: corte.insumos,
    estampado,
    // Por prenda: la suma de todos los costos fijos (etiquetas, fundas…).
    costoFijoPorUnidad: data.costosFijos.reduce((s, f) => s + Number(f.valor), 0),
    consumoPartes: { superior: consumoParte("superior"), inferior: consumoParte("inferior") },
  });
}

/**
 * Costo de producción de UNA prenda de ese corte (de esa parte, si es un
 * conjunto), sin estampado ni costo operativo. null = no se puede calcular.
 */
export function costoProduccionUnitario(data: ProdData, corte: Corte, parte: Parte | null): number | null {
  const c = costoDeCorte(data, corte, { sinEstampado: true });
  if (!c) return null;
  if (parte && c.partes) return c.partes[parte].costoUnitario;
  return c.costoUnitario;
}
