/**
 * "Semilla": una foto comprimida de toda la base (licitaciones + ítems +
 * etapas) que permite arrancar el servidor con los datos ya cargados.
 *
 * Por qué existe: el disco de Render (plan gratis) es efímero, así que cada
 * vez que el servicio se duerme y despierta pierde la base, y volver a
 * descargar ~2500 detalles de SEACE a un ritmo seguro toma más de una hora.
 * Con la semilla, el arranque en frío tarda segundos: se importa la foto y
 * después la sincronización normal solo pide a SEACE lo que cambió.
 *
 * Flujo:
 *  - GET /api/export entrega la foto actual (exportarSemilla + gzip).
 *  - Una tarea de GitHub Actions la guarda periódicamente en la rama `data`.
 *  - Al arrancar con la base vacía, cargarSemillaSiVacia() la baja de esa
 *    rama (o usa la copia incluida en el repo si no hay red) y la importa.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, upsertTenderHeader, replaceTenderDetail, contarEstadoDatos } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SEMILLA_VERSION = 1;

// La semilla es un dato externo (viene de una URL): se valida y se acota todo.
const MAX_BYTES_DESCOMPRIMIDO = 50 * 1024 * 1024; // contra "zip bombs"
const MAX_TENDERS = 50_000;
const MAX_ITEMS_POR_TENDER = 2_000;
const MAX_ETAPAS_POR_TENDER = 100;
const MAX_TEXTO = 5_000;

const SEMILLA_URL_POR_DEFECTO =
  'https://raw.githubusercontent.com/carlosgonzaleshuapalla-svg/Licitaciones-SEACE/data/seed.json.gz';
const ARCHIVO_RESPALDO = path.join(__dirname, '..', 'seed', 'seed.json.gz');

// ---------- validación ----------

const texto = (v, max = MAX_TEXTO) => (typeof v === 'string' ? v.slice(0, max) : null);
const entero = (v) => (Number.isSafeInteger(v) ? v : null);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valida y normaliza una licitación de la semilla; null si no sirve. */
function normalizarTender(t) {
  if (!t || typeof t !== 'object') return null;
  const id = entero(t.id);
  if (id === null || id <= 0) return null;

  const header = {
    id_contrato: id,
    codigo: texto(t.codigo),
    entidad: texto(t.entidad),
    objeto: texto(t.objeto, 50),
    descripcion: texto(t.descripcion),
    estado: texto(t.estado, 50),
    fecha_publicacion: texto(t.fechaPublicacion, 40),
    cotizacion_inicio: texto(t.cotizacionInicio, 40),
    cotizacion_fin: texto(t.cotizacionFin, 40),
    cantidad_items: 0,
    es_producto_rapido: t.esProductoRapido ? 1 : 0,
  };

  let items = null;
  let etapas = null;
  if (t.detalleOk) {
    if (!Array.isArray(t.items) || !Array.isArray(t.etapas)) return null;
    if (t.items.length > MAX_ITEMS_POR_TENDER || t.etapas.length > MAX_ETAPAS_POR_TENDER) return null;
    items = t.items
      .filter((i) => i && typeof i === 'object')
      .map((i) => ({
        id_item: entero(i.idItem),
        id_contrato: id,
        producto: texto(i.producto),
        cantidad: numero(i.cantidad),
        unidad_medida: texto(i.unidadMedida, 100),
        ciudad: texto(i.ciudad, 200),
      }));
    etapas = t.etapas
      .filter((e) => e && typeof e === 'object' && entero(e.id) !== null)
      .map((e) => ({
        id_contrato_etapa: e.id,
        id_contrato: id,
        nombre: texto(e.nombre, 200),
        inicio: texto(e.inicio, 40),
        fin: texto(e.fin, 40),
      }));
  }
  return { header, items, etapas };
}

// ---------- exportar ----------

/**
 * Foto completa de la base. `sincronizadoEn` es cuándo se completó por última
 * vez una sincronización con SEACE en este servidor (null si aún no): permite
 * a quien guarda la semilla saber si los datos son realmente frescos.
 */
export function exportarSemilla({ sincronizadoEn = null } = {}) {
  const tenders = db.prepare('SELECT * FROM tenders ORDER BY id_contrato').all();
  const itemsPor = new Map();
  for (const i of db.prepare('SELECT * FROM items ORDER BY id').all()) {
    if (!itemsPor.has(i.id_contrato)) itemsPor.set(i.id_contrato, []);
    itemsPor.get(i.id_contrato).push({
      idItem: i.id_item,
      producto: i.producto,
      cantidad: i.cantidad,
      unidadMedida: i.unidad_medida,
      ciudad: i.ciudad,
    });
  }
  const etapasPor = new Map();
  for (const e of db.prepare('SELECT * FROM etapas ORDER BY id_contrato_etapa').all()) {
    if (!etapasPor.has(e.id_contrato)) etapasPor.set(e.id_contrato, []);
    etapasPor.get(e.id_contrato).push({ id: e.id_contrato_etapa, nombre: e.nombre, inicio: e.inicio, fin: e.fin });
  }

  const salida = tenders.map((t) => {
    const base = {
      id: t.id_contrato,
      codigo: t.codigo,
      entidad: t.entidad,
      objeto: t.objeto,
      descripcion: t.descripcion,
      estado: t.estado,
      fechaPublicacion: t.fecha_publicacion,
      cotizacionInicio: t.cotizacion_inicio,
      cotizacionFin: t.cotizacion_fin,
      esProductoRapido: t.es_producto_rapido,
      detalleOk: t.detalle_ok,
    };
    return t.detalle_ok
      ? { ...base, items: itemsPor.get(t.id_contrato) ?? [], etapas: etapasPor.get(t.id_contrato) ?? [] }
      : base;
  });

  const conDetalle = tenders.filter((t) => t.detalle_ok).length;
  return {
    version: SEMILLA_VERSION,
    generadoEn: new Date().toISOString(),
    sincronizadoEn: sincronizadoEn ? new Date(sincronizadoEn).toISOString() : null,
    total: tenders.length,
    conDetalle,
    tenders: salida,
  };
}

export const comprimirSemilla = (semilla) => zlib.gzipSync(JSON.stringify(semilla), { level: 9 });

// ---------- importar ----------

/** Descomprime y valida la forma general. Lanza Error si no es una semilla válida. */
export function leerSemilla(buffer) {
  const json = zlib.gunzipSync(buffer, { maxOutputLength: MAX_BYTES_DESCOMPRIMIDO }).toString('utf8');
  const semilla = JSON.parse(json);
  if (!semilla || typeof semilla !== 'object') throw new Error('semilla vacía');
  if (semilla.version !== SEMILLA_VERSION) throw new Error(`versión de semilla no soportada: ${semilla.version}`);
  if (!Array.isArray(semilla.tenders)) throw new Error('semilla sin lista de licitaciones');
  if (semilla.tenders.length > MAX_TENDERS) throw new Error('semilla demasiado grande');
  return semilla;
}

/** Importa la semilla en una sola transacción. Las filas inválidas se omiten. */
export function importarSemilla(semilla) {
  const marca = typeof semilla.generadoEn === 'string' ? semilla.generadoEn : new Date().toISOString();
  let cargados = 0;
  let omitidos = 0;

  db.transaction(() => {
    for (const crudo of semilla.tenders) {
      const t = normalizarTender(crudo);
      if (!t) {
        omitidos++;
        continue;
      }
      upsertTenderHeader({ ...t.header, updated_at: marca });
      if (t.items) replaceTenderDetail(t.header.id_contrato, t.items, t.etapas);
      cargados++;
    }
  })();

  return { cargados, omitidos, conDetalle: contarEstadoDatos().conDetalle };
}

// ---------- carga al arrancar ----------

let infoCarga = null;
/** De dónde salieron los datos iniciales (para /api/status). */
export const infoSemilla = () => infoCarga;

/**
 * Si la base está vacía, la llena con la semilla: primero la rama `data`
 * (la más fresca), y si no hay red o falla, la copia incluida en el repo.
 * Nunca lanza: si no hay semilla, el servidor sigue y sincroniza desde cero.
 */
export async function cargarSemillaSiVacia({
  log = console.log,
  urls = [process.env.SEMILLA_URL === undefined ? SEMILLA_URL_POR_DEFECTO : process.env.SEMILLA_URL].filter(Boolean),
  archivos = [ARCHIVO_RESPALDO],
  fetchImpl = (...a) => fetch(...a),
  timeoutMs = 30_000,
} = {}) {
  if (contarEstadoDatos().total > 0) {
    log('La base ya tiene datos: no se carga semilla.');
    return null;
  }

  const intentos = [
    ...urls.map((url) => ({
      origen: url,
      leer: async () => {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      },
    })),
    ...archivos.map((archivo) => ({
      origen: archivo,
      leer: async () => fs.readFileSync(archivo),
    })),
  ];

  for (const { origen, leer } of intentos) {
    try {
      const semilla = leerSemilla(await leer());
      const r = importarSemilla(semilla);
      infoCarga = { origen, generadaEn: semilla.generadoEn ?? null, cargados: r.cargados, conDetalle: r.conDetalle };
      log(`Semilla cargada desde ${origen}: ${r.cargados} licitaciones (${r.conDetalle} con detalle), generada ${semilla.generadoEn}.`);
      return infoCarga;
    } catch (err) {
      log(`No se pudo usar la semilla de ${origen}: ${err.message}`);
    }
  }
  log('No hay semilla disponible: se sincroniza desde cero con SEACE.');
  return null;
}
