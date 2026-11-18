import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  parsearFechaPortal,
  parsearListaClasica,
  parsearZonaSunarp,
  parsearZonasSunarp,
  parsearListaMinsa,
  totalMinsa,
  arreglarTitulo,
  normalizarEnlace,
} from '../src/entidades/parsers.js';
import { recolectarTodas, recolectarEntidad, comprimirEntidades } from '../src/entidades/recolector.js';
import { ENTIDADES, entidadPorId } from '../src/entidades/catalogo.js';
import {
  leerArchivoEntidades,
  validarEntidades,
  cargarEntidades,
  reiniciarEntidades,
  listarEntidades,
  listarRequerimientos,
  refrescarEntidades,
} from '../src/entidades/almacen.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const leer = (f) => fs.readFileSync(path.join(aqui, 'fixtures', 'entidades', f), 'utf8');

describe('fechas de los portales', () => {
  test('formatos de SUNARP, Sanipes y MINSA; la hora es de 24 h aunque diga am/pm', () => {
    assert.equal(parsearFechaPortal('2026-11-18 12:59'), '2026-11-18T12:59:00-05:00');
    assert.equal(parsearFechaPortal('2026-11-19 19:00 pm'), '2026-11-19T19:00:00-05:00');
    assert.equal(parsearFechaPortal('2026-11-19 09:09 am'), '2026-11-19T09:09:00-05:00');
    assert.equal(parsearFechaPortal('20/11/26 17:30 pm'), '2026-11-20T17:30:00-05:00');
    assert.equal(parsearFechaPortal('5/1/2027 8:05'), '2027-01-05T08:05:00-05:00');
  });
  test('lo que no se entiende da null', () => {
    for (const malo of [null, '', 'mañana', '2026-13-01 10:00', '2026-11-18', '31/02/26 25:00']) {
      assert.equal(parsearFechaPortal(malo), null, String(malo));
    }
  });
});

describe('arreglos de texto de origen', () => {
  test('"¿" suelto → guion y tildes en minúscula dentro de MAYÚSCULAS', () => {
    assert.equal(arreglarTitulo('AGENDA  ¿ 2027 PARA LA SUNARP'), 'AGENDA – 2027 PARA LA SUNARP');
    assert.equal(arreglarTitulo('ADQUISICIóN DE MEDICAMENTOS'), 'ADQUISICIÓN DE MEDICAMENTOS');
    assert.equal(arreglarTitulo('Adquisición de papel'), 'Adquisición de papel'); // mixto: no se toca
  });
  test('los enlaces con "/../" se normalizan y solo se aceptan http(s)', () => {
    assert.equal(normalizarEnlace('https://x.pe/../storage/a.pdf', 'https://x.pe/portal'), 'https://x.pe/storage/a.pdf');
    assert.equal(normalizarEnlace('javascript:alert(1)', 'https://x.pe/portal'), null);
  });
});

describe('lectores (páginas reales guardadas)', () => {
  test('SUNARP: zona con tipo, publicación, cierre y términos de referencia', () => {
    const r = parsearZonaSunarp(leer('sunarp-sede-central.html'), { base: 'https://8uit.sunarp.gob.pe/portal' });
    assert.equal(r.length, 5);
    assert.equal(r[0].id, '999416');
    assert.equal(r[0].tipo, 'Servicio');
    assert.equal(r[0].zona, 'SEDE CENTRAL');
    assert.equal(r[0].publicado, '2026-11-13T18:00:00-05:00');
    assert.equal(r[0].vence, '2026-11-18T12:59:00-05:00');
    assert.match(r[0].titulo, /^SERVICIO DE MANTENIMIENTO PREVENTIVO .* – SUNARP$/);
    assert.deepEqual(r[0].documentos, [
      { nombre: 'Términos de referencia', url: 'https://8uit.sunarp.gob.pe/storage/files2/terminos-de-referencia-preventivo-eak-k018f-1794610801.pdf' },
    ]);
    assert.equal(r.filter((x) => x.tipo === 'Bien').length, 2);
  });

  test('SUNARP: portada con las zonas y cuántas vigentes tiene cada una', () => {
    const z = parsearZonasSunarp(leer('sunarp-inicio.html'));
    assert.ok(z.length >= 4);
    assert.equal(z[0].url, 'https://8uit.sunarp.gob.pe/portal/zona-registral/sede-central');
    assert.equal(z[0].vigentes, 5);
    assert.equal(z.find((x) => x.url.endsWith('sede-chiclayo')).vigentes, 0);
  });

  for (const [archivo, base, cantidad, primero] of [
    ['sanipes.html', 'https://requerimiento8uit.sanipes.gob.pe/portal', 8, 'SERVICIO DE MANTENIMIENTO PREVENTIVO DE EQUIPOS PARA LOS LABORATORIOS DE LA DSI.'],
    ['sbn.html', 'https://8uit.sbn.gob.pe/portal', 5, '2DA REFORMULACION: SERVICIO DE CONTRATACIÓN SEGURO DE FORMACIÓN LABORAL PARA PRACTICANTES - FOLA'],
    ['ventanilla.html', 'https://8uit.hospitaldeventanilla.gob.pe/8uits/public/portal', 5, 'ADQUISICION DE MEDICAMENTOS'],
  ]) {
    test(`lista clásica: ${archivo}`, () => {
      const r = parsearListaClasica(leer(archivo), { base });
      assert.equal(r.length, cantidad);
      assert.equal(r[0].titulo, primero);
      assert.ok(r.every((x) => x.id && x.vence && /^\d{4}-\d\d-\d\dT/.test(x.vence)));
      assert.ok(r.every((x) => x.tipo === 'Bien' || x.tipo === 'Servicio'));
      assert.ok(r.every((x) => x.documentos.length >= 1 && x.documentos[0].url.startsWith('https://')));
      assert.ok(r.every((x) => !x.documentos[0].url.includes('/../')));
    });
  }

  test('MINSA: 10 por página, total anunciado, tipo recibido y enlace propio', () => {
    const html = leer('minsa-p1.html');
    const r = parsearListaMinsa(html, { base: 'https://8uit.minsa.gob.pe/portal', tipo: 'Bien' });
    assert.equal(r.length, 10);
    assert.equal(totalMinsa(html), 23);
    assert.equal(r[0].id, '3769');
    assert.equal(r[0].tipo, 'Bien');
    assert.equal(r[0].vence, '2026-11-20T17:30:00-05:00');
    assert.equal(r[0].enlace, 'https://8uit.minsa.gob.pe/portal/3769/convocatoria');
    assert.match(r[0].documentos[0].url, /^https:\/\/8uit\.minsa\.gob\.pe\/files_convocatoria\//);
  });

  test('HTML vacío o ajeno no rompe: devuelve lista vacía', () => {
    assert.deepEqual(parsearListaClasica('<html></html>', { base: 'https://x.pe/portal' }), []);
    assert.deepEqual(parsearZonaSunarp('', { base: 'https://x.pe/portal' }), []);
    assert.deepEqual(parsearListaMinsa('<h2 class="h2 card-title">Sin fecha</h2>', { base: 'https://x.pe/portal' }), []);
  });
});

// Descargador falso que responde con las páginas guardadas.
function descargadorDePrueba() {
  const paginas = {
    'https://8uit.sunarp.gob.pe/portal': leer('sunarp-inicio.html'),
    'https://8uit.sunarp.gob.pe/portal/zona-registral/sede-central': leer('sunarp-sede-central.html'),
    'https://8uit.sbn.gob.pe/portal': leer('sbn.html'),
    'https://requerimiento8uit.sanipes.gob.pe/portal': leer('sanipes.html'),
    'https://8uit.hospitaldeventanilla.gob.pe/8uits/public/portal': leer('ventanilla.html'),
  };
  const minsa = leer('minsa-p1.html');
  const pedidos = [];
  const descargar = async (url) => {
    pedidos.push(url);
    if (url.startsWith('https://8uit.minsa.gob.pe/portal?type=')) return url.endsWith('page=1') && url.includes('type=B') ? minsa : '<html></html>';
    if (url in paginas) return paginas[url];
    if (url.includes('/zona-registral/')) return '<html></html>'; // zonas que no tenemos guardadas
    throw new Error('HTTP 404');
  };
  return { descargar, pedidos };
}

describe('recolector', () => {
  test('SUNARP lee solo las zonas con requerimientos vigentes', async () => {
    const { descargar, pedidos } = descargadorDePrueba();
    const r = await recolectarEntidad(entidadPorId('sunarp'), descargar);
    assert.equal(r.length, 5);
    assert.ok(!pedidos.some((u) => u.endsWith('sede-chiclayo')), 'no pide la zona sin vigentes');
  });

  test('MINSA pide Bienes y Servicios por separado y deja de pedir páginas al llegar al total', async () => {
    const { descargar, pedidos } = descargadorDePrueba();
    const r = await recolectarEntidad(entidadPorId('minsa'), descargar);
    assert.equal(r.length, 10);
    assert.ok(r.every((x) => x.tipo === 'Bien'));
    assert.ok(pedidos.some((u) => u.includes('type=S')));
    assert.ok(pedidos.filter((u) => u.includes('type=B')).length <= 2);
  });

  test('si una entidad falla se conserva lo anterior y se anota el error', async () => {
    const { descargar } = descargadorDePrueba();
    const primera = await recolectarTodas({ descargar, ahora: new Date('2026-11-18T10:00:00Z') });
    assert.equal(primera.entidades.length, ENTIDADES.length);
    assert.ok(primera.entidades.every((e) => e.error === null));

    const roto = async (url) => {
      if (url.includes('sbn')) throw new Error('fetch failed');
      return descargar(url);
    };
    const segunda = await recolectarTodas({ previo: primera, descargar: roto, ahora: new Date('2026-11-18T13:00:00Z') });
    const sbn = segunda.entidades.find((e) => e.id === 'sbn');
    assert.equal(sbn.error, 'fetch failed');
    assert.equal(sbn.requerimientos.length, 5, 'conserva lo anterior');
    assert.equal(sbn.actualizadoEn, '2026-11-18T10:00:00.000Z', 'con la fecha en que sí se leyó');
    assert.equal(segunda.entidades.find((e) => e.id === 'sanipes').error, null);
  });

  test('sin datos previos, una entidad caída queda vacía (no inventa)', async () => {
    const { descargar } = descargadorDePrueba();
    const roto = async (url) => {
      if (url.includes('sanipes')) throw new Error('HTTP 503');
      return descargar(url);
    };
    const r = await recolectarTodas({ descargar: roto });
    const s = r.entidades.find((e) => e.id === 'sanipes');
    assert.deepEqual([s.requerimientos.length, s.actualizadoEn], [0, null]);
  });
});

describe('almacén: validación, listado y filtros', () => {
  const AHORA = new Date('2026-11-18T10:00:00-05:00');
  const archivo = {
    version: 1,
    generadoEn: '2026-11-18T14:00:00.000Z',
    entidades: [
      {
        id: 'sunarp',
        actualizadoEn: '2026-11-18T14:00:00.000Z',
        error: null,
        requerimientos: [
          { id: '1', tipo: 'Bien', titulo: 'ADQUISICIÓN DE TÓNER', zona: 'SEDE CENTRAL', publicado: '2026-11-17T10:00:00-05:00', vence: '2026-11-20T10:00:00-05:00', documentos: [{ nombre: 'TDR', url: 'https://a.pe/x.pdf' }] },
          { id: '2', tipo: 'Servicio', titulo: 'SERVICIO DE LIMPIEZA', zona: 'ZONA N° IX', publicado: '2026-11-18T08:00:00-05:00', vence: '2026-11-19T10:00:00-05:00', documentos: [] },
          { id: '3', tipo: 'Bien', titulo: 'PAPEL TÉRMICO', zona: 'SEDE CENTRAL', publicado: null, vence: '2026-11-17T10:00:00-05:00', documentos: [] }, // vencido
          { id: '4', tipo: 'Bien', titulo: '', vence: '2026-11-20T10:00:00-05:00' }, // sin título: se descarta
          { id: '5', tipo: 'Otro', titulo: 'Raro', vence: '2026-11-21T10:00:00-05:00', documentos: [{ nombre: 'x', url: 'javascript:alert(1)' }] },
        ],
      },
      { id: 'desconocida', requerimientos: [{ id: '9', titulo: 'x', vence: '2026-12-01T10:00:00-05:00' }] },
    ],
  };

  test('valida: descarta lo malformado, tipos raros pasan a null y enlaces no http se quitan', () => {
    const v = validarEntidades(archivo);
    assert.equal(v.porEntidad.size, 1, 'entidades fuera del catálogo se ignoran');
    const rs = v.porEntidad.get('sunarp').requerimientos;
    assert.deepEqual(rs.map((r) => r.id), ['1', '2', '3', '5']);
    assert.equal(rs[3].tipo, null);
    assert.deepEqual(rs[3].documentos, []);
  });

  test('rechaza formatos desconocidos', () => {
    assert.throws(() => validarEntidades({ version: 2, entidades: [] }));
    assert.throws(() => validarEntidades(null));
    assert.throws(() => leerArchivoEntidades(Buffer.from('no es gzip')));
  });

  test('listar entidades cuenta solo lo vigente y no devuelve vencidos', () => {
    cargarEntidades(validarEntidades(archivo));
    const l = listarEntidades(AHORA);
    assert.equal(l.datosAl, '2026-11-18T14:00:00.000Z');
    assert.equal(l.entidades.length, ENTIDADES.length);
    assert.equal(l.entidades.find((e) => e.id === 'sunarp').vigentes, 3);
    assert.equal(l.entidades.find((e) => e.id === 'sbn').vigentes, 0);
    const r = listarRequerimientos('sunarp', { ahora: AHORA });
    assert.deepEqual(r.data.map((x) => x.id), ['2', '1', '5'], 'cierra primero el que vence antes');
    assert.deepEqual(r.zonas, ['SEDE CENTRAL', 'ZONA N° IX']);
  });

  test('filtra por texto (sin tildes), tipo y zona; pagina', () => {
    cargarEntidades(validarEntidades(archivo));
    assert.deepEqual(listarRequerimientos('sunarp', { q: 'toner', ahora: AHORA }).data.map((x) => x.id), ['1']);
    assert.deepEqual(listarRequerimientos('sunarp', { tipo: 'Servicio', ahora: AHORA }).data.map((x) => x.id), ['2']);
    assert.deepEqual(listarRequerimientos('sunarp', { zona: 'SEDE CENTRAL', ahora: AHORA }).data.map((x) => x.id), ['1']);
    const p = listarRequerimientos('sunarp', { pageSize: 2, page: 2, ahora: AHORA });
    assert.equal(p.total, 3);
    assert.equal(p.data.length, 1);
    assert.equal(listarRequerimientos('no-existe'), null);
  });

  test('un requerimiento sin enlace propio apunta al portal de la entidad', () => {
    cargarEntidades(validarEntidades(archivo));
    const r = listarRequerimientos('sunarp', { ahora: AHORA });
    assert.equal(r.data[0].enlace, 'https://8uit.sunarp.gob.pe/portal');
  });

  test('refrescar descarga el archivo, ignora uno más viejo y no lanza si falla', async () => {
    reiniciarEntidades();
    const gz = comprimirEntidades(archivo);
    const ok = async () => ({ ok: true, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) });
    const log = () => {};
    assert.equal((await refrescarEntidades({ url: 'https://x.pe/e.gz', fetchImpl: ok, log })).actualizado, true);
    assert.equal((await refrescarEntidades({ url: 'https://x.pe/e.gz', fetchImpl: ok, log })).motivo, 'al-dia');
    const caido = async () => ({ ok: false, status: 503 });
    assert.equal((await refrescarEntidades({ url: 'https://x.pe/e.gz', fetchImpl: caido, log })).motivo, 'error');
    assert.equal(listarEntidades(AHORA).datosAl, '2026-11-18T14:00:00.000Z', 'lo cargado se mantiene');
    assert.equal(zlib.gunzipSync(gz).length > 0, true);
  });
});

describe('API /api/entidades', () => {
  const app = createApp();
  let server;
  let base;

  test('arranca', async () => {
    cargarEntidades(
      validarEntidades({
        version: 1,
        generadoEn: '2099-01-01T00:00:00.000Z',
        entidades: [
          {
            id: 'sbn',
            actualizadoEn: '2099-01-01T00:00:00.000Z',
            requerimientos: [{ id: '7', tipo: 'Bien', titulo: 'COMPRA DE PRUEBA', vence: '2099-12-31T10:00:00-05:00', documentos: [] }],
          },
        ],
      }),
    );
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  test('GET /api/entidades lista el catálogo con sus vigentes', async () => {
    const body = await (await fetch(`${base}/api/entidades`)).json();
    assert.equal(body.entidades.length, ENTIDADES.length);
    assert.equal(body.entidades.find((e) => e.id === 'sbn').vigentes, 1);
  });

  test('GET /api/entidades/:id/requerimientos filtra y valida parámetros', async () => {
    const ok = await (await fetch(`${base}/api/entidades/sbn/requerimientos?q=prueba&tipo=Bien`)).json();
    assert.equal(ok.total, 1);
    assert.equal(ok.data[0].enlace, 'https://8uit.sbn.gob.pe/portal');
    const sinTipo = await (await fetch(`${base}/api/entidades/sbn/requerimientos?tipo=Servicio`)).json();
    assert.equal(sinTipo.total, 0);
    const basura = await fetch(`${base}/api/entidades/sbn/requerimientos?tipo=%27%3Bdrop&page=abc&pageSize=99999`);
    assert.equal(basura.status, 200);
    assert.equal((await basura.json()).pageSize, 100);
    assert.equal((await fetch(`${base}/api/entidades/nada/requerimientos`)).status, 404);
  });

  after(() => {
    server?.close();
    reiniciarEntidades();
  });
});
