// El backend reenvía las fechas tal como las entrega SEACE:
// "DD/MM/YYYY HH:mm:ss" (no ISO 8601), p.ej. "19/08/2026 18:20:15".
const FORMATO_SEACE = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function parsearFechaSeace(valor: string): Date | null {
  const m = FORMATO_SEACE.exec(valor.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "00", min = "00", ss = "00"] = m;
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss)
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

// Se conserva la hora (no solo el día): la ventana de cotización suele abrir
// y cerrar el mismo día, y la hora exacta es lo que decide si todavía se
// puede cotizar.
export function formatearFecha(valor: string | undefined | null): string {
  if (!valor) return "—";
  const d = parsearFechaSeace(valor) ?? new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return d.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
