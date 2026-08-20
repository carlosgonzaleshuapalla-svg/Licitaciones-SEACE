import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { listarTenders } from '../src/tendersRepo.js';

describe('cabeceras de seguridad (helmet)', () => {
  const app = createApp();
  let server;
  let baseUrl;

  test('arranca un servidor efímero', async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  test('las respuestas traen cabeceras de seguridad y no exponen X-Powered-By', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  after(() => {
    server?.close();
  });
});

describe('rate limiting en /api/*', () => {
  const app = createApp();
  let server;
  let baseUrl;

  test('arranca un servidor efímero', async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  test('después del límite (120/min), responde 429 en vez de seguir aceptando', async () => {
    let ultimaRespuesta;
    for (let i = 0; i < 121; i++) {
      ultimaRespuesta = await fetch(`${baseUrl}/api/health`);
    }
    assert.equal(ultimaRespuesta.status, 429);
    const body = await ultimaRespuesta.json();
    assert.match(body.error, /demasiadas solicitudes/i);
  });

  after(() => {
    server?.close();
  });
});

describe('pageSize sin techo (abuso de memoria/ancho de banda)', () => {
  test('un pageSize enorme se recorta a 100, no se respeta tal cual', () => {
    const { pageSize } = listarTenders({ page: 1, pageSize: 999999 });
    assert.equal(pageSize, 100);
  });

  test('un pageSize razonable se respeta sin cambios', () => {
    const { pageSize } = listarTenders({ page: 1, pageSize: 20 });
    assert.equal(pageSize, 20);
  });
});
