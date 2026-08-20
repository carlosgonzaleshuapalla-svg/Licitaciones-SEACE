import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader } from '../src/db.js';
import { mapListRecordToTenderHeader } from '../src/syncService.js';
import { listarTenders } from '../src/tendersRepo.js';

// SEACE a veces sigue marcando "Vigente" contratos cuya cotizacion_fin ya
// pasó (dato de la fuente, no lo controlamos). ocultarVencidas filtra por
// la fecha real, no por el campo estado.

const ID_VENCIDA = 999999501; // cotizacion_fin en 2020, muy en el pasado
const ID_ABIERTA = 999999502; // cotizacion_fin en 2099, muy en el futuro

function registro(id, fecFin) {
  return {
    idContrato: id,
    desContratacion: `CM-TEST-${id}`,
    nomEntidad: 'ENTIDAD DE PRUEBA',
    idObjetoContrato: 1,
    nomObjetoContrato: 'Bien',
    desObjetoContrato: 'COMPRA DE PRUEBA OCULTAR VENCIDAS',
    idEstadoContrato: 2,
    nomEstadoContrato: 'Vigente',
    fecPublica: '01/01/2026 10:00:00',
    fecIniCotizacion: '01/01/2026 10:00:00',
    fecFinCotizacion: fecFin,
  };
}

describe('listarTenders ocultarVencidas', () => {
  test('con ocultarVencidas=true, esconde contratos cuya cotizacion_fin ya pasó', () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_VENCIDA, '01/01/2020 10:00:00')));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_ABIERTA, '01/01/2099 10:00:00')));

    const conFiltro = listarTenders({ q: 'OCULTAR VENCIDAS', ocultarVencidas: true, page: 1, pageSize: 10 });
    const ids = conFiltro.data.map((t) => t.idContrato);
    assert.ok(ids.includes(ID_ABIERTA), 'la que sigue abierta debe aparecer');
    assert.ok(!ids.includes(ID_VENCIDA), 'la vencida debe ocultarse');

    const sinFiltro = listarTenders({ q: 'OCULTAR VENCIDAS', ocultarVencidas: false, page: 1, pageSize: 10 });
    const idsSinFiltro = sinFiltro.data.map((t) => t.idContrato);
    assert.ok(idsSinFiltro.includes(ID_VENCIDA), 'sin el filtro, la vencida sí debe aparecer');
    assert.ok(idsSinFiltro.includes(ID_ABIERTA));

    db.prepare('DELETE FROM tenders WHERE id_contrato IN (?, ?)').run(ID_VENCIDA, ID_ABIERTA);
  });
});
