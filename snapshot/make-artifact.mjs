/**
 * Inyecta snapshot/data.json dentro de snapshot/template.html y escribe
 * snapshot/artifact.html — el archivo que se publica con la herramienta
 * Artifact. Se corre después de build.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const data = fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

// Evita que el JSON cierre el <script> si algún texto de SEACE trae "</script>" literal.
const dataSegura = data.replace(/<\/script/gi, '<\\/script');

const out = template.replace('__SEACE_DATA_JSON__', dataSegura);
fs.writeFileSync(path.join(__dirname, 'artifact.html'), out);

console.log(`artifact.html generado (${(out.length / 1024).toFixed(0)} KB)`);
