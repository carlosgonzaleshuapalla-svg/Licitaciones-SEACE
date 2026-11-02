import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rubroDeTexto, rubroDeContratacion, segmentoCubso, normalizar, SIN_RUBRO, RUBRO_MIXTO } from '../src/rubros.js';
import {
  percentil, estadisticos, calidadPorN, fechaIso, semanaIso, filaHistorico, marcarAtipicos, resumenGrupo, resumenPorRubro, resumenPorProducto,
} from '../src/historico.js';

// Sin red ni base: funciones puras.
const fila = (id, extra = {}) => ({
  id_contrato: id, codigo: `CM-${id}`, entidad: 'E', objeto: 'Bien', descripcion: 'COMPRA', cotizacion_fin: '20/10/2026 10:00:00',
  resultado: 'ADJUDICADO', n_items: 1, n_adjudicados: 1, ruc_adjudicado: '20111111111', razon_adjudicado: 'A SAC', precio_total_adjudicado: 100,
  items_json: JSON.stringify([{ producto: 'CASCO DE SEGURIDAD', cantidad: 10, unidad: 'UNIDAD', estado: 'ADJUDICADO' }]), ...extra,
});

describe('rubros', () => {
  test('normaliza tildes y mayúsculas', () => assert.equal(normalizar('  Cañería  ñandú '), 'CANERIA NANDU'));
  test('clasifica con reglas explícitas y en orden', () => {
    assert.equal(rubroDeTexto('DIESEL B5 S-50', 'Bien'), 'Combustibles y lubricantes');
    assert.equal(rubroDeTexto('CASCO PROTECTOR DE PLASTICO COLOR BLANCO', 'Bien'), 'EPP y seguridad industrial');
    assert.equal(rubroDeTexto('TONER COLOR NEGRO PARA IMPRESORA LASER', 'Bien'), 'Tóner, tinta y suministros de impresión');
    assert.equal(rubroDeTexto('SERVICIO DE ALQUILER DE CAMIONETA', 'Servicio'), 'Servicios de alquiler de maquinaria y vehículos');
    assert.equal(rubroDeTexto('SERVICIO DE MANTENIMIENTO CORRECTIVO DE TRACTOR ORUGA', 'Servicio'), 'Servicios de mantenimiento y reparación');
  });
  test('las reglas de servicio no se aplican a bienes y viceversa', () => {
    assert.notEqual(rubroDeTexto('MANTENIMIENTO', 'Bien'), 'Servicios de mantenimiento y reparación');
  });
  test('texto sin regla = null; nunca se inventa un rubro', () => {
    assert.equal(rubroDeTexto('XYZZY QWERTY', 'Bien'), null);
    assert.equal(rubroDeContratacion({ objeto: 'Bien', items: [{ producto: 'XYZZY' }], descripcion: 'QWERTY' }).rubro, SIN_RUBRO);
  });
  test('contratación: rubro mayoritario; sin mayoría = canasta mixta; descripción como último recurso', () => {
    const it = (p) => ({ producto: p });
    assert.equal(rubroDeContratacion({ objeto: 'Bien', items: [it('CASCO'), it('GUANTE'), it('DIESEL B5')] }).rubro, 'EPP y seguridad industrial');
    assert.equal(rubroDeContratacion({ objeto: 'Bien', items: [it('CASCO'), it('DIESEL B5')] }).rubro, RUBRO_MIXTO);
    const d = rubroDeContratacion({ objeto: 'Bien', items: [it('XYZZY')], descripcion: 'ADQUISICION DE TONER' });
    assert.equal(d.rubro, 'Tóner, tinta y suministros de impresión');
    assert.equal(d.origen, 'descripcion');
  });
  test('segmento CUBSO: 2 primeros dígitos del código de 16', () => {
    assert.equal(segmentoCubso('8011150100354182'), '80');
    assert.equal(segmentoCubso(null), null);
    assert.equal(segmentoCubso('12'), null);
  });
});

describe('estadística robusta', () => {
  test('percentil igual a PERCENTIL.INC de Excel', () => {
    assert.equal(percentil([1, 2, 3, 4], 0.25), 1.75);
    assert.equal(percentil([10, 20, 30, 40, 50], 0.5), 30);
    assert.equal(percentil([10, 20, 30, 40, 50], 0.9), 46);
    assert.equal(percentil([7], 0.9), 7);
    assert.equal(percentil([], 0.5), null);
  });
  test('estadísticos y calidad por n (umbrales supuestos)', () => {
    const e = estadisticos([5, 1, 3]);
    assert.deepEqual([e.n, e.min, e.mediana, e.max, e.calidad], [3, 1, 3, 5, 'POCO CONFIABLE']);
    assert.equal(calidadPorN(0), 'SIN DATOS');
    assert.equal(calidadPorN(5), 'INDICATIVO');
    assert.equal(calidadPorN(29), 'INDICATIVO');
    assert.equal(calidadPorN(30), 'RAZONABLE');
  });
  test('fechas: ISO y semana ISO 8601', () => {
    assert.equal(fechaIso('30/10/2026 18:00:00'), '2026-10-30');
    assert.equal(fechaIso('basura'), null);
    assert.equal(semanaIso('2026-10-30'), '2026-W44');
    assert.equal(semanaIso('2026-01-01'), '2026-W01');
  });
});

describe('fila del histórico', () => {
  test('ítem único adjudicado: unitario deducido con bandera', () => {
    const f = filaHistorico(fila(1));
    assert.equal(f.unitario_deducido, 10);
    assert.deepEqual(f.banderas, ['UNITARIO_DEDUCIDO']);
    assert.equal(f.periodo, '2026-10');
    assert.equal(f.rubro, 'EPP y seguridad industrial');
  });
  test('centavos como Excel: 229.35 / 10 = 22.935 se redondea a 22.94', () => {
    const f = filaHistorico(fila(9, { precio_total_adjudicado: 229.35, items_json: JSON.stringify([{ producto: 'CASCO', cantidad: 10 }]) }));
    assert.equal(f.unitario_deducido, 22.94);
  });
  test('varios ítems: sin unitario (el total se repite entre ítems), bandera TOTAL_CANASTA', () => {
    const items = [{ producto: 'CASCO', cantidad: 2 }, { producto: 'CASCO', cantidad: 3 }];
    const f = filaHistorico(fila(2, { n_items: 2, items_json: JSON.stringify(items) }));
    assert.equal(f.unitario_deducido, null);
    assert.ok(f.banderas.includes('TOTAL_CANASTA'));
  });
  test('desierto: sin precio ni unitario, con bandera', () => {
    const f = filaHistorico(fila(3, { resultado: 'DESIERTO', precio_total_adjudicado: null, ruc_adjudicado: null, razon_adjudicado: null }));
    assert.equal(f.unitario_deducido, null);
    assert.ok(f.banderas.includes('DESIERTO'));
  });
  test('cantidad cero o ausente: no se divide', () => {
    const f = filaHistorico(fila(4, { items_json: JSON.stringify([{ producto: 'CASCO', cantidad: 0 }]) }));
    assert.equal(f.unitario_deducido, null);
    assert.ok(f.banderas.includes('CANTIDAD_INVALIDA'));
  });
  test('segmento CUBSO sólo si hay código; varios segmentos = VARIOS', () => {
    assert.equal(filaHistorico(fila(5)).segmento_cubso, '');
    const uno = filaHistorico(fila(6, { items_json: JSON.stringify([{ producto: 'CASCO', cantidad: 1, cubso: '4617150100000001' }]) }));
    assert.equal(uno.segmento_cubso, '46');
  });
  test('mixto: no cuenta como desierto', () => {
    const f = filaHistorico(fila(7, { resultado: 'MIXTO', n_items: 2, items_json: JSON.stringify([{ producto: 'CASCO', cantidad: 1 }, { producto: 'CASCO', cantidad: 1 }]) }));
    assert.ok(f.banderas.includes('MIXTO'));
    assert.ok(!f.banderas.includes('DESIERTO'));
  });
});

describe('resumen por rubro', () => {
  const filas = [
    ...[10, 20, 30, 40, 50].map((p, i) => filaHistorico(fila(100 + i, { precio_total_adjudicado: p * 10, ruc_adjudicado: i % 2 ? '20222222222' : '20111111111' }))),
    filaHistorico(fila(200, { resultado: 'DESIERTO', precio_total_adjudicado: null, ruc_adjudicado: null, razon_adjudicado: null })),
    filaHistorico(fila(201, { cotizacion_fin: '05/11/2026 10:00:00', precio_total_adjudicado: 700 })),
  ];
  test('n, desiertos, tasa, ganadores distintos y percentiles', () => {
    const g = resumenGrupo(filas);
    assert.equal(g.n_procesos, 7);
    assert.equal(g.n_desiertos, 1);
    assert.equal(g.tasa_desiertos, 0.143);
    assert.equal(g.ganadores_distintos, 2);
    assert.equal(g.postores_distintos, null); // SEACE no publica perdedores
    assert.equal(g.unitario.n, 6);
    assert.equal(g.unitario.mediana, 35); // unitarios 10,20,30,40,50,70 -> (30+40)/2
  });
  test('por rubro y por período', () => {
    const r = resumenPorRubro(filas);
    assert.equal(r.length, 1);
    assert.equal(r[0].rubro, 'EPP y seguridad industrial');
    const p = resumenPorRubro(filas, { porPeriodo: true });
    assert.deepEqual(p.map((x) => [x.periodo, x.n_procesos]).sort(), [['2026-10', 6], ['2026-11', 1]]);
  });
  test('atípicos: sólo con n >= 8 y sólo se marcan (no se excluyen)', () => {
    const base = Array.from({ length: 8 }, (_, i) => filaHistorico(fila(300 + i, { precio_total_adjudicado: 100 + i })));
    base.push(filaHistorico(fila(399, { precio_total_adjudicado: 100000 })));
    marcarAtipicos(base);
    assert.ok(base[8].banderas.includes('ATIPICO'));
    assert.ok(!base[0].banderas.includes('ATIPICO'));
    const pocos = [filaHistorico(fila(1)), filaHistorico(fila(2, { precio_total_adjudicado: 99999 }))];
    marcarAtipicos(pocos);
    assert.ok(!pocos[1].banderas.includes('ATIPICO'));
  });
});


describe('resumen por producto', () => {
  test('agrupa por nombre CUBSO normalizado sólo con ítem único y un mínimo de procesos', () => {
    const mk = (id, prod, p) => filaHistorico(fila(id, { precio_total_adjudicado: p, items_json: JSON.stringify([{ producto: prod, cantidad: 1, unidad: 'UNIDAD' }]) }));
    const filas = [mk(1, 'Diesel B5 S-50', 10), mk(2, 'DIESEL B5 S-50', 12), mk(3, 'DIESEL B5 S-50', 14), mk(4, 'CASCO', 5), mk(5, 'CASCO', 6)];
    const r = resumenPorProducto(filas, { minProcesos: 3 });
    assert.equal(r.length, 1);
    assert.equal(r[0].producto, 'DIESEL B5 S-50');
    assert.equal(r[0].unitario.mediana, 12);
    assert.equal(r[0].unitario.dispersion_p90_p10, 1.31); // (13.6 / 10.4)
  });
});
