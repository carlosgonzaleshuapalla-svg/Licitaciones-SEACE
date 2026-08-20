import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.SEACE_DB_PATH || path.join(DATA_DIR, 'seace.db');

if (DB_PATH !== ':memory:' && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Cierra la conexión limpiamente al salir: evita que better-sqlite3 finalice
// statements nativos vía GC durante el shutdown del proceso (causa crashes
// nativos intermitentes en algunas versiones de Node).
process.once('exit', () => {
  try {
    db.close();
  } catch {
    // ya cerrada o proceso terminando de forma anómala, no hay nada que hacer
  }
});

db.exec(`
  CREATE TABLE IF NOT EXISTS tenders (
    id_contrato        INTEGER PRIMARY KEY,
    codigo             TEXT,
    entidad            TEXT,
    objeto             TEXT,
    descripcion        TEXT,
    estado             TEXT,
    fecha_publicacion  TEXT,
    cotizacion_inicio  TEXT,
    cotizacion_fin     TEXT,
    cantidad_items     INTEGER NOT NULL DEFAULT 0,
    es_producto_rapido INTEGER NOT NULL DEFAULT 0,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id_item       INTEGER PRIMARY KEY,
    id_contrato   INTEGER NOT NULL REFERENCES tenders(id_contrato) ON DELETE CASCADE,
    producto      TEXT,
    cantidad      REAL,
    unidad_medida TEXT,
    ciudad        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_items_id_contrato ON items(id_contrato);

  CREATE TABLE IF NOT EXISTS etapas (
    id_contrato_etapa INTEGER PRIMARY KEY,
    id_contrato       INTEGER NOT NULL REFERENCES tenders(id_contrato) ON DELETE CASCADE,
    nombre            TEXT,
    inicio            TEXT,
    fin               TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_etapas_id_contrato ON etapas(id_contrato);

  -- Departamento por contrato, derivado del primer segmento de nomDistrito
  -- de cada item ("DEPARTAMENTO/PROVINCIA/DISTRITO"). Tabla normalizada
  -- para poder filtrar por igualdad exacta (no LIKE sobre un CSV).
  CREATE TABLE IF NOT EXISTS tender_departamentos (
    id_contrato INTEGER NOT NULL REFERENCES tenders(id_contrato) ON DELETE CASCADE,
    departamento TEXT NOT NULL,
    PRIMARY KEY (id_contrato, departamento)
  );
  CREATE INDEX IF NOT EXISTS idx_tender_departamentos_dep ON tender_departamentos(departamento);
`);

const upsertTenderStmt = db.prepare(`
  INSERT INTO tenders (
    id_contrato, codigo, entidad, objeto, descripcion, estado,
    fecha_publicacion, cotizacion_inicio, cotizacion_fin,
    cantidad_items, es_producto_rapido, updated_at
  ) VALUES (
    @id_contrato, @codigo, @entidad, @objeto, @descripcion, @estado,
    @fecha_publicacion, @cotizacion_inicio, @cotizacion_fin,
    @cantidad_items, @es_producto_rapido, @updated_at
  )
  ON CONFLICT(id_contrato) DO UPDATE SET
    codigo = excluded.codigo,
    entidad = excluded.entidad,
    objeto = excluded.objeto,
    descripcion = excluded.descripcion,
    estado = excluded.estado,
    fecha_publicacion = excluded.fecha_publicacion,
    cotizacion_inicio = excluded.cotizacion_inicio,
    cotizacion_fin = excluded.cotizacion_fin,
    cantidad_items = excluded.cantidad_items,
    es_producto_rapido = excluded.es_producto_rapido,
    updated_at = excluded.updated_at
`);

const upsertItemStmt = db.prepare(`
  INSERT INTO items (id_item, id_contrato, producto, cantidad, unidad_medida, ciudad)
  VALUES (@id_item, @id_contrato, @producto, @cantidad, @unidad_medida, @ciudad)
  ON CONFLICT(id_item) DO UPDATE SET
    id_contrato = excluded.id_contrato,
    producto = excluded.producto,
    cantidad = excluded.cantidad,
    unidad_medida = excluded.unidad_medida,
    ciudad = excluded.ciudad
`);

const upsertEtapaStmt = db.prepare(`
  INSERT INTO etapas (id_contrato_etapa, id_contrato, nombre, inicio, fin)
  VALUES (@id_contrato_etapa, @id_contrato, @nombre, @inicio, @fin)
  ON CONFLICT(id_contrato_etapa) DO UPDATE SET
    id_contrato = excluded.id_contrato,
    nombre = excluded.nombre,
    inicio = excluded.inicio,
    fin = excluded.fin
`);

const deleteItemsForContratoStmt = db.prepare(`DELETE FROM items WHERE id_contrato = ?`);
const deleteEtapasForContratoStmt = db.prepare(`DELETE FROM etapas WHERE id_contrato = ?`);
const deleteDepartamentosForContratoStmt = db.prepare(`DELETE FROM tender_departamentos WHERE id_contrato = ?`);
const insertDepartamentoStmt = db.prepare(`
  INSERT OR IGNORE INTO tender_departamentos (id_contrato, departamento) VALUES (?, ?)
`);

/**
 * Extrae el departamento (primer segmento) de un nomDistrito con formato
 * "DEPARTAMENTO/PROVINCIA/DISTRITO". Devuelve null si el valor no trae
 * el formato esperado.
 */
export function extraerDepartamento(nomDistrito) {
  if (!nomDistrito || typeof nomDistrito !== 'string') return null;
  const partes = nomDistrito.split('/');
  const dep = partes[0]?.trim();
  return dep ? dep : null;
}

/** Upsert de la cabecera de un tender (datos que vienen del buscador). */
export function upsertTenderHeader(tender) {
  upsertTenderStmt.run(tender);
}

/**
 * Reemplaza items + etapas + departamentos de un contrato en una sola
 * transacción, y actualiza cantidad_items en la cabecera.
 */
export const replaceTenderDetail = db.transaction((idContrato, items, etapas) => {
  deleteItemsForContratoStmt.run(idContrato);
  deleteEtapasForContratoStmt.run(idContrato);
  deleteDepartamentosForContratoStmt.run(idContrato);

  const departamentosVistos = new Set();

  for (const item of items) {
    upsertItemStmt.run(item);
    const dep = extraerDepartamento(item.ciudad);
    if (dep && !departamentosVistos.has(dep)) {
      departamentosVistos.add(dep);
      insertDepartamentoStmt.run(idContrato, dep);
    }
  }

  for (const etapa of etapas) {
    upsertEtapaStmt.run(etapa);
  }

  db.prepare(`UPDATE tenders SET cantidad_items = ? WHERE id_contrato = ?`).run(items.length, idContrato);
});

/**
 * Elimina de la base local los tenders cuyo id_contrato NO está en
 * `idsVigentes`. Cada sincronización solo pide contratos Bien+Vigente, así
 * que cualquier id que ya no aparece en esa respuesta significa que el
 * contrato cambió de estado (o dejó de existir) en SEACE: hay que quitarlo
 * en vez de dejarlo congelado con datos viejos. items/etapas/departamentos
 * se van con él por ON DELETE CASCADE.
 *
 * Usa una tabla temporal en vez de un `NOT IN (?, ?, ...)` con miles de
 * parámetros, que puede chocar con el límite de variables de SQLite.
 */
export const pruneTendersNotIn = db.transaction((idsVigentes) => {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS _ids_vigentes (id_contrato INTEGER PRIMARY KEY)`);
  db.exec(`DELETE FROM _ids_vigentes`);
  const insertTemp = db.prepare(`INSERT OR IGNORE INTO _ids_vigentes (id_contrato) VALUES (?)`);
  for (const id of idsVigentes) insertTemp.run(id);

  const result = db
    .prepare(`DELETE FROM tenders WHERE id_contrato NOT IN (SELECT id_contrato FROM _ids_vigentes)`)
    .run();

  db.exec(`DELETE FROM _ids_vigentes`);
  return result.changes;
});

export default db;
