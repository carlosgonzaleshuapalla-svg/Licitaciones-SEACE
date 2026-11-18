/**
 * Recolecta las licitaciones vigentes directamente desde SEACE y escribe una
 * semilla (seed.json.gz). Pensado para correr en GitHub Actions, sin depender
 * de que el servidor de Render pueda hablar con SEACE.
 *
 *   SEACE_DB_PATH=/ruta/temporal.db node scripts/recolectar.mjs salida.json.gz
 *
 * Parte de la semilla anterior (rama `data`) para bajar de SEACE solo los
 * detalles que faltan, con el mismo ritmo y las mismas pausas ante bloqueo que
 * usa el servidor. Códigos de salida:
 *   0  semilla escrita (datos frescos y completos)
 *   3  SEACE limitó el acceso o la lista quedó incompleta: no se escribe nada
 */
import fs from 'node:fs';
import { cargarSemillaSiVacia, exportarSemilla, comprimirSemilla } from '../src/semilla.js';
import { runSync, getSyncStatus } from '../src/syncService.js';
import { revisarBasesPendientes, compilarLector, crearLectorDeArchivos } from '../src/bases.js';
import { crearClienteSeace } from '../src/seaceClient.js';

const salida = process.argv[2];
if (!salida) {
  console.error('Uso: node scripts/recolectar.mjs salida.json.gz');
  process.exit(1);
}

await cargarSemillaSiVacia({});
const resultado = await runSync({ origen: 'ci', saltarCooldown: true });
const estado = getSyncStatus();

const fresco = resultado.ok && !estado.bloqueado && estado.ultimoExito;
const pctPendiente = estado.total ? (estado.pendientesDetalle / estado.total) * 100 : 0;
console.log(`Resultado: ok=${resultado.ok} total=${estado.total} conDetalle=${estado.conDetalle} pendientes=${estado.pendientesDetalle} bloqueado=${estado.bloqueado}`);
if (!fresco || pctPendiente > 3) {
  console.error('No se escribe semilla: SEACE limitó el acceso, la lista quedó incompleta o faltan demasiados detalles.');
  process.exit(3);
}

// Bases (anexo de la contratación) de los Bienes con plazo abierto: ver si piden
// experiencia. Es un extra: si falla o SEACE limita, se publica igual lo que hay.
if (process.env.SEACE_BASES !== '0') {
  try {
    const exe = await compilarLector({ log: console.log });
    if (!exe) {
      console.log('Bases: sin lector de PDF (hace falta macOS con las herramientas de línea de comandos); se omite.');
    } else {
      await revisarBasesPendientes({
        client: crearClienteSeace(),
        leerTexto: crearLectorDeArchivos(exe),
        log: console.log,
        maxMs: (Number(process.env.BASES_MAX_MINUTOS) || 30) * 60_000,
      });
    }
  } catch (err) {
    console.error(`Bases: se omite por un error inesperado (${String(err.message).slice(0, 200)}).`);
  }
}

const semilla = exportarSemilla({ sincronizadoEn: estado.ultimoExito ? Date.parse(estado.ultimoExito) : Date.now() });
fs.writeFileSync(salida, comprimirSemilla(semilla));
console.log(`Semilla escrita en ${salida}: ${semilla.total} licitaciones, ${semilla.conDetalle} con detalle.`);
