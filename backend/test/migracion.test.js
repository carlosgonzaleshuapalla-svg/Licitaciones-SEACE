import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Esquema ANTERIOR: items con id_item (id de catálogo, repetido) como clave
// primaria y tenders sin detalle_ok. Es el que tienen las bases ya creadas.
function crearBaseVieja(archivo) {
  const viejo = new Database(archivo);
  viejo.exec(`
    CREATE TABLE tenders (
      id_contrato INTEGER PRIMARY KEY, codigo TEXT, entidad TEXT, objeto TEXT,
      descripcion TEXT, estado TEXT, fecha_publicacion TEXT, cotizacion_inicio TEXT,
      cotizacion_fin TEXT, cantidad_items INTEGER NOT NULL DEFAULT 0,
      es_producto_rapido INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE items (
      id_item INTEGER PRIMARY KEY, id_contrato INTEGER NOT NULL REFERENCES tenders(id_contrato) ON DELETE CASCADE,
      producto TEXT, cantidad REAL, unidad_medida TEXT, ciudad TEXT
    );
    INSERT INTO tenders (id_contrato, codigo, updated_at, cantidad_items) VALUES (1, 'A', 'x', 1), (2, 'B', 'x', 1);
    INSERT INTO items (id_item, id_contrato, producto) VALUES (1509, 2, 'DIESEL');
  `);
  viejo.close();
}

describe('migración de una base con el esquema anterior', () => {
  test('recrea items con clave propia y marca todo el detalle como pendiente (sin perder cabeceras)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'seace-mig-'));
    const archivo = path.join(dir, 'vieja.db');
    try {
      crearBaseVieja(archivo);

      // Carga db.js (que migra al importarse) en un proceso aparte apuntando a esa base.
      const salida = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
          import { db, contarEstadoDatos } from './src/db.js';
          const cols = db.pragma('table_info(items)').map((c) => c.name);
          console.log(JSON.stringify({ cols, estado: contarEstadoDatos() }));
          `,
        ],
        { cwd: backendDir, env: { ...process.env, SEACE_DB_PATH: archivo }, encoding: 'utf8' },
      );
      const { cols, estado } = JSON.parse(salida.trim().split('\n').pop());

      assert.ok(cols.includes('id'), 'items debe tener clave propia');
      assert.ok(cols.includes('id_item'));
      assert.equal(estado.total, 2, 'las cabeceras no se pierden');
      assert.equal(estado.pendientesDetalle, 2, 'todo el detalle queda pendiente para volver a bajarlo bien');

      // Una segunda carga ya no vuelve a migrar ni a invalidar nada.
      const otra = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { db, contarEstadoDatos } from './src/db.js';
           db.prepare('UPDATE tenders SET detalle_ok = 1 WHERE id_contrato = 1').run();
           console.log(JSON.stringify(contarEstadoDatos()));`,
        ],
        { cwd: backendDir, env: { ...process.env, SEACE_DB_PATH: archivo }, encoding: 'utf8' },
      );
      const e2 = JSON.parse(otra.trim().split('\n').pop());
      assert.equal(e2.conDetalle, 1);
      const tercera = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `import { contarEstadoDatos } from './src/db.js'; console.log(JSON.stringify(contarEstadoDatos()));`],
        { cwd: backendDir, env: { ...process.env, SEACE_DB_PATH: archivo }, encoding: 'utf8' },
      );
      assert.equal(JSON.parse(tercera.trim().split('\n').pop()).conDetalle, 1, 'reabrir la base no debe resetear el avance');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
