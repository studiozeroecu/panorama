/**
 * Fases 8s y 8t: el reparto de UNA entrega de maquila entre sus destinos,
 * talla por talla.
 *
 * Tres destinos: bodega, locales y feria (decisión del dueño, 2026-10-27).
 * Dentro de cada uno se dice cuántas van con cada estampado; lo que queda va
 * BÁSICO y se calcula solo.
 *
 * Lo que se escribe en pantalla viaja como texto (inputs) y aquí se convierte.
 * La regla dura —cada talla cuadra EXACTO con lo que llegó— la vuelve a exigir
 * fn_repartir_entrega_maquila; esto existe para decirlo antes de enviar y
 * marcar en qué talla está el descuadre.
 */

export type DestinoEnvio = "bodega" | "local" | "feria";

export const DESTINOS: { id: DestinoEnvio; etiqueta: string }[] = [
  { id: "bodega", etiqueta: "Bodega" },
  { id: "local", etiqueta: "Locales" },
  { id: "feria", etiqueta: "Feria" },
];

/**
 * Costo operativo por prenda según a dónde sale. ⚠️ La tarifa que se guarda la
 * pone la base (fn_costo_operativo); esto es solo para mostrarla. Se mueven
 * juntas. La bodega no lleva: se suma cuando sale a vender (en línea, $5).
 */
export const COSTO_OPERATIVO: Record<DestinoEnvio | "online", number> = {
  bodega: 0,
  local: 2.5,
  feria: 5,
  online: 5,
};

/** Lo que cuesta estampar una prenda, si no se escribe otro valor. */
export const COSTO_ESTAMPADO_DEFECTO = 2.5;

export type TallasTexto = Record<string, string>;

export interface DisenoReparto {
  nombre: string;
  tallas: TallasTexto;
}

export interface RepartoForm {
  activos: DestinoEnvio[];
  /** Cuántas van a cada destino, por talla (básicas + estampadas). */
  tallas: Record<DestinoEnvio, TallasTexto>;
  /** Los estampados de cada destino; lo que no cubren va básico. */
  disenos: Record<DestinoEnvio, DisenoReparto[]>;
}

export const formVacio = (activos: DestinoEnvio[] = []): RepartoForm => ({
  activos,
  tallas: { bodega: {}, local: {}, feria: {} },
  disenos: { bodega: [], local: [], feria: [] },
});

/** Un input vacío o inválido cuenta como 0; los negativos también (el input no los deja). */
export function cantidad(v: string | undefined): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Texto → números, sin ceros. */
export function tallasLimpias(t: TallasTexto): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [talla, v] of Object.entries(t)) {
    const n = cantidad(v);
    if (n > 0) out[talla] = n;
  }
  return out;
}

export const sumaTallas = (t: Record<string, number>) => Object.values(t).reduce((s, n) => s + n, 0);

/** Lo estampado de un destino por talla: la suma de sus diseños. */
export function tallasEstampado(disenos: DisenoReparto[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of disenos) {
    for (const [talla, n] of Object.entries(tallasLimpias(d.tallas))) out[talla] = (out[talla] ?? 0) + n;
  }
  return out;
}

/** Lo que va a un destino por talla. Un destino desmarcado no cuenta, aunque tenga números. */
export function tallasDestino(form: RepartoForm, d: DestinoEnvio): Record<string, number> {
  return form.activos.includes(d) ? tallasLimpias(form.tallas[d]) : {};
}

/** Básicas de un destino por talla: lo que va − lo estampado. Negativo = los diseños se pasan. */
export function basicosDestino(form: RepartoForm, d: DestinoEnvio): Record<string, number> {
  const out: Record<string, number> = { ...tallasDestino(form, d) };
  for (const [t, n] of Object.entries(tallasEstampado(form.disenos[d]))) out[t] = (out[t] ?? 0) - n;
  return out;
}

/**
 * Lo que falta repartir por talla: llegó − lo de los destinos. Negativo =
 * sobra. Incluye las tallas que solo aparecen en los destinos, para que un
 * error de tecleo en una talla que no llegó se vea.
 */
export function faltaPorTalla(llegadas: Record<string, number>, form: RepartoForm): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, n] of Object.entries(llegadas)) if (n > 0) out[t] = n;
  for (const d of form.activos) {
    for (const [t, n] of Object.entries(tallasDestino(form, d))) out[t] = (out[t] ?? 0) - n;
  }
  return out;
}

/** "Lo que sobra → bodega": bodega = llegó − lo de los otros destinos, por talla. */
export function completarConBodega(llegadas: Record<string, number>, form: RepartoForm): TallasTexto {
  const sinBodega = { ...form, activos: form.activos.filter((d) => d !== "bodega") };
  const bodega: TallasTexto = {};
  for (const [t, n] of Object.entries(faltaPorTalla(llegadas, sinBodega))) {
    if (n > 0) bodega[t] = String(n);
  }
  return bodega;
}

/** Lo que impide guardar, en palabras para el dueño. Vacío = se puede procesar. */
export function problemasReparto(llegadas: Record<string, number>, form: RepartoForm): string[] {
  const out: string[] = [];
  if (!form.activos.length) return ["Marca al menos un destino."];

  for (const [t, n] of Object.entries(faltaPorTalla(llegadas, form))) {
    if (n > 0) out.push(`Talla ${t}: faltan ${n} por repartir.`);
    if (n < 0) out.push(`Talla ${t}: repartiste ${-n} de más.`);
  }
  for (const { id, etiqueta } of DESTINOS) {
    if (!form.activos.includes(id)) continue;
    if (sumaTallas(tallasDestino(form, id)) === 0) {
      out.push(`${etiqueta} está marcado pero no tiene unidades.`);
      continue;
    }
    for (const [t, n] of Object.entries(basicosDestino(form, id))) {
      if (n < 0) out.push(`${etiqueta}, talla ${t}: los estampados suman ${-n} más de las que van.`);
    }
    for (const d of form.disenos[id]) {
      const und = sumaTallas(tallasLimpias(d.tallas));
      if (!d.nombre.trim() && und > 0) out.push(`${etiqueta}: hay un estampado con unidades pero sin nombre.`);
      if (d.nombre.trim() && und === 0) out.push(`${etiqueta}: el estampado "${d.nombre.trim()}" no tiene unidades.`);
    }
  }
  return out;
}

/** Básicas y estampados de cada destino marcado, como los espera fn_repartir_entrega_maquila. */
export function repartoParaBase(form: RepartoForm) {
  const out: Partial<Record<DestinoEnvio, { basicos: Record<string, number>; disenos: { nombre: string; tallas: Record<string, number> }[] }>> = {};
  for (const d of form.activos) {
    const basicos: Record<string, number> = {};
    for (const [t, n] of Object.entries(basicosDestino(form, d))) if (n > 0) basicos[t] = n;
    out[d] = {
      basicos,
      disenos: form.disenos[d]
        .map((x) => ({ nombre: x.nombre.trim(), tallas: tallasLimpias(x.tallas) }))
        .filter((x) => x.nombre || sumaTallas(x.tallas) > 0),
    };
  }
  return out;
}

/** Costo por prenda que sale a un destino: producción + estampado (si va estampada) + operativo. */
export function costoSalida(produccion: number, destino: DestinoEnvio, estampado: number | null): number {
  return Math.round((produccion + (estampado ?? 0) + COSTO_OPERATIVO[destino]) * 100) / 100;
}

/**
 * Envío agrupado por producción (2026-10-27): una tarjeta por corte, con los
 * colores en filas y las tallas en columnas. Cada fila es UNA entrega
 * pendiente, y cada entrega se sigue procesando por separado en la base
 * (fn_repartir_entrega_maquila): este estado solo junta lo de todas en una
 * pantalla, y formDeEntrega lo vuelve a partir.
 */
export interface EstampadoGrupo extends DisenoReparto {
  /** La fila (entrega) a la que pertenece este estampado. */
  entregaId: string;
}

export interface GrupoForm {
  activos: DestinoEnvio[];
  /** destino → entrega → talla → cantidad escrita. */
  tallas: Record<DestinoEnvio, Record<string, TallasTexto>>;
  estampados: Record<DestinoEnvio, EstampadoGrupo[]>;
}

export const grupoVacio = (activos: DestinoEnvio[] = []): GrupoForm => ({
  activos,
  tallas: { bodega: {}, local: {}, feria: {} },
  estampados: { bodega: [], local: [], feria: [] },
});

/** El formulario de UNA entrega dentro del grupo, para reusar las reglas de arriba. */
export function formDeEntrega(g: GrupoForm, entregaId: string): RepartoForm {
  const f = formVacio(g.activos);
  for (const { id } of DESTINOS) {
    f.tallas[id] = g.tallas[id][entregaId] ?? {};
    f.disenos[id] = g.estampados[id]
      .filter((e) => e.entregaId === entregaId)
      .map(({ nombre, tallas }) => ({ nombre, tallas }));
  }
  return f;
}

/** "Lo que sobra → bodega" para todas las filas a la vez. */
export function completarGrupoConBodega(
  llegadas: Record<string, Record<string, number>>,
  g: GrupoForm
): Record<string, TallasTexto> {
  const out: Record<string, TallasTexto> = {};
  for (const [id, tallas] of Object.entries(llegadas)) out[id] = completarConBodega(tallas, formDeEntrega(g, id));
  return out;
}
