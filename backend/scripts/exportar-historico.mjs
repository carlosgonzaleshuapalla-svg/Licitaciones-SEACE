/**
 * Exporta el histórico de precios adjudicados (Bienes y Servicios) con RUBRO y estadísticos robustos.
 * Solo lectura de la base; NO consulta a SEACE.
 *
 *   node scripts/exportar-historico.mjs --salida carpeta/
 *
 * Escribe en la carpeta:
 *   historico-datos.json  filas por contratación + resumen por rubro y por período + meta (lo lee generar_excel.py)
 *   sin-rubro.csv         nombres CUBSO que ninguna regla de rubro clasificó (para afinar src/rubros.js)
 *
 * Base: SEACE_DB_PATH, o la de la Mac (~/Library/Application Support/licitaciones-seace/seace.db).
 * Luego: python3 servitotal/herramientas/contrataciones/historico_precios/generar_excel.py --datos <carpeta>/historico-datos.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { construirHistorico } from '../src/historico.js';

const args = process.argv.slice(2);
const i = args.indexOf('--salida');
const salida = i !== -1 && args[i + 1] ? args[i + 1] : path.join(os.homedir(), 'Library', 'Application Support', 'licitaciones-seace', 'historico');
const dbRuta = process.env.SEACE_DB_PATH || path.join(os.homedir(), 'Library', 'Application Support', 'licitaciones-seace', 'seace.db');
if (!fs.existsSync(dbRuta)) { console.error(`No encuentro la base en ${dbRuta}. Defina SEACE_DB_PATH.`); process.exit(1); }
const db = new Database(dbRuta, { readonly: true, fileMustExist: true });
if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='resultados_adjudicacion'`).get()) {
  console.error('La base todavía no tiene el historial de precios.'); process.exit(1);
}
const paquete = construirHistorico(db);
paquete.meta.base = path.basename(dbRuta);
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(salida, 'historico-datos.json'), JSON.stringify(paquete, null, 1), 'utf8');
const csv = (v) => (/[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(path.join(salida, 'sin-rubro.csv'), '﻿nombre;n\n' + paquete.sin_rubro.map((x) => `${csv(x.nombre)};${x.n}`).join('\n') + '\n', 'utf8');
const m = paquete.meta;
console.log(`Histórico exportado a ${salida}: ${m.n_filas} filas, cierres ${m.cierre_desde} a ${m.cierre_hasta}, rubro asignado al ${Math.round(m.cobertura_rubro * 100)} %, ${m.filas_con_cubso} con código CUBSO.`);
db.close();
