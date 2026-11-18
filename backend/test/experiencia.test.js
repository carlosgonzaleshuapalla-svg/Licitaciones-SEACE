import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertTenderHeader, replaceTenderDetail, guardarRevisionBases } from '../src/db.js';
import { mapListRecordToTenderHeader, mapDetailToItemsAndEtapas } from '../src/syncService.js';
import { listarTenders, obtenerTenderDetalle } from '../src/tendersRepo.js';
import { exportarSemilla, comprimirSemilla, leerSemilla, importarSemilla } from '../src/semilla.js';
import { detectarExperiencia } from '../src/requisitos.js';

const BASE = 999994000;
const vaciar = () => db.prepare('DELETE FROM tenders').run();

describe('detectarExperiencia', () => {
  test('encuentra la exigencia aunque esté en mayúsculas y con tildes', () => {
    const r = detectarExperiencia([
      'TANQUE ACRILICO - ADJUNTAR FICHA TECNICA - POSTOR DEBE PERTENECER AL RUBRO Y ACREDITAR EXPERIENCIA EN VENTAS SIMILARES POR UN MONTO ACUMULADO',
    ]);
    assert.equal(r.exige, 1);
    assert.match(r.nota, /EXPERIENCIA EN VENTAS SIMILARES/);
    assert.ok(r.nota.length <= 230);
  });

  test('reconoce "ventas/servicios similares" y "trayectoria" aunque no diga "experiencia"', () => {
    assert.equal(detectarExperiencia(['El postor acreditará ventas similares por S/ 10 000']).exige, 1);
    assert.equal(detectarExperiencia(['Se valora la trayectoria del proveedor']).exige, 1);
  });

  test('"sin experiencia" o "no se requiere experiencia" NO cuentan como exigencia', () => {
    assert.equal(detectarExperiencia(['Postor sin experiencia previa puede participar']).exige, 0);
    assert.equal(detectarExperiencia(['No se requiere experiencia del postor.']).exige, 0);
  });

  test('sin texto o sin mención: exige 0 y sin nota', () => {
    assert.deepEqual(detectarExperiencia([null, undefined, '', 'ADQUISICION DE LAPTOPS']), { exige: 0, nota: null });
    assert.deepEqual(detectarExperiencia([]), { exige: 0, nota: null });
  });

  test('revisa todos los textos: basta que un producto la pida', () => {
    assert.equal(detectarExperiencia(['COMPRA DE UTILES', 'CUADERNO A4', 'ACREDITAR EXPERIENCIA MINIMA DE 1 AÑO']).exige, 1);
  });
});

describe('filtro por experiencia y viaje en la semilla', () => {
  beforeEach(vaciar);

  const alta = (id, textoItem) => {
    upsertTenderHeader(mapListRecordToTenderHeader({
      idContrato: id, desContratacion: `CM-EXP-${id}`, nomEntidad: 'E', nomObjetoContrato: 'Bien',
      desObjetoContrato: 'PRUEBA REQUISITOS', nomEstadoContrato: 'Vigente',
      fecPublica: '01/01/2026 10:00:00', fecIniCotizacion: '01/01/2026 10:00:00', fecFinCotizacion: '01/01/2099 10:00:00',
    }));
    const { items, etapas, experiencia } = mapDetailToItemsAndEtapas(id, {
      uitContratoCompletoProjection: { desObjetoContrato: 'PRUEBA REQUISITOS' },
      uitContratoItemProjectionList: [{ idContratoItem: 1, nomCubso: 'COSA', cantidad: 1, nomUnidadMedida: 'UNIDAD', nomDistrito: 'LIMA/LIMA/LIMA', descripcionItem: textoItem }],
      uitContratoEtapaProjectionList: [{ idContratoEtapa: id * 10, nomEtapaContrato: 'ETAPA', fecIni: 'a', fecFin: 'b' }],
    });
    replaceTenderDetail(id, items, etapas, experiencia);
  };

  test('"con" y "sin" separan bien, y la nota viaja al detalle', () => {
    alta(BASE + 1, 'POSTOR DEBE ACREDITAR EXPERIENCIA EN VENTAS SIMILARES');
    alta(BASE + 2, 'ADJUNTAR FICHA TECNICA');
    // uno con detalle viejo (sin el dato): no aparece en ninguno de los dos filtros
    upsertTenderHeader(mapListRecordToTenderHeader({ idContrato: BASE + 3, desContratacion: 'CM-EXP-3', nomObjetoContrato: 'Bien', desObjetoContrato: 'PRUEBA REQUISITOS', nomEstadoContrato: 'Vigente' }));
    replaceTenderDetail(BASE + 3, [], []);

    const ids = (f) => listarTenders({ q: 'PRUEBA REQUISITOS', pageSize: 10, ...f }).data.map((t) => t.idContrato).sort();
    assert.deepEqual(ids({ experiencia: 'con' }), [BASE + 1]);
    // "sin" exige haber LEÍDO el anexo: hasta entonces BASE+2 (que solo pasó por la descripción) no entra.
    assert.deepEqual(ids({ experiencia: 'sin' }), []);
    guardarRevisionBases(BASE + 2, { estado: 'leido', exige: 0, nota: null, fuente: null });
    assert.deepEqual(ids({ experiencia: 'sin' }), [BASE + 2]);
    assert.deepEqual(ids({}), [BASE + 1, BASE + 2, BASE + 3]);

    const d = obtenerTenderDetalle(BASE + 1);
    assert.equal(d.exigeExperiencia, true);
    assert.match(d.notaExperiencia, /EXPERIENCIA/);
    assert.equal(obtenerTenderDetalle(BASE + 3).exigeExperiencia, null);
  });

  test('un valor raro en el filtro no rompe la consulta (se ignora)', () => {
    alta(BASE + 4, 'X');
    const r = listarTenders({ q: 'PRUEBA REQUISITOS', experiencia: "x'; DROP TABLE tenders; --", pageSize: 10 });
    assert.equal(r.data.length, 1);
  });

  test('la semilla lleva el dato y al reimportar se conserva', () => {
    alta(BASE + 5, 'ACREDITAR EXPERIENCIA');
    alta(BASE + 6, 'NADA');
    const semilla = leerSemilla(comprimirSemilla(exportarSemilla()));
    vaciar();
    importarSemilla(semilla);
    assert.equal(obtenerTenderDetalle(BASE + 5).exigeExperiencia, true);
    assert.equal(obtenerTenderDetalle(BASE + 6).exigeExperiencia, false);
  });

  test('una semilla vieja (sin el dato) no borra lo ya sabido', () => {
    alta(BASE + 7, 'ACREDITAR EXPERIENCIA');
    const semilla = leerSemilla(comprimirSemilla(exportarSemilla()));
    for (const t of semilla.tenders) { delete t.exigeExperiencia; delete t.notaExperiencia; }
    importarSemilla(semilla);
    assert.equal(obtenerTenderDetalle(BASE + 7).exigeExperiencia, true);
  });
});

describe('detectarExperiencia con texto de bases (plantilla de TDR)', () => {
  test('el encabezado "TIEMPO MÍNIMO DE EXPERIENCIA / REQUIERE PERSONAL ESPECIALIZADO: No aplica" no cuenta', () => {
    const tdr = `REQUISITOS DEL POSTOR\nPertenecer al rubro.\nTIEMPO MÍNIMO DE EXPERIENCIA\nREQUIERE PERSONAL ESPECIALIZADO   No Aplica.\nExperiencia del personal: No aplica.`;
    assert.equal(detectarExperiencia([tdr]).exige, 0);
  });

  test('una mención negada al inicio no tapa una exigencia real más abajo', () => {
    const tdr = `Nota: no se requiere experiencia en obras.\n\nEl postor debe acreditar experiencia en ventas de bienes similares por un monto facturado acumulado igual o mayor a la cotización.`;
    const r = detectarExperiencia([tdr]);
    assert.equal(r.exige, 1);
    assert.match(r.nota, /ventas de bienes similares/);
  });

  test('la cláusula del TDR real (leída por OCR, con saltos de línea) se detecta', () => {
    const ocr = `El postor debe acreditar experiencia en ventas de bienes similares\n5.   por un monto facturado acumulado igual o mayor a la cotización. La\nexperiencia será acreditada con copia simple de contratos u órdenes`;
    assert.equal(detectarExperiencia([ocr]).exige, 1);
  });
});
