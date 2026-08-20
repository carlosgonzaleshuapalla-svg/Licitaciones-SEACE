import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
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

  test('responde { ok: true }', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
  });

  test('GET /api/meta responde con departamentos y estados como arrays', async () => {
    const res = await fetch(`${baseUrl}/api/meta`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.departamentos));
    assert.ok(Array.isArray(body.estados));
  });

  after(() => {
    server?.close();
  });
});
