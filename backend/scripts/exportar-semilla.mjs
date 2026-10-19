/**
 * Genera una semilla (seed.json.gz) a partir de una base SQLite existente.
 *
 *   SEACE_DB_PATH=/ruta/a/la.db node scripts/exportar-semilla.mjs salida.json.gz [--forzar]
 *
 * Se niega a exportar si menos del 97 % de las licitaciones tiene detalle
 * (una semilla a medias haría que el servidor arranque con datos incompletos),
 * salvo con --forzar.
 */
import fs from 'node:fs';
import { exportarSemilla, comprimirSemilla } from '../src/semilla.js';

const salida = process.argv[2];
const forzar = process.argv.includes('--forzar');
if (!salida || salida.startsWith('--')) {
  console.error('Uso: node scripts/exportar-semilla.mjs salida.json.gz [--forzar]');
  process.exit(1);
}

// Exportación manual: quien la corre responde de que la base está al día.
const semilla = exportarSemilla({ sincronizadoEn: Date.now() });
const pct = semilla.total ? (semilla.conDetalle / semilla.total) * 100 : 0;
console.log(`${semilla.total} licitaciones, ${semilla.conDetalle} con detalle (${pct.toFixed(1)} %).`);
if (!forzar && (semilla.total < 1000 || pct < 97)) {
  console.error('La base no está completa (se piden >= 1000 licitaciones y >= 97 % con detalle). Use --forzar para exportar igual.');
  process.exit(2);
}
const buf = comprimirSemilla(semilla);
fs.writeFileSync(salida, buf);
console.log(`Semilla escrita en ${salida} (${(buf.length / 1024).toFixed(0)} KB comprimida).`);
