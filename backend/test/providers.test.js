import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generarProveedores, clasificarProducto } from '../src/providerLinks.js';

describe('generarProveedores (enlaces de cotización por item)', () => {
  test('siempre incluye MercadoLibre Perú y Google Shopping', () => {
    const proveedores = generarProveedores('LAPICERO AZUL PUNTA FINA');
    const nombres = proveedores.map((p) => p.nombre);
    assert.ok(nombres.includes('MercadoLibre Perú'));
    assert.ok(nombres.includes('Google Shopping'));
    const ml = proveedores.find((p) => p.nombre === 'MercadoLibre Perú');
    assert.ok(ml.url.startsWith('https://listado.mercadolibre.com.pe/'));
    const gs = proveedores.find((p) => p.nombre === 'Google Shopping');
    assert.ok(gs.url.startsWith('https://www.google.com/search?tbm=shop&q='));
  });

  test('clasifica productos eléctricos/ferretería (ej. conector RJ45)', () => {
    const cat = clasificarProducto('CONECTOR RJ45 CAT 6');
    assert.ok(cat);
    assert.equal(cat.categoria, 'Ferretería / eléctrico');
    const proveedores = generarProveedores('CONECTOR RJ45 CAT 6');
    assert.equal(proveedores.length, 3);
    assert.ok(proveedores[2].url.includes('sodimac.com.pe'));
  });

  test('clasifica útiles de oficina (papel, formato de impresión)', () => {
    const cat = clasificarProducto('PAPEL BOND A4 80GR PARA IMPRESION');
    assert.ok(cat);
    assert.equal(cat.categoria, 'Útiles de oficina');
    const proveedores = generarProveedores('PAPEL BOND A4 80GR PARA IMPRESION');
    assert.equal(proveedores[2].url.includes('tailoy.com.pe'), true);
  });

  test('clasifica cómputo (laptop, toner)', () => {
    const cat = clasificarProducto('TONER PARA IMPRESORA LASER HP');
    assert.ok(cat);
    assert.equal(cat.categoria, 'Cómputo');
  });

  test('sin match de categoría, omite el tercer enlace (no inventa tienda)', () => {
    const proveedores = generarProveedores('COMBUSTIBLE PETROLEO DIESEL B5-S50');
    assert.equal(proveedores.length, 2);
  });

  test('la clasificación ignora mayúsculas/tildes', () => {
    const cat = clasificarProducto('cómputo laptop económica');
    assert.ok(cat);
    assert.equal(cat.categoria, 'Cómputo');
  });
});
