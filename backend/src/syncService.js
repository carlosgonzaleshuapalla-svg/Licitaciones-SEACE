import { buscarPagina, listarCompleto } from './seaceClient.js';
import { upsertTenderHeader, replaceTenderDetail, pruneTendersNotIn } from './db.js';
import { runWithConcurrency } from './concurrencyPool.js';

const PAGE_SIZE = 50;
const DETAIL_CONCURRENCY = 6; // lote de 5-8 en paralelo, no golpear el server real
export const SYNC_INTERVAL_MS = 20 * 60 * 1000; // cada 20 minutos

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
    cantidad_items: 0, // se completa al sincronizar el detalle
    es_producto_rapido: record.nomObjetoContrato === OBJETO_BIEN ? 1 : 0,
    updated_at: new Date().toISOString(),
  };
}

/** Mapea la respuesta de listar-completo a filas `items` y `etapas`. */
export function mapDetailToItemsAndEtapas(idContrato, detalle) {
  const items = (detalle?.uitContratoItemProjectionList ?? []).map((it) => ({
    id_item: it.idContratoItem,
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
 * registros obtenidos y si la paginación se completó sin errores
 * (`completo: false` si se cortó por un fallo de red a mitad de camino —
 * en ese caso el resultado es parcial y NO representa "todo lo vigente
 * ahora mismo", así que no debe usarse para decidir qué borrar).
 */
async function fetchTodosLosRegistros(log) {
  const registros = [];
  let page = 1;
  let totalElements = Infinity;
  let completo = true;

  while ((page - 1) * PAGE_SIZE < totalElements) {
    let respuesta;
    try {
      respuesta = await buscarPagina({ page, pageSize: PAGE_SIZE });
    } catch (err) {
      log(`Error obteniendo página ${page} del buscador: ${err.message}. Se detiene la paginación.`);
      completo = false;
      break;
    }
    const data = respuesta?.data ?? [];
    registros.push(...data);
    totalElements = respuesta?.pageable?.totalElements ?? registros.length;

    if (data.length === 0) break; // evita loop infinito si la API responde vacío
    page++;
  }

  return { registros, completo };
}

let syncEnCurso = false;

/**
 * Corre una sincronización completa: pagina el buscador, guarda cabeceras,
 * y luego trae el detalle (items + etapas) de cada contrato con
 * concurrencia limitada. Nunca lanza por fallos individuales de red.
 */
export async function runSync({ log = console.log } = {}) {
  if (syncEnCurso) {
    log('Sincronización ya en curso, se omite este disparo.');
    return { ok: false, sincronizados: 0, timestamp: new Date().toISOString(), motivo: 'ya-en-curso' };
  }

  syncEnCurso = true;
  const inicio = Date.now();
  let sincronizados = 0;

  try {
    log('Iniciando sincronización con SEACE...');
    const { registros, completo } = await fetchTodosLosRegistros(log);
    log(`Buscador devolvió ${registros.length} contrataciones (Bien + Vigente).`);

    for (const record of registros) {
      if (!record?.idContrato) continue;
      upsertTenderHeader(mapListRecordToTenderHeader(record));
    }

    const idsContrato = registros.map((r) => r.idContrato).filter(Boolean);

    await runWithConcurrency(
      idsContrato,
      DETAIL_CONCURRENCY,
      async (idContrato) => {
        const detalle = await listarCompleto(idContrato);
        const { items, etapas } = mapDetailToItemsAndEtapas(idContrato, detalle);
        replaceTenderDetail(idContrato, items, etapas);
        sincronizados++;
      },
      (err, idContrato) => {
        log(`Error sincronizando detalle del contrato ${idContrato}: ${err.message}`);
      }
    );

    // Cualquier tender que ya estaba en la base pero no vino en esta
    // respuesta ya no es Bien+Vigente (cambió de estado o se cerró): se
    // quita del portal. Solo se hace si la paginación fue completa —
    // sobre una lista parcial, borrar sería quitar contratos que siguen
    // vigentes y que simplemente no llegamos a ver por un fallo de red.
    let eliminados = 0;
    if (completo) {
      eliminados = pruneTendersNotIn(idsContrato);
      if (eliminados > 0) {
        log(`${eliminados} contrato(s) ya no están Bien+Vigente y se quitaron del portal.`);
      }
    } else {
      log('Paginación incompleta por errores de red: se omite la limpieza de contratos vencidos en esta corrida.');
    }

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    log(`Sincronización terminada: ${sincronizados}/${idsContrato.length} contratos con detalle en ${segundos}s.`);

    return { ok: true, sincronizados, eliminados, timestamp: new Date().toISOString() };
  } catch (err) {
    log(`Sincronización falló de forma inesperada: ${err.stack || err.message}`);
    return { ok: false, sincronizados, timestamp: new Date().toISOString(), error: err.message };
  } finally {
    syncEnCurso = false;
  }
}

/** Corre la sync una vez al arrancar y luego cada SYNC_INTERVAL_MS. */
export function startScheduledSync({ log = console.log } = {}) {
  runSync({ log }).catch((err) => log(`Sync inicial falló: ${err.message}`));
  const timer = setInterval(() => {
    runSync({ log }).catch((err) => log(`Sync programada falló: ${err.message}`));
  }, SYNC_INTERVAL_MS);
  timer.unref?.(); // no debe mantener vivo el proceso solo por el timer
  return timer;
}
