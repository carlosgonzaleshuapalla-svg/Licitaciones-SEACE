import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader } from '../src/db.js';
import { mapListRecordToTenderHeader } from '../src/syncService.js';
import { listarTenders } from '../src/tendersRepo.js';

// Reproduce el bug real: fecha_publicacion se guarda como texto
// "DD/MM/YYYY HH:mm:ss" (formato de SEACE). Ordenar ese texto tal cual
// pone "19/08/2026" ANTES que "31/12/2025" porque compara caracter por
// caracter ('1' < '3') — no es orden cronológico. listarTenders debe
// devolver lo más reciente primero de verdad.

const ID_VIEJO = 999999401; // publicado 31/12/2025
const ID_NUEVO = 999999402; // publicado 19/08/2026, "menor" alfabéticamente

describe('listarTenders ordena por fecha real, no alfabéticamente', () => {
  test('un contrato publicado en 2026 aparece antes que uno publicado en 2025', () => {
    const registro = (id, fecha) => ({
      idContrato: id,
      desContratacion: `CM-TEST-${id}`,
      nomEntidad: 'ENTIDAD DE PRUEBA',
      idObjetoContrato: 1,
      nomObjetoContrato: 'Bien',
      desObjetoContrato: 'COMPRA DE PRUEBA ORDEN FECHA',
      idEstadoContrato: 2,
      nomEstadoContrato: 'Vigente',
      fecPublica: fecha,
      fecIniCotizacion: fecha,
      fecFinCotizacion: fecha,
    });

    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_VIEJO, '31/12/2025 12:00:00')));
    upsertTenderHeader(mapListRecordToTenderHeader(registro(ID_NUEVO, '19/08/2026 09:00:00')));

    const { data } = listarTenders({ q: 'ORDEN FECHA', page: 1, pageSize: 10 });
    const posiciones = data.map((t) => t.idContrato);
    const idxNuevo = posiciones.indexOf(ID_NUEVO);
    const idxViejo = posiciones.indexOf(ID_VIEJO);

    assert.ok(idxNuevo !== -1 && idxViejo !== -1, 'ambos deben aparecer en el resultado');
    assert.ok(
      idxNuevo < idxViejo,
      `el contrato de 2026 (idx ${idxNuevo}) debe salir antes que el de 2025 (idx ${idxViejo})`
    );

    db.prepare('DELETE FROM tenders WHERE id_contrato IN (?, ?)').run(ID_VIEJO, ID_NUEVO);
  });
});
