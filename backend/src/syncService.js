import * as clienteSeace from './seaceClient.js';
import { SeaceBloqueadoError } from './seaceClient.js';
import {
  upsertTenderHeader,
  replaceTenderDetail,
  pruneTendersNotIn,
  filtrarPendientesDetalle,
  contarEstadoDatos,
} from './db.js';

const PAGE_SIZE = 50;
// El ritmo real hacia SEACE lo limita el propio cliente (ver seaceClient.js);
// esto solo es cuántas peticiones de detalle pueden estar "en vuelo" a la vez.
const DETAIL_CONCURRENCY = 3;
// Si SEACE responde 403/429 este número de veces seguidas, se deja de
// insistir en esta corrida: seguir golpeando un bloqueo solo lo prolonga.
const MAX_BLOQUEOS_SEGUIDOS = 3;

export const SYNC_INTERVAL_MS = 30 * 60 * 1000; // cada 30 minutos
const BACKOFF_MAX_MS = 2 * 60 * 60 * 1000; // tope de espera tras bloqueos: 2 h

// Criterio documentado en el LEDGER: "producto que se puede comprar rápido"
// = objeto de contratación "Bien" (única señal honesta que da la fuente;
// no hay forma confiable de inferir rapidez de entrega sin parsear PDFs).
const OBJETO_BIEN = 'Bien';

/** Mapea un registro de /buscador a la fila `tenders` (sin items/etapas aún). */
export function mapListRecordToTenderHeader(record) {
  return {
    id_contrato: record.idContrato,
    codigo: record.desContratacion ?? null,
    entidad: record.nomEntidad ?? null,
    objeto: record.nomObjetoContrato ?? null,
    descripcion: record.desObjetoContrato ?? null,
    estado: record.nomEstadoContrato ?? null,
    fecha_publicacion: record.fecPublica ?? null,
    cotizacion_inicio: record.fecIniCotizacion ?? null,
    cotizacion_fin: record.fecFinCotizacion ?? null,
    cantidad_items: 0, // solo para el INSERT inicial; luego lo fija el detalle
    es_producto_rapido: record.nomObjetoContrato === OBJETO_BIEN ? 1 : 0,
    updated_at: new Date().toISOString(),
  };
}

/** Mapea la respuesta de listar-completo a filas `items` y `etapas`. */
export function mapDetailToItemsAndEtapas(idContrato, detalle) {
  const items = (detalle?.uitContratoItemProjectionList ?? []).map((it) => ({
    id_item: it.idContratoItem, // ID de catálogo de SEACE: se repite, no es clave
    id_contrato: idContrato,
    producto: it.nomCubso ?? null,
    cantidad: it.cantidad ?? null,
    unidad_medida: it.nomUnidadMedida ?? null,
    ciudad: it.nomDistrito ?? null,
  }));

  const etapas = (detalle?.uitContratoEtapaProjectionList ?? []).map((et) => ({
    id_contrato_etapa: et.idContratoEtapa,
    id_contrato: idContrato,
    nombre: et.nomEtapaContrato ?? null,
    inicio: et.fecIni ?? null,
    fin: et.fecFin ?? null,
  }));

  return { items, etapas };
}

/**
 * Pagina /buscador hasta cubrir pageable.totalElements. Devuelve los
 * registros obtenidos y:
 *  - `completo`: false si se cortó por un error a mitad de camino — el
 *    resultado es parcial y NO representa "todo lo vigente ahora mismo",
 *    así que no debe usarse para decidir qué borrar.
 *  - `bloqueado`: true si el corte fue porque SEACE rechazó (403/429).
 */
async function fetchTodosLosRegistros(client, log) {
  const registros = [];
  let page = 1;
  let totalElements = Infinity;
  let completo = true;
  let bloqueado = false;

  while ((page - 1) * PAGE_SIZE < totalElements) {
    let respuesta;
    try {
      respuesta = await client.buscarPagina({ page, pageSize: PAGE_SIZE });
    } catch (err) {
      bloqueado = err instanceof SeaceBloqueadoError;
      log(
        bloqueado
          ? `SEACE bloqueó la página ${page} del buscador (HTTP ${err.status}). Se detiene la paginación.`
          : `Error obteniendo página ${page} del buscador: ${err.message}. Se detiene la paginación.`,
      );
      completo = false;
      break;
    }
    const data = respuesta?.data ?? [];
    registros.push(...data);
    totalElements = respuesta?.pageable?.totalElements ?? registros.length;

    if (data.length === 0) break; // evita loop infinito si la API responde vacío
    page++;
  }

  return { registros, completo, bloqueado };
}

/**
 * Descarga el detalle de los contratos pendientes, en el orden dado (los más
 * recientes primero), con un freno: tras MAX_BLOQUEOS_SEGUIDOS rechazos
 * seguidos de SEACE deja de pedir. Lo que no alcanzó a bajar queda
 * pendiente (detalle_ok = 0) para la siguiente corrida.
 */
async function descargarDetalles(client, pendientes, log) {
  const cola = [...pendientes];
  let sincronizados = 0;
  let bloqueosSeguidos = 0;
  let bloqueado = false;

  async function trabajador() {
    while (!bloqueado) {
      const idContrato = cola.shift();
      if (idContrato === undefined) return;
      try {
        const detalle = await client.listarCompleto(idContrato);
        const { items, etapas } = mapDetailToItemsAndEtapas(idContrato, detalle);
        replaceTenderDetail(idContrato, items, etapas);
        sincronizados++;
        bloqueosSeguidos = 0;
      } catch (err) {
        if (err instanceof SeaceBloqueadoError) {
          bloqueosSeguidos++;
          if (bloqueosSeguidos >= MAX_BLOQUEOS_SEGUIDOS) {
            bloqueado = true;
            log(`SEACE bloqueó ${bloqueosSeguidos} peticiones seguidas (HTTP ${err.status}). Se frena la descarga de detalles.`);
          }
        } else {
          log(`Error sincronizando detalle del contrato ${idContrato}: ${err.message}`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, cola.length) }, trabajador));
  return { sincronizados, bloqueado };
}

// --- Estado observable de la sincronización (lo muestra /api/status) ---

const estado = {
  sincronizando: false,
  ultimoIntento: null, // ms epoch
  ultimoExito: null, // ms epoch: lista completa descargada sin bloqueo
  bloqueado: false,
  bloqueadoDesde: null,
  bloqueosSeguidos: 0, // corridas seguidas terminadas en bloqueo
  proximoIntento: null, // ms epoch
};

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** Estado de la sincronización + qué tan completos están los datos. */
export function getSyncStatus() {
  return {
    sincronizando: estado.sincronizando,
    bloqueado: estado.bloqueado,
    bloqueadoDesde: iso(estado.bloqueadoDesde),
    ultimoIntento: iso(estado.ultimoIntento),
    ultimoExito: iso(estado.ultimoExito),
    proximoIntento: iso(estado.proximoIntento),
    ...contarEstadoDatos(),
  };
}

/** Espera hasta la próxima corrida: normal, o creciente (30→60→120 min) si hay bloqueo. */
function calcularProximaEspera() {
  if (!estado.bloqueado) return SYNC_INTERVAL_MS;
  const factor = 2 ** Math.max(0, estado.bloqueosSeguidos - 1);
  return Math.min(SYNC_INTERVAL_MS * factor, BACKOFF_MAX_MS);
}

let syncEnCurso = false;
let ultimaSyncIniciadaEn = 0;

// Cooldown global (no por IP): protege tanto a este servidor como a la API
// de SEACE de que muchas requests de sync manual, aunque vengan de IPs
// distintas (esquivando el rate limit por IP de la ruta), terminen
// machacando ambos servicios.
const SYNC_COOLDOWN_MS = 90 * 1000;

/**
 * Corre una sincronización incremental:
 *  1. Pagina el buscador (pocas peticiones) y guarda/actualiza cabeceras.
 *  2. Descarga SOLO los detalles que faltan, los más recientes primero.
 *  3. Si la lista quedó completa y no hubo bloqueo, quita lo que ya no está vigente.
 * Nunca lanza por fallos de red; ante un bloqueo de SEACE frena y lo registra.
 *
 * `client` e `saltarCooldown` son inyectables para poder probarlo sin red.
 */
export async function runSync({
  log = console.log,
  client = clienteSeace,
  origen = 'programada',
  saltarCooldown = false,
} = {}) {
  if (syncEnCurso) {
    log('Sincronización ya en curso, se omite este disparo.');
    return { ok: false, sincronizados: 0, timestamp: new Date().toISOString(), motivo: 'ya-en-curso' };
  }

  // Mientras SEACE nos tiene bloqueados, un disparo manual solo alargaría
  // el bloqueo: se rechaza hasta la próxima ventana de reintento.
  if (origen === 'manual' && estado.bloqueado && estado.proximoIntento && Date.now() < estado.proximoIntento) {
    log('Sincronización manual rechazada: SEACE está limitando el acceso, se espera al próximo reintento.');
    return {
      ok: false,
      sincronizados: 0,
      timestamp: new Date().toISOString(),
      motivo: 'bloqueado',
      proximoIntento: iso(estado.proximoIntento),
    };
  }

  const desdeUltima = Date.now() - ultimaSyncIniciadaEn;
  if (!saltarCooldown && desdeUltima < SYNC_COOLDOWN_MS) {
    log(`Sincronización pedida demasiado pronto (hace ${Math.round(desdeUltima / 1000)}s). Se omite.`);
    return { ok: false, sincronizados: 0, timestamp: new Date().toISOString(), motivo: 'cooldown' };
  }

  syncEnCurso = true;
  estado.sincronizando = true;
  ultimaSyncIniciadaEn = Date.now();
  estado.ultimoIntento = Date.now();
  const inicio = Date.now();
  let sincronizados = 0;

  try {
    log('Iniciando sincronización con SEACE...');
    const lista = await fetchTodosLosRegistros(client, log);
    const { registros, completo } = lista;
    let bloqueado = lista.bloqueado;
    log(`Buscador devolvió ${registros.length} contrataciones (Bien+Servicio, Vigente).`);

    for (const record of registros) {
      if (!record?.idContrato) continue;
      upsertTenderHeader(mapListRecordToTenderHeader(record));
    }

    const idsContrato = registros.map((r) => r.idContrato).filter(Boolean);

    // Si ya nos bloquearon al listar, pedir detalles solo empeoraría las cosas.
    if (!bloqueado) {
      const pendientes = filtrarPendientesDetalle(idsContrato);
      log(`${pendientes.length} contrato(s) con detalle pendiente (el resto ya estaba descargado).`);
      const detalles = await descargarDetalles(client, pendientes, log);
      sincronizados = detalles.sincronizados;
      bloqueado = detalles.bloqueado;
    }

    // Cualquier tender que ya estaba en la base pero no vino en esta
    // respuesta ya no es Bien/Servicio+Vigente (cambió de estado o se
    // cerró): se quita del portal. Solo si la paginación fue completa —
    // sobre una lista parcial, borrar sería quitar contratos que siguen
    // vigentes y que simplemente no llegamos a ver.
    let eliminados = 0;
    if (completo) {
      eliminados = pruneTendersNotIn(idsContrato);
      if (eliminados > 0) {
        log(`${eliminados} contrato(s) ya no están Bien/Servicio+Vigente y se quitaron del portal.`);
      }
    } else {
      log('Lista incompleta: se omite la limpieza de contratos vencidos en esta corrida.');
    }

    if (bloqueado) {
      estado.bloqueado = true;
      estado.bloqueadoDesde ??= Date.now();
      estado.bloqueosSeguidos++;
    } else {
      estado.bloqueado = false;
      estado.bloqueadoDesde = null;
      estado.bloqueosSeguidos = 0;
      if (completo) estado.ultimoExito = Date.now();
    }

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    log(`Sincronización terminada: ${sincronizados} detalle(s) nuevos en ${segundos}s${bloqueado ? ' (SEACE limitó el acceso)' : ''}.`);

    return {
      ok: !bloqueado,
      sincronizados,
      eliminados,
      ...(bloqueado ? { motivo: 'bloqueado' } : {}),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    log(`Sincronización falló de forma inesperada: ${err.stack || err.message}`);
    return { ok: false, sincronizados, timestamp: new Date().toISOString(), error: err.message };
  } finally {
    syncEnCurso = false;
    estado.sincronizando = false;
  }
}

/**
 * Corre la sync una vez al arrancar y luego de forma encadenada: la espera
 * hasta la siguiente corrida es SYNC_INTERVAL_MS, o crece (hasta 2 h) si
 * SEACE está bloqueando — así dejamos de golpearlo y se puede recuperar.
 */
export function startScheduledSync({ log = console.log, client } = {}) {
  let timer = null;
  let detenido = false;

  const ciclo = async () => {
    try {
      await runSync({ log, client });
    } catch (err) {
      log(`Sync programada falló: ${err.message}`);
    }
    if (detenido) return;
    const espera = calcularProximaEspera();
    estado.proximoIntento = Date.now() + espera;
    if (estado.bloqueado) {
      log(`Próximo intento de sincronización en ${Math.round(espera / 60000)} min (SEACE limitando el acceso).`);
    }
    timer = setTimeout(ciclo, espera);
    timer.unref?.(); // no debe mantener vivo el proceso solo por el timer
  };

  ciclo();

  return {
    stop() {
      detenido = true;
      if (timer) clearTimeout(timer);
    },
  };
}
