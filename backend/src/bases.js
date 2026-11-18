/**
 * Revisión de las bases ("Anexo de la contratación") de las licitaciones de
 * Bienes con plazo abierto, para saber si exigen experiencia previa al postor.
 *
 * La API de detalle de SEACE no dice nada de requisitos: están en el PDF de
 * especificaciones técnicas / términos de referencia que la entidad adjunta, y
 * esa lista de archivos sí es pública (sin sesión). Por contrato son 2 pedidos
 * (la lista y el archivo), con el mismo ritmo y las mismas pausas ante bloqueo
 * que el resto del cliente de SEACE.
 *
 * Solo se guarda el resultado ("pide / no pide" y la frase que lo dice): el
 * archivo se lee y se borra. Corre en la Mac (hace falta macOS para el OCR de
 * los PDF escaneados); en el servidor no se usa.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { contratosConBasesPendientes, guardarRevisionBases } from './db.js';
import { cotizacionAbierta, ordenableDeSeace } from './fechas.js';
import { detectarExperiencia } from './requisitos.js';
import { SeaceBloqueadoError, MAX_BYTES_ARCHIVO } from './seaceClient.js';

const execFileP = promisify(execFile);

const MAX_ARCHIVOS = 4; // un anexo suele ser 1 archivo; más de 4 no se revisan
const MIN_CARACTERES_UTILES = 80; // menos que esto = no se pudo leer
const FUENTE_SWIFT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'mac', 'leer_documento.swift');

/**
 * Compila (una vez, queda en caché) el lector de PDF con OCR de macOS y
 * devuelve la ruta del ejecutable; null si no se puede (no es macOS, falta swiftc).
 */
export async function compilarLector({ log = () => {}, fuente = FUENTE_SWIFT } = {}) {
  if (process.platform !== 'darwin' || !fs.existsSync(fuente)) return null;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(fuente)).digest('hex').slice(0, 12);
  const dir = process.env.LECTOR_CACHE || path.join(os.homedir(), 'Library', 'Caches', 'licitaciones-seace');
  const exe = path.join(dir, `leer_documento-${hash}`);
  if (fs.existsSync(exe)) return exe;
  try {
    fs.mkdirSync(dir, { recursive: true });
    log('Compilando el lector de PDF con OCR (solo la primera vez)…');
    await execFileP('swiftc', ['-O', fuente, '-o', exe], { timeout: 300_000 });
    return exe;
  } catch (err) {
    log(`No se pudo compilar el lector de PDF: ${String(err.message).slice(0, 200)}`);
    return null;
  }
}

/** Texto de un .docx: el XML principal sin etiquetas. */
async function textoDeDocx(archivo) {
  const { stdout } = await execFileP('unzip', ['-p', archivo, 'word/document.xml'], { maxBuffer: 50 * 1024 * 1024, timeout: 30_000 });
  return stdout
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Crea la función `leerTexto(buffer, extension)` sobre el lector compilado. */
export function crearLectorDeArchivos(exePdf) {
  return async function leerTexto(buffer, extension) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bases-'));
    const archivo = path.join(dir, `doc.${extension}`);
    try {
      fs.writeFileSync(archivo, buffer);
      if (extension === 'pdf') {
        const { stdout } = await execFileP(exePdf, [archivo, '40'], { maxBuffer: 50 * 1024 * 1024, timeout: 240_000 });
        return stdout;
      }
      if (extension === 'docx') return await textoDeDocx(archivo);
      return null;
    } catch {
      return ''; // ilegible: PDF con clave, dañado o sin respuesta a tiempo
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

const extensionDe = (a) =>
  String(a?.descripcionExtension || path.extname(String(a?.nombre ?? '')) || '').toLowerCase().replace('.', '');

/**
 * Revisa el anexo de un contrato. Devuelve { estado, exige?, nota?, fuente? }:
 *  - 'leido'        se leyó al menos un archivo; exige/nota según el texto
 *  - 'sin-anexo'    la entidad no adjuntó nada
 *  - 'no-soportado' solo hay archivos que no sabemos leer (.doc, .xls, .zip, imágenes…)
 *  - 'ilegible'     había PDF/Word pero no se obtuvo texto (o pesaban demasiado)
 * Los bloqueos de SEACE (SeaceBloqueadoError) y otros fallos se propagan.
 */
export async function revisarBases({ client, idContrato, leerTexto }) {
  const lista = await client.listarAnexos(idContrato);
  if (!Array.isArray(lista) || lista.length === 0) return { estado: 'sin-anexo' };

  const textos = [];
  let noSoportados = 0;
  let ilegibles = 0;
  for (const archivo of lista.slice(0, MAX_ARCHIVOS)) {
    const ext = extensionDe(archivo);
    if (ext !== 'pdf' && ext !== 'docx') {
      noSoportados++;
      continue;
    }
    if (Number(archivo.tamanio) > MAX_BYTES_ARCHIVO) {
      ilegibles++;
      continue;
    }
    let buffer;
    try {
      buffer = await client.descargarArchivo(archivo.idContratoArchivo);
    } catch (err) {
      if (err?.demasiadoGrande) {
        ilegibles++;
        continue;
      }
      throw err;
    }
    const texto = await leerTexto(buffer, ext);
    if (typeof texto === 'string' && texto.replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_CARACTERES_UTILES) textos.push(texto);
    else ilegibles++;
  }

  if (textos.length === 0) return { estado: noSoportados > 0 && ilegibles === 0 ? 'no-soportado' : 'ilegible' };
  const { exige, nota } = detectarExperiencia(textos);
  return { estado: 'leido', exige, nota, fuente: exige ? 'anexo' : null };
}

/**
 * Revisa las bases pendientes de los Bienes con plazo abierto (los que cierran
 * antes, primero) hasta `maxMs`. Lo ya revisado no se vuelve a pedir. Si SEACE
 * limita el acceso, se detiene sin error: lo pendiente sigue en la próxima corrida.
 */
export async function revisarBasesPendientes({ client, leerTexto, log = () => {}, maxMs = 30 * 60_000, ahora = new Date() }) {
  const cola = contratosConBasesPendientes()
    .filter((r) => cotizacionAbierta(r.cotizacion_fin, ahora))
    .sort((a, b) => {
      // Sin revisar antes que los que fallaron; luego, el que cierra antes.
      const pa = a.bases_estado === null ? 0 : 1;
      const pb = b.bases_estado === null ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (ordenableDeSeace(a.cotizacion_fin) ?? '9').localeCompare(ordenableDeSeace(b.cotizacion_fin) ?? '9');
    });
  const resumen = { pendientes: cola.length, revisadas: 0, conExperiencia: 0, errores: 0, bloqueado: false, cortadoPorTiempo: false };
  if (cola.length === 0) return resumen;

  log(`Bases por revisar: ${cola.length} licitaciones de Bienes con plazo abierto.`);
  const inicio = Date.now();
  for (const fila of cola) {
    if (Date.now() - inicio > maxMs) {
      resumen.cortadoPorTiempo = true;
      break;
    }
    try {
      const r = await revisarBases({ client, idContrato: fila.id_contrato, leerTexto });
      // Lo que ya decía la descripción no se pierde si el anexo no lo repite.
      const previa = fila.exige_experiencia === 1;
      const exige = r.exige === 1 || previa ? 1 : 0;
      guardarRevisionBases(fila.id_contrato, {
        estado: r.estado,
        exige,
        nota: r.exige === 1 ? r.nota : previa ? fila.nota_experiencia : null,
        fuente: r.exige === 1 ? 'anexo' : previa ? 'descripcion' : null,
      });
      resumen.revisadas++;
      if (exige) resumen.conExperiencia++;
    } catch (err) {
      if (err instanceof SeaceBloqueadoError) {
        resumen.bloqueado = true;
        log(`SEACE limitó el acceso (HTTP ${err.status}) al revisar bases; se sigue en la próxima corrida.`);
        break;
      }
      resumen.errores++;
      log(`No se pudo revisar las bases del contrato ${fila.id_contrato}: ${String(err.message).slice(0, 120)}`);
      guardarRevisionBases(fila.id_contrato, {
        estado: 'error',
        exige: fila.exige_experiencia === 1 ? 1 : 0,
        nota: fila.exige_experiencia === 1 ? fila.nota_experiencia : null,
        fuente: fila.exige_experiencia === 1 ? 'descripcion' : null,
      });
    }
  }
  log(`Bases revisadas: ${resumen.revisadas} (${resumen.conExperiencia} piden experiencia), errores: ${resumen.errores}${resumen.cortadoPorTiempo ? ', cortado por tiempo' : ''}.`);
  return resumen;
}
