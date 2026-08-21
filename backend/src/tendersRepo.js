import { db } from './db.js';
import { generarProveedores } from './providerLinks.js';

const getCiudadesStmt = db.prepare(`
  SELECT departamento FROM tender_departamentos WHERE id_contrato = ? ORDER BY departamento
`);

function ciudadesDe(idContrato) {
  return getCiudadesStmt.all(idContrato).map((r) => r.departamento);
}

/**
 * Las fechas se guardan tal como las entrega SEACE: texto "DD/MM/YYYY
 * HH:mm:ss" (no ISO). Compararlas como texto es alfabético, no cronológico
 * ("19/08/2026" queda antes que "31/12/2025" porque "1" < "3"). Esta
 * función arma la misma columna reordenada a "YYYYMMDDHH:mm:ss", que sí
 * compara (y ordena) cronológicamente. Se usa tanto para ORDER BY como
 * para el filtro de "ya venció".
 */
function fechaOrdenable(columnaSql) {
  return `(substr(${columnaSql}, 7, 4) || substr(${columnaSql}, 4, 2) || substr(${columnaSql}, 1, 2) || substr(${columnaSql}, 12, 8))`;
}

const FECHA_PUBLICACION_ORDENABLE = fechaOrdenable('t.fecha_publicacion');
const COTIZACION_FIN_ORDENABLE = fechaOrdenable('t.cotizacion_fin');

/** "ahora" en el mismo formato "YYYYMMDDHH:mm:ss" que fechaOrdenable(). */
function ahoraOrdenable() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function rowToSummary(row) {
  return {
    idContrato: row.id_contrato,
    codigo: row.codigo,
    entidad: row.entidad,
    objeto: row.objeto,
    descripcion: row.descripcion,
    estado: row.estado,
    fechaPublicacion: row.fecha_publicacion,
    cotizacionInicio: row.cotizacion_inicio,
    cotizacionFin: row.cotizacion_fin,
    ciudades: ciudadesDe(row.id_contrato),
    cantidadItems: row.cantidad_items,
    esProductoRapido: !!row.es_producto_rapido,
  };
}

/**
 * Lista tenders con filtros y paginación.
 * departamento: exact-match contra tender_departamentos.
 * estado: exact-match contra tenders.estado.
 * q: substring case-insensitive sobre descripcion o entidad.
 * objeto: exact-match contra tenders.objeto ('Bien' o 'Servicio'; el
 * portal sincroniza solo esos dos tipos — Obra y Consultoría de Obra
 * quedan fuera de alcance). Sin valor, no filtra por tipo (trae ambos).
 * ocultarVencidas: si es true, esconde contratos cuya cotizacion_fin ya
 * pasó — SEACE a veces los sigue marcando "Vigente" aunque el plazo real
 * de cotización ya cerró (dato de la fuente, no lo controlamos), así que
 * este filtro es la única forma honesta de mostrar solo lo que de verdad
 * se puede cotizar todavía.
 */
const OBJETOS_VALIDOS = new Set(['Bien', 'Servicio']);

export function listarTenders({
  departamento,
  estado,
  q,
  objeto,
  ocultarVencidas,
  page = 1,
  pageSize = 20,
}) {
  const condiciones = [];
  const params = {};

  let baseFrom = 'FROM tenders t';
  if (departamento) {
    baseFrom += ' JOIN tender_departamentos td ON td.id_contrato = t.id_contrato';
    condiciones.push('td.departamento = @departamento');
    params.departamento = departamento;
  }
  if (estado) {
    condiciones.push('t.estado = @estado');
    params.estado = estado;
  }
  if (q) {
    condiciones.push('(t.descripcion LIKE @q OR t.entidad LIKE @q)');
    params.q = `%${q}%`;
  }
  if (objeto && OBJETOS_VALIDOS.has(objeto)) {
    condiciones.push('t.objeto = @objeto');
    params.objeto = objeto;
  }
  if (ocultarVencidas) {
    condiciones.push(`(t.cotizacion_fin IS NULL OR ${COTIZACION_FIN_ORDENABLE} >= @ahora)`);
    params.ahora = ahoraOrdenable();
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(DISTINCT t.id_contrato) AS total ${baseFrom} ${where}`)
    .get(params);
  const total = totalRow.total;

  // pageSize sin techo dejaría pedir el total de filas de una sola vez
  // (memoria/ancho de banda como vector de abuso) — se limita a 100.
  const pageSafe = Math.max(1, Number(page) || 1);
  const pageSizeSafe = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (pageSafe - 1) * pageSizeSafe;

  const rows = db
    .prepare(
      `SELECT DISTINCT t.* ${baseFrom} ${where}
       ORDER BY ${FECHA_PUBLICACION_ORDENABLE} DESC, t.id_contrato DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSizeSafe, offset });

  return {
    data: rows.map(rowToSummary),
    total,
    page: pageSafe,
    pageSize: pageSizeSafe,
  };
}

export function obtenerTenderDetalle(idContrato) {
  const row = db.prepare(`SELECT * FROM tenders WHERE id_contrato = ?`).get(idContrato);
  if (!row) return null;

  const etapas = db
    .prepare(`SELECT nombre, inicio, fin FROM etapas WHERE id_contrato = ? ORDER BY id_contrato_etapa`)
    .all(idContrato);

  const itemsRows = db
    .prepare(`SELECT id_item, producto, cantidad, unidad_medida, ciudad FROM items WHERE id_contrato = ? ORDER BY id_item`)
    .all(idContrato);

  const items = itemsRows.map((it) => ({
    idItem: it.id_item,
    producto: it.producto,
    cantidad: it.cantidad,
    unidadMedida: it.unidad_medida,
    ciudad: it.ciudad,
    proveedores: generarProveedores(it.producto),
  }));

  return {
    ...rowToSummary(row),
    etapas,
    items,
  };
}

export function obtenerMeta() {
  const departamentos = db
    .prepare(`SELECT DISTINCT departamento FROM tender_departamentos ORDER BY departamento`)
    .all()
    .map((r) => r.departamento);

  const estados = db
    .prepare(`SELECT DISTINCT estado FROM tenders WHERE estado IS NOT NULL ORDER BY estado`)
    .all()
    .map((r) => r.estado);

  return { departamentos, estados };
}
