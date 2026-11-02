/**
 * Historial de precios adjudicados.
 *
 * El portal solo guarda lo que está vigente: cuando una contratación cierra,
 * `pruneTendersNotIn` la borra. Aquí se conserva lo que importa para calibrar
 * ofertas: QUIÉN ganó y a QUÉ PRECIO TOTAL.
 *
 *  - `seguimiento_resultado`: cada contratación vista mientras estaba abierta,
 *    con su plazo de cotización. NO tiene clave foránea a `tenders`, así que
 *    sobrevive a la limpieza.
 *  - `resultados_adjudicacion`: lo que SEACE publica al cerrar (estado de la
 *    cotización por ítem, RUC, razón social y precio total adjudicado).
 *
 * Qué publica SEACE (medido el 24/10/2026 en 10 contrataciones cerradas): el
 * detalle (`listar-completo`) trae en cada ítem `nomEstadoCotiza` (ADJUDICADO o
 * DESIERTO) y, si se adjudicó, `codRuc`, `nomRazonSocial` y `precioTotal`.
 * `precioTotal` es el TOTAL de la cotización ganadora y se repite igual en todos
 * los ítems que cubre (p. ej. 14 ítems con 668,5). NO publica las cotizaciones
 * perdedoras. Por eso el precio unitario solo se puede deducir cuando la
 * contratación tiene un único ítem.
 */
import { db } from './db.js';
import { SeaceBloqueadoError, ESTADO_CULMINADO } from './seaceClient.js';
import { ordenableDeSeace, ahoraLimaOrdenable } from './fechas.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS seguimiento_resultado (
    id_contrato    INTEGER PRIMARY KEY,
    codigo         TEXT,
    entidad        TEXT,
    objeto         TEXT,
    descripcion    TEXT,
    cotizacion_fin TEXT,
    visto_en       TEXT NOT NULL,
    intentos       INTEGER NOT NULL DEFAULT 0,
    ultimo_intento TEXT,
    estado         INTEGER NOT NULL DEFAULT 0   -- 0 pendiente, 1 resuelto, 2 abandonado
  );
  CREATE INDEX IF NOT EXISTS idx_seguimiento_estado ON seguimiento_resultado(estado);

  CREATE TABLE IF NOT EXISTS resultados_adjudicacion (
    id_contrato            INTEGER PRIMARY KEY,
    codigo                 TEXT,
    entidad                TEXT,
    objeto                 TEXT,
    descripcion            TEXT,
    cotizacion_fin         TEXT,
    resultado              TEXT,      -- ADJUDICADO | DESIERTO | MIXTO
    n_items                INTEGER,
    n_adjudicados          INTEGER,
    ruc_adjudicado         TEXT,
    razon_adjudicado       TEXT,
    precio_total_adjudicado REAL,     -- suma de cada cotización ganadora distinta (RUC + precio)
    items_json             TEXT,      -- [{producto,cantidad,unidad,ciudad,estado}]
    capturado_en           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_resultados_resultado ON resultados_adjudicacion(resultado);

  -- Pequeño almacén de estado para el historial (pausas por bloqueo, avance del histórico).
  CREATE TABLE IF NOT EXISTS resultados_meta (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );
`);

const metaLeer = db.prepare(`SELECT valor FROM resultados_meta WHERE clave = ?`);
const metaEscribir = db.prepare(`INSERT INTO resultados_meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`);
export const meta = {
  leer: (clave) => metaLeer.get(clave)?.valor ?? null,
  escribir: (clave, valor) => metaEscribir.run(clave, String(valor)),
};

/** Horas de pausa de TODO el historial tras un rechazo (403/429) del SEACE. */
export const HORAS_PAUSA_TRAS_BLOQUEO = 6;
export function enPausa(ahora = new Date()) {
  const hasta = Number(meta.leer('pausa_hasta') ?? 0);
  return hasta > ahora.getTime() ? new Date(hasta) : null;
}
function iniciarPausa(ahora = new Date()) {
  meta.escribir('pausa_hasta', ahora.getTime() + HORAS_PAUSA_TRAS_BLOQUEO * 3600 * 1000);
}

// Contrataciones que ya estaban en la base antes de existir este historial.
db.exec(`
  INSERT OR IGNORE INTO seguimiento_resultado (id_contrato, codigo, entidad, objeto, descripcion, cotizacion_fin, visto_en)
  SELECT id_contrato, codigo, entidad, objeto, descripcion, cotizacion_fin, updated_at FROM tenders
`);

const upsertSeguimiento = db.prepare(`
  INSERT INTO seguimiento_resultado (id_contrato, codigo, entidad, objeto, descripcion, cotizacion_fin, visto_en)
  VALUES (@id_contrato, @codigo, @entidad, @objeto, @descripcion, @cotizacion_fin, @visto_en)
  ON CONFLICT(id_contrato) DO UPDATE SET
    codigo = excluded.codigo, entidad = excluded.entidad, objeto = excluded.objeto,
    descripcion = excluded.descripcion, cotizacion_fin = excluded.cotizacion_fin
`);

/** Anota una contratación vista en el buscador (cabecera de `tenders`). */
export function registrarSeguimiento(cab) {
  upsertSeguimiento.run({
    id_contrato: cab.id_contrato,
    codigo: cab.codigo ?? null,
    entidad: cab.entidad ?? null,
    objeto: cab.objeto ?? null,
    descripcion: cab.descripcion ?? null,
    cotizacion_fin: cab.cotizacion_fin ?? null,
    visto_en: new Date().toISOString(),
  });
}

/** Del detalle de SEACE a la fila de `resultados_adjudicacion` (función pura). */
export function mapDetalleAResultado(idContrato, detalle, seguimiento = {}) {
  const cab = detalle?.uitContratoCompletoProjection ?? {};
  const itemsRaw = detalle?.uitContratoItemProjectionList ?? [];
  const items = itemsRaw.map((it) => ({
    producto: it.nomCubso ?? null,
    cantidad: it.cantidad ?? null,
    unidad: it.nomUnidadMedida ?? null,
    ciudad: it.nomDistrito ?? null,
    estado: it.nomEstadoCotiza ?? null,
    cubso: it.codCubso ?? null, // código CUBSO de 16 dígitos (estilo UNSPSC); desde 01/11/2026
  }));
  const adjudicados = itemsRaw.filter((it) => String(it.nomEstadoCotiza ?? '').toUpperCase() === 'ADJUDICADO');
  // Cada cotización ganadora distinta = un par (RUC, precio total).
  const pares = new Map();
  for (const it of adjudicados) {
    if (it.precioTotal == null) continue;
    pares.set(`${it.codRuc}|${it.precioTotal}`, { ruc: it.codRuc ?? null, razon: it.nomRazonSocial ?? null, precio: Number(it.precioTotal) });
  }
  const ganadoras = [...pares.values()];
  const resultado = adjudicados.length === 0 ? 'DESIERTO' : adjudicados.length === itemsRaw.length ? 'ADJUDICADO' : 'MIXTO';
  return {
    id_contrato: idContrato,
    codigo: cab.nroDescripcion ?? seguimiento.codigo ?? null,
    entidad: cab.nomEntidad ?? seguimiento.entidad ?? null,
    objeto: cab.nomObjetoContrato ?? seguimiento.objeto ?? null,
    descripcion: cab.desObjetoContrato ?? seguimiento.descripcion ?? null,
    cotizacion_fin: seguimiento.cotizacion_fin ?? null,
    resultado,
    n_items: itemsRaw.length,
    n_adjudicados: adjudicados.length,
    ruc_adjudicado: ganadoras.map((g) => g.ruc).join(';') || null,
    razon_adjudicado: ganadoras.map((g) => g.razon).join(';') || null,
    precio_total_adjudicado: ganadoras.length ? Math.round(ganadoras.reduce((s, g) => s + g.precio, 0) * 100) / 100 : null,
    items_json: JSON.stringify(items),
    capturado_en: new Date().toISOString(),
  };
}

/** ¿El detalle ya trae el resultado definitivo? (contrato culminado o todos los ítems resueltos) */
export function detalleResuelto(detalle) {
  const cab = detalle?.uitContratoCompletoProjection ?? {};
  const items = detalle?.uitContratoItemProjectionList ?? [];
  if (!items.length) return false;
  const finales = (e) => ['ADJUDICADO', 'DESIERTO'].includes(String(e ?? '').toUpperCase());
  return String(cab.nomEstadoContrato ?? '').toUpperCase() === 'CULMINADO' && items.every((it) => finales(it.nomEstadoCotiza));
}

const guardarResultado = db.prepare(`
  INSERT OR REPLACE INTO resultados_adjudicacion
    (id_contrato, codigo, entidad, objeto, descripcion, cotizacion_fin, resultado, n_items, n_adjudicados,
     ruc_adjudicado, razon_adjudicado, precio_total_adjudicado, items_json, capturado_en)
  VALUES
    (@id_contrato, @codigo, @entidad, @objeto, @descripcion, @cotizacion_fin, @resultado, @n_items, @n_adjudicados,
     @ruc_adjudicado, @razon_adjudicado, @precio_total_adjudicado, @items_json, @capturado_en)
`);
const marcarEstado = db.prepare(`UPDATE seguimiento_resultado SET estado = ?, intentos = intentos + 1, ultimo_intento = ? WHERE id_contrato = ?`);
const sumarIntento = db.prepare(`UPDATE seguimiento_resultado SET intentos = intentos + 1, ultimo_intento = ? WHERE id_contrato = ?`);

export const MAX_INTENTOS = 20;
export const DIAS_PARA_ABANDONAR = 30;

/** Contrataciones cuyo plazo ya venció (con margen) y aún no tienen resultado. Las más recientes primero. */
export function pendientesDeResultado({ ahora = new Date(), margenMin = 60, limite = 40 } = {}) {
  const corte = ahoraLimaOrdenable(new Date(ahora.getTime() - margenMin * 60 * 1000));
  const filas = db.prepare(`SELECT * FROM seguimiento_resultado WHERE estado = 0`).all();
  return filas
    .map((f) => ({ ...f, _fin: ordenableDeSeace(f.cotizacion_fin) }))
    .filter((f) => f._fin !== null && f._fin <= corte)
    .sort((a, b) => (a._fin < b._fin ? 1 : -1)) // lo más reciente primero: es lo más útil para calibrar
    .slice(0, limite);
}

/**
 * Baja de SEACE el resultado de las contrataciones que ya cerraron. Un pedido
 * por contratación (al ritmo del cliente) y como máximo `limite` por corrida.
 * Si SEACE bloquea, se detiene SIN pausar ni reintentar: el resto queda
 * pendiente para la próxima corrida (reintentar solo alargaría el bloqueo).
 */
export async function capturarResultados({ client, log = console.log, ahora = new Date(), limite = Number(process.env.SEACE_RESULTADOS_LIMITE) || 40, margenMin = 60 } = {}) {
  const pausa = enPausa(ahora);
  if (pausa) {
    log(`Resultados: en pausa por un rechazo anterior del SEACE, hasta ${pausa.toISOString()}.`);
    return { capturados: 0, sinResultado: 0, abandonados: 0, bloqueado: false, revisados: 0, enPausa: true };
  }
  const limiteAbandono = ahoraLimaOrdenable(new Date(ahora.getTime() - DIAS_PARA_ABANDONAR * 86400 * 1000));
  let capturados = 0;
  let abandonados = 0;
  let sinResultado = 0;
  let bloqueado = false;
  const cola = pendientesDeResultado({ ahora, margenMin, limite });
  for (const seg of cola) {
    try {
      const detalle = await client.listarCompleto(seg.id_contrato);
      if (detalleResuelto(detalle)) {
        guardarResultado.run(mapDetalleAResultado(seg.id_contrato, detalle, seg));
        marcarEstado.run(1, new Date().toISOString(), seg.id_contrato);
        capturados++;
      } else if (seg.intentos + 1 >= MAX_INTENTOS || (seg._fin && seg._fin < limiteAbandono)) {
        marcarEstado.run(2, new Date().toISOString(), seg.id_contrato);
        abandonados++;
      } else {
        sumarIntento.run(new Date().toISOString(), seg.id_contrato);
        sinResultado++;
      }
    } catch (err) {
      if (err instanceof SeaceBloqueadoError) {
        bloqueado = true;
        iniciarPausa(ahora);
        log(`Resultados: SEACE limitó el ritmo (HTTP ${err.status}); se detiene y todo el historial descansa ${HORAS_PAUSA_TRAS_BLOQUEO} h.`);
        break;
      }
      sumarIntento.run(new Date().toISOString(), seg.id_contrato);
      log(`Resultados: error con el contrato ${seg.id_contrato}: ${err.message}`);
    }
  }
  if (cola.length) {
    log(`Resultados: ${capturados} guardado(s), ${sinResultado} aún sin resultado, ${abandonados} abandonado(s)${bloqueado ? ', cortado por bloqueo' : ''} (de ${cola.length} revisados).`);
  }
  return { capturados, sinResultado, abandonados, bloqueado, revisados: cola.length };
}

/** Conteos para el registro. */
export function resumenResultados() {
  const q = (sql) => db.prepare(sql).get();
  return {
    adjudicados: q(`SELECT COUNT(*) n FROM resultados_adjudicacion WHERE resultado = 'ADJUDICADO'`).n,
    desiertos: q(`SELECT COUNT(*) n FROM resultados_adjudicacion WHERE resultado = 'DESIERTO'`).n,
    mixtos: q(`SELECT COUNT(*) n FROM resultados_adjudicacion WHERE resultado = 'MIXTO'`).n,
    pendientes: q(`SELECT COUNT(*) n FROM seguimiento_resultado WHERE estado = 0`).n,
  };
}


const insertarSeguimientoSiFalta = db.prepare(`
  INSERT OR IGNORE INTO seguimiento_resultado (id_contrato, codigo, entidad, objeto, descripcion, cotizacion_fin, visto_en)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// SEACE_HISTORICO_DIAS=0 apaga el histórico (interruptor de emergencia); sin definir: 90 días.
export const DIAS_HISTORICO = process.env.SEACE_HISTORICO_DIAS === '0' ? 0 : Number(process.env.SEACE_HISTORICO_DIAS) || 90;
// Páginas del buscador por corrida, en TOTAL (se reparten entre los objetos pendientes, Bienes primero).
export const PAGINAS_HISTORICO_POR_CORRIDA = Number(process.env.SEACE_HISTORICO_PAGINAS) || 20;
// Objetos del histórico: 1 = Bien, 2 = Servicio (SEACE_HISTORICO_OBJETOS="1" lo deja sólo en Bienes).
export const OBJETOS_HISTORICO = (process.env.SEACE_HISTORICO_OBJETOS ?? '1,2').split(',').map((x) => Number(x.trim())).filter((x) => x === 1 || x === 2);
const TAM_PAGINA = 50;

// Cursores por objeto. Bienes conserva las claves originales (compatibles con bases ya en uso);
// Servicios usa las mismas con sufijo _2.
const claveCursor = (objeto, base) => (objeto === 1 ? base : `${base}_${objeto}`);

/**
 * Anota las contrataciones (Bienes y Servicios) ya cerradas de los últimos `dias` días para que
 * `capturarResultados` les baje el resultado poco a poco. Avanza como máximo `paginas` páginas
 * del buscador por corrida (en total, no por objeto) y recuerda dónde se quedó en cada objeto.
 * Ante un 403/429 se detiene SIN reintentar y todo el historial descansa 6 h.
 */
export async function prepararHistorico({ client, log = console.log, ahora = new Date(), dias = DIAS_HISTORICO, paginas = PAGINAS_HISTORICO_POR_CORRIDA, objetos = OBJETOS_HISTORICO } = {}) {
  if (!(dias > 0)) return { completo: false, anotados: 0, paginas: 0, apagado: true };
  const todosCompletos = () => objetos.every((o) => meta.leer(claveCursor(o, 'historico_completo')) === '1');
  if (meta.leer('historico_dias') === String(dias) && todosCompletos()) return { completo: true, anotados: 0, paginas: 0 };
  const pausa = enPausa(ahora);
  if (pausa) {
    log(`Histórico: en pausa por un rechazo anterior del SEACE, hasta ${pausa.toISOString()}.`);
    return { completo: false, anotados: 0, paginas: 0, enPausa: true };
  }
  if (meta.leer('historico_dias') !== String(dias)) {
    meta.escribir('historico_dias', dias);
    for (const o of [1, 2]) {
      meta.escribir(claveCursor(o, 'historico_pagina'), 1);
      meta.escribir(claveCursor(o, 'historico_completo'), 0);
    }
  }
  const corte = ahoraLimaOrdenable(new Date(ahora.getTime() - dias * 86400 * 1000));
  let anotados = 0;
  let leidas = 0;
  let detenido = false;
  const porObjeto = {};
  for (const objeto of objetos) {
    if (detenido || leidas >= paginas) break;
    if (meta.leer(claveCursor(objeto, 'historico_completo')) === '1') continue;
    let pagina = Number(meta.leer(claveCursor(objeto, 'historico_pagina')) ?? 1);
    let completoObj = false;
    let anotadosObj = 0;
    let leidasObj = 0;
    while (leidas < paginas) {
      let r;
      try {
        r = await client.buscarPagina({ page: pagina, pageSize: TAM_PAGINA, objetos: [objeto], estados: [ESTADO_CULMINADO] });
      } catch (err) {
        if (err instanceof SeaceBloqueadoError) {
          iniciarPausa(ahora);
          log(`Histórico: SEACE limitó el ritmo (HTTP ${err.status}) en la página ${pagina} (objeto ${objeto}); se detiene y descansa ${HORAS_PAUSA_TRAS_BLOQUEO} h.`);
        } else {
          log(`Histórico: error en la página ${pagina} (objeto ${objeto}): ${err.message}. Se retoma en la próxima corrida.`);
        }
        detenido = true;
        break;
      }
      const data = r?.data ?? [];
      leidas++;
      leidasObj++;
      for (const rec of data) {
        const pub = ordenableDeSeace(rec.fecPublica);
        if (pub !== null && pub < corte) continue; // fuera de la ventana
        if (!rec.idContrato) continue;
        const res = insertarSeguimientoSiFalta.run(rec.idContrato, rec.desContratacion ?? null, rec.nomEntidad ?? null, rec.nomObjetoContrato ?? null, rec.desObjetoContrato ?? null, rec.fecFinCotizacion ?? null, new Date().toISOString());
        anotados += res.changes;
        anotadosObj += res.changes;
      }
      const ultima = data.length ? ordenableDeSeace(data[data.length - 1].fecPublica) : null;
      if (data.length === 0 || (ultima !== null && ultima < corte)) {
        completoObj = true;
        break;
      }
      pagina++;
      meta.escribir(claveCursor(objeto, 'historico_pagina'), pagina);
    }
    if (completoObj) meta.escribir(claveCursor(objeto, 'historico_completo'), 1);
    porObjeto[objeto] = { anotados: anotadosObj, paginas: leidasObj, completo: completoObj, siguientePagina: pagina };
    log(`Histórico (${dias} días, ${objeto === 1 ? 'Bienes' : 'Servicios'}): ${anotadosObj} contratación(es) anotada(s) en ${leidasObj} página(s)${completoObj ? '; ventana completa' : `; sigue en la página ${pagina}`}.`);
  }
  return { completo: todosCompletos(), anotados, paginas: leidas, porObjeto };
}

// SEACE_CUBSO_RELLENO = nº de resultados antiguos (sin código CUBSO) a re-consultar por corrida. 0 (por defecto) = apagado.
export const CUBSO_RELLENO_POR_CORRIDA = Number(process.env.SEACE_CUBSO_RELLENO) || 0;

/**
 * Completa el código CUBSO (codCubso) de resultados guardados ANTES de que se guardara. Un pedido por
 * contratación (al ritmo del cliente), lo más reciente primero, hasta `limite` por corrida; ante
 * 403/429 se detiene sin reintentar y activa la misma pausa. Sólo toca `items_json`: nunca cambia
 * resultado, ganador ni precio. Con `limite` 0 no hace nada.
 */
export async function rellenarCubso({ client, log = console.log, ahora = new Date(), limite = CUBSO_RELLENO_POR_CORRIDA } = {}) {
  if (!(limite > 0)) return { rellenados: 0, apagado: true };
  const pausa = enPausa(ahora);
  if (pausa) return { rellenados: 0, enPausa: true };
  const filas = db.prepare(`SELECT id_contrato, items_json FROM resultados_adjudicacion WHERE items_json NOT LIKE '%"cubso"%' ORDER BY id_contrato DESC LIMIT ?`).all(limite);
  const actualizar = db.prepare(`UPDATE resultados_adjudicacion SET items_json = ? WHERE id_contrato = ?`);
  let rellenados = 0;
  let sinCoincidir = 0;
  for (const f of filas) {
    try {
      const detalle = await client.listarCompleto(f.id_contrato);
      const nuevos = mapDetalleAResultado(f.id_contrato, detalle);
      const viejos = JSON.parse(f.items_json);
      const items = JSON.parse(nuevos.items_json);
      // Sólo se acepta si el detalle coincide ítem por ítem (mismo orden y producto).
      if (items.length === viejos.length && items.every((it, i) => it.producto === viejos[i].producto)) {
        actualizar.run(JSON.stringify(viejos.map((v, i) => ({ ...v, cubso: items[i].cubso }))), f.id_contrato);
        rellenados++;
      } else {
        sinCoincidir++;
        actualizar.run(JSON.stringify(viejos.map((v) => ({ ...v, cubso: null }))), f.id_contrato); // evita reintentar para siempre
      }
    } catch (err) {
      if (err instanceof SeaceBloqueadoError) {
        iniciarPausa(ahora);
        log(`CUBSO: SEACE limitó el ritmo (HTTP ${err.status}); se detiene y el historial descansa ${HORAS_PAUSA_TRAS_BLOQUEO} h.`);
        break;
      }
      log(`CUBSO: error con el contrato ${f.id_contrato}: ${err.message}`);
    }
  }
  if (filas.length) log(`CUBSO: ${rellenados} relleno(s), ${sinCoincidir} sin coincidencia (de ${filas.length} revisados).`);
  return { rellenados, sinCoincidir, revisados: filas.length };
}
