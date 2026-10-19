import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, upsertTenderHeader, replaceTenderDetail, contarEstadoDatos } from '../src/db.js';
import { mapListRecordToTenderHeader, mapDetailToItemsAndEtapas } from '../src/syncService.js';
import {
  exportarSemilla,
  comprimirSemilla,
  leerSemilla,
  importarSemilla,
  cargarSemillaSiVacia,
  SEMILLA_VERSION,
} from '../src/semilla.js';
import { obtenerTenderDetalle } from '../src/tendersRepo.js';
import { createApp } from '../src/app.js';

const silencio = () => {};
const BASE = 999996000;
let sufijoEtapa = 0;

function registro(id) {
  return {
    idContrato: id,
    desContratacion: `CM-SEMILLA-${id}`,
    nomEntidad: 'ENTIDAD DE PRUEBA',
    nomObjetoContrato: 'Bien',
    desObjetoContrato: 'PRUEBA SEMILLA',
    nomEstadoContrato: 'Vigente',
    fecPublica: '01/01/2026 10:00:00',
    fecIniCotizacion: '01/01/2026 10:00:00',
    fecFinCotizacion: '01/01/2099 10:00:00',
  };
}

// Mismo id de catálogo repetido (1509) dentro del contrato, como en los datos reales.
function detalle() {
  const item = (cantidad, distrito) => ({
    idContratoItem: 1509,
    nomCubso: 'DIESEL B5 S-50',
    cantidad,
    nomUnidadMedida: 'GALON',
    nomDistrito: distrito,
  });
  return {
    uitContratoItemProjectionList: [item(10, 'LIMA/LIMA/LIMA'), item(20, 'CUSCO/CUSCO/CUSCO')],
    uitContratoEtapaProjectionList: [
      { idContratoEtapa: BASE * 10 + ++sufijoEtapa, nomEtapaContrato: 'ETAPA DE COTIZACIÓN', fecIni: 'a', fecFin: 'b' },
    ],
  };
}

/** 3 licitaciones: 2 con detalle y 1 pendiente. */
function sembrarBase() {
  for (const id of [BASE + 1, BASE + 2, BASE + 3]) upsertTenderHeader(mapListRecordToTenderHeader(registro(id)));
  for (const id of [BASE + 1, BASE + 2]) {
    const { items, etapas } = mapDetailToItemsAndEtapas(id, detalle());
    replaceTenderDetail(id, items, etapas);
  }
}

const vaciar = () => db.prepare('DELETE FROM tenders').run();

describe('exportar e importar la semilla', () => {
  beforeEach(vaciar);

  test('ida y vuelta: lo exportado se importa idéntico (ítems repetidos, ciudades, etapas y pendientes)', () => {
    sembrarBase();
    const antes = [BASE + 1, BASE + 2, BASE + 3].map((id) => obtenerTenderDetalle(id));

    const semilla = leerSemilla(comprimirSemilla(exportarSemilla()));
    assert.equal(semilla.version, SEMILLA_VERSION);
    assert.equal(semilla.total, 3);
    assert.equal(semilla.conDetalle, 2);

    vaciar();
    assert.equal(contarEstadoDatos().total, 0);
    const r = importarSemilla(semilla);

    assert.equal(r.cargados, 3);
    assert.equal(r.omitidos, 0);
    const despues = [BASE + 1, BASE + 2, BASE + 3].map((id) => obtenerTenderDetalle(id));
    for (let i = 0; i < 3; i++) {
      assert.equal(despues[i].codigo, antes[i].codigo);
      assert.equal(despues[i].items.length, antes[i].items.length);
      assert.deepEqual(despues[i].ciudades, antes[i].ciudades);
      assert.equal(despues[i].etapas.length, antes[i].etapas.length);
      assert.equal(despues[i].cantidadItems, antes[i].cantidadItems);
    }
    assert.equal(despues[0].items.length, 2, 'el ítem repetido no se pierde');
    assert.deepEqual(despues[0].ciudades, ['CUSCO', 'LIMA']);
    // la licitación sin detalle sigue pendiente (se bajará de SEACE), no marcada como completa
    assert.equal(contarEstadoDatos().pendientesDetalle, 1);
  });

  test('conserva la marca de cuándo se sincronizó por última vez', () => {
    sembrarBase();
    const t = Date.parse('2026-10-18T12:00:00Z');
    assert.equal(exportarSemilla({ sincronizadoEn: t }).sincronizadoEn, '2026-10-18T12:00:00.000Z');
    assert.equal(exportarSemilla().sincronizadoEn, null);
  });
});

describe('la semilla es un dato externo: se valida', () => {
  beforeEach(vaciar);

  test('rechaza lo que no es una semilla válida', () => {
    assert.throws(() => leerSemilla(Buffer.from('esto no es gzip')));
    assert.throws(() => leerSemilla(zlib.gzipSync('{"version":999,"tenders":[]}')), /versión/);
    assert.throws(() => leerSemilla(zlib.gzipSync('{"version":1}')), /lista/);
    assert.throws(() => leerSemilla(zlib.gzipSync('no json')));
  });

  test('omite filas inválidas sin tumbar el resto', () => {
    const r = importarSemilla({
      version: 1,
      generadoEn: 'x',
      tenders: [
        { id: BASE + 10, codigo: 'OK', detalleOk: 0 },
        { id: 'no-es-numero', codigo: 'MAL' },
        { id: -5 },
        null,
        'texto',
        { id: BASE + 11, detalleOk: 1, items: 'no-es-lista', etapas: [] },
        { id: BASE + 12, detalleOk: 1, items: [{ producto: 'A', cantidad: 'no-numero', ciudad: 'LIMA/LIMA/LIMA' }], etapas: [] },
      ],
    });
    assert.equal(r.cargados, 2);
    assert.equal(r.omitidos, 5);
    const item = obtenerTenderDetalle(BASE + 12).items[0];
    assert.equal(item.cantidad, null, 'un tipo inesperado se descarta, no se guarda tal cual');
  });

  test('textos enormes se recortan (no se guardan sin límite)', () => {
    importarSemilla({ version: 1, tenders: [{ id: BASE + 20, codigo: 'x'.repeat(100_000) }] });
    assert.ok(obtenerTenderDetalle(BASE + 20).codigo.length <= 5000);
  });

  test('un contrato con una cantidad absurda de ítems se descarta', () => {
    const r = importarSemilla({
      version: 1,
      tenders: [{ id: BASE + 30, detalleOk: 1, items: Array.from({ length: 5000 }, () => ({ producto: 'x' })), etapas: [] }],
    });
    assert.equal(r.cargados, 0);
  });
});

describe('cargarSemillaSiVacia: de dónde sale y cuándo se usa', () => {
  beforeEach(vaciar);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seace-semilla-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function semillaBuffer() {
    sembrarBase();
    const buf = comprimirSemilla(exportarSemilla());
    vaciar();
    return buf;
  }
  const respuestaOk = (buf) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

  test('con la base vacía carga desde la URL remota', async () => {
    const buf = semillaBuffer();
    const info = await cargarSemillaSiVacia({
      log: silencio,
      urls: ['https://ejemplo.test/seed.json.gz'],
      archivos: [],
      fetchImpl: respuestaOk(buf),
    });
    assert.equal(info.cargados, 3);
    assert.equal(contarEstadoDatos().total, 3);
    assert.equal(contarEstadoDatos().conDetalle, 2);
  });

  test('si la URL falla, usa la copia incluida en el repo', async () => {
    const buf = semillaBuffer();
    const archivo = path.join(dir, 'respaldo.json.gz');
    fs.writeFileSync(archivo, buf);
    const info = await cargarSemillaSiVacia({
      log: silencio,
      urls: ['https://ejemplo.test/seed.json.gz'],
      archivos: [archivo],
      fetchImpl: async () => {
        throw new Error('sin red');
      },
    });
    assert.equal(info.origen, archivo);
    assert.equal(contarEstadoDatos().total, 3);
  });

  test('si la remota viene corrupta, también cae al respaldo', async () => {
    const buf = semillaBuffer();
    const archivo = path.join(dir, 'respaldo2.json.gz');
    fs.writeFileSync(archivo, buf);
    const info = await cargarSemillaSiVacia({
      log: silencio,
      urls: ['https://ejemplo.test/seed.json.gz'],
      archivos: [archivo],
      fetchImpl: respuestaOk(Buffer.from('basura')),
    });
    assert.equal(info.origen, archivo);
  });

  test('si no hay ninguna semilla usable, no lanza y la base queda vacía', async () => {
    const info = await cargarSemillaSiVacia({
      log: silencio,
      urls: ['https://ejemplo.test/seed.json.gz'],
      archivos: [path.join(dir, 'no-existe.json.gz')],
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    assert.equal(info, null);
    assert.equal(contarEstadoDatos().total, 0);
  });

  test('NO pisa una base que ya tiene datos', async () => {
    const buf = semillaBuffer();
    upsertTenderHeader(mapListRecordToTenderHeader(registro(BASE + 99)));
    let pidio = false;
    const info = await cargarSemillaSiVacia({
      log: silencio,
      urls: ['https://ejemplo.test/seed.json.gz'],
      archivos: [],
      fetchImpl: async (...a) => {
        pidio = true;
        return respuestaOk(buf)(...a);
      },
    });
    assert.equal(info, null);
    assert.equal(pidio, false, 'ni siquiera debe descargarla');
    assert.equal(contarEstadoDatos().total, 1);
  });
});

describe('GET /api/export', () => {
  beforeEach(vaciar);
  let server;
  after(() => server?.close());

  test('entrega la semilla comprimida y válida', async () => {
    sembrarBase();
    const base = await new Promise((resolve) => {
      server = createApp().listen(0, () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
    const res = await fetch(`${base}/api/export`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/gzip');
    const semilla = leerSemilla(Buffer.from(await res.arrayBuffer()));
    assert.equal(semilla.total, 3);
    assert.equal(semilla.conDetalle, 2);
  });
});
