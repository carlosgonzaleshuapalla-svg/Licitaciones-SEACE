import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ordenableDeSeace, ahoraLimaOrdenable, cotizacionAbierta } from '../src/fechas.js';

describe('fechas de SEACE (hora de Lima)', () => {
  test('ordenableDeSeace reordena DD/MM/YYYY a un texto que sí compara cronológicamente', () => {
    assert.equal(ordenableDeSeace('19/08/2026 18:20:15'), '2026081918:20:15');
    assert.ok(ordenableDeSeace('01/01/2026 00:00:00') > ordenableDeSeace('31/12/2025 23:59:59'));
    assert.equal(ordenableDeSeace(null), null);
    assert.equal(ordenableDeSeace('no es fecha'), null);
  });

  test('"ahora" se calcula en hora de Lima, no en la zona del servidor (Render corre en UTC)', () => {
    // 03:00 UTC del 19/10 = 22:00 del 18/10 en Lima
    assert.equal(ahoraLimaOrdenable(new Date('2026-10-19T03:00:00Z')), '2026101822:00:00');
    // 04:59:59 UTC = 23:59:59 Lima; 05:00:00 UTC ya es el día siguiente en Lima
    assert.equal(ahoraLimaOrdenable(new Date('2026-10-19T04:59:59Z')), '2026101823:59:59');
    assert.equal(ahoraLimaOrdenable(new Date('2026-10-19T05:00:00Z')), '2026101900:00:00');
  });

  test('cotizacionAbierta: el caso que antes fallaba en Render (UTC contra plazo en hora de Lima)', () => {
    const ahora = new Date('2026-10-19T03:00:00Z'); // 22:00 en Lima
    // plazo a las 23:00 de Lima: aún quedan 1 h. Comparando la hora UTC (03:00 del día
    // siguiente) se lo daba por vencido 5 horas antes de tiempo.
    assert.equal(cotizacionAbierta('18/10/2026 23:00:00', ahora), true);
    assert.equal(cotizacionAbierta('18/10/2026 21:59:59', ahora), false);
  });

  test('sin fecha o con formato desconocido, ante la duda NO se descarta', () => {
    assert.equal(cotizacionAbierta(null), true);
    assert.equal(cotizacionAbierta(''), true);
    assert.equal(cotizacionAbierta('formato raro'), true);
  });
});
