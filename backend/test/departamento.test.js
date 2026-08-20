import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extraerDepartamento } from '../src/db.js';

describe('extraerDepartamento (filtro por ciudad/departamento sobre nomDistrito)', () => {
  test('extrae el primer segmento de un nomDistrito bien formado', () => {
    assert.equal(extraerDepartamento('ICA/ICA/ICA'), 'ICA');
    assert.equal(extraerDepartamento('LIMA/LIMA/SAN ISIDRO'), 'LIMA');
    assert.equal(extraerDepartamento('CUSCO/URUBAMBA/MACHUPICCHU'), 'CUSCO');
  });

  test('devuelve null para valores vacíos, null o sin formato esperado', () => {
    assert.equal(extraerDepartamento(null), null);
    assert.equal(extraerDepartamento(undefined), null);
    assert.equal(extraerDepartamento(''), null);
    assert.equal(extraerDepartamento('   '), null);
  });

  test('funciona incluso si solo hay un segmento (sin provincia/distrito)', () => {
    assert.equal(extraerDepartamento('AREQUIPA'), 'AREQUIPA');
  });

  test('recorta espacios alrededor del departamento', () => {
    assert.equal(extraerDepartamento(' PUNO /PUNO/PUNO'), 'PUNO');
  });
});
