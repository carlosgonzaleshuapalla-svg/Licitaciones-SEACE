import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import {
  registrarSeguimiento, mapDetalleAResultado, detalleResuelto, pendientesDeResultado,
  capturarResultados, resumenResultados, MAX_INTENTOS,
} from '../src/resultados.js';
import { SeaceBloqueadoError } from '../src/seaceClient.js';

// Todo con clientes falsos: ninguna prueba toca la red de SEACE.
const silencio = () => {};
const AHORA = new Date('2026-10-25T20:00:00Z'); // 15:00 en Lima

function cab(id, fin, extra = {}) {
  return { id_contrato: id, codigo: `CM-${id}-2026-PRUEBA`, entidad: 'ENTIDAD', objeto: 'Bien', descripcion: 'PRUEBA', cotizacion_fin: fin, ...extra };
}
const item = (estado, extra = {}) => ({ nomCubso: 'ESTANTE', cantidad: 11, nomUnidadMedida: 'UNIDAD', nomDistrito: 'LIMA/LIMA/PUEBLO LIBRE', nomEstadoCotiza: estado, ...extra });
// Formas reales medidas el 24/10/2026: el precio total se repite en cada ítem cubierto.
const adjudicado = (id, n = 2, ruc = '20434899410', precio = 668.5) => ({
  uitContratoCompletoProjection: { idContrato: id, nroDescripcion: `CM-${id}-2026-PRUEBA`, nomEstadoContrato: 'Culminado', nomObjetoContrato: 'Bien', desObjetoContrato: 'PRUEBA', nomEntidad: 'ENTIDAD' },
  uitContratoItemProjectionList: Array.from({ length: n }, () => item('ADJUDICADO', { codRuc: ruc, nomRazonSocial: 'PROVEEDOR S.A.C.', precioTotal: precio })),
});
const desierto = (id) => ({
  uitContratoCompletoProjection: { idContrato: id, nroDescripcion: `CM-${id}-2026-PRUEBA`, nomEstadoContrato: 'Culminado' },
  uitContratoItemProjectionList: [item('DESIERTO')],
});

function limpiar() {
  db.exec(`DELETE FROM seguimiento_resultado; DELETE FROM resultados_adjudicacion;`);
}

describe('mapeo del detalle', () => {
  test('adjudicado: un solo precio total aunque se repita en cada ítem', () => {
    const r = mapDetalleAResultado(1, adjudicado(1, 14));
    assert.equal(r.resultado, 'ADJUDICADO');
    assert.equal(r.n_items, 14);
    assert.equal(r.n_adjudicados, 14);
    assert.equal(r.precio_total_adjudicado, 668.5);
    assert.equal(r.ruc_adjudicado, '20434899410');
    assert.equal(JSON.parse(r.items_json).length, 14);
  });
  test('desierto: sin proveedor ni precio', () => {
    const r = mapDetalleAResultado(2, desierto(2));
    assert.equal(r.resultado, 'DESIERTO');
    assert.equal(r.precio_total_adjudicado, null);
    assert.equal(r.ruc_adjudicado, null);
  });
  test('mixto: dos ganadores distintos suman cada cotización una vez', () => {
    const d = adjudicado(3, 1, '20111111111', 100);
    d.uitContratoItemProjectionList.push(item('ADJUDICADO', { codRuc: '20222222222', nomRazonSocial: 'OTRO', precioTotal: 250.5 }), item('DESIERTO'));
    const r = mapDetalleAResultado(3, d);
    assert.equal(r.resultado, 'MIXTO');
    assert.equal(r.precio_total_adjudicado, 350.5);
    assert.equal(r.ruc_adjudicado, '20111111111;20222222222');
  });
  test('detalleResuelto: solo si está culminado y todos los ítems tienen resultado', () => {
    assert.equal(detalleResuelto(adjudicado(1)), true);
    assert.equal(detalleResuelto(desierto(1)), true);
    const enEval = adjudicado(1); enEval.uitContratoCompletoProjection.nomEstadoContrato = 'En Evaluación';
    assert.equal(detalleResuelto(enEval), false);
    const sinResultado = desierto(1); sinResultado.uitContratoItemProjectionList[0].nomEstadoCotiza = null;
    assert.equal(detalleResuelto(sinResultado), false);
    assert.equal(detalleResuelto({}), false);
  });
});

describe('captura de resultados', () => {
  beforeEach(limpiar);

  test('solo se revisan las contrataciones cuyo plazo ya venció (con margen de 1 h)', () => {
    registrarSeguimiento(cab(901, '25/10/2026 09:00:00')); // venció hace 6 h
    registrarSeguimiento(cab(902, '25/10/2026 14:30:00')); // venció hace 30 min: aún en el margen
    registrarSeguimiento(cab(903, '30/10/2026 10:00:00')); // sigue abierta
    registrarSeguimiento(cab(904, null));                  // sin fecha: no se puede saber
    const ids = pendientesDeResultado({ ahora: AHORA }).map((f) => f.id_contrato);
    assert.deepEqual(ids, [901]);
  });

  test('guarda adjudicados y desiertos, y los marca resueltos', async () => {
    registrarSeguimiento(cab(911, '25/10/2026 09:00:00'));
    registrarSeguimiento(cab(912, '24/10/2026 09:00:00'));
    const client = { listarCompleto: async (id) => (id === 911 ? adjudicado(911, 3, '20999999999', 5260.43) : desierto(912)) };
    const r = await capturarResultados({ client, log: silencio, ahora: AHORA });
    assert.equal(r.capturados, 2);
    const filas = db.prepare(`SELECT * FROM resultados_adjudicacion ORDER BY id_contrato`).all();
    assert.equal(filas[0].resultado, 'ADJUDICADO');
    assert.equal(filas[0].precio_total_adjudicado, 5260.43);
    assert.equal(filas[1].resultado, 'DESIERTO');
    assert.deepEqual(resumenResultados(), { adjudicados: 1, desiertos: 1, mixtos: 0, pendientes: 0 });
    // una segunda corrida no vuelve a pedir lo ya resuelto
    let llamadas = 0;
    await capturarResultados({ client: { listarCompleto: async () => { llamadas++; return desierto(0); } }, log: silencio, ahora: AHORA });
    assert.equal(llamadas, 0);
  });

  test('sin resultado todavía: se reintenta después y tras MAX_INTENTOS se abandona', async () => {
    registrarSeguimiento(cab(921, '25/10/2026 09:00:00'));
    const enEval = adjudicado(921); enEval.uitContratoCompletoProjection.nomEstadoContrato = 'En Evaluación';
    const client = { listarCompleto: async () => enEval };
    const r1 = await capturarResultados({ client, log: silencio, ahora: AHORA });
    assert.equal(r1.sinResultado, 1);
    assert.equal(db.prepare(`SELECT estado, intentos FROM seguimiento_resultado WHERE id_contrato = 921`).get().estado, 0);
    db.prepare(`UPDATE seguimiento_resultado SET intentos = ? WHERE id_contrato = 921`).run(MAX_INTENTOS - 1);
    const r2 = await capturarResultados({ client, log: silencio, ahora: AHORA });
    assert.equal(r2.abandonados, 1);
    assert.equal(db.prepare(`SELECT estado FROM seguimiento_resultado WHERE id_contrato = 921`).get().estado, 2);
  });

  test('se abandona lo que cerró hace más de 30 días sin resultado', async () => {
    registrarSeguimiento(cab(931, '01/09/2026 09:00:00'));
    const enEval = adjudicado(931); enEval.uitContratoCompletoProjection.nomEstadoContrato = 'En Evaluación';
    const r = await capturarResultados({ client: { listarCompleto: async () => enEval }, log: silencio, ahora: AHORA });
    assert.equal(r.abandonados, 1);
  });

  test('un bloqueo de SEACE detiene la captura sin perder lo pendiente ni reintentar', async () => {
    registrarSeguimiento(cab(941, '24/10/2026 09:00:00'));
    registrarSeguimiento(cab(942, '25/10/2026 09:00:00'));
    let llamadas = 0;
    const client = { listarCompleto: async (id) => { llamadas++; if (id === 942) throw new SeaceBloqueadoError(403, 'x'); return desierto(id); } };
    const r = await capturarResultados({ client, log: silencio, ahora: AHORA });
    assert.equal(r.bloqueado, true);
    assert.equal(r.capturados, 1);
    assert.equal(llamadas, 2);
    assert.equal(db.prepare(`SELECT estado FROM seguimiento_resultado WHERE id_contrato = 942`).get().estado, 0);
  });

  test('un error común en un contrato no frena a los demás', async () => {
    registrarSeguimiento(cab(951, '24/10/2026 09:00:00'));
    registrarSeguimiento(cab(952, '25/10/2026 09:00:00'));
    const client = { listarCompleto: async (id) => { if (id === 951) throw new Error('red'); return desierto(id); } };
    const r = await capturarResultados({ client, log: silencio, ahora: AHORA });
    assert.equal(r.capturados, 1);
    assert.equal(db.prepare(`SELECT intentos FROM seguimiento_resultado WHERE id_contrato = 951`).get().intentos, 1);
  });

  test('respeta el límite por corrida', async () => {
    for (let i = 0; i < 5; i++) registrarSeguimiento(cab(960 + i, '24/10/2026 09:00:00'));
    const r = await capturarResultados({ client: { listarCompleto: async (id) => desierto(id) }, log: silencio, ahora: AHORA, limite: 3 });
    assert.equal(r.revisados, 3);
  });

  test('el historial sobrevive cuando la contratación sale de `tenders`', async () => {
    db.exec(`DELETE FROM tenders`);
    db.prepare(`INSERT INTO tenders (id_contrato, codigo, updated_at) VALUES (970, 'CM-970', ?)`).run(new Date().toISOString());
    registrarSeguimiento(cab(970, '24/10/2026 09:00:00'));
    db.exec(`DELETE FROM tenders WHERE id_contrato = 970`); // lo que hace pruneTendersNotIn al cerrar
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM seguimiento_resultado WHERE id_contrato = 970`).get().n, 1);
  });
});
