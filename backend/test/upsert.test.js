import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader, replaceTenderDetail, pruneTendersNotIn } from '../src/db.js';
import { mapListRecordToTenderHeader, mapDetailToItemsAndEtapas } from '../src/syncService.js';

// idContrato de prueba fuera de rango real de SEACE para no chocar con datos
// sincronizados de verdad al correr los tests contra la misma DB de dev.
const ID_CONTRATO_TEST = 999999001;

describe('upsert de tenders/items/etapas no duplica filas al re-sincronizar', () => {
  test('correr el upsert dos veces con los mismos datos deja una sola fila por id', () => {
    const record = {
      idContrato: ID_CONTRATO_TEST,
      desContratacion: 'CM-TEST-2026',
      nomEntidad: 'ENTIDAD DE PRUEBA',
      idObjetoContrato: 1,
      nomObjetoContrato: 'Bien',
      desObjetoContrato: 'COMPRA DE PRUEBA',
      idEstadoContrato: 2,
      nomEstadoContrato: 'Vigente',
      fecPublica: '19/08/2026 10:00:00',
      fecIniCotizacion: '19/08/2026 10:00:00',
      fecFinCotizacion: '21/08/2026 10:00:00',
    };
    const detalle = {
      uitContratoItemProjectionList: [
        {
          idContratoItem: 999999101,
          nomCubso: 'ITEM DE PRUEBA',
          cantidad: 5,
          nomUnidadMedida: 'UNIDAD',
          nomDistrito: 'LIMA/LIMA/MIRAFLORES',
        },
      ],
      uitContratoEtapaProjectionList: [
        {
          idContratoEtapa: 999999201,
          nomEtapaContrato: 'ETAPA DE COTIZACIÓN',
          fecIni: '19/08/2026 10:00:00',
          fecFin: '21/08/2026 10:00:00',
        },
      ],
    };

    for (let i = 0; i < 2; i++) {
      upsertTenderHeader(mapListRecordToTenderHeader(record));
      const { items, etapas } = mapDetailToItemsAndEtapas(ID_CONTRATO_TEST, detalle);
      replaceTenderDetail(ID_CONTRATO_TEST, items, etapas);
    }

    const tenderCount = db
      .prepare('SELECT COUNT(*) AS c FROM tenders WHERE id_contrato = ?')
      .get(ID_CONTRATO_TEST).c;
    const itemCount = db
      .prepare('SELECT COUNT(*) AS c FROM items WHERE id_contrato = ?')
      .get(ID_CONTRATO_TEST).c;
    const etapaCount = db
      .prepare('SELECT COUNT(*) AS c FROM etapas WHERE id_contrato = ?')
      .get(ID_CONTRATO_TEST).c;
    const depCount = db
      .prepare('SELECT COUNT(*) AS c FROM tender_departamentos WHERE id_contrato = ?')
      .get(ID_CONTRATO_TEST).c;

    assert.equal(tenderCount, 1);
    assert.equal(itemCount, 1);
    assert.equal(etapaCount, 1);
    assert.equal(depCount, 1);

    // limpieza para no ensuciar la DB de dev entre corridas de test
    db.prepare('DELETE FROM tenders WHERE id_contrato = ?').run(ID_CONTRATO_TEST);
  });
});

describe('pruneTendersNotIn (limpia contratos que dejaron de ser Bien+Vigente)', () => {
  const ID_A = 999999301;
  const ID_B = 999999302;

  test('borra el tender ausente de la lista vigente y conserva el presente, incluidos items/etapas por CASCADE', () => {
    const registro = (id) => ({
      idContrato: id,
      desContratacion: `CM-TEST-${id}`,
      nomEntidad: 'ENTIDAD DE PRUEBA',
      idObjetoContrato: 1,
      nomObjetoContrato: 'Bien',
      desObjetoContrato: 'COMPRA DE PRUEBA',
      idEstadoContrato: 2,
      nomEstadoContrato: 'Vigente',
      fecPublica: '19/08/2026 10:00:00',
      fecIniCotizacion: '19/08/2026 10:00:00',
      fecFinCotizacion: '21/08/2026 10:00:00',
    });
    const detalleCon1Item = (id) => ({
      uitContratoItemProjectionList: [
        { idContratoItem: id * 10, nomCubso: 'ITEM', cantidad: 1, nomUnidadMedida: 'UNIDAD', nomDistrito: 'LIMA/LIMA/MIRAFLORES' },
      ],
      uitContratoEtapaProjectionList: [],
    });

    for (const id of [ID_A, ID_B]) {
      upsertTenderHeader(mapListRecordToTenderHeader(registro(id)));
      const { items, etapas } = mapDetailToItemsAndEtapas(id, detalleCon1Item(id));
      replaceTenderDetail(id, items, etapas);
    }

    // Una resync posterior solo devuelve ID_B (ID_A ya no es Bien+Vigente).
    const eliminados = pruneTendersNotIn([ID_B]);

    const existeA = db.prepare('SELECT COUNT(*) AS c FROM tenders WHERE id_contrato = ?').get(ID_A).c;
    const existeB = db.prepare('SELECT COUNT(*) AS c FROM tenders WHERE id_contrato = ?').get(ID_B).c;
    const itemsDeA = db.prepare('SELECT COUNT(*) AS c FROM items WHERE id_contrato = ?').get(ID_A).c;

    assert.ok(eliminados >= 1);
    assert.equal(existeA, 0, 'el tender que ya no está vigente debe borrarse');
    assert.equal(existeB, 1, 'el tender que sigue vigente no debe tocarse');
    assert.equal(itemsDeA, 0, 'los items del tender borrado deben irse por CASCADE');

    db.prepare('DELETE FROM tenders WHERE id_contrato = ?').run(ID_B);
  });
});
