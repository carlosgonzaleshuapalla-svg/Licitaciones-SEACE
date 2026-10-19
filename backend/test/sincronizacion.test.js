import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { runSync, startScheduledSync, getSyncStatus } from '../src/syncService.js';
import { crearClienteSeace, SeaceBloqueadoError } from '../src/seaceClient.js';
import { obtenerTenderDetalle } from '../src/tendersRepo.js';

// Todo con clientes falsos: ninguna prueba toca la red de SEACE.

const BASE = 999997000;
const silencio = () => {};
// Sin esperas reales: las pausas ante un 403 son de minutos en producción.
const rapido = { log: silencio, saltarCooldown: true, pausasMs: [0, 0, 0] };

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

function crearFake({
  ids,
  bloquearListaEnPagina = null,
  bloquearDetallesTrasN = Infinity,
  bloqueosTransitorios = 0, // los primeros N detalles dan 403 y luego SEACE se recupera
  bloqueosListaTransitorios = 0, // ídem para las primeras N páginas de la lista
}) {
  const llamadas = { detalle: 0, paginas: 0 };
  let registros = ids.map((id) => registro(id));
  return {
    llamadas,
    setRegistros(fn) {
      registros = ids.map((id) => fn(registro(id)));
    },
    async buscarPagina({ page, pageSize }) {
      llamadas.paginas++;
      if (llamadas.paginas <= bloqueosListaTransitorios) throw new SeaceBloqueadoError(403, 'lista-transitorio');
      if (bloquearListaEnPagina !== null && page >= bloquearListaEnPagina) {
        throw new SeaceBloqueadoError(403, 'lista');
      }
      const data = registros.slice((page - 1) * pageSize, page * pageSize);
      return { data, pageable: { totalElements: registros.length } };
    },
    async listarCompleto() {
      llamadas.detalle++;
      if (llamadas.detalle <= bloqueosTransitorios) throw new SeaceBloqueadoError(403, 'detalle-transitorio');
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
    await runSync({ ...rapido, client: fake });

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

  test('tras un 403 el cliente se frena (duplica el intervalo) y luego vuelve a acelerar con éxitos', async () => {
    let n = 0;
    const cliente = crearClienteSeace({
      minIntervalMs: 2,
      fetchImpl: async () => {
        n++;
        if (n === 1) return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    assert.equal(cliente.intervaloActualMs(), 2);
    await assert.rejects(() => cliente.listarCompleto(1), SeaceBloqueadoError);
    assert.equal(cliente.intervaloActualMs(), 4, 'duplica tras el 403');
    for (let i = 0; i < 30; i++) await cliente.listarCompleto(i);
    assert.ok(cliente.intervaloActualMs() < 4, 'con una racha de éxitos vuelve hacia la base');
    assert.ok(cliente.intervaloActualMs() >= 2, 'sin bajar de la base');
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

    await runSync({ ...rapido, client: fake });
    assert.equal(fake.llamadas.detalle, 4);

    await runSync({ ...rapido, client: fake });
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
    await runSync({ ...rapido, client: fake });

    fake.setRegistros((r) => ({ ...r, fecFinCotizacion: '31/12/2099 23:00:00' }));
    await runSync({ ...rapido, client: fake });

    assert.equal(obtenerTenderDetalle(ids[0]).cotizacionFin, '31/12/2099 23:00:00');
  });
});


describe('un 403 pasajero (SEACE se recupera solo en segundos) NO abandona la corrida', () => {
  beforeEach(limpiar);

  test('en los detalles: pausa, reintenta lo rechazado y termina todo en la misma corrida', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => BASE + 400 + i);
    const fake = crearFake({ ids, bloqueosTransitorios: 2 });

    const r = await runSync({ ...rapido, client: fake });

    assert.equal(r.ok, true, 'no debe quedar marcado como bloqueado');
    assert.equal(getSyncStatus().bloqueado, false);
    assert.equal(getSyncStatus().pendientesDetalle, 0);
    // 10 detalles + los 2 rechazados que se reintentaron, ninguno perdido
    assert.equal(fake.llamadas.detalle, 12);
    for (const id of ids) assert.equal(obtenerTenderDetalle(id).items.length, 2);
  });

  test('en la lista: reintenta la misma página tras la pausa y completa la lista', async () => {
    const ids = [BASE + 501, BASE + 502, BASE + 503];
    const fake = crearFake({ ids, bloqueosListaTransitorios: 1 });

    const r = await runSync({ ...rapido, client: fake });

    assert.equal(r.ok, true);
    assert.equal(fake.llamadas.paginas, 2, 'una página rechazada + la misma reintentada');
    assert.ok(getSyncStatus().ultimoExito, 'la lista se completó, cuenta como éxito');
    assert.equal(getSyncStatus().pendientesDetalle, 0);
  });
});

describe('solo se guardan las licitaciones con plazo de cotización abierto (sin histórico)', () => {
  beforeEach(limpiar);

  test('las vencidas ni se guardan ni se les pide el detalle', async () => {
    const ids = [BASE + 601, BASE + 602, BASE + 603];
    const fake = crearFake({ ids });
    fake.setRegistros((r) =>
      r.idContrato === BASE + 602 ? { ...r, fecFinCotizacion: '01/01/2020 10:00:00' } : r,
    );

    await runSync({ ...rapido, client: fake });

    assert.equal(fake.llamadas.detalle, 2, 'no se pide el detalle de la vencida');
    assert.ok(obtenerTenderDetalle(BASE + 601));
    assert.ok(obtenerTenderDetalle(BASE + 603));
    assert.equal(obtenerTenderDetalle(BASE + 602), null, 'la vencida no queda guardada');
  });

  test('una que estaba guardada y luego vence sale sola en la siguiente sincronización', async () => {
    const ids = [BASE + 611, BASE + 612];
    const fake = crearFake({ ids });
    await runSync({ ...rapido, client: fake });
    assert.ok(obtenerTenderDetalle(BASE + 612));

    fake.setRegistros((r) =>
      r.idContrato === BASE + 612 ? { ...r, fecFinCotizacion: '01/01/2020 10:00:00' } : r,
    );
    const r = await runSync({ ...rapido, client: fake });

    assert.equal(r.eliminados >= 1, true);
    assert.equal(obtenerTenderDetalle(BASE + 612), null);
    assert.ok(obtenerTenderDetalle(BASE + 611), 'la que sigue abierta se conserva');
  });
});

describe('SEACE bloquea (403) durante la sincronización', () => {
  beforeEach(limpiar);

  test('en los detalles: frena tras varios rechazos seguidos, deja lo pendiente; al recuperarse pide solo lo que faltó', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => BASE + 100 + i);
    const bloqueante = crearFake({ ids, bloquearDetallesTrasN: 2 });

    const r = await runSync({ ...rapido, client: bloqueante });

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
    const r2 = await runSync({ ...rapido, client: sano });
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
    await runSync({ ...rapido, client: viejo });

    const bloqueado = crearFake({ ids: [BASE + 203], bloquearListaEnPagina: 1 });
    const r = await runSync({ ...rapido, client: bloqueado });

    assert.equal(r.motivo, 'bloqueado');
    assert.equal(bloqueado.llamadas.detalle, 0);
    // lista incompleta → no se hace limpieza: lo anterior sigue visible
    assert.ok(obtenerTenderDetalle(BASE + 201));
    assert.ok(obtenerTenderDetalle(BASE + 202));
  });

  test('un disparo manual se rechaza mientras dure la espera tras un bloqueo', async () => {
    limpiar();
    const bloqueado = crearFake({ ids: [BASE + 301], bloquearListaEnPagina: 1 });
    const prog = startScheduledSync({ log: silencio, client: bloqueado, pausasMs: [0, 0, 0] });
    for (let i = 0; i < 50 && !getSyncStatus().proximoIntento; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    prog.stop();

    const r = await runSync({ ...rapido, client: crearFake({ ids: [BASE + 301] }), origen: 'manual' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'bloqueado');
    assert.ok(r.proximoIntento);
  });
});
