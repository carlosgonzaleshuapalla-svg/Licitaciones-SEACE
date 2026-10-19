/**
 * Fechas de SEACE: texto "DD/MM/YYYY HH:mm:ss" en hora de Lima (UTC-5, Perú no
 * tiene horario de verano). Comparar ese texto tal cual es alfabético, no
 * cronológico, así que se reordena a "YYYYMMDDHH:mm:ss" (ver también
 * fechaOrdenable en tendersRepo.js, que hace lo mismo en SQL).
 */

const FORMATO_SEACE = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/;

/** "19/08/2026 18:20:15" -> "2026081918:20:15"; null si no tiene ese formato. */
export function ordenableDeSeace(texto) {
  const m = typeof texto === 'string' ? FORMATO_SEACE.exec(texto) : null;
  return m ? `${m[3]}${m[2]}${m[1]}${m[4]}` : null;
}

/**
 * "Ahora" en hora de Lima, en el mismo formato ordenable. Usa siempre Lima y
 * NO la zona del servidor: Render corre en UTC (5 h adelante), y comparar la
 * hora UTC contra plazos de Lima daba por vencidas licitaciones que aún
 * tenían hasta 5 horas de plazo.
 */
export function ahoraLimaOrdenable(ahora = new Date()) {
  const lima = new Date(ahora.getTime() - 5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${lima.getUTCFullYear()}${p(lima.getUTCMonth() + 1)}${p(lima.getUTCDate())}` +
    `${p(lima.getUTCHours())}:${p(lima.getUTCMinutes())}:${p(lima.getUTCSeconds())}`
  );
}

/**
 * ¿Sigue abierto el plazo de cotización? Sin fecha, o con un formato que no
 * reconocemos, se asume que sí: ante la duda no se descartan datos.
 */
export function cotizacionAbierta(cotizacionFin, ahora = new Date()) {
  const fin = ordenableDeSeace(cotizacionFin);
  if (fin === null) return true;
  return fin >= ahoraLimaOrdenable(ahora);
}
