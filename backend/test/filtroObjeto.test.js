import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader } from '../src/db.js';
import { mapListRecordToTenderHeader } from '../src/syncService.js';
import { listarTenders } from '../src/tendersRepo.js';

// El portal ahora sincroniza Bien y Servicio (antes solo Bien). El filtro
// objeto deja elegir uno de los dos, o traer ambos si no se especifica.

const ID_BIEN = 999999601;
const ID_SERVICIO = 999999602;

function registro(id, idObjeto, nomObjeto) {
  return {
    idContrato: id,
    desContratacion: `CM-TEST-${id}`,
    nomEntidad: 'ENTIDAD DE PRUEBA',
    idObjetoContrato: idObjeto,
    nomObjetoContrato: nomObjeto,
    desObjetoContrato: 'PRUEBA FILTRO OBJETO',
    idEstadoContrato: 2,
    nomEstadoContrato: 'Vigente',
    fecPublica: '01/01/2026 10:00:00',
    fecIniCotizacion: '01/01/2026 10:00:00',
    fecFinCotizacion: '01/01/2099 10:00:00',
  };
}

describe('listarTenders filtro objeto (Bien/Servicio)', () => {
  test('objeto="Bien" solo trae Bien; objeto="Servicio" solo trae Servicio; sin objeto trae ambos', () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_BIEN, 1, 'Bien')));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_SERVICIO, 2, 'Servicio')));

    const soloBien = listarTenders({ q: 'FILTRO OBJETO', objeto: 'Bien', page: 1, pageSize: 10 });
    assert.deepEqual(soloBien.data.map((t) => t.idContrato).sort(), [ID_BIEN]);

    const soloServicio = listarTenders({ q: 'FILTRO OBJETO', objeto: 'Servicio', page: 1, pageSize: 10 });
    assert.deepEqual(soloServicio.data.map((t) => t.idContrato).sort(), [ID_SERVICIO]);

    const ambos = listarTenders({ q: 'FILTRO OBJETO', page: 1, pageSize: 10 });
    assert.deepEqual(ambos.data.map((t) => t.idContrato).sort(), [ID_BIEN, ID_SERVICIO].sort());

    db.prepare('DELETE FROM tenders WHERE id_contrato IN (?, ?)').run(ID_BIEN, ID_SERVICIO);
  });

  test('esProductoRapido solo es true para Bien, nunca para Servicio', () => {
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_BIEN, 1, 'Bien')));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_SERVICIO, 2, 'Servicio')));

    const { data } = listarTenders({ q: 'FILTRO OBJETO', page: 1, pageSize: 10 });
    const bien = data.find((t) => t.idContrato === ID_BIEN);
    const servicio = data.find((t) => t.idContrato === ID_SERVICIO);

    assert.equal(bien.esProductoRapido, true);
    assert.equal(servicio.esProductoRapido, false);

    db.prepare('DELETE FROM tenders WHERE id_contrato IN (?, ?)').run(ID_BIEN, ID_SERVICIO);
  });
});
