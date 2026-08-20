import { db } from './db.js';
import { generarProveedores } from './providerLinks.js';

const getCiudadesStmt = db.prepare(`
  SELECT departamento FROM tender_departamentos WHERE id_contrato = ? ORDER BY departamento
`);

function ciudadesDe(idContrato) {
  return getCiudadesStmt.all(idContrato).map((r) => r.departamento);
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
 * soloBienes: si es true, solo objeto = 'Bien' (por ahora siempre es el caso,
 * pero se deja como filtro explícito y honesto en vez de asumirlo).
 */
export function listarTenders({ departamento, estado, q, soloBienes, page = 1, pageSize = 20 }) {
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
  if (soloBienes) {
    condiciones.push("t.objeto = 'Bien'");
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(DISTINCT t.id_contrato) AS total ${baseFrom} ${where}`)
    .get(params);
  const total = totalRow.total;

  const pageSafe = Math.max(1, Number(page) || 1);
  const pageSizeSafe = Math.max(1, Number(pageSize) || 20);
  const offset = (pageSafe - 1) * pageSizeSafe;

  const rows = db
    .prepare(
      `SELECT DISTINCT t.* ${baseFrom} ${where}
       ORDER BY t.fecha_publicacion DESC, t.id_contrato DESC
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
