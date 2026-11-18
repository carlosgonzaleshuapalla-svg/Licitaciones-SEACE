import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader, replaceTenderDetail } from '../src/db.js';
import { mapListRecordToTenderHeader } from '../src/syncService.js';
import { listarTenders, obtenerTenderDetalle } from '../src/tendersRepo.js';
import { revisarBases, revisarBasesPendientes } from '../src/bases.js';
import { exportarSemilla, comprimirSemilla, leerSemilla, importarSemilla } from '../src/semilla.js';
import { SeaceBloqueadoError } from '../src/seaceClient.js';

const BASE = 999993000;
const vaciar = () => db.prepare('DELETE FROM tenders').run();
const TEXTO_LARGO = 'ESPECIFICACIONES TECNICAS DEL BIEN A ADQUIRIR PARA LA ENTIDAD CON TODOS LOS DETALLES NECESARIOS DEL REQUERIMIENTO. ';

/** Cliente falso: `anexos[id]` es la lista de archivos; `archivos[idArchivo]` el contenido. */
function clienteFalso({ anexos = {}, archivos = {}, bloquearEn = null } = {}) {
  const llamadas = { listar: [], descargar: [] };
  return {
    llamadas,
    async listarAnexos(id) {
      llamadas.listar.push(id);
      if (id === bloquearEn) throw new SeaceBloqueadoError(403, 'x');
      return anexos[id] ?? [];
    },
    async descargarArchivo(idArchivo) {
      llamadas.descargar.push(idArchivo);
      if (!(idArchivo in archivos)) throw new Error('HTTP 500');
      return archivos[idArchivo];
    },
  };
}
const pdf = (idContratoArchivo, tamanio = 1000) => ({ idContratoArchivo, nombre: `a${idContratoArchivo}.pdf`, descripcionExtension: '.pdf', tamanio: String(tamanio) });
const leerDe = (mapa) => async (buffer) => mapa[buffer.toString()] ?? '';

function altaBien(id, { cierre = '01/01/2099 10:00:00', objeto = 'Bien', conDetalle = true } = {}) {
  upsertTenderHeader(mapListRecordToTenderHeader({
    idContrato: id, desContratacion: `CM-B-${id}`, nomEntidad: 'E', nomObjetoContrato: objeto,
    desObjetoContrato: 'PRUEBA BASES', nomEstadoContrato: 'Vigente',
    fecPublica: '01/01/2026 10:00:00', fecIniCotizacion: '01/01/2026 10:00:00', fecFinCotizacion: cierre,
  }));
  if (conDetalle) replaceTenderDetail(id, [], []);
}

describe('revisarBases (un contrato)', () => {
  test('sin archivos: "sin-anexo"', async () => {
    const r = await revisarBases({ client: clienteFalso(), idContrato: 1, leerTexto: leerDe({}) });
    assert.deepEqual(r, { estado: 'sin-anexo' });
  });

  test('lee el PDF y detecta la exigencia, con su frase', async () => {
    const client = clienteFalso({ anexos: { 1: [pdf(10)] }, archivos: { 10: Buffer.from('a') } });
    const leerTexto = leerDe({ a: `${TEXTO_LARGO}El postor debe acreditar experiencia en ventas de bienes similares por un monto acumulado.` });
    const r = await revisarBases({ client, idContrato: 1, leerTexto });
    assert.equal(r.estado, 'leido');
    assert.equal(r.exige, 1);
    assert.equal(r.fuente, 'anexo');
    assert.match(r.nota, /ventas de bienes similares/);
  });

  test('leído y sin mención: exige 0 (esto es lo único que cuenta como "sin experiencia")', async () => {
    const client = clienteFalso({ anexos: { 1: [pdf(10)] }, archivos: { 10: Buffer.from('a') } });
    const r = await revisarBases({ client, idContrato: 1, leerTexto: leerDe({ a: TEXTO_LARGO.repeat(3) }) });
    assert.equal(r.estado, 'leido');
    assert.equal(r.exige, 0);
  });

  test('texto casi vacío (escaneo que el OCR no pudo leer): "ilegible", no "sin experiencia"', async () => {
    const client = clienteFalso({ anexos: { 1: [pdf(10)] }, archivos: { 10: Buffer.from('a') } });
    const r = await revisarBases({ client, idContrato: 1, leerTexto: leerDe({ a: '--- Página 1 ---\n' }) });
    assert.equal(r.estado, 'ilegible');
    assert.equal(r.exige, undefined);
  });

  test('solo archivos que no sabemos leer: "no-soportado" y no se descargan', async () => {
    const client = clienteFalso({ anexos: { 1: [{ idContratoArchivo: 11, nombre: 'x.xls', descripcionExtension: '.xls', tamanio: '10' }] } });
    const r = await revisarBases({ client, idContrato: 1, leerTexto: leerDe({}) });
    assert.equal(r.estado, 'no-soportado');
    assert.deepEqual(client.llamadas.descargar, []);
  });

  test('un archivo muy grande no se descarga', async () => {
    const client = clienteFalso({ anexos: { 1: [pdf(10, 50 * 1024 * 1024)] } });
    const r = await revisarBases({ client, idContrato: 1, leerTexto: leerDe({}) });
    assert.equal(r.estado, 'ilegible');
    assert.deepEqual(client.llamadas.descargar, []);
  });

  test('si hay varios archivos, basta que uno pida la experiencia', async () => {
    const client = clienteFalso({
      anexos: { 1: [pdf(10), pdf(11)] },
      archivos: { 10: Buffer.from('a'), 11: Buffer.from('b') },
    });
    const leerTexto = leerDe({ a: TEXTO_LARGO.repeat(2), b: `${TEXTO_LARGO}Se exige experiencia mínima de 2 años en el rubro.` });
    assert.equal((await revisarBases({ client, idContrato: 1, leerTexto })).exige, 1);
  });
});

describe('revisarBasesPendientes (todos los Bienes abiertos)', () => {
  beforeEach(vaciar);

  test('solo revisa Bienes con detalle y plazo abierto, los que cierran antes primero, y no repite lo ya revisado', async () => {
    altaBien(BASE + 1, { cierre: '30/12/2099 10:00:00' });
    altaBien(BASE + 2, { cierre: '05/12/2099 10:00:00' });
    altaBien(BASE + 3, { objeto: 'Servicio' });
    altaBien(BASE + 4, { cierre: '01/01/2020 10:00:00' }); // plazo vencido
    altaBien(BASE + 5, { conDetalle: false });
    const client = clienteFalso({ anexos: { [BASE + 1]: [pdf(10)], [BASE + 2]: [pdf(11)] }, archivos: { 10: Buffer.from('a'), 11: Buffer.from('b') } });
    const leerTexto = leerDe({ a: TEXTO_LARGO.repeat(2), b: `${TEXTO_LARGO}El postor debe acreditar experiencia en ventas similares.` });

    const r = await revisarBasesPendientes({ client, leerTexto });
    assert.equal(r.revisadas, 2);
    assert.equal(r.conExperiencia, 1);
    assert.deepEqual(client.llamadas.listar, [BASE + 2, BASE + 1]); // 05/12 antes que 30/12

    assert.equal(obtenerTenderDetalle(BASE + 2).exigeExperiencia, true);
    assert.equal(obtenerTenderDetalle(BASE + 2).experienciaFuente, 'anexo');
    assert.equal(obtenerTenderDetalle(BASE + 1).basesEstado, 'leido');
    assert.equal(obtenerTenderDetalle(BASE + 3).basesEstado, null);

    // segunda corrida: nada nuevo, no pide nada
    const client2 = clienteFalso();
    const r2 = await revisarBasesPendientes({ client: client2, leerTexto });
    assert.equal(r2.pendientes, 0);
    assert.deepEqual(client2.llamadas.listar, []);

    // el filtro "sin" solo trae lo leído y sin exigencia
    const ids = (f) => listarTenders({ q: 'PRUEBA BASES', pageSize: 20, ...f }).data.map((t) => t.idContrato);
    assert.deepEqual(ids({ experiencia: 'sin' }), [BASE + 1]);
    assert.deepEqual(ids({ experiencia: 'con' }), [BASE + 2]);
  });

  test('si SEACE bloquea, se detiene sin error y lo pendiente sigue pendiente', async () => {
    altaBien(BASE + 10, { cierre: '01/12/2099 10:00:00' });
    altaBien(BASE + 11, { cierre: '02/12/2099 10:00:00' });
    const client = clienteFalso({ anexos: { [BASE + 10]: [] }, bloquearEn: BASE + 11 });
    const r = await revisarBasesPendientes({ client, leerTexto: leerDe({}) });
    assert.equal(r.bloqueado, true);
    assert.equal(r.revisadas, 1); // BASE+10 quedó 'sin-anexo'
    assert.equal(obtenerTenderDetalle(BASE + 11).basesEstado, null);
  });

  test('un fallo de un contrato queda como "error" y se reintenta en la siguiente corrida', async () => {
    altaBien(BASE + 20);
    const client = clienteFalso({ anexos: { [BASE + 20]: [pdf(99)] } }); // la descarga falla (HTTP 500)
    const r = await revisarBasesPendientes({ client, leerTexto: leerDe({}) });
    assert.equal(r.errores, 1);
    assert.equal(obtenerTenderDetalle(BASE + 20).basesEstado, 'error');

    const bueno = clienteFalso({ anexos: { [BASE + 20]: [pdf(99)] }, archivos: { 99: Buffer.from('a') } });
    const r2 = await revisarBasesPendientes({ client: bueno, leerTexto: leerDe({ a: TEXTO_LARGO.repeat(2) }) });
    assert.equal(r2.revisadas, 1);
    assert.equal(obtenerTenderDetalle(BASE + 20).basesEstado, 'leido');
  });

  test('lo que ya decía la descripción no se pierde si el anexo no lo repite', async () => {
    altaBien(BASE + 30);
    db.prepare(`UPDATE tenders SET exige_experiencia = 1, nota_experiencia = 'POSTOR DEBE ACREDITAR EXPERIENCIA', experiencia_fuente = 'descripcion' WHERE id_contrato = ?`).run(BASE + 30);
    const client = clienteFalso({ anexos: { [BASE + 30]: [pdf(5)] }, archivos: { 5: Buffer.from('a') } });
    await revisarBasesPendientes({ client, leerTexto: leerDe({ a: TEXTO_LARGO.repeat(2) }) });
    const d = obtenerTenderDetalle(BASE + 30);
    assert.equal(d.exigeExperiencia, true);
    assert.equal(d.experienciaFuente, 'descripcion');
    assert.equal(d.basesEstado, 'leido');
  });

  test('tiempo agotado: corta y avisa', async () => {
    altaBien(BASE + 40);
    const r = await revisarBasesPendientes({ client: clienteFalso(), leerTexto: leerDe({}), maxMs: -1 });
    assert.equal(r.cortadoPorTiempo, true);
    assert.equal(r.revisadas, 0);
  });
});

describe('las bases viajan en la semilla', () => {
  beforeEach(vaciar);

  test('estado, fuente y frase se exportan y se reimportan', async () => {
    altaBien(BASE + 50);
    const client = clienteFalso({ anexos: { [BASE + 50]: [pdf(7)] }, archivos: { 7: Buffer.from('a') } });
    await revisarBasesPendientes({ client, leerTexto: leerDe({ a: `${TEXTO_LARGO}Debe acreditar experiencia en ventas similares.` }) });
    const semilla = leerSemilla(comprimirSemilla(exportarSemilla()));
    vaciar();
    importarSemilla(semilla);
    const d = obtenerTenderDetalle(BASE + 50);
    assert.equal(d.basesEstado, 'leido');
    assert.equal(d.exigeExperiencia, true);
    assert.equal(d.experienciaFuente, 'anexo');
    assert.match(d.notaExperiencia, /experiencia/i);
  });
});
