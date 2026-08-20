/**
 * Genera un snapshot estático (JSON) de las contrataciones Bien+Vigente de
 * SEACE, listo para incrustar en el Artifact publicado (que no puede hacer
 * fetch a hosts externos). Reusa los módulos puros del backend (sin DB):
 * seaceClient (cliente HTTP), providerLinks (enlaces de proveedores) y
 * concurrencyPool (límite de concurrencia).
 *
 * Uso: node build.mjs
 * Salida: snapshot/data.json y snapshot/data.meta.json (para el artifact.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPagina, listarCompleto } from '../backend/src/seaceClient.js';
import { generarProveedores } from '../backend/src/providerLinks.js';
import { runWithConcurrency } from '../backend/src/concurrencyPool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_SIZE = 50;
const DETAIL_CONCURRENCY = 6;
const OBJETO_BIEN = 'Bien';

function extraerDepartamento(nomDistrito) {
  if (!nomDistrito || typeof nomDistrito !== 'string') return null;
  const dep = nomDistrito.split('/')[0]?.trim();
  return dep || null;
}

async function fetchTodosLosRegistros(log) {
  const registros = [];
  let page = 1;
  let totalElements = Infinity;
  while ((page - 1) * PAGE_SIZE < totalElements) {
    const respuesta = await buscarPagina({ page, pageSize: PAGE_SIZE });
    const data = respuesta?.data ?? [];
    registros.push(...data);
    totalElements = respuesta?.pageable?.totalElements ?? registros.length;
    if (data.length === 0) break;
    log(`  página ${page}: ${registros.length}/${totalElements}`);
    page++;
  }
  return registros;
}

function mapHeader(record) {
  return {
    idContrato: record.idContrato,
    codigo: record.desContratacion ?? null,
    entidad: record.nomEntidad ?? null,
    objeto: record.nomObjetoContrato ?? null,
    descripcion: record.desObjetoContrato ?? null,
    estado: record.nomEstadoContrato ?? null,
    fechaPublicacion: record.fecPublica ?? null,
    cotizacionInicio: record.fecIniCotizacion ?? null,
    cotizacionFin: record.fecFinCotizacion ?? null,
    esProductoRapido: record.nomObjetoContrato === OBJETO_BIEN,
  };
}

function mapDetalle(detalle) {
  const items = (detalle?.uitContratoItemProjectionList ?? []).map((it) => ({
    idItem: it.idContratoItem,
    producto: it.nomCubso ?? null,
    cantidad: it.cantidad ?? null,
    unidadMedida: it.nomUnidadMedida ?? null,
    ciudad: it.nomDistrito ?? null,
    proveedores: generarProveedores(it.nomCubso),
  }));
  const etapas = (detalle?.uitContratoEtapaProjectionList ?? []).map((et) => ({
    nombre: et.nomEtapaContrato ?? null,
    inicio: et.fecIni ?? null,
    fin: et.fecFin ?? null,
  }));
  const ciudades = [...new Set(items.map((it) => extraerDepartamento(it.ciudad)).filter(Boolean))];
  return { items, etapas, ciudades };
}

async function main() {
  const inicio = Date.now();
  const log = (msg) => console.log(msg);

  log('Descargando lista de contrataciones Bien + Vigente...');
  const registros = await fetchTodosLosRegistros(log);
  log(`Total: ${registros.length} contrataciones. Descargando detalle...`);

  let ok = 0;
  const tenders = await runWithConcurrency(
    registros,
    DETAIL_CONCURRENCY,
    async (record) => {
      const detalle = await listarCompleto(record.idContrato);
      const { items, etapas, ciudades } = mapDetalle(detalle);
      ok++;
      if (ok % 100 === 0) log(`  detalle ${ok}/${registros.length}`);
      return {
        ...mapHeader(record),
        items,
        etapas,
        ciudades,
        cantidadItems: items.length,
      };
    },
    (err, record) => log(`  error en contrato ${record.idContrato}: ${err.message}`)
  );

  const tendersValidos = tenders.filter(Boolean);
  const departamentos = [...new Set(tendersValidos.flatMap((t) => t.ciudades))].sort();

  const snapshot = {
    generadoEn: new Date().toISOString(),
    total: tendersValidos.length,
    departamentos,
    tenders: tendersValidos,
  };

  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(snapshot));
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  log(`Listo: ${tendersValidos.length} contrataciones en ${segundos}s → snapshot/data.json`);
}

main().catch((err) => {
  console.error('Falló la generación del snapshot:', err);
  process.exit(1);
});
