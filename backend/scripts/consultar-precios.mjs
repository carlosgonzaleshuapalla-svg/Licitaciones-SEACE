/**
 * Consulta el historial de precios adjudicados (solo lectura).
 *
 *   node scripts/consultar-precios.mjs estante            # busca por palabra en la descripción o los ítems
 *   node scripts/consultar-precios.mjs "toner" --csv      # además escribe resultados-adjudicados.csv
 *   node scripts/consultar-precios.mjs --csv ruta.csv     # exporta todo al archivo dado
 *
 * Base: SEACE_DB_PATH, o la de la Mac (~/Library/Application Support/licitaciones-seace/seace.db).
 *
 * Qué mide: SEACE publica solo la cotización GANADORA (RUC, razón social y precio TOTAL de lo
 * adjudicado) o DESIERTO; no publica las cotizaciones perdedoras. El precio unitario solo se
 * deduce cuando la contratación tiene un único ítem (precio total / cantidad).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const iCsv = args.indexOf('--csv');
let csvRuta = null;
if (iCsv !== -1) {
  const sig = args[iCsv + 1];
  csvRuta = sig && !sig.startsWith('--') ? sig : 'resultados-adjudicados.csv';
  args.splice(iCsv, sig && !sig.startsWith('--') ? 2 : 1);
}
const palabra = args.join(' ').trim().toLowerCase();

const dbRuta = process.env.SEACE_DB_PATH || path.join(os.homedir(), 'Library', 'Application Support', 'licitaciones-seace', 'seace.db');
if (!fs.existsSync(dbRuta)) {
  console.error(`No encuentro la base en ${dbRuta}. Defina SEACE_DB_PATH.`);
  process.exit(1);
}
const db = new Database(dbRuta, { readonly: true, fileMustExist: true });
const tiene = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='resultados_adjudicacion'`).get();
if (!tiene) {
  console.error('La base todavía no tiene el historial de precios: corra primero una sincronización con la versión nueva.');
  process.exit(1);
}

const filas = db.prepare(`SELECT * FROM resultados_adjudicacion ORDER BY id_contrato DESC`).all()
  .filter((r) => !palabra || `${r.descripcion ?? ''} ${r.items_json ?? ''}`.toLowerCase().includes(palabra));

function precioUnitario(r) {
  if (r.n_items !== 1 || r.precio_total_adjudicado == null) return null;
  const items = JSON.parse(r.items_json || '[]');
  const cant = Number(items[0]?.cantidad);
  return cant > 0 ? Math.round((r.precio_total_adjudicado / cant) * 100) / 100 : null;
}
const csvCelda = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

if (csvRuta) {
  const cab = ['id_contrato', 'codigo', 'entidad', 'cierre_cotizacion', 'resultado', 'n_items', 'ruc_adjudicado', 'razon_adjudicado', 'precio_total_adjudicado', 'precio_unitario_deducido', 'descripcion'];
  const lineas = [cab.join(';')].concat(filas.map((r) => [r.id_contrato, r.codigo, r.entidad, r.cotizacion_fin, r.resultado, r.n_items, r.ruc_adjudicado, r.razon_adjudicado, r.precio_total_adjudicado, precioUnitario(r), r.descripcion].map(csvCelda).join(';')));
  fs.writeFileSync(csvRuta, '﻿' + lineas.join('\n') + '\n', 'utf8');
  console.log(`CSV escrito en ${csvRuta}: ${filas.length} fila(s).`);
}

if (!csvRuta || palabra) {
  const adj = filas.filter((r) => r.resultado !== 'DESIERTO');
  const des = filas.filter((r) => r.resultado === 'DESIERTO');
  console.log(`${filas.length} contratación(es)${palabra ? ` con «${palabra}»` : ''}: ${adj.length} adjudicada(s), ${des.length} desierta(s)${filas.length ? ` (${Math.round((des.length / filas.length) * 100)} % desiertas)` : ''}.`);
  for (const r of filas.slice(0, 25)) {
    const u = precioUnitario(r);
    console.log(`- ${r.cotizacion_fin ?? ''} · ${r.codigo} · ${r.entidad ?? ''} · ${r.resultado}${r.precio_total_adjudicado != null ? ` · total S/ ${r.precio_total_adjudicado}` : ''}${u != null ? ` · unitario ≈ S/ ${u}` : ''}${r.razon_adjudicado ? ` · ${r.razon_adjudicado}` : ''}\n    ${(r.descripcion ?? '').slice(0, 110)}`);
  }
  const unit = adj.map(precioUnitario).filter((x) => x != null).sort((a, b) => a - b);
  if (unit.length) {
    const med = unit.length % 2 ? unit[(unit.length - 1) / 2] : (unit[unit.length / 2 - 1] + unit[unit.length / 2]) / 2;
    console.log(`Precio unitario deducido (${unit.length} contratación(es) de un solo ítem): mínimo ${unit[0]}, mediana ${Math.round(med * 100) / 100}, máximo ${unit[unit.length - 1]}.`);
  }
  if (filas.length > 25) console.log(`(se muestran 25 de ${filas.length}; use --csv para ver todo)`);
}
db.close();
