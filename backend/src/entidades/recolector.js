/**
 * Recolecta los requerimientos vigentes de las entidades del catálogo y arma el
 * archivo "entidades" (JSON comprimido) que publica la Mac junto a la semilla.
 *
 * Cortesía con los portales: un pedido cada 2 s, sin paralelismo, identificándose
 * como un navegador común (el MINSA rechaza clientes sin cabecera de navegador).
 * Si una entidad falla se conserva lo último que se tenía de ella (marcado con
 * su fecha de actualización) en vez de mostrar el portal como vacío.
 */
import { execFile } from 'node:child_process';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { ENTIDADES } from './catalogo.js';
import { parsearListaClasica, parsearZonaSunarp, parsearZonasSunarp, parsearListaMinsa, totalMinsa } from './parsers.js';

export const ENTIDADES_VERSION = 1;

const PAUSA_MS = 2000;
const TIMEOUT_MS = 30_000;
const MAX_PAGINAS_MINSA = 20;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const execFileP = promisify(execFile);

/**
 * Descarga con `curl` del sistema. Se usa en vez de fetch de Node porque algunos
 * portales (SBN, Hospital de Ventanilla) envían la cadena de certificados
 * incompleta: curl la completa y valida igual, y Node la rechaza. La verificación
 * del certificado NO se desactiva.
 */
async function curl(url) {
  const { stdout } = await execFileP(
    'curl',
    ['-sS', '-L', '--fail', '--max-time', String(TIMEOUT_MS / 1000), '--max-filesize', String(5 * 1024 * 1024), '-A', USER_AGENT, '-H', 'Accept-Language: es-PE,es;q=0.9', url],
    { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: TIMEOUT_MS + 5000 },
  );
  return stdout;
}

/** Pide una página (con un reintento) respetando la pausa entre pedidos. */
export function crearDescargador({ transporte = curl, pausaMs = PAUSA_MS } = {}) {
  let ultimo = 0;
  return async function descargar(url) {
    let error;
    for (let intento = 0; intento < 2; intento++) {
      const espera = ultimo + pausaMs - Date.now();
      if (espera > 0) await dormir(espera);
      ultimo = Date.now();
      try {
        return await transporte(url);
      } catch (err) {
        error = err;
      }
    }
    throw error;
  };
}

/** Requerimientos vigentes de una entidad, ya sin duplicados. */
export async function recolectarEntidad(entidad, descargar) {
  const base = entidad.portal;
  let lista = [];
  if (entidad.lector === 'clasico') {
    lista = parsearListaClasica(await descargar(base), { base });
  } else if (entidad.lector === 'sunarp') {
    const zonas = parsearZonasSunarp(await descargar(base)).filter((z) => z.vigentes > 0);
    for (const zona of zonas) lista.push(...parsearZonaSunarp(await descargar(zona.url), { base }));
  } else if (entidad.lector === 'minsa') {
    for (const [codigo, tipo] of [['B', 'Bien'], ['S', 'Servicio']]) {
      let total = null;
      for (let pagina = 1; pagina <= MAX_PAGINAS_MINSA; pagina++) {
        const html = await descargar(`${base}?type=${codigo}&page=${pagina}`);
        const filas = parsearListaMinsa(html, { base, tipo });
        total ??= totalMinsa(html);
        lista.push(...filas);
        if (filas.length === 0 || total === null || lista.filter((r) => r.tipo === tipo).length >= total) break;
      }
    }
  } else {
    throw new Error(`lector desconocido: ${entidad.lector}`);
  }
  const vistos = new Set();
  return lista.filter((r) => {
    const clave = `${r.id}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Recolecta todas las entidades. `previo` es el archivo anterior (ya leído) para
 * conservar lo de una entidad que no respondió. Devuelve el objeto a publicar.
 */
export async function recolectarTodas({ previo = null, descargar = crearDescargador(), log = () => {}, ahora = new Date(), entidades = ENTIDADES } = {}) {
  const salida = [];
  for (const entidad of entidades) {
    const anterior = previo?.entidades?.find((e) => e.id === entidad.id) ?? null;
    try {
      const requerimientos = await recolectarEntidad(entidad, descargar);
      log(`${entidad.nombre}: ${requerimientos.length} requerimiento(s) vigente(s).`);
      salida.push({ id: entidad.id, actualizadoEn: ahora.toISOString(), error: null, requerimientos });
    } catch (err) {
      const motivo = String(err.message).slice(0, 160);
      log(`${entidad.nombre}: no se pudo leer (${motivo})${anterior ? '; se conserva lo anterior' : ''}.`);
      salida.push({
        id: entidad.id,
        actualizadoEn: anterior?.actualizadoEn ?? null,
        error: motivo,
        requerimientos: anterior?.requerimientos ?? [],
      });
    }
  }
  return { version: ENTIDADES_VERSION, generadoEn: ahora.toISOString(), entidades: salida };
}

export const comprimirEntidades = (datos) => zlib.gzipSync(Buffer.from(JSON.stringify(datos), 'utf8'));
