/**
 * Análisis del histórico de precios adjudicados (funciones puras + lectura de la base).
 *
 * Qué SÍ publica SEACE (medido el 01/11/2026 en Bienes y Servicios): por ítem, el estado de la
 * cotización (ADJUDICADO/DESIERTO) y, si se adjudicó, RUC, razón social y el precio TOTAL de la
 * cotización ganadora, repetido en cada ítem que cubre. NO publica a los postores perdedores ni
 * sus precios, ni el motivo del desierto: por eso aquí hay "ganadores distintos", nunca
 * "postores distintos", y el desierto se cuenta sin causa.
 *
 * El precio UNITARIO es DEDUCIDO (total / cantidad) y sólo se calcula cuando la contratación
 * tiene un único ítem. Es orientativo. Se desconoce si el precio publicado incluye IGV
 * [VERIFICAR]; el modelo de precio compara en ambos supuestos.
 */
import { normalizar, rubroDeContratacion, segmentoCubso, VERSION_REGLAS_RUBRO, SIN_RUBRO, RUBRO_MIXTO } from './rubros.js';

/** Umbrales de n [SUPUESTO] (alineados con SOP-LIC-011): <5 poco confiable, 5–29 indicativo, ≥30 razonable. */
export const UMBRAL_POCO_CONFIABLE = 5;
export const UMBRAL_RAZONABLE = 30;
export function calidadPorN(n) {
  if (!n) return 'SIN DATOS';
  if (n < UMBRAL_POCO_CONFIABLE) return 'POCO CONFIABLE';
  if (n < UMBRAL_RAZONABLE) return 'INDICATIVO';
  return 'RAZONABLE';
}

/** Percentil con interpolación lineal, igual que PERCENTIL.INC de Excel (p entre 0 y 1). */
export function percentil(valores, p) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const pos = (v.length - 1) * p;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < v.length ? v[i] + f * (v[i + 1] - v[i]) : v[i];
}
// Centavos como Excel (mitad hacia arriba sobre 15 cifras significativas): 229.35/10 = 22.935 -> 22.94.
const r2 = (x) => (x == null ? null : Math.round(Number((x * 100).toPrecision(15))) / 100);

export function estadisticos(valores) {
  const v = valores.filter((x) => Number.isFinite(x));
  const n = v.length;
  return {
    n,
    calidad: calidadPorN(n),
    min: r2(n ? Math.min(...v) : null),
    p10: r2(percentil(v, 0.1)),
    p25: r2(percentil(v, 0.25)),
    mediana: r2(percentil(v, 0.5)),
    p75: r2(percentil(v, 0.75)),
    p90: r2(percentil(v, 0.9)),
    max: r2(n ? Math.max(...v) : null),
    // P90/P10: si es > 10 el grupo mezcla productos muy distintos y la mediana sirve poco como precio de referencia
    dispersion_p90_p10: n >= 2 && percentil(v, 0.1) > 0 ? r2(percentil(v, 0.9) / percentil(v, 0.1)) : null,
  };
}

/** "DD/MM/YYYY HH:mm:ss" -> "YYYY-MM-DD" (null si no se reconoce). */
export function fechaIso(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(texto ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** Semana ISO 8601 "YYYY-Www" de una fecha "YYYY-MM-DD". */
export function semanaIso(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dia + 3); // jueves de esa semana
  const anio = d.getUTCFullYear();
  const primero = new Date(Date.UTC(anio, 0, 4));
  const sem = 1 + Math.round(((d - primero) / 86400000 - 3 + ((primero.getUTCDay() + 6) % 7)) / 7);
  return `${anio}-W${String(sem).padStart(2, '0')}`;
}

/** Fila del histórico (una por contratación) a partir de `resultados_adjudicacion`. */
export function filaHistorico(r) {
  let items = [];
  try { items = JSON.parse(r.items_json || '[]'); } catch { items = []; }
  const { rubro, origen } = rubroDeContratacion({ objeto: r.objeto, items, descripcion: r.descripcion });
  const iso = fechaIso(r.cotizacion_fin);
  const banderas = [];
  const adjudicada = r.resultado !== 'DESIERTO' && r.precio_total_adjudicado != null;
  let unitario = null;
  const cant = Number(items[0]?.cantidad);
  if (r.n_items === 1 && adjudicada) {
    if (cant > 0) { unitario = r2(r.precio_total_adjudicado / cant); banderas.push('UNITARIO_DEDUCIDO'); }
    else banderas.push('CANTIDAD_INVALIDA');
  } else if (adjudicada) banderas.push('TOTAL_CANASTA');
  if (r.resultado === 'DESIERTO') banderas.push('DESIERTO');
  if (r.resultado === 'MIXTO') banderas.push('MIXTO');
  if (rubro === SIN_RUBRO) banderas.push('SIN_RUBRO');
  if (rubro === RUBRO_MIXTO) banderas.push('RUBRO_MIXTO');
  if (origen === 'descripcion') banderas.push('RUBRO_POR_DESCRIPCION');
  const cubsos = items.map((i) => segmentoCubso(i.cubso)).filter(Boolean);
  const segmento = cubsos.length && cubsos.every((s) => s === cubsos[0]) ? cubsos[0] : cubsos.length ? 'VARIOS' : '';
  const rucs = (r.ruc_adjudicado ?? '').split(';').filter(Boolean);
  const razones = (r.razon_adjudicado ?? '').split(';').filter(Boolean);
  return {
    id_contrato: r.id_contrato,
    codigo: r.codigo,
    entidad: r.entidad,
    objeto: r.objeto,
    rubro,
    rubro_origen: origen,
    segmento_cubso: segmento,
    producto_principal: items[0]?.producto ?? null,
    descripcion: (r.descripcion ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
    cierre: iso,
    periodo: iso ? iso.slice(0, 7) : null,
    semana: semanaIso(iso),
    resultado: r.resultado,
    n_items: r.n_items,
    cantidad: r.n_items === 1 && cant > 0 ? cant : null,
    unidad: r.n_items === 1 ? items[0]?.unidad ?? null : null,
    ruc: rucs[0] ?? null,
    rucs_todos: rucs,
    razon_social: razones[0] ?? null,
    precio_total: r.precio_total_adjudicado,
    unitario_deducido: unitario,
    banderas,
  };
}

/** Marca ATIPICO (cercas de Tukey 1.5×RIQ sobre log10 del unitario, sólo si el rubro tiene ≥ 8). Informativo: no excluye nada. */
export function marcarAtipicos(filas) {
  const porRubro = new Map();
  for (const f of filas) if (f.unitario_deducido > 0) (porRubro.get(f.rubro) ?? porRubro.set(f.rubro, []).get(f.rubro)).push(f);
  for (const lista of porRubro.values()) {
    if (lista.length < 8) continue;
    const l = lista.map((f) => Math.log10(f.unitario_deducido));
    const q1 = percentil(l, 0.25), q3 = percentil(l, 0.75), iqr = q3 - q1;
    for (let i = 0; i < lista.length; i++) if (l[i] < q1 - 1.5 * iqr || l[i] > q3 + 1.5 * iqr) lista[i].banderas.push('ATIPICO');
  }
  return filas;
}

/** Resumen de un grupo de filas: n, desiertos, ganadores distintos y estadísticos de precio. */
export function resumenGrupo(filas) {
  const adj = filas.filter((f) => f.resultado === 'ADJUDICADO').length;
  const des = filas.filter((f) => f.resultado === 'DESIERTO').length;
  const mix = filas.filter((f) => f.resultado === 'MIXTO').length;
  const ganadores = new Set(filas.flatMap((f) => f.rucs_todos));
  const unit = estadisticos(filas.map((f) => f.unitario_deducido).filter((x) => x != null));
  const total = estadisticos(filas.filter((f) => f.resultado !== 'DESIERTO').map((f) => f.precio_total).filter((x) => x != null));
  const n = filas.length;
  return {
    n_procesos: n,
    n_adjudicados: adj,
    n_desiertos: des,
    n_mixtos: mix,
    tasa_desiertos: n ? Math.round((des / n) * 1000) / 1000 : null,
    calidad_tasa: calidadPorN(n),
    ganadores_distintos: ganadores.size,
    postores_distintos: null, // SEACE no publica a los postores perdedores
    unitario: unit,
    total,
  };
}

export function resumenPorRubro(filas, { porPeriodo = false, campoPeriodo = 'periodo' } = {}) {
  const grupos = new Map();
  for (const f of filas) {
    const clave = porPeriodo ? `${f.rubro}\u0000${f[campoPeriodo] ?? 'SIN FECHA'}` : f.rubro;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)).push(f);
  }
  return [...grupos.entries()].map(([clave, lista]) => {
    const [rubro, periodo] = clave.split('\u0000');
    return { rubro, ...(porPeriodo ? { periodo } : {}), objetos: [...new Set(lista.map((f) => f.objeto))].join('/'), ...resumenGrupo(lista) };
  }).sort((a, b) => b.n_procesos - a.n_procesos || a.rubro.localeCompare(b.rubro));
}

/**
 * Resumen por PRODUCTO homogéneo (nombre CUBSO normalizado del ítem) de las contrataciones de un solo ítem.
 * Es la comparación realmente útil con un precio de oferta: dentro de un rubro se mezclan productos de
 * precio muy distinto. Sólo entran productos con al menos `minProcesos` contrataciones.
 */
export function resumenPorProducto(filas, { minProcesos = 3 } = {}) {
  const grupos = new Map();
  for (const f of filas) {
    if (f.n_items !== 1 || !f.producto_principal) continue;
    const k = normalizar(f.producto_principal);
    (grupos.get(k) ?? grupos.set(k, []).get(k)).push(f);
  }
  return [...grupos.entries()].filter(([, l]) => l.length >= minProcesos).map(([k, l]) => ({
    producto: k, rubro: l[0].rubro, objeto: l[0].objeto, unidad_frecuente: modaUnidad(l),
    ...resumenGrupo(l), cierre_desde: l.map((f) => f.cierre).filter(Boolean).sort()[0] ?? null, cierre_hasta: l.map((f) => f.cierre).filter(Boolean).sort().at(-1) ?? null,
  })).sort((a, b) => b.n_procesos - a.n_procesos || a.producto.localeCompare(b.producto));
}
function modaUnidad(lista) {
  const c = new Map();
  for (const f of lista) if (f.unidad) c.set(f.unidad, (c.get(f.unidad) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Lee la base (sólo lectura) y arma el paquete completo del histórico. `database` = conexión better-sqlite3. */
export function construirHistorico(database, { ahora = new Date() } = {}) {
  const filasDb = database.prepare(`SELECT * FROM resultados_adjudicacion ORDER BY id_contrato`).all();
  const filas = marcarAtipicos(filasDb.map(filaHistorico));
  const fechas = filas.map((f) => f.cierre).filter(Boolean).sort();
  const sinRubro = {};
  for (const f of filas) if (f.rubro === SIN_RUBRO) sinRubro[f.producto_principal ?? f.descripcion] = (sinRubro[f.producto_principal ?? f.descripcion] ?? 0) + 1;
  const conCubso = filas.filter((f) => f.segmento_cubso).length;
  return {
    meta: {
      generado: ahora.toISOString(),
      fuente: 'SEACE - Buscador público de contrataciones ≤ 8 UIT (prod6.seace.gob.pe), historial del portal licitaciones-seace (base de la Mac)',
      version_reglas_rubro: VERSION_REGLAS_RUBRO,
      n_filas: filas.length,
      cierre_desde: fechas[0] ?? null,
      cierre_hasta: fechas[fechas.length - 1] ?? null,
      filas_con_cubso: conCubso,
      cobertura_rubro: filas.length ? Math.round((filas.filter((f) => f.rubro !== SIN_RUBRO).length / filas.length) * 1000) / 1000 : null,
      umbrales_n: { poco_confiable_menor_que: UMBRAL_POCO_CONFIABLE, razonable_desde: UMBRAL_RAZONABLE },
      avisos: [
        'El precio unitario es DEDUCIDO (total / cantidad) y sólo existe cuando la contratación tiene un único ítem; es orientativo.',
        'SEACE publica sólo la cotización ganadora: no hay postores perdedores ni sus precios, ni motivo del desierto.',
        'Se desconoce si el precio publicado incluye IGV [VERIFICAR].',
        'El rubro sale de palabras clave sobre el nombre CUBSO del ítem (criterio en backend/src/rubros.js); es orientativo.',
      ],
    },
    filas,
    resumen_rubro: resumenPorRubro(filas),
    resumen_periodo: resumenPorRubro(filas, { porPeriodo: true }),
    resumen_producto: resumenPorProducto(filas),
    sin_rubro: Object.entries(sinRubro).sort((a, b) => b[1] - a[1]).map(([nombre, n]) => ({ nombre, n })),
  };
}
