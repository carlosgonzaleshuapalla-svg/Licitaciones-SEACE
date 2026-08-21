/**
 * Cliente HTTP hacia la API pública de SEACE (prod6.seace.gob.pe).
 * Sin autenticación, pero se manda un User-Agent de navegador normal por
 * si el servidor lo exige, y se reintenta una vez ante fallos de red.
 */

const BASE_URL = 'https://prod6.seace.gob.pe/v1/s8uit-services/buscadorpublico/contrataciones';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonConReintento(url, { retries = MAX_RETRIES } = {}) {
  let lastError;
  for (let intento = 0; intento <= retries; intento++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} para ${url}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (intento < retries) {
        await sleep(RETRY_DELAY_MS * (intento + 1));
      }
    }
  }
  throw lastError;
}

const ANIO_FIJO = 2024; // la SPA oficial usa este valor fijo, no filtra por año real
// 1=Bien, 2=Servicio, 3=Obra, 4=Consultoría de Obra (catálogo de SEACE).
// Se sincronizan Bien y Servicio — Obra/Consultoría quedan fuera del
// alcance del portal (no son del tipo "puedo cotizar/comprar rápido").
const CODIGOS_OBJETO_SINCRONIZADOS = [1, 2];
const ESTADO_VIGENTE = 2;

/** Trae una página del buscador de contrataciones (Bien+Servicio, Vigente). */
export async function buscarPagina({ page, pageSize }) {
  const url =
    `${BASE_URL}/buscador?anio=${ANIO_FIJO}&palabra_clave=&orden=2` +
    `&lista_codigo_objeto=${CODIGOS_OBJETO_SINCRONIZADOS.join(',')}&lista_estado_contrato=${ESTADO_VIGENTE}` +
    `&page=${page}&page_size=${pageSize}`;
  return fetchJsonConReintento(url);
}

/** Trae el detalle completo (cabecera + etapas + items) de un contrato. */
export async function listarCompleto(idContrato) {
  const url = `${BASE_URL}/listar-completo?id_contrato=${idContrato}`;
  return fetchJsonConReintento(url);
}

export const seaceConfig = { BASE_URL, ANIO_FIJO, CODIGOS_OBJETO_SINCRONIZADOS, ESTADO_VIGENTE };
