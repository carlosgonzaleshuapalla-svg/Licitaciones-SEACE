/**
 * Detecta si una licitación exige experiencia previa al postor.
 *
 * SEACE NO tiene un campo oficial para esto: la exigencia (cuando existe)
 * aparece escrita en la descripción del objeto o en la descripción de cada
 * producto ("POSTOR DEBE ACREDITAR EXPERIENCIA EN VENTAS SIMILARES…"), y a veces
 * solo en los términos de referencia adjuntos, que no están en la API. Por eso
 * esto es una detección por texto: acierta cuando lo dice en la descripción, y
 * un "no se menciona" NO garantiza que las bases no la pidan.
 */

// Letra por letra (sin cambiar el largo) para que un índice del texto
// normalizado sirva también en el texto original.
const sinTildes = (s) =>
  [...s].map((c) => c.normalize('NFD')[0]).join('').toLowerCase();

const PIDE = [
  /experiencia/,
  /(ventas|contratos|contrataciones|servicios|prestaciones|suministros|trabajos|obras|entregas|provisiones) similares/,
  /trayectoria/,
  /monto (acumulado|facturado)/,
];

// "No se requiere experiencia", "sin experiencia previa": la menciona para decir que NO la piden.
const NO_PIDE = /(\bsin\b|\bno (se )?(requiere|exige|solicita|necesita|es necesari[oa])\b|\bno requiere\b)[^.;\n]{0,40}experiencia/;

// Encabezados de la plantilla de los términos de referencia que nombran la
// experiencia pero no la exigen ("TIEMPO MÍNIMO DE EXPERIENCIA", "REQUIERE
// PERSONAL ESPECIALIZADO: No aplica"): se borran antes de buscar.
const PLANTILLA = [/tiempo minimo de experiencia/g, /requiere personal especializado/g, /experiencia del personal/g];
// "Experiencia: no aplica / no corresponde".
const NO_APLICA = /experiencia[^.;\n]{0,25}(no aplica|no corresponde)/;

const LARGO_NOTA = 220;

function recorte(texto, indice) {
  const desde = Math.max(0, indice - 70);
  const hasta = Math.min(texto.length, indice + LARGO_NOTA - 70);
  const medio = texto.slice(desde, hasta).replace(/\s+/g, ' ').trim();
  return `${desde > 0 ? '…' : ''}${medio}${hasta < texto.length ? '…' : ''}`;
}

/**
 * @param {Array<string|null|undefined>} textos descripción del objeto, descripciones de los productos, etc.
 * @returns {{ exige: 0|1, nota: string|null }}
 */
export function detectarExperiencia(textos) {
  for (const original of textos) {
    if (typeof original !== 'string' || !original.trim()) continue;
    let t = sinTildes(original);
    for (const re of PLANTILLA) t = t.replace(re, (m) => ' '.repeat(m.length)); // mismo largo: los índices valen en el original
    // Todas las coincidencias, de la primera a la última: en un texto largo una
    // mención negada ("no se requiere experiencia") no debe tapar una exigencia posterior.
    const indices = [];
    for (const re of PIDE) {
      const global = new RegExp(re.source, 'g');
      let m;
      while ((m = global.exec(t)) !== null) indices.push(m.index);
    }
    indices.sort((a, b) => a - b);
    for (const indice of indices) {
      // Si en el entorno cercano dice que NO la piden, esta mención no cuenta.
      const entorno = t.slice(Math.max(0, indice - 60), indice + 40);
      if (NO_PIDE.test(entorno) || NO_APLICA.test(entorno)) continue;
      return { exige: 1, nota: recorte(original, indice) };
    }
  }
  return { exige: 0, nota: null };
}
