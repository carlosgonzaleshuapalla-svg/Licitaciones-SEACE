/**
 * Almacén en memoria de los requerimientos de las otras entidades. Los datos
 * vienen del archivo "entidades.json.gz" que publica la Mac en la rama `data`
 * (el servidor no consulta los portales: son pocas decenas de filas y así no
 * depende de que esos portales acepten IPs de la nube). Se relee cada 30 min.
 *
 * El archivo es un dato externo: se valida y se acota todo antes de usarlo.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ENTIDADES, entidadPorId } from './catalogo.js';

const URL_POR_DEFECTO = 'https://raw.githubusercontent.com/carlosgonzaleshuapalla-svg/Licitaciones-SEACE/data/entidades.json.gz';
const REFRESCO_CADA_MS = 30 * 60 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REQUERIMIENTOS_POR_ENTIDAD = 3000;

const texto = (v, max = 2000) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
const fechaIso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v.slice(0, 40) : null);
const urlHttp = (v) => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

function normalizarRequerimiento(r) {
  if (!r || typeof r !== 'object') return null;
  const id = texto(String(r.id ?? ''), 40);
  const titulo = texto(r.titulo, 600);
  const vence = fechaIso(r.vence);
  if (!id || !titulo || !vence) return null;
  return {
    id,
    tipo: r.tipo === 'Bien' || r.tipo === 'Servicio' ? r.tipo : null,
    titulo,
    descripcion: texto(r.descripcion, 2000),
    zona: texto(r.zona, 120),
    publicado: fechaIso(r.publicado),
    vence,
    documentos: (Array.isArray(r.documentos) ? r.documentos : [])
      .slice(0, 10)
      .map((d) => ({ nombre: texto(d?.nombre, 120) ?? 'Documento', url: urlHttp(d?.url) }))
      .filter((d) => d.url),
    enlace: urlHttp(r.enlace),
  };
}

/** Valida el archivo ya descomprimido; devuelve { generadoEn, porEntidad: Map } o lanza. */
export function validarEntidades(datos) {
  if (!datos || typeof datos !== 'object' || datos.version !== 1 || !Array.isArray(datos.entidades)) {
    throw new Error('formato no reconocido');
  }
  const porEntidad = new Map();
  for (const e of datos.entidades) {
    if (!e || !entidadPorId(e.id)) continue; // solo las del catálogo
    porEntidad.set(e.id, {
      actualizadoEn: fechaIso(e.actualizadoEn),
      error: texto(e.error, 200),
      requerimientos: (Array.isArray(e.requerimientos) ? e.requerimientos : [])
        .slice(0, MAX_REQUERIMIENTOS_POR_ENTIDAD)
        .map(normalizarRequerimiento)
        .filter(Boolean),
    });
  }
  return { generadoEn: fechaIso(datos.generadoEn), porEntidad };
}

export function leerArchivoEntidades(buffer) {
  const json = zlib.gunzipSync(buffer, { maxOutputLength: MAX_BYTES }).toString('utf8');
  return validarEntidades(JSON.parse(json));
}

let actual = { generadoEn: null, porEntidad: new Map() };

export function cargarEntidades(datosValidados) {
  actual = datosValidados;
}

export function reiniciarEntidades() {
  actual = { generadoEn: null, porEntidad: new Map() };
}

const vigente = (r, ahora) => Date.parse(r.vence) > ahora.getTime();

/** Catálogo con cuántos requerimientos vigentes tiene cada entidad ahora mismo. */
export function listarEntidades(ahora = new Date()) {
  return {
    datosAl: actual.generadoEn,
    entidades: ENTIDADES.map((e) => {
      const d = actual.porEntidad.get(e.id);
      return {
        id: e.id,
        nombre: e.nombre,
        nombreCompleto: e.nombreCompleto,
        portal: e.portal,
        vigentes: d ? d.requerimientos.filter((r) => vigente(r, ahora)).length : 0,
        actualizadoEn: d?.actualizadoEn ?? null,
        error: d?.error ?? null,
      };
    }),
  };
}

const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Requerimientos vigentes de una entidad (los vencidos no se devuelven),
 * filtrables por texto, tipo y zona; primero los que cierran antes.
 */
export function listarRequerimientos(id, { q, tipo, zona, orden = 'cierre', page = 1, pageSize = 20, ahora = new Date() } = {}) {
  const entidad = entidadPorId(id);
  if (!entidad) return null;
  const d = actual.porEntidad.get(id);
  const vigentes = (d?.requerimientos ?? []).filter((r) => vigente(r, ahora));
  const zonas = [...new Set(vigentes.map((r) => r.zona).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  const palabras = q ? sinTildes(String(q)).split(/\s+/).filter(Boolean) : [];
  let filas = vigentes.filter((r) => {
    if (tipo && r.tipo !== tipo) return false;
    if (zona && r.zona !== zona) return false;
    if (palabras.length) {
      const pajar = sinTildes(`${r.titulo} ${r.descripcion ?? ''} ${r.zona ?? ''}`);
      if (!palabras.every((p) => pajar.includes(p))) return false;
    }
    return true;
  });

  filas.sort((a, b) =>
    orden === 'publicacion'
      ? (b.publicado ?? '').localeCompare(a.publicado ?? '') || Date.parse(a.vence) - Date.parse(b.vence)
      : Date.parse(a.vence) - Date.parse(b.vence),
  );

  const tam = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const pag = Math.max(1, Number(page) || 1);
  const total = filas.length;
  filas = filas.slice((pag - 1) * tam, pag * tam);
  return {
    entidad: { id: entidad.id, nombre: entidad.nombre, nombreCompleto: entidad.nombreCompleto, portal: entidad.portal },
    actualizadoEn: d?.actualizadoEn ?? null,
    error: d?.error ?? null,
    zonas,
    data: filas.map((r) => ({ ...r, enlace: r.enlace ?? entidad.portal })),
    total,
    page: pag,
    pageSize: tam,
  };
}

// ---------- carga y refresco ----------

export async function refrescarEntidades({ log = console.log, url = process.env.ENTIDADES_URL ?? URL_POR_DEFECTO, fetchImpl = (...a) => fetch(...a), timeoutMs = 30_000 } = {}) {
  if (!url) return { actualizado: false, motivo: 'sin-url' };
  try {
    // `file://` permite probar en local con un archivo ya generado, sin red.
    let crudo;
    if (url.startsWith('file://')) {
      crudo = fs.readFileSync(fileURLToPath(url));
    } else {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      crudo = Buffer.from(await res.arrayBuffer());
    }
    const datos = leerArchivoEntidades(crudo);
    if (actual.generadoEn && datos.generadoEn && datos.generadoEn <= actual.generadoEn) return { actualizado: false, motivo: 'al-dia' };
    cargarEntidades(datos);
    const total = [...datos.porEntidad.values()].reduce((s, e) => s + e.requerimientos.length, 0);
    log(`Entidades cargadas desde ${url}: ${total} requerimientos (generadas ${datos.generadoEn}).`);
    return { actualizado: true, total };
  } catch (err) {
    log(`No se pudieron cargar las entidades de ${url}: ${err.message}`);
    return { actualizado: false, motivo: 'error' };
  }
}

export function iniciarRefrescoDeEntidades({ log = console.log, cadaMs = REFRESCO_CADA_MS, ...opciones } = {}) {
  const timer = setInterval(() => {
    refrescarEntidades({ log, ...opciones }).catch((err) => log(`Refresco de entidades falló: ${err.message}`));
  }, cadaMs);
  timer.unref?.();
  return timer;
}
