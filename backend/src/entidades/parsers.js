/**
 * Lectores de los portales públicos de "compras menores o iguales a 8 UIT" de
 * otras entidades del Estado. Cada entidad publica sus requerimientos (con
 * términos de referencia y fecha de cierre) en su propio portal, sin sesión.
 *
 * Las funciones son puras (reciben el HTML, devuelven datos) para poder
 * probarlas con páginas guardadas. Ninguna lanza: lo que no se reconoce se
 * omite, y un requerimiento sin título o sin fecha de cierre no se publica.
 */

const ZONA_HORARIA = '-05:00'; // Perú no usa horario de verano

const ENTIDADES_HTML = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };

/** Texto limpio: sin etiquetas, con entidades HTML resueltas y espacios simples. */
export function limpiar(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#0?39);/g, (m) => ENTIDADES_HTML[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fecha de los portales → ISO con zona de Perú ("2026-11-18T16:00:00-05:00").
 * Formatos: "2026-11-18 16:00 pm", "2026-11-18 12:59", "20/11/26 17:30 pm".
 * Los portales escriben la hora en 24 h y le agregan "am/pm" por costumbre del
 * lenguaje: se toma la hora tal cual. Devuelve null si no se reconoce.
 */
export function parsearFechaPortal(texto) {
  const s = String(texto ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s);
  let anio;
  let mes;
  let dia;
  let hora;
  let min;
  if (m) {
    [, anio, mes, dia, hora, min] = m;
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})[ T](\d{1,2}):(\d{2})/.exec(s);
    if (!m) return null;
    [, dia, mes, anio, hora, min] = m;
    if (anio.length === 2) anio = `20${anio}`;
  }
  const n = (v) => Number(v);
  if (n(mes) < 1 || n(mes) > 12 || n(dia) < 1 || n(dia) > 31 || n(hora) > 23 || n(min) > 59) return null;
  const dos = (v) => String(n(v)).padStart(2, '0');
  return `${anio}-${dos(mes)}-${dos(dia)}T${dos(hora)}:${dos(min)}:00${ZONA_HORARIA}`;
}

/**
 * Arregla dos defectos de origen: un "¿" suelto donde iba un guion largo
 * (" ¿ SUNARP") y las tildes en minúscula dentro de títulos en mayúsculas
 * ("ADQUISICIóN").
 */
export function arreglarTitulo(texto) {
  let t = String(texto ?? '').replace(/\s+¿\s+/g, ' – ').replace(/\s+/g, ' ').trim();
  if (!/[a-z]/.test(t)) t = t.replace(/[áéíóúñ]/g, (c) => c.toUpperCase());
  return t;
}

/** Normaliza el tipo ("Bienes", "SERVICIOS", "Servicio"…) a 'Bien' | 'Servicio' | null. */
export function normalizarTipo(texto) {
  const t = String(texto ?? '').toLowerCase();
  if (t.startsWith('bien')) return 'Bien';
  if (t.startsWith('servicio')) return 'Servicio';
  return null;
}

/** "https://host/../storage/x.pdf" → "https://host/storage/x.pdf"; solo http(s). */
export function normalizarEnlace(href, base) {
  try {
    const u = new URL(String(href).replace(/&amp;/g, '&').trim(), base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Partes del HTML que empiezan en cada coincidencia de `inicio` (hasta la siguiente). */
function bloques(html, inicio) {
  const idx = [];
  const re = new RegExp(inicio.source, inicio.flags.includes('g') ? inicio.flags : `${inicio.flags}g`);
  let m;
  while ((m = re.exec(html)) !== null) idx.push(m.index);
  return idx.map((desde, i) => html.slice(desde, idx[i + 1] ?? html.length));
}

/** Enlaces de documentos (términos de referencia / especificaciones) de un bloque. */
function documentosDe(bloque, base) {
  const docs = [];
  const re = /<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(bloque)) !== null) {
    const href = m[1];
    if (!/\/storage\/|files_convocatoria|\.(pdf|docx?|xlsx?|zip|rar)(\?|$)/i.test(href)) continue;
    const url = normalizarEnlace(href, base);
    if (!url || docs.some((d) => d.url === url)) continue;
    const titulo = /title="([^"]+)"/i.exec(m[0])?.[1];
    // El texto del enlace trae el nombre del ícono ("picture_as_pdf"); se prefiere el title o el texto sin íconos.
    const texto = limpiar(m[2]).replace(/\b(picture_as_pdf|description|note_add|task)\b/gi, '').replace(/\s+/g, ' ').trim();
    docs.push({ nombre: (titulo ? limpiar(titulo) : texto || 'Documento').slice(0, 120), url });
  }
  return docs;
}

const idDe = (bloque) => /data-convocatoria="(\d+)"/.exec(bloque)?.[1] ?? null;

/** Campo "Etiqueta: valor" dentro de un bloque (el valor llega tras el </strong>). */
function campo(bloque, etiqueta) {
  const re = new RegExp(`${etiqueta}:?\\s*(?:<\\/strong>|<\\/b>)?\\s*([^<]+)`, 'i');
  const m = re.exec(bloque);
  return m ? limpiar(m[1]) : null;
}

/**
 * Portales "clásicos" (Sanipes, SBN, Hospital de Ventanilla): una tarjeta por
 * requerimiento, con título "Bienes: …", fecha de vencimiento y enlace al TDR.
 */
export function parsearListaClasica(html, { base }) {
  const salida = [];
  for (const b of bloques(html, /<h6\b[^>]*data-filter-by/i)) {
    const h6 = /<h6\b[^>]*>([\s\S]*?)<\/h6>/i.exec(b);
    if (!h6) continue;
    const texto = limpiar(h6[1]).replace(/^(queue_play_next)\s*/i, '');
    const m = /^(Bienes?|Servicios?)\s*:\s*(.+)$/i.exec(texto);
    const tipo = normalizarTipo(m?.[1]);
    const titulo = arreglarTitulo(m ? m[2] : texto);
    const vence = parsearFechaPortal(campo(b, 'Fecha de vencimiento'));
    const id = idDe(b);
    if (!titulo || !vence || !id) continue;
    salida.push({ id, tipo, titulo, descripcion: null, zona: null, publicado: null, vence, documentos: documentosDe(b, base), enlace: null });
  }
  return salida;
}

/** Portal de SUNARP, una zona registral: lo mismo con más datos (zona y publicación). */
export function parsearZonaSunarp(html, { base }) {
  const salida = [];
  for (const b of bloques(html, /<h5\b[^>]*data-filter-by/i)) {
    const h5 = /<h5\b[^>]*>([\s\S]*?)<\/h5>/i.exec(b);
    if (!h5) continue;
    const tipo = normalizarTipo(/<strong>\s*([^<]+?)\s*<\/strong>/i.exec(h5[1])?.[1]);
    const titulo = arreglarTitulo(limpiar(h5[1].replace(/<strong>[^<]*<\/strong>\s*:?/i, '')));
    const vence = parsearFechaPortal(campo(b, 'Fecha de vencimiento'));
    const id = idDe(b);
    if (!titulo || !vence || !id) continue;
    salida.push({
      id,
      tipo,
      titulo,
      descripcion: null,
      zona: campo(b, 'Zona Registral'),
      publicado: parsearFechaPortal(campo(b, 'Fecha de publicación')),
      vence,
      documentos: documentosDe(b, base),
      enlace: null,
    });
  }
  return salida;
}

/** Portada de SUNARP: las zonas registrales con requerimientos vigentes. */
export function parsearZonasSunarp(html) {
  const zonas = [];
  const re = /<a\b[^>]*href="(https?:\/\/[^"]*\/portal\/zona-registral\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const texto = limpiar(m[2]);
    const vigentes = Number(/(\d+)\s+Vigentes?/i.exec(texto)?.[1] ?? 0);
    if (!zonas.some((z) => z.url === m[1])) zonas.push({ url: m[1], vigentes });
  }
  return zonas;
}

/**
 * Portal del MINSA: lista paginada (10 por página) con título, descripción y
 * especificaciones técnicas. El tipo no viene en la tarjeta: se pide filtrado
 * (type=B / type=S) y se pasa en `tipo`.
 */
export function parsearListaMinsa(html, { base, tipo = null }) {
  const salida = [];
  for (const b of bloques(html, /<h2\b[^>]*class="[^"]*card-title/i)) {
    const titulo = arreglarTitulo(limpiar(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(b)?.[1]));
    const descripcion = limpiar(/<p\b[^>]*card-text[^>]*>([\s\S]*?)<\/p>/i.exec(b)?.[1]) || null;
    const vence = parsearFechaPortal(campo(b, 'Vencimiento'));
    const id = idDe(b);
    if (!titulo || !vence || !id) continue;
    salida.push({
      id,
      tipo,
      titulo,
      descripcion: descripcion && descripcion !== titulo ? descripcion : null,
      zona: null,
      publicado: null,
      vence,
      documentos: documentosDe(b, base),
      enlace: `${new URL(base).origin}/portal/${id}/convocatoria`,
    });
  }
  return salida;
}

/** Total de resultados que anuncia el MINSA ("Mostrando 1 - 10 de 23"). */
export function totalMinsa(html) {
  const m = /Mostrando[\s\S]{0,40}?de\s*(\d+)/i.exec(limpiar(html).replace(/<[^>]+>/g, ' '));
  return m ? Number(m[1]) : null;
}
