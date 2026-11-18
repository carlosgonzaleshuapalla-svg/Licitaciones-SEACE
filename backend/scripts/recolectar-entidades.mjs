/**
 * Lee los portales de 8 UIT de las otras entidades (SUNARP, SBN, SANIPES, MINSA,
 * Hospital de Ventanilla) y escribe entidades.json.gz para publicarlo junto a la semilla.
 *
 *   node scripts/recolectar-entidades.mjs salida.json.gz [previo.json.gz]
 *
 * `previo` (opcional) es la última versión publicada: si una entidad no responde
 * se conserva lo que tenía. Es un extra de la corrida de la Mac: si todo falla,
 * sale con 3 y no se publica nada nuevo (la web sigue con lo último).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { recolectarTodas, comprimirEntidades } from '../src/entidades/recolector.js';

const [salida, previoArchivo] = process.argv.slice(2);
if (!salida) {
  console.error('Uso: node scripts/recolectar-entidades.mjs salida.json.gz [previo.json.gz]');
  process.exit(1);
}

let previo = null;
if (previoArchivo && fs.existsSync(previoArchivo) && fs.statSync(previoArchivo).size > 0) {
  try {
    previo = JSON.parse(zlib.gunzipSync(fs.readFileSync(previoArchivo)).toString('utf8'));
  } catch {
    console.log('El archivo anterior de entidades no se pudo leer; se parte de cero.');
  }
}

const datos = await recolectarTodas({ previo, log: console.log });
const conDatos = datos.entidades.filter((e) => !e.error).length;
if (conDatos === 0) {
  console.error('Ninguna entidad respondió: no se escribe el archivo de entidades.');
  process.exit(3);
}
fs.writeFileSync(salida, comprimirEntidades(datos));
const total = datos.entidades.reduce((s, e) => s + e.requerimientos.length, 0);
console.log(`Entidades escritas en ${salida}: ${total} requerimientos de ${conDatos}/${datos.entidades.length} entidades.`);
