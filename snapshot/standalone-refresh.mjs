/**
 * Script autocontenido (sin imports locales) que:
 *   1. Descarga las contrataciones Bien+Vigente de SEACE (API pública).
 *   2. Genera enlaces de proveedores por producto.
 *   3. Arma el HTML final del Artifact "Licitaciones SEACE" con los datos
 *      incrustados.
 *
 * Se usa tanto localmente (node standalone-refresh.mjs) como desde la
 * rutina programada en la nube (que no tiene acceso al resto del repo, así
 * que este archivo no importa nada de backend/ ni de otros módulos).
 *
 * Salida: ./artifact.html en el mismo directorio que este script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- cliente HTTP hacia SEACE ----------
const BASE_URL = 'https://prod6.seace.gob.pe/v1/s8uit-services/buscadorpublico/contrataciones';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const PAGE_SIZE = 50;
const DETAIL_CONCURRENCY = 6;
const ANIO_FIJO = 2024;
const CODIGO_OBJETO_BIEN = 1;
const ESTADO_VIGENTE = 2;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchJsonConReintento(url, { retries = MAX_RETRIES } = {}) {
  let lastError;
  for (let intento = 0; intento <= retries; intento++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} para ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (intento < retries) await sleep(RETRY_DELAY_MS * (intento + 1));
    }
  }
  throw lastError;
}

function buscarPagina({ page, pageSize }) {
  const url = `${BASE_URL}/buscador?anio=${ANIO_FIJO}&palabra_clave=&orden=2&lista_codigo_objeto=${CODIGO_OBJETO_BIEN}&lista_estado_contrato=${ESTADO_VIGENTE}&page=${page}&page_size=${pageSize}`;
  return fetchJsonConReintento(url);
}
function listarCompleto(idContrato) {
  return fetchJsonConReintento(`${BASE_URL}/listar-completo?id_contrato=${idContrato}`);
}

// ---------- concurrencia ----------
async function runWithConcurrency(items, limit, worker, onError) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const idx = cursor++;
      try { results[idx] = await worker(items[idx], idx); }
      catch (err) { if (onError) onError(err, items[idx], idx); results[idx] = undefined; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

// ---------- clasificador de proveedores ----------
const CATEGORIAS = [
  { categoria: 'Ferretería / eléctrico', keywords: ['cable', 'conector', 'electric', 'riel', 'interruptor', 'tomacorriente', 'foco', 'lampara', 'lámpara', 'tuberia', 'tubería', 'pvc', 'tornillo', 'valvula', 'válvula', 'jack rj45', 'llave termica', 'llave térmica', 'caja de paso', 'enchufe', 'fluorescente', 'reflector'], tienda: { nombre: 'Sodimac', buildUrl: (q) => `https://www.sodimac.com.pe/sodimac-pe/search?Ntt=${q}` } },
  { categoria: 'Útiles de oficina', keywords: ['papel', 'oficina', 'formato', 'impresion', 'impresión', 'archivador', 'lapicero', 'lapiz', 'lápiz', 'folder', 'engrapador', 'cuaderno', 'carpeta', 'sobre manila', 'cinta adhesiva', 'plumon', 'plumón'], tienda: { nombre: 'Tai Loy', buildUrl: (q) => `https://www.tailoy.com.pe/catalogsearch/result/?q=${q}` } },
  { categoria: 'Cómputo', keywords: ['laptop', 'computadora', 'impresora', 'toner', 'tóner', 'tinta', 'monitor', 'teclado', 'mouse', 'cpu', 'disco duro', 'memoria ram', 'usb', 'cartucho', 'notebook', 'scanner', 'escáner'], tienda: { nombre: 'Coolbox', buildUrl: (q) => `https://www.coolbox.pe/catalogsearch/result/?q=${q}` } },
];
const DIACRITICOS_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');
function normalizar(t) { return (t || '').toLowerCase().normalize('NFD').replace(DIACRITICOS_REGEX, ''); }
function clasificarProducto(nomCubso) {
  const texto = normalizar(nomCubso);
  for (const entry of CATEGORIAS) if (entry.keywords.some((kw) => texto.includes(normalizar(kw)))) return entry;
  return null;
}
function generarProveedores(nomCubso) {
  const texto = (nomCubso || '').trim();
  const q = encodeURIComponent(texto);
  const proveedores = [
    { nombre: 'MercadoLibre Perú', url: `https://listado.mercadolibre.com.pe/${q}`, categoria: 'Marketplace general' },
    { nombre: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${q}`, categoria: 'Marketplace general' },
  ];
  const match = clasificarProducto(texto);
  if (match) proveedores.push({ nombre: match.tienda.nombre, url: match.tienda.buildUrl(q), categoria: match.categoria });
  return proveedores;
}

// ---------- mapeo SEACE -> snapshot ----------
function extraerDepartamento(nomDistrito) {
  if (!nomDistrito || typeof nomDistrito !== 'string') return null;
  const dep = nomDistrito.split('/')[0]?.trim();
  return dep || null;
}
function mapHeader(record) {
  return {
    idContrato: record.idContrato, codigo: record.desContratacion ?? null, entidad: record.nomEntidad ?? null,
    objeto: record.nomObjetoContrato ?? null, descripcion: record.desObjetoContrato ?? null, estado: record.nomEstadoContrato ?? null,
    fechaPublicacion: record.fecPublica ?? null, cotizacionInicio: record.fecIniCotizacion ?? null, cotizacionFin: record.fecFinCotizacion ?? null,
    esProductoRapido: record.nomObjetoContrato === 'Bien',
  };
}
function mapDetalle(detalle) {
  const items = (detalle?.uitContratoItemProjectionList ?? []).map((it) => ({
    idItem: it.idContratoItem, producto: it.nomCubso ?? null, cantidad: it.cantidad ?? null,
    unidadMedida: it.nomUnidadMedida ?? null, ciudad: it.nomDistrito ?? null, proveedores: generarProveedores(it.nomCubso),
  }));
  const etapas = (detalle?.uitContratoEtapaProjectionList ?? []).map((et) => ({ nombre: et.nomEtapaContrato ?? null, inicio: et.fecIni ?? null, fin: et.fecFin ?? null }));
  const ciudades = [...new Set(items.map((it) => extraerDepartamento(it.ciudad)).filter(Boolean))];
  return { items, etapas, ciudades };
}

async function fetchTodosLosRegistros(log) {
  const registros = [];
  let page = 1, totalElements = Infinity;
  while ((page - 1) * PAGE_SIZE < totalElements) {
    const respuesta = await buscarPagina({ page, pageSize: PAGE_SIZE });
    const data = respuesta?.data ?? [];
    registros.push(...data);
    totalElements = respuesta?.pageable?.totalElements ?? registros.length;
    if (data.length === 0) break;
    log(`  página ${page}: ${registros.length}/${totalElements}`);
    page++;
  }
  return registros;
}

// ---------- plantilla HTML (diseño del artifact) ----------
const HTML_TEMPLATE = String.raw`<title>Licitaciones SEACE</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">

<style>
  :root {
    --paper: #f7f6f3; --paper-raised: #ffffff; --ink: #1c1a17; --ink-soft: #5b564c; --ink-faint: #8c8578;
    --line: #ddd8cd; --line-strong: #c7c0b1; --accent: #b3221a; --accent-ink: #ffffff; --accent-soft: #f3ded9;
    --success: #3a7d5c; --success-soft: #dcece3; --warn: #b8791a; --warn-soft: #f3e6d2; --focus: #1c5fb8;
    --shadow: 0 8px 24px -12px rgba(28, 26, 23, 0.28);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #15140f; --paper-raised: #1e1c16; --ink: #ede9df; --ink-soft: #b3ac9c; --ink-faint: #837c6c;
      --line: #33301f; --line-strong: #46422a; --accent: #e2564b; --accent-ink: #1c0a08; --accent-soft: #3a1c17;
      --success: #6cbf95; --success-soft: #1c3128; --warn: #dba24a; --warn-soft: #35270f; --focus: #7cb0f2;
      --shadow: 0 8px 28px -12px rgba(0, 0, 0, 0.6);
    }
  }
  :root[data-theme="dark"] {
    --paper: #15140f; --paper-raised: #1e1c16; --ink: #ede9df; --ink-soft: #b3ac9c; --ink-faint: #837c6c;
    --line: #33301f; --line-strong: #46422a; --accent: #e2564b; --accent-ink: #1c0a08; --accent-soft: #3a1c17;
    --success: #6cbf95; --success-soft: #1c3128; --warn: #dba24a; --warn-soft: #35270f; --focus: #7cb0f2;
    --shadow: 0 8px 28px -12px rgba(0, 0, 0, 0.6);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: "IBM Plex Sans", system-ui, sans-serif; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  h1, h2, h3 { font-family: "Archivo", system-ui, sans-serif; text-wrap: balance; margin: 0; }
  a { color: inherit; } button { font: inherit; } ::selection { background: var(--accent-soft); }
  .topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px; padding: 14px 20px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .seal { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-family: "Archivo", sans-serif; font-weight: 800; font-size: 15px; letter-spacing: -0.02em; flex: none; }
  .topbar h1 { font-size: 19px; font-weight: 800; letter-spacing: -0.01em; }
  .topbar .sub { font-size: 12.5px; color: var(--ink-faint); margin-top: 1px; }
  .topbar .meta { margin-left: auto; text-align: right; font-size: 11.5px; color: var(--ink-faint); }
  .topbar .meta strong { color: var(--ink-soft); font-weight: 600; }
  .shell { display: grid; grid-template-columns: 268px minmax(0, 1fr); align-items: start; }
  .rail { position: sticky; top: 61px; height: calc(100vh - 61px); overflow-y: auto; padding: 20px 16px 40px; border-right: 1px solid var(--line); }
  .field { margin-bottom: 18px; }
  .field label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin-bottom: 6px; }
  .field select, .field input[type="search"] { width: 100%; padding: 9px 10px; border-radius: 7px; border: 1px solid var(--line-strong); background: var(--paper-raised); color: var(--ink); font-size: 13.5px; font-family: inherit; }
  .field select:focus, .field input:focus, button:focus-visible, a:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .toggle-row { display: flex; gap: 9px; align-items: flex-start; padding: 11px; border-radius: 8px; background: var(--paper-raised); border: 1px solid var(--line); }
  .toggle-row input { margin-top: 3px; accent-color: var(--accent); }
  .toggle-row .t-label { font-size: 12.5px; font-weight: 600; }
  .toggle-row .t-help { font-size: 11.5px; color: var(--ink-faint); margin-top: 3px; line-height: 1.45; }
  .rail-count { font-size: 11.5px; color: var(--ink-faint); margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
  .rail-count strong { color: var(--ink); font-family: "IBM Plex Mono", monospace; }
  .main { padding: 20px 24px 60px; min-width: 0; }
  .list-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
  .list-head h2 { font-size: 15px; color: var(--ink-soft); font-weight: 600; }
  .empty { padding: 60px 20px; text-align: center; color: var(--ink-faint); }
  .cards { display: flex; flex-direction: column; gap: 10px; }
  .card { text-align: left; width: 100%; background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; cursor: pointer; display: grid; gap: 6px; transition: border-color .12s ease, box-shadow .12s ease; }
  .card:hover { border-color: var(--line-strong); }
  .card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .card-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .card-code { font-size: 11.5px; color: var(--ink-faint); }
  .pill { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 99px; }
  .pill-ok { background: var(--success-soft); color: var(--success); }
  .pill-neutral { background: var(--accent-soft); color: var(--accent); }
  .card-entity { font-size: 14.5px; font-weight: 600; }
  .card-desc { font-size: 13px; color: var(--ink-soft); }
  .card-foot { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
  .card-foot b { color: var(--ink-soft); font-weight: 600; }
  .card-foot .val { font-family: "IBM Plex Mono", monospace; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 22px; font-size: 13px; color: var(--ink-soft); }
  .pager button { padding: 7px 14px; border-radius: 7px; border: 1px solid var(--line-strong); background: var(--paper-raised); color: var(--ink); cursor: pointer; }
  .pager button:disabled { opacity: .4; cursor: not-allowed; }
  .backdrop { position: fixed; inset: 0; background: rgba(20, 18, 14, 0.35); opacity: 0; pointer-events: none; transition: opacity .16s ease; z-index: 29; }
  .backdrop.show { opacity: 1; pointer-events: auto; }
  .panel { position: fixed; top: 0; right: 0; height: 100%; width: min(480px, 100vw); background: var(--paper-raised); border-left: 1px solid var(--line); box-shadow: var(--shadow); transform: translateX(100%); transition: transform .18s ease; z-index: 30; overflow-y: auto; }
  .panel.open { transform: translateX(0); }
  .panel-head { position: sticky; top: 0; background: var(--paper-raised); border-bottom: 1px solid var(--line); padding: 16px 18px; z-index: 2; }
  .panel-close { border: 1px solid var(--line-strong); background: var(--paper); color: var(--ink-soft); border-radius: 7px; padding: 5px 10px; cursor: pointer; font-size: 12px; float: right; }
  .panel-head .card-code { display: block; margin-bottom: 6px; }
  .panel-head h3 { font-size: 17px; margin-top: 2px; }
  .panel-head .card-desc { margin-top: 4px; }
  .panel-body { padding: 16px 18px 40px; }
  .panel-section { margin-bottom: 22px; }
  .panel-section h4 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin-bottom: 10px; }
  .etapas { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .etapas li { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; padding: 8px 10px; background: var(--paper); border-radius: 7px; border: 1px solid var(--line); }
  .etapas b { font-weight: 600; }
  .etapas span { color: var(--ink-faint); font-family: "IBM Plex Mono", monospace; text-align: right; }
  .item-card { border: 1px solid var(--line); border-radius: 9px; padding: 13px; margin-bottom: 12px; background: var(--paper); }
  .item-card h5 { font-size: 13px; font-weight: 600; margin: 0 0 3px; }
  .item-meta { font-size: 11.5px; color: var(--ink-faint); font-family: "IBM Plex Mono", monospace; }
  .provs { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
  .prov-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; text-decoration: none; padding: 5px 10px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); border: 1px solid transparent; }
  .prov-link:hover { border-color: var(--accent); }
  .prov-link .cat { opacity: .7; font-weight: 400; }
  .calc { border-top: 1px dashed var(--line-strong); padding-top: 12px; margin-top: 10px; display: grid; gap: 10px; }
  .calc-row label { display: block; font-size: 11.5px; color: var(--ink-faint); margin-bottom: 4px; }
  .calc-row input[type="number"] { width: 100%; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--paper-raised); color: var(--ink); font-family: "IBM Plex Mono", monospace; font-size: 13px; }
  .calc-row input[type="range"] { width: 100%; accent-color: var(--accent); }
  .margin-value { font-family: "IBM Plex Mono", monospace; color: var(--accent); font-weight: 600; }
  .calc-results { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 4px; }
  .calc-results div { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 7px; padding: 8px 9px; }
  .calc-results .rlabel { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); display: block; margin-bottom: 3px; }
  .calc-results .rval { font-family: "IBM Plex Mono", monospace; font-weight: 600; font-size: 13px; }
  .calc-results .gain { color: var(--success); }
  .notice { font-size: 11.5px; color: var(--ink-faint); line-height: 1.5; background: var(--warn-soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 11px; }
  .footer { text-align: center; font-size: 11.5px; color: var(--ink-faint); padding: 30px 20px 10px; }
  @media (max-width: 860px) { .shell { grid-template-columns: 1fr; } .rail { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--line); } .main { padding: 16px; } .panel { width: 100%; } }
  @media (prefers-reduced-motion: reduce) { .panel, .backdrop, .card { transition: none; } }
</style>

<div class="topbar">
  <div class="seal">SE</div>
  <div><h1>Licitaciones SEACE</h1><div class="sub">Bienes en cotización activa &middot; buscador público del Estado peruano</div></div>
  <div class="meta" id="meta-generado"></div>
</div>

<div class="shell">
  <aside class="rail">
    <div class="field"><label for="f-depto">Ciudad / departamento</label><select id="f-depto"><option value="">Todos los departamentos</option></select></div>
    <div class="field"><label for="f-q">Buscar</label><input id="f-q" type="search" placeholder="Descripción o entidad…"></div>
    <div class="toggle-row">
      <input type="checkbox" id="f-bienes" checked>
      <div><div class="t-label">Solo productos para comprar y entregar</div>
      <div class="t-help">Criterio real disponible en SEACE: contratos clasificados como "Bien" frente a Servicio/Obra/Consultoría. SEACE no publica un plazo de entrega estructurado, así que no mostramos "rapidez de entrega" — solo el tipo de contratación.</div></div>
    </div>
    <div class="rail-count"><strong id="rail-total">0</strong> licitaciones vigentes en el snapshot</div>
  </aside>
  <main class="main">
    <div class="list-head"><h2 id="list-count">Cargando…</h2></div>
    <div class="cards" id="cards"></div>
    <div class="empty" id="empty" style="display:none">No hay licitaciones que coincidan con estos filtros.</div>
    <div class="pager" id="pager" style="display:none"></div>
    <div class="footer">Datos: buscador público de SEACE (prod6.seace.gob.pe) &middot; snapshot regenerado automáticamente varias veces al día &middot; los enlaces de proveedores son búsquedas directas, no precios verificados en tiempo real.</div>
  </main>
</div>
<div class="backdrop" id="backdrop"></div>
<aside class="panel" id="panel" aria-hidden="true"></aside>

<script id="seace-data" type="application/json">__SEACE_DATA_JSON__</script>
<script>
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("seace-data").textContent);
  var tenders = DATA.tenders || [];
  var PAGE_SIZE = 20;
  var state = { depto: "", q: "", soloBienes: true, page: 1, activeId: null };
  var fmtMoneda = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });

  function parseFechaSeace(valor) {
    if (!valor) return null;
    var m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(valor.trim());
    if (!m) { var d0 = new Date(valor); return isNaN(d0.getTime()) ? null : d0; }
    var d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
    return isNaN(d.getTime()) ? null : d;
  }
  function formatearFecha(valor) {
    var d = parseFechaSeace(valor);
    if (!d) return valor || "—";
    return d.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var generadoEl = document.getElementById("meta-generado");
  var fechaGen = new Date(DATA.generadoEn);
  generadoEl.innerHTML = "Actualizado<br><strong>" + (!isNaN(fechaGen.getTime()) ? fechaGen.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—") + "</strong>";

  var deptoSel = document.getElementById("f-depto");
  (DATA.departamentos || []).forEach(function (d) {
    var opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    deptoSel.appendChild(opt);
  });
  document.getElementById("rail-total").textContent = tenders.length;

  deptoSel.addEventListener("change", function () { state.depto = deptoSel.value; state.page = 1; render(); });
  var qInput = document.getElementById("f-q");
  var qTimer = null;
  qInput.addEventListener("input", function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = qInput.value.trim().toLowerCase(); state.page = 1; render(); }, 250);
  });
  var bienesChk = document.getElementById("f-bienes");
  bienesChk.addEventListener("change", function () { state.soloBienes = bienesChk.checked; state.page = 1; render(); });

  function filtrar() {
    return tenders.filter(function (t) {
      if (state.soloBienes && !t.esProductoRapido) return false;
      if (state.depto && (t.ciudades || []).indexOf(state.depto) === -1) return false;
      if (state.q) {
        var hay = ((t.descripcion || "") + " " + (t.entidad || "") + " " + (t.codigo || "")).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    });
  }

  var cardsEl = document.getElementById("cards");
  var emptyEl = document.getElementById("empty");
  var pagerEl = document.getElementById("pager");
  var countEl = document.getElementById("list-count");

  function cardHTML(t) {
    var activeCls = t.idContrato === state.activeId ? " active" : "";
    return (
      '<button class="card' + activeCls + '" data-id="' + t.idContrato + '">' +
      '<div class="card-top"><span class="card-code mono">' + esc(t.codigo) + '</span>' +
      '<span class="pill pill-ok">' + esc(t.estado) + '</span>' +
      '<span class="pill pill-neutral">' + esc(t.objeto) + '</span></div>' +
      '<div class="card-entity">' + esc(t.entidad) + '</div>' +
      '<div class="card-desc">' + esc(t.descripcion) + '</div>' +
      '<div class="card-foot">' +
      '<span><b>Ciudades:</b> <span class="val">' + esc((t.ciudades || []).join(", ") || "—") + '</span></span>' +
      '<span><b>Publicado:</b> <span class="val">' + esc(formatearFecha(t.fechaPublicacion)) + '</span></span>' +
      '<span><b>Cotización:</b> <span class="val">' + esc(formatearFecha(t.cotizacionInicio)) + ' – ' + esc(formatearFecha(t.cotizacionFin)) + '</span></span>' +
      '<span><b>Items:</b> <span class="val">' + t.cantidadItems + '</span></span>' +
      '</div></button>'
    );
  }

  function render() {
    var filtrados = filtrar();
    countEl.textContent = filtrados.length + " licitacion" + (filtrados.length === 1 ? "" : "es") + " encontradas";
    var totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = filtrados.slice(start, start + PAGE_SIZE);

    if (pageItems.length === 0) { cardsEl.innerHTML = ""; emptyEl.style.display = "block"; }
    else { emptyEl.style.display = "none"; cardsEl.innerHTML = pageItems.map(cardHTML).join(""); }

    if (filtrados.length > PAGE_SIZE) {
      pagerEl.style.display = "flex";
      pagerEl.innerHTML =
        '<button id="p-prev" ' + (state.page <= 1 ? "disabled" : "") + '>&larr; Anterior</button>' +
        '<span class="mono">Página ' + state.page + ' de ' + totalPages + '</span>' +
        '<button id="p-next" ' + (state.page >= totalPages ? "disabled" : "") + '>Siguiente &rarr;</button>';
      document.getElementById("p-prev").addEventListener("click", function () { state.page--; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      document.getElementById("p-next").addEventListener("click", function () { state.page++; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    } else { pagerEl.style.display = "none"; pagerEl.innerHTML = ""; }

    Array.prototype.forEach.call(cardsEl.querySelectorAll(".card"), function (btn) {
      btn.addEventListener("click", function () { openPanel(Number(btn.getAttribute("data-id"))); });
    });
  }

  var panelEl = document.getElementById("panel");
  var backdropEl = document.getElementById("backdrop");

  function calcularProyeccion(costo, margen, cantidad) {
    var c = Number(costo); if (!isFinite(c) || c < 0) c = 0;
    var m = Number(margen); if (!isFinite(m)) m = 0;
    var cant = Number(cantidad); if (!isFinite(cant) || cant < 0) cant = 0;
    var precioUnit = c * (1 + m / 100);
    return { precioUnit: precioUnit, precioTotal: precioUnit * cant, gananciaTotal: (precioUnit - c) * cant };
  }

  function itemHTML(item, idx) {
    var provs = (item.proveedores || []).map(function (p) {
      return '<a class="prov-link" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + esc(p.nombre) + ' <span class="cat">' + esc(p.categoria) + '</span></a>';
    }).join("");
    return (
      '<div class="item-card" data-idx="' + idx + '">' +
      '<h5>' + esc(item.producto) + '</h5>' +
      '<div class="item-meta">' + item.cantidad + ' ' + esc(item.unidadMedida) + ' &middot; ' + esc(item.ciudad) + '</div>' +
      '<div class="provs">' + provs + '</div>' +
      '<div class="calc">' +
      '<div class="calc-row"><label>Costo unitario estimado (S/)</label><input type="number" min="0" step="0.01" placeholder="0.00" class="calc-costo" data-idx="' + idx + '"></div>' +
      '<div class="calc-row"><label>Margen de ganancia: <span class="margin-value calc-margin-label" data-idx="' + idx + '">30%</span></label><input type="range" min="0" max="100" step="1" value="30" class="calc-margen" data-idx="' + idx + '" aria-label="Porcentaje de ganancia"></div>' +
      '<div class="calc-results">' +
      '<div><span class="rlabel">Venta unitaria</span><span class="rval calc-r-unit" data-idx="' + idx + '">S/ 0.00</span></div>' +
      '<div><span class="rlabel">Total (' + item.cantidad + ')</span><span class="rval calc-r-total" data-idx="' + idx + '">S/ 0.00</span></div>' +
      '<div><span class="rlabel">Ganancia</span><span class="rval gain calc-r-gain" data-idx="' + idx + '">S/ 0.00</span></div>' +
      '</div></div></div>'
    );
  }

  function wireCalculators(items) {
    Array.prototype.forEach.call(panelEl.querySelectorAll(".calc-costo, .calc-margen"), function (el) {
      el.addEventListener("input", function () {
        var idx = Number(el.getAttribute("data-idx"));
        var item = items[idx];
        var costoEl = panelEl.querySelector('.calc-costo[data-idx="' + idx + '"]');
        var margenEl = panelEl.querySelector('.calc-margen[data-idx="' + idx + '"]');
        var res = calcularProyeccion(costoEl.value, margenEl.value, item.cantidad);
        panelEl.querySelector('.calc-margin-label[data-idx="' + idx + '"]').textContent = margenEl.value + "%";
        panelEl.querySelector('.calc-r-unit[data-idx="' + idx + '"]').textContent = fmtMoneda.format(res.precioUnit);
        panelEl.querySelector('.calc-r-total[data-idx="' + idx + '"]').textContent = fmtMoneda.format(res.precioTotal);
        panelEl.querySelector('.calc-r-gain[data-idx="' + idx + '"]').textContent = fmtMoneda.format(res.gananciaTotal);
      });
    });
  }

  function openPanel(idContrato) {
    var t = tenders.filter(function (x) { return x.idContrato === idContrato; })[0];
    if (!t) return;
    state.activeId = idContrato;
    render();
    var etapasHTML = (t.etapas || []).map(function (e) {
      return '<li><b>' + esc(e.nombre) + '</b><span>' + esc(formatearFecha(e.inicio)) + ' – ' + esc(formatearFecha(e.fin)) + '</span></li>';
    }).join("") || '<li><span>Sin etapas registradas</span></li>';
    panelEl.innerHTML =
      '<div class="panel-head"><button class="panel-close" id="panel-close">✕ Cerrar</button>' +
      '<span class="card-code mono">' + esc(t.codigo) + '</span>' +
      '<h3>' + esc(t.entidad) + '</h3>' +
      '<div class="card-desc">' + esc(t.descripcion) + '</div></div>' +
      '<div class="panel-body">' +
      '<div class="panel-section"><h4>Etapas del proceso</h4><ul class="etapas">' + etapasHTML + '</ul></div>' +
      '<div class="panel-section"><h4>Items y proyección de venta</h4>' + (t.items || []).map(itemHTML).join("") + '</div>' +
      '<div class="notice">Los enlaces de proveedores son búsquedas directas en cada marketplace, elegidas por el nombre oficial del producto (catálogo CUBSO) — no son precios verificados en tiempo real. Cotiza con el proveedor que te dé mejor precio y plazo real.</div>' +
      '</div>';
    document.getElementById("panel-close").addEventListener("click", closePanel);
    wireCalculators(t.items || []);
    panelEl.classList.add("open"); panelEl.setAttribute("aria-hidden", "false");
    backdropEl.classList.add("show");
  }
  function closePanel() {
    panelEl.classList.remove("open"); panelEl.setAttribute("aria-hidden", "true");
    backdropEl.classList.remove("show");
    state.activeId = null; render();
  }
  backdropEl.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });
  render();
})();
</script>
`;

// ---------- main ----------
async function main() {
  const inicio = Date.now();
  const log = (m) => console.log(m);

  log('Descargando lista de contrataciones Bien + Vigente...');
  const registros = await fetchTodosLosRegistros(log);
  log(`Total: ${registros.length} contrataciones. Descargando detalle...`);

  let ok = 0;
  const tenders = await runWithConcurrency(
    registros, DETAIL_CONCURRENCY,
    async (record) => {
      const detalle = await listarCompleto(record.idContrato);
      const { items, etapas, ciudades } = mapDetalle(detalle);
      ok++;
      if (ok % 100 === 0) log(`  detalle ${ok}/${registros.length}`);
      return { ...mapHeader(record), items, etapas, ciudades, cantidadItems: items.length };
    },
    (err, record) => log(`  error en contrato ${record.idContrato}: ${err.message}`)
  );

  const tendersValidos = tenders.filter(Boolean);
  const departamentos = [...new Set(tendersValidos.flatMap((t) => t.ciudades))].sort();
  const snapshot = { generadoEn: new Date().toISOString(), total: tendersValidos.length, departamentos, tenders: tendersValidos };

  const dataSegura = JSON.stringify(snapshot).replace(/<\/script/gi, '<\\/script');
  const html = HTML_TEMPLATE.replace('__SEACE_DATA_JSON__', dataSegura);
  const outPath = path.join(__dirname, 'artifact.html');
  fs.writeFileSync(outPath, html);

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  log(`Listo: ${tendersValidos.length} contrataciones en ${segundos}s → ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => { console.error('Falló la generación:', err); process.exit(1); });
