/**
 * Fase 8s: el reparto de UNA entrega de maquila entre varios destinos, talla
 * por talla.
 *
 * Lo que se escribe en pantalla viaja como texto (inputs) y aquí se convierte.
 * La regla dura —cada talla cuadra EXACTO con lo que llegó— la vuelve a exigir
 * fn_repartir_entrega_maquila; esto existe para decirlo antes de enviar y
 * marcar en qué talla está el descuadre.
 */

export type DestinoEnvio = "online" | "estampado" | "local" | "feria";

export const DESTINOS: { id: DestinoEnvio; etiqueta: string }[] = [
  { id: "online", etiqueta: "Stock online" },
  { id: "estampado", etiqueta: "Estampado" },
  { id: "local", etiqueta: "Locales" },
  { id: "feria", etiqueta: "Feria" },
];

export type TallasTexto = Record<string, string>;

export interface DisenoReparto {
  nombre: string;
  tallas: TallasTexto;
}

export interface RepartoForm {
  activos: DestinoEnvio[];
  online: TallasTexto;
  local: TallasTexto;
  feria: TallasTexto;
  disenos: DisenoReparto[];
}

/** Un input vacío o inválido cuenta como 0; los negativos también (el input no los deja). */
export function cantidad(v: string | undefined): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Texto → números, sin ceros. Es lo que viaja a la base. */
export function tallasLimpias(t: TallasTexto): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [talla, v] of Object.entries(t)) {
    const n = cantidad(v);
    if (n > 0) out[talla] = n;
  }
  return out;
}

const suma = (t: Record<string, number>) => Object.values(t).reduce((s, n) => s + n, 0);

/** Lo que va a estampado por talla: la suma de todos los diseños. */
export function tallasEstampado(disenos: DisenoReparto[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of disenos) {
    for (const [talla, n] of Object.entries(tallasLimpias(d.tallas))) out[talla] = (out[talla] ?? 0) + n;
  }
  return out;
}

/** Unidades por talla de un destino. Un destino desmarcado no cuenta, aunque tenga números escritos. */
export function tallasDestino(form: RepartoForm, destino: DestinoEnvio): Record<string, number> {
  if (!form.activos.includes(destino)) return {};
  if (destino === "estampado") return tallasEstampado(form.disenos);
  return tallasLimpias(form[destino]);
}

export function unidadesDestino(form: RepartoForm, destino: DestinoEnvio): number {
  return suma(tallasDestino(form, destino));
}

/**
 * Lo que falta repartir por talla: llegó − asignado. Negativo = sobra (se
 * repartió más de lo que llegó). Incluye las tallas que solo aparecen en los
 * destinos, para que un error de tecleo en una talla que no llegó se vea.
 */
export function faltaPorTalla(llegadas: Record<string, number>, form: RepartoForm): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, n] of Object.entries(llegadas)) if (n > 0) out[t] = n;
  for (const d of form.activos) {
    for (const [t, n] of Object.entries(tallasDestino(form, d))) out[t] = (out[t] ?? 0) - n;
  }
  return out;
}

/**
 * "Lo que sobra va al online": online = llegó − lo de los demás destinos, por
 * talla. Lo que ya hubiera en online se reemplaza, no se suma.
 */
export function completarConOnline(llegadas: Record<string, number>, form: RepartoForm): TallasTexto {
  const sinOnline = { ...form, activos: form.activos.filter((d) => d !== "online") };
  const online: TallasTexto = {};
  for (const [t, n] of Object.entries(faltaPorTalla(llegadas, sinOnline))) {
    if (n > 0) online[t] = String(n);
  }
  return online;
}

/** Lo que impide guardar, en palabras para el dueño. Vacío = se puede procesar. */
export function problemasReparto(llegadas: Record<string, number>, form: RepartoForm): string[] {
  const out: string[] = [];
  if (!form.activos.length) return ["Marca al menos un destino."];

  for (const [t, n] of Object.entries(faltaPorTalla(llegadas, form))) {
    if (n > 0) out.push(`Talla ${t}: faltan ${n} por repartir.`);
    if (n < 0) out.push(`Talla ${t}: repartiste ${-n} de más.`);
  }
  if (form.activos.includes("estampado")) {
    for (const d of form.disenos) {
      const und = suma(tallasLimpias(d.tallas));
      if (!d.nombre.trim() && und > 0) out.push("Hay un diseño con unidades pero sin nombre.");
      if (d.nombre.trim() && und === 0) out.push(`El diseño "${d.nombre.trim()}" no tiene unidades.`);
    }
  }
  for (const { id, etiqueta } of DESTINOS) {
    if (form.activos.includes(id) && unidadesDestino(form, id) === 0) {
      out.push(`${etiqueta} está marcado pero no tiene unidades.`);
    }
  }
  return out;
}

/** El objeto `p_reparto` de fn_repartir_entrega_maquila, sin los datos de cada destino. */
export function repartoParaBase(form: RepartoForm) {
  const activo = (d: DestinoEnvio) => form.activos.includes(d);
  return {
    online: activo("online") ? tallasLimpias(form.online) : null,
    disenos: activo("estampado")
      ? form.disenos
          .map((d) => ({ nombre: d.nombre.trim(), tallas: tallasLimpias(d.tallas) }))
          .filter((d) => d.nombre || suma(d.tallas) > 0)
      : null,
    local: activo("local") ? tallasLimpias(form.local) : null,
    feria: activo("feria") ? tallasLimpias(form.feria) : null,
  };
}
