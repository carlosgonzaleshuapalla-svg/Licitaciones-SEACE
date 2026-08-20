import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mapListRecordToTenderHeader, mapDetailToItemsAndEtapas } from '../src/syncService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8'));
}

describe('mapeo de respuestas SEACE (usa fixtures locales, sin red)', () => {
  test('mapListRecordToTenderHeader mapea los campos del buscador', () => {
    const fixture = loadFixture('buscador-page1.json');
    const record = fixture.data[0];
    const header = mapListRecordToTenderHeader(record);

    assert.equal(header.id_contrato, record.idContrato);
    assert.equal(header.codigo, record.desContratacion);
    assert.equal(header.entidad, record.nomEntidad);
    assert.equal(header.objeto, record.nomObjetoContrato);
    assert.equal(header.descripcion, record.desObjetoContrato);
    assert.equal(header.estado, record.nomEstadoContrato);
    assert.equal(header.es_producto_rapido, record.nomObjetoContrato === 'Bien' ? 1 : 0);
  });

  test('mapDetailToItemsAndEtapas mapea items y etapas del detalle', () => {
    const fixture = loadFixture('listar-completo-88171.json');
    const { items, etapas } = mapDetailToItemsAndEtapas(88171, fixture);

    assert.ok(items.length > 0);
    for (const item of items) {
      assert.equal(item.id_contrato, 88171);
      assert.ok('producto' in item);
      assert.ok('cantidad' in item);
      assert.ok('unidad_medida' in item);
      assert.ok('ciudad' in item);
    }
    // primer item conocido del fixture real
    assert.equal(items[0].producto, 'CONECTOR RJ45 CAT 6');
    assert.equal(items[0].ciudad, 'ICA/ICA/ICA');

    assert.ok(etapas.length >= 2);
    const nombres = etapas.map((e) => e.nombre);
    assert.ok(nombres.some((n) => n.includes('COTIZACI')));
  });
});
