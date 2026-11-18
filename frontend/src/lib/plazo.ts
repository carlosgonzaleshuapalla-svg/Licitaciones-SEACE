// Cuánto falta para que cierre la cotización. Las fechas de SEACE vienen en
// hora de Lima (UTC-5, sin horario de verano) como "DD/MM/YYYY HH:mm:ss"; se
// interpretan así sin importar la zona horaria de quien mira la página.
const FORMATO_SEACE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LIMA_UTC_OFFSET_HORAS = 5;

export function instanteDeSeace(valor: string | null | undefined): number | null {
  const m = FORMATO_SEACE.exec((valor ?? "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss = "00"] = m;
  const ms = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh) + LIMA_UTC_OFFSET_HORAS,
    Number(min),
    Number(ss),
  );
  return Number.isNaN(ms) ? null : ms;
}

// "urgente": menos de 3 h. "pronto": menos de 24 h. "normal": más.
export type NivelPlazo = "urgente" | "pronto" | "normal" | "vencida";

export interface Plazo {
  texto: string;
  nivel: NivelPlazo;
}

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export function describirPlazo(
  cotizacionFin: string | null | undefined,
  ahora: number = Date.now(),
): Plazo | null {
  return plazoHasta(instanteDeSeace(cotizacionFin), ahora);
}

/** Lo mismo para fechas ISO 8601 con zona (las de los portales de otras entidades). */
export function describirPlazoIso(
  iso: string | null | undefined,
  ahora: number = Date.now(),
): Plazo | null {
  const t = Date.parse(iso ?? "");
  return plazoHasta(Number.isNaN(t) ? null : t, ahora);
}

function plazoHasta(fin: number | null, ahora: number): Plazo | null {
  if (fin === null) return null;

  const falta = fin - ahora;
  if (falta <= 0) return { texto: "Plazo vencido", nivel: "vencida" };
  if (falta < HORA) {
    return { texto: `Cierra en ${Math.max(1, Math.round(falta / MIN))} min`, nivel: "urgente" };
  }
  if (falta < 3 * HORA) {
    return { texto: `Cierra en ${Math.floor(falta / HORA)} h`, nivel: "urgente" };
  }
  if (falta < DIA) {
    return { texto: `Cierra en ${Math.floor(falta / HORA)} h`, nivel: "pronto" };
  }
  const dias = Math.floor(falta / DIA);
  return { texto: dias === 1 ? "Cierra en 1 día" : `Cierra en ${dias} días`, nivel: "normal" };
}

/** "hace 5 min", "hace 3 h", "hace 2 días" — para "datos actualizados". */
export function haceCuanto(iso: string | null | undefined, ahora: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const pasado = Math.max(0, ahora - t);
  if (pasado < 2 * MIN) return "hace un momento";
  if (pasado < HORA) return `hace ${Math.round(pasado / MIN)} min`;
  if (pasado < DIA) return `hace ${Math.round(pasado / HORA)} h`;
  const dias = Math.round(pasado / DIA);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}
