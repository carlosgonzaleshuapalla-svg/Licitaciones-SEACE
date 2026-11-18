import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearClienteSeace, SeaceBloqueadoError, MAX_BYTES_ARCHIVO } from '../src/seaceClient.js';

const respuesta = ({ status = 200, cuerpo = Buffer.from('x'), json, longitud } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: (k) => (k.toLowerCase() === 'content-length' && longitud !== undefined ? String(longitud) : null) },
  json: async () => json,
  arrayBuffer: async () => cuerpo.buffer.slice(cuerpo.byteOffset, cuerpo.byteOffset + cuerpo.byteLength),
});

describe('cliente de SEACE: anexos de la contratación', () => {
  test('lista los archivos de la categoría 1 de ese contrato', async () => {
    const urls = [];
    const c = crearClienteSeace({ minIntervalMs: 0, fetchImpl: async (u) => { urls.push(u); return respuesta({ json: [{ idContratoArchivo: 5 }] }); } });
    const r = await c.listarAnexos('111339');
    assert.deepEqual(r, [{ idContratoArchivo: 5 }]);
    assert.match(urls[0], /archivos-publico\/listar-archivos-contrato\/111339\/1$/);
  });

  test('el id se fuerza a número (no se cuela texto en la URL)', async () => {
    const urls = [];
    const c = crearClienteSeace({ minIntervalMs: 0, fetchImpl: async (u) => { urls.push(u); return respuesta({ json: [] }); } });
    await c.listarAnexos('1/../../x');
    assert.match(urls[0], /\/NaN\/1$/);
  });

  test('descarga el archivo como Buffer', async () => {
    const c = crearClienteSeace({ minIntervalMs: 0, fetchImpl: async () => respuesta({ cuerpo: Buffer.from('%PDF-1.4 hola') }) });
    const b = await c.descargarArchivo(445396);
    assert.ok(Buffer.isBuffer(b));
    assert.equal(b.toString(), '%PDF-1.4 hola');
  });

  test('rechaza por el tamaño declarado sin bajar el cuerpo, y no reintenta', async () => {
    let pedidos = 0;
    const c = crearClienteSeace({ minIntervalMs: 0, fetchImpl: async () => { pedidos++; return respuesta({ longitud: MAX_BYTES_ARCHIVO + 1 }); } });
    await assert.rejects(c.descargarArchivo(1), (e) => e.demasiadoGrande === true);
    assert.equal(pedidos, 1);
  });

  test('un 403 en la descarga lanza SeaceBloqueadoError', async () => {
    const c = crearClienteSeace({ minIntervalMs: 0, fetchImpl: async () => respuesta({ status: 403 }) });
    await assert.rejects(c.descargarArchivo(1), SeaceBloqueadoError);
  });
});
