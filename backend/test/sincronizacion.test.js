import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { runSync, startScheduledSync, getSyncStatus } from '../src/syncService.js';
import { crearClienteSeace, SeaceBloqueadoError } from '../src/seaceClient.js';
import { obtenerTenderDetalle } from '../src/tendersRepo.js';

// Todo con clientes falsos: ninguna prueba toca la red de SEACE.

const BASE = 999997000;
const silencio = () => {};

function registro(id, extra = {}) {
  return {
    idContrato: id,
    desContratacion: `CM-SYNC-${id}`,
    nomEntidad: 'ENTIDAD DE PRUEBA',
    idObjetoContrato: 1,
    nomObjetoContrato: 'Bien',
    desObjetoContrato: 'PRUEBA SINCRONIZACION',
    nomEstadoContrato: 'Vigente',
    fecPublica: '01/01/2026 10:00:00',
    fecIniCotizacion: '01/01/2026 10:00:00',
    fecFinCotizacion: '01/01/2099 10:00:00',
    ...extra,
  };
}

// El detalle trae el MISMO id de catálogo (1509) en todas las licitaciones y
// repetido dos veces dentro de cada una — como pasa con los datos reales.
function detalle() {
  const item = (cantidad) => ({
    idContratoItem: 1509,
    nomCubso: 'DIESEL B5 S-50',
    cantidad,
    nomUnidadMedida: 'GALON',
    nomDistrito: 'LIMA/LIMA/LIMA',
  });
  return {
    uitContratoItemProjectionList: [item(10), item(20)],
    uitContratoEtapaProjectionList: [
      { idContratoEtapa: Math.floor(Math.random() * 1e9), nomEtapaContrato: 'ETAPA DE COTIZACIÓN', fecIni: 'a', fecFin: 'b' },
    ],
  };
}

function crearFake({ ids, bloquearListaEnPagina = null, bloquearDetallesTrasN = Infinity }) {
  const llamadas = { detalle: 0, paginas: 0 };
  let registros = ids.map((id) => registro(id));
  return {
    llamadas,
    setRegistros(fn) {
      registros = ids.map((id) => fn(registro(id)));
    },
    async buscarPagina({ page, pageSize }) {
      llamadas.paginas++;
      if (bloquearListaEnPagina !== null && page >= bloquearListaEnPagina) {
        throw new SeaceBloqueadoError(403, 'lista');
      }
      const data = registros.slice((page - 1) * pageSize, page * pageSize);
      return { data, pageable: { totalElements: registros.length } };
    },
    async listarCompleto() {
      llamadas.detalle++;
      if (llamadas.detalle > bloquearDetallesTrasN) throw new SeaceBloqueadoError(403, 'detalle');
      return detalle();
    },
  };
}

function limpiar() {
  db.prepare('DELETE FROM tenders WHERE id_contrato >= ?').run(BASE);
}

describe('items: el id de catálogo de SEACE se repite y NO debe pisar licitaciones', () => {
  beforeEach(limpiar);

  test('licitaciones que comparten el mismo id de ítem conservan cada una sus ítems', async () => {
    const ids = [BASE + 1, BASE + 2, BASE + 3];
    const fake = crearFake({ ids });
    await runSync({ log: silencio, client: fake, saltarCooldown: true });

    for (const id of ids) {
      const d = obtenerTenderDetalle(id);
      assert.equal(d.items.length, 2, `la licitación ${id} debe conservar sus 2 ítems`);
      assert.equal(d.cantidadItems, 2);
      assert.deepEqual(d.ciudades, ['LIMA']);
    }
    // y los idItem que ve el frontend son únicos (se usan como key de React)
    const todos = ids.flatMap((id) => obtenerTenderDetalle(id).items.map((i) => i.idItem));
    assert.equal(new Set(todos).size, todos.length);
  });
});

describe('cliente de SEACE ante un firewall (403/429)', () => {
  test('un 403 lanza SeaceBloqueadoError y NO se reintenta', async () => {
    let llamadas = 0;
    const cliente = crearClienteSeace({
      minIntervalMs: 0,
      fetchImpl: async () => {
        llamadas++;
        return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}) };
      },
    });
    await assert.rejects(() => cliente.listarCompleto(1), SeaceBloqueadoError);
    assert.equal(llamadas, 1, 'reintentar un bloqueo solo lo prolonga');
  });

  test('un 429 también cuenta como bloqueo', async () => {
    const cliente = crearClienteSeace({
      minIntervalMs: 0,
      fetchImpl: async () => ({ ok: false, status: 429, statusText: 'Too Many', json: async () => ({}) }),
    });
    await assert.rejects(() => cliente.buscarPagina({ page: 1, pageSize: 50 }), SeaceBloqueadoError);
  });

  test('respeta la separación mínima entre peticiones aunque se lancen en paralelo', async () => {
    const inicios = [];
    const cliente = crearClienteSeace({
      minIntervalMs: 40,
      fetchImpl: async () => {
        inicios.push(Date.now());
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    await Promise.all([1, 2, 3, 4].map((n) => cliente.listarCompleto(n)));
    for (let i = 1; i < inicios.length; i++) {
      assert.ok(inicios[i] - inicios[i - 1] >= 35, `petición ${i} salió demasiado pegada a la anterior`);
    }
  });
});

describe('sincronización incremental', () => {
  beforeEach(limpiar);

  test('la segunda corrida no vuelve a pedir los detalles ya descargados y conserva los ítems', async () => {
    const ids = [BASE + 11, BASE + 12, BASE + 13, BASE + 14];
    const fake = crearFake({ ids });

    await runSync({ log: silencio, client: fake, saltarCooldown: true });
    assert.equal(fake.llamadas.detalle, 4);

    await runSync({ log: silencio, client: fake, saltarCooldown: true });
    assert.equal(fake.llamadas.detalle, 4, 'no debe pedir detalles que ya tiene');

    for (const id of ids) {
      const d = obtenerTenderDetalle(id);
      assert.equal(d.items.length, 2, 're-sincronizar la cabecera no debe borrar los ítems');
      assert.equal(d.cantidadItems, 2);
    }
  });

  test('aun sin pedir detalles, la cabecera sí se actualiza (p. ej. plazo ampliado)', async () => {
    const ids = [BASE + 21];
    const fake = crearFake({ ids });
    await runSync({ log: silencio, client: fake, saltarCooldown: true });

    fake.setRegistros((r) => ({ ...r, fecFinCotizacion: '31/12/2099 23:00:00' }));
    await runSync({ log: silencio, client: fake, saltarCooldown: true });

    assert.equal(obtenerTenderDetalle(ids[0]).cotizacionFin, '31/12/2099 23:00:00');
  });
});

describe('SEACE bloquea (403) durante la sincronización', () => {
  beforeEach(limpiar);

  test('en los detalles: frena tras varios rechazos seguidos, deja lo pendiente; al recuperarse pide solo lo que faltó', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => BASE + 100 + i);
    const bloqueante = crearFake({ ids, bloquearDetallesTrasN: 2 });

    const r = await runSync({ log: silencio, client: bloqueante, saltarCooldown: true });

    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'bloqueado');
    assert.ok(bloqueante.llamadas.detalle < 12, `siguió golpeando a SEACE (${bloqueante.llamadas.detalle} peticiones)`);
    const s1 = getSyncStatus();
    assert.equal(s1.bloqueado, true);
    assert.ok(s1.pendientesDetalle > 0);
    // las cabeceras igual quedaron guardadas: se ven aunque sin detalle
    assert.equal(obtenerTenderDetalle(ids[29]).idContrato, ids[29]);

    const yaBajados = db
      .prepare('SELECT COUNT(*) c FROM tenders WHERE detalle_ok = 1 AND id_contrato >= ?')
      .get(BASE).c;
    assert.ok(yaBajados >= 1 && yaBajados <= 2);

    // SEACE vuelve a responder: solo se piden los que faltaban
    const sano = crearFake({ ids });
    const r2 = await runSync({ log: silencio, client: sano, saltarCooldown: true });
    assert.equal(r2.ok, true);
    assert.equal(sano.llamadas.detalle, ids.length - yaBajados);
    const s2 = getSyncStatus();
    assert.equal(s2.bloqueado, false);
    assert.equal(s2.pendientesDetalle, 0);
    assert.ok(s2.ultimoExito);
  });

  test('en la lista: no pide detalles ni borra nada de lo que ya había', async () => {
    limpiar();
    const viejo = crearFake({ ids: [BASE + 201, BASE + 202] });
    await runSync({ log: silencio, client: viejo, saltarCooldown: true });

    const bloqueado = crearFake({ ids: [BASE + 203], bloquearListaEnPagina: 1 });
    const r = await runSync({ log: silencio, client: bloqueado, saltarCooldown: true });

    assert.equal(r.motivo, 'bloqueado');
    assert.equal(bloqueado.llamadas.detalle, 0);
    // lista incompleta → no se hace limpieza: lo anterior sigue visible
    assert.ok(obtenerTenderDetalle(BASE + 201));
    assert.ok(obtenerTenderDetalle(BASE + 202));
  });

  test('un disparo manual se rechaza mientras dure la espera tras un bloqueo', async () => {
    limpiar();
    const bloqueado = crearFake({ ids: [BASE + 301], bloquearListaEnPagina: 1 });
    const prog = startScheduledSync({ log: silencio, client: bloqueado });
    for (let i = 0; i < 50 && !getSyncStatus().proximoIntento; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    prog.stop();

    const r = await runSync({ log: silencio, client: crearFake({ ids: [BASE + 301] }), origen: 'manual', saltarCooldown: true });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'bloqueado');
    assert.ok(r.proximoIntento);
  });
});
