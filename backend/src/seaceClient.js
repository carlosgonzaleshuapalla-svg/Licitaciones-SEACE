/**
 * Cliente HTTP hacia la API pública de SEACE (prod6.seace.gob.pe).
 * Sin autenticación, pero se manda un User-Agent de navegador normal por
 * si el servidor lo exige.
 *
 * SEACE protege su API con un firewall que responde 403/429 cuando una IP
 * hace demasiadas peticiones. Por eso este cliente:
 *  - limita el ritmo global de peticiones (aunque haya varias en paralelo),
 *  - NO reintenta ante 403/429 (reintentar un bloqueo solo lo prolonga) y
 *    lanza SeaceBloqueadoError para que quien lo llama frene y espere.
 */

const BASE_URL = 'https://prod6.seace.gob.pe/v1/s8uit-services/buscadorpublico/contrataciones';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Separación mínima entre el inicio de dos peticiones a SEACE (ms). ~3 req/s
// por defecto; ajustable por entorno si SEACE vuelve a limitar el acceso.
const DEFAULT_MIN_INTERVAL_MS = Number(process.env.SEACE_MIN_INTERVAL_MS) || 350;

const ANIO_FIJO = 2024; // la SPA oficial usa este valor fijo, no filtra por año real
// 1=Bien, 2=Servicio, 3=Obra, 4=Consultoría de Obra (catálogo de SEACE).
// Se sincronizan Bien y Servicio — Obra/Consultoría quedan fuera del
// alcance del portal (no son del tipo "puedo cotizar/comprar rápido").
const CODIGOS_OBJETO_SINCRONIZADOS = [1, 2];
const ESTADO_VIGENTE = 2;

/** SEACE rechazó la petición por exceso de tráfico (HTTP 403 o 429). */
export class SeaceBloqueadoError extends Error {
  constructor(status, url) {
    super(`SEACE bloqueó la petición (HTTP ${status}) para ${url}`);
    this.name = 'SeaceBloqueadoError';
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crea un cliente con su propio limitador de ritmo. `fetchImpl` y
 * `minIntervalMs` son inyectables para poder probarlo sin red.
 */
export function crearClienteSeace({
  fetchImpl = (...args) => fetch(...args),
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
} = {}) {
  let ultimoInicio = 0;
  let cola = Promise.resolve();

  // Serializa los "turnos": cada petición espera a que pase minIntervalMs
  // desde el inicio de la anterior, sin importar cuántas estén en paralelo.
  function esperarTurno() {
    const turno = cola.then(async () => {
      const espera = ultimoInicio + minIntervalMs - Date.now();
      if (espera > 0) await sleep(espera);
      ultimoInicio = Date.now();
    });
    cola = turno.catch(() => {});
    return turno;
  }

  async function fetchJsonConReintento(url, { retries = MAX_RETRIES } = {}) {
    let lastError;
    for (let intento = 0; intento <= retries; intento++) {
      await esperarTurno();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.status === 403 || res.status === 429) {
          throw new SeaceBloqueadoError(res.status, url);
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} para ${url}`);
        }
        return await res.json();
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof SeaceBloqueadoError) throw err; // no se reintenta un bloqueo
        lastError = err;
        if (intento < retries) {
          await sleep(RETRY_DELAY_MS * (intento + 1));
        }
      }
    }
    throw lastError;
  }

  return {
    /** Trae una página del buscador de contrataciones (Bien+Servicio, Vigente). */
    buscarPagina({ page, pageSize }) {
      const url =
        `${BASE_URL}/buscador?anio=${ANIO_FIJO}&palabra_clave=&orden=2` +
        `&lista_codigo_objeto=${CODIGOS_OBJETO_SINCRONIZADOS.join(',')}&lista_estado_contrato=${ESTADO_VIGENTE}` +
        `&page=${page}&page_size=${pageSize}`;
      return fetchJsonConReintento(url);
    },

    /** Trae el detalle completo (cabecera + etapas + items) de un contrato. */
    listarCompleto(idContrato) {
      const url = `${BASE_URL}/listar-completo?id_contrato=${idContrato}`;
      return fetchJsonConReintento(url);
    },
  };
}

// Cliente por defecto, compartido por todo el proceso (un solo limitador de
// ritmo para toda la app, no uno por llamada).
const clienteDefault = crearClienteSeace();
export const buscarPagina = (args) => clienteDefault.buscarPagina(args);
export const listarCompleto = (id) => clienteDefault.listarCompleto(id);

export const seaceConfig = { BASE_URL, ANIO_FIJO, CODIGOS_OBJETO_SINCRONIZADOS, ESTADO_VIGENTE };
