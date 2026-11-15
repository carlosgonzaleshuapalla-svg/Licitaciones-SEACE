import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader, replaceTenderDetail, contarEstadoDatos } from '../src/db.js';
import { mapListRecordToTenderHeader, mapDetailToItemsAndEtapas } from '../src/syncService.js';
import { listarTenders } from '../src/tendersRepo.js';
import { exportarSemilla, comprimirSemilla, leerSemilla, refrescarDesdeSemilla } from '../src/semilla.js';
import { createApp } from '../src/app.js';

const BASE = 999995000;
const vaciar = () => db.prepare('DELETE FROM tenders').run();
let sufijoEtapa = 0;

function registro(id, { publicacion = '01/01/2026 10:00:00', cierre = '01/01/2099 10:00:00' } = {}) {
  return {
    idContrato: id,
    desContratacion: `CM-LISTA-${id}`,
    nomEntidad: 'ENTIDAD DE PRUEBA',
    nomObjetoContrato: 'Bien',
    desObjetoContrato: 'PRUEBA LISTA',
    nomEstadoContrato: 'Vigente',
    fecPublica: publicacion,
    fecIniCotizacion: publicacion,
    fecFinCotizacion: cierre,
  };
}

function conProductos(id, productos) {
  const detalle = {
    uitContratoItemProjectionList: productos.map(([nombre, cantidad], i) => ({
      idContratoItem: 1000 + i,
      nomCubso: nombre,
      cantidad,
      nomUnidadMedida: 'UNIDAD',
      nomDistrito: 'LIMA/LIMA/LIMA',
    })),
    uitContratoEtapaProjectionList: [
      { idContratoEtapa: BASE * 10 + ++sufijoEtapa, nomEtapaContrato: 'ETAPA DE COTIZACIÓN', fecIni: 'a', fecFin: 'b' },
    ],
  };
  const { items, etapas } = mapDetailToItemsAndEtapas(id, detalle);
  replaceTenderDetail(id, items, etapas);
}

describe('orden de la lista', () => {
  beforeEach(vaciar);

  test('"cierre" pone primero lo que antes vence; sin fecha de cierre, al final', () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 1, { cierre: '30/12/2099 10:00:00' })));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 2, { cierre: '05/12/2099 10:00:00' })));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 3, { cierre: '20/12/2099 10:00:00' })));
    upsertTenderHeader(mapListRecordToTenderHeader({ ...registro(BASE + 4), fecFinCotizacion: null }));

    const { data } = listarTenders({ q: 'PRUEBA LISTA', orden: 'cierre', pageSize: 10 });
    // 05/12 < 20/12 < 30/12 (comparado como fecha, no como texto: "30/12" < "05/12" alfabéticamente no)
    assert.deepEqual(data.map((t) => t.idContrato), [BASE + 2, BASE + 3, BASE + 1, BASE + 4]);
  });

  test('un orden desconocido cae al de publicación y no rompe la consulta', () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 1, { publicacion: '01/01/2026 10:00:00' })));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 2, { publicacion: '02/02/2026 10:00:00' })));
    const { data } = listarTenders({ q: 'PRUEBA LISTA', orden: "'; DROP TABLE tenders; --", pageSize: 10 });
    assert.deepEqual(data.map((t) => t.idContrato), [BASE + 2, BASE + 1]);
    assert.equal(contarEstadoDatos().total, 2);
  });
});

describe('vista previa de productos en la lista', () => {
  beforeEach(vaciar);

  test('trae los primeros 3 productos distintos con su cantidad y cuántos hay en total', () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 10)));
    conProductos(BASE + 10, [['CEMENTO', 10], ['ARENA', 5], ['CEMENTO', 3], ['LADRILLO', 100], ['FIERRO', 8]]);
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 11)));

    const { data } = listarTenders({ q: 'PRUEBA LISTA', pageSize: 10 });
    const con = data.find((t) => t.idContrato === BASE + 10);
    assert.deepEqual(con.productos.map((p) => p.producto), ['CEMENTO', 'ARENA', 'LADRILLO']);
    assert.equal(con.productos[0].cantidad, 10);
    assert.equal(con.productosTotal, 4, 'CEMENTO repetido cuenta una sola vez');
    const sin = data.find((t) => t.idContrato === BASE + 11);
    assert.deepEqual(sin.productos, []);
    assert.equal(sin.productosTotal, 0);
  });
});

describe('refrescar desde la semilla publicada', () => {
  beforeEach(vaciar);

  /** Respuesta HTTP falsa con una semilla armada a mano. */
  function respuestaCon(semilla) {
    const buf = comprimirSemilla(semilla);
    return async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  }
  const semillaDe = (ids, generadoEn) => ({
    version: 1,
    generadoEn,
    sincronizadoEn: generadoEn,
    total: ids.length,
    conDetalle: 0,
    tenders: ids.map((id) => ({ id, codigo: `S-${id}`, objeto: 'Bien', descripcion: 'DE SEMILLA', estado: 'Vigente', detalleOk: 0 })),
  });
  const muchos = (desde, n) => Array.from({ length: n }, (_, i) => desde + i);

  test('agrega lo nuevo, quita lo que ya no está y no repite si la semilla no cambió', async () => {
    const log = () => {};
    // Primera: 60 licitaciones (BASE+100 ... BASE+159)
    let r = await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: respuestaCon(semillaDe(muchos(BASE + 100, 60), '2099-01-01T00:00:00.000Z')) });
    assert.equal(r.actualizado, true);
    assert.equal(contarEstadoDatos().total, 60);

    // Misma fecha de generación: no hace nada
    r = await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: respuestaCon(semillaDe(muchos(BASE + 100, 60), '2099-01-01T00:00:00.000Z')) });
    assert.equal(r.actualizado, false);
    assert.equal(r.motivo, 'al-dia');

    // Más nueva: se corre 10 (salen las 10 primeras, entran 10 nuevas)
    r = await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: respuestaCon(semillaDe(muchos(BASE + 110, 60), '2099-01-01T06:00:00.000Z')) });
    assert.equal(r.actualizado, true);
    assert.equal(r.quitadas, 10);
    assert.equal(contarEstadoDatos().total, 60);
    const ids = db.prepare('SELECT id_contrato FROM tenders ORDER BY id_contrato').all().map((x) => x.id_contrato);
    assert.equal(ids[0], BASE + 110);
    assert.equal(ids.at(-1), BASE + 169);
  });

  test('una semilla casi vacía NO reemplaza lo que hay', async () => {
    const log = () => {};
    await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: respuestaCon(semillaDe(muchos(BASE + 200, 60), '2099-02-01T00:00:00.000Z')) });
    const r = await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: respuestaCon(semillaDe([BASE + 999], '2099-02-02T00:00:00.000Z')) });
    assert.equal(r.actualizado, false);
    assert.equal(r.motivo, 'muy-chica');
    assert.equal(contarEstadoDatos().total, 60, 'la base queda intacta');
  });

  test('si no hay red o la semilla está corrupta, no lanza y no toca nada', async () => {
    const log = () => {};
    await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: respuestaCon(semillaDe(muchos(BASE + 300, 60), '2099-03-01T00:00:00.000Z')) });
    let r = await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: async () => { throw new Error('sin red'); } });
    assert.equal(r.motivo, 'error');
    r = await refrescarDesdeSemilla({ log, urls: ['https://x.test/s'], fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(Buffer.from('basura')).buffer }) });
    assert.equal(r.motivo, 'error');
    assert.equal(contarEstadoDatos().total, 60);
  });

  test('una semilla exportada de verdad también se reimporta sin problema', async () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 400)));
    conProductos(BASE + 400, [['CEMENTO', 10]]);
    const real = leerSemilla(comprimirSemilla(exportarSemilla()));
    assert.equal(real.total, 1);
  });
});

describe('API: fuente de datos y sincronización desactivada', () => {
  let server;
  after(() => server?.close());

  test('/api/status dice que la fuente es la semilla y /api/sync no hace nada', async () => {
    const base = await new Promise((resolve) => {
      server = createApp().listen(0, () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.fuente, 'semilla');
    assert.ok('datosAl' in status);

    const sync = await (await fetch(`${base}/api/sync`, { method: 'POST' })).json();
    assert.equal(sync.ok, false);
    assert.equal(sync.motivo, 'desactivada');

    const lista = await (await fetch(`${base}/api/tenders?orden=cierre&pageSize=2`)).json();
    assert.ok(Array.isArray(lista.data));
  });
});
