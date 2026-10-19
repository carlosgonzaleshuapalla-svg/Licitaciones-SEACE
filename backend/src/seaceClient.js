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

// Separación mínima entre el inicio de dos peticiones a SEACE (ms).
// Medido contra el SEACE real (oct 2026): 1 petición cada 2 s (30/min) y 1 por
// segundo pasan sin problema en pruebas cortas, pero a ~1,1 s sostenido ya
// aparecen 403 (el límite parece rondar las ~50 peticiones por minuto) y a ~3/s
// se bloquea en segundos. El 403 se levanta solo, pero a veces tarda más de 1
// min. Por eso base de 2 s, con auto-ajuste (ver abajo). Ajustable por entorno.
const DEFAULT_MIN_INTERVAL_MS = Number(process.env.SEACE_MIN_INTERVAL_MS) || 2000;
// Tras un 403 el intervalo se duplica (hasta este tope) y vuelve a la base
// poco a poco con peticiones exitosas.
const MAX_INTERVAL_MS = 16_000;
const RACHA_PARA_ACELERAR = 25;

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
  let intervaloActual = minIntervalMs; // se auto-ajusta: sube ante un 403, baja con éxitos
  let rachaExitos = 0;

  // Serializa los "turnos": cada petición espera a que pase minIntervalMs
  // desde el inicio de la anterior, sin importar cuántas estén en paralelo.
  function esperarTurno() {
    const turno = cola.then(async () => {
      const espera = ultimoInicio + intervaloActual - Date.now();
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
          // SEACE nos está limitando: ir más despacio de aquí en adelante.
          rachaExitos = 0;
          intervaloActual = Math.min(Math.max(intervaloActual, 1) * 2, MAX_INTERVAL_MS);
          throw new SeaceBloqueadoError(res.status, url);
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} para ${url}`);
        }
        const json = await res.json();
        // Si viene yendo bien un buen rato, se vuelve a acelerar hacia la base.
        if (intervaloActual > minIntervalMs && ++rachaExitos >= RACHA_PARA_ACELERAR) {
          rachaExitos = 0;
          intervaloActual = Math.max(minIntervalMs, Math.round(intervaloActual / 1.5));
        }
        return json;
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
    /** Intervalo actual entre peticiones (ms), tras el auto-ajuste. */
    intervaloActualMs: () => intervaloActual,

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
