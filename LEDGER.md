# LEDGER — Portal de Licitaciones SEACE

## Objetivo
Portal web que sincroniza periódicamente las contrataciones "vigentes" del
Buscador Público de SEACE (prod6.seace.gob.pe), permite filtrar por ciudad
(departamento), rango de fechas de cotización y fecha de publicación, separa
automáticamente las que son compra de PRODUCTOS ("Bien", entrega física —
frente a Servicio/Obra/Consultoría), y por cada ítem de producto genera
enlaces directos de cotización en marketplaces peruanos relevantes según el
tipo de producto. Incluye una calculadora de precio de venta proyectado con
un slider de % de ganancia sobre un costo unitario que ingresa el usuario.

## Fuente de datos real (investigada por el orquestador, 2026-08-19)
API pública JSON detrás de https://prod6.seace.gob.pe/buscador-publico/contrataciones
(sin autenticación, mismo origen que usa la SPA oficial):

- `GET https://prod6.seace.gob.pe/v1/s8uit-services/buscadorpublico/contrataciones/buscador`
  Query params: `anio` (usar `2024`, es el valor fijo que usa la propia SPA —
  no filtra por año real del contrato, todos los años vigentes salen igual),
  `palabra_clave`, `orden` (usar `2`), `page`, `page_size`,
  `lista_codigo_objeto` (CSV de ids: 1=Bien, 2=Servicio, 3=Obra, 4=Consultoría de Obra),
  `lista_estado_contrato` (CSV de ids: 2=Vigente, 3=En Evaluación, 4=Culminado).
  Respuesta: `{ data: [ { idContrato, desContratacion, idObjetoContrato,
  nomObjetoContrato, desObjetoContrato, fecIniCotizacion, fecFinCotizacion,
  idEstadoContrato, nomEstadoContrato, fecPublica, nomEntidad, ... } ],
  pageable: { pageNumber, pageSize, totalElements } }`.
  Con `lista_codigo_objeto=1&lista_estado_contrato=2` (Bien + Vigente) hay
  ~1088 registros ahora mismo — dataset chico y sincronizable en minutos.

- `GET .../contrataciones/listar-completo?id_contrato={id}` — detalle:
  `uitContratoCompletoProjection` (cabecera), `uitContratoEtapaProjectionList`
  (etapas con `nomEtapaContrato`, `fecIni`, `fecFin` — típicamente "ETAPA DE
  CONSULTAS" y "ETAPA DE COTIZACIÓN"; NO existe un campo estructurado de
  "fecha de entrega del producto" en la API pública — eso vive dentro del PDF
  de requerimiento, fuera de alcance de parseo automático confiable),
  `uitContratoItemProjectionList` (items: `nomCubso` = nombre oficial
  estandarizado del producto/catálogo CUBSO, `cantidad`, `nomUnidadMedida`,
  `nomDistrito` con formato `DEPARTAMENTO/PROVINCIA/DISTRITO`).

- `GET .../maestras/listar-departamento` — 25 departamentos `{id, nom}`.
- `GET .../maestras/listar-objeto-contratacion` — `{id:1,nom:"Bien"}` etc.
- `GET .../maestras/listar-estados-contrato-cotizacion` — `{id:2,nom:"Vigente"}` etc.

Decisión de producto: "ciudad" = departamento (primer segmento de
`nomDistrito`), porque es el único nivel geográfico consistente para filtrar.
"Producto que se puede comprar rápido" = `idObjetoContrato = 1` (Bien) +
estado Vigente — es la clasificación oficial más honesta disponible (no hay
forma confiable de inferir "rapidez de entrega" sin parsear PDFs). La UI debe
dejar esto explícito al usuario, no inventar un dato que la fuente no da.

"Dónde cotizar": NO se scrapea precios en vivo de terceros (frágil, sin
permiso, no verificable). En su lugar, por cada `nomCubso` se generan enlaces
de búsqueda directa a marketplaces peruanos reales (MercadoLibre Perú,
Google Shopping, y una tienda especializada elegida por palabras clave del
nombre del producto — ferretería/eléctrico → Sodimac/Promart, oficina →
TaiLoy, cómputo → tiendas de cómputo, etc.), rankeados por una heurística de
categoría simple y documentada. El usuario decide con qué proveedor cotiza.

## Contrato de API (congelado antes de construir — P2)

Backend sirve en `http://localhost:4000`.

- `GET /api/meta` → `{ departamentos: string[], estados: string[] }`
- `GET /api/tenders?departamento=&estado=Vigente&q=&soloBienes=true&page=1&pageSize=20`
  → `{ data: TenderSummary[], total, page, pageSize }`
  `TenderSummary = { idContrato, codigo, entidad, objeto, descripcion,
  estado, fechaPublicacion, cotizacionInicio, cotizacionFin, ciudades: string[],
  cantidadItems, esProductoRapido: boolean }`
- `GET /api/tenders/:id` → `TenderDetail = TenderSummary & { etapas: {nombre,
  inicio, fin}[], items: { idItem, producto, cantidad, unidadMedida, ciudad,
  proveedores: { nombre, url, categoria }[] }[] }`
- `POST /api/sync` → dispara sincronización manual (además hay un cron
  interno cada 20 min). Respuesta `{ ok, sincronizados, timestamp }`.
- `GET /api/health` → `{ ok: true }`

El cálculo de proyección de venta (costo × (1+margen%)) es lógica pura de
frontend, sin endpoint — no hay razón para un roundtrip por cada movimiento
del slider.

## Perfil y fases
🔴 COMPLETO. Fase única de construcción con patrón orquestador-subagentes:
equipo Backend y equipo Frontend en paralelo, huellas separadas
(`backend/`, `frontend/`), contrato ya congelado arriba.

## Equipos y huella
- **Backend** (`backend/`): Node.js + Express + better-sqlite3. ETL que
  pagina `buscador` (Bien+Vigente), sincroniza detalle por contrato, guarda
  en SQLite, expone el contrato de arriba. Incluye sus propios tests.
- **Frontend** (`frontend/`): React + Vite + TypeScript. Consume el
  contrato, filtros (ciudad, estado, texto, checkbox "solo productos"),
  tarjetas de licitación, panel de detalle con items + enlaces de
  proveedores + calculadora de margen con slider. Incluye sus propios tests.

## Estado de tareas
- [x] Backend: ETL + API implementada y corriendo (1088 licitaciones Bien+Vigente sincronizadas en vivo)
- [x] Frontend: UI implementada consumiendo el contrato
- [x] Gate 0 determinista (build/lint/test ambos lados) — orquestador: backend 17/17 tests, frontend tsc+build+20/20 tests
- [x] QA de código (revisor, no autor) — 2 hallazgos reales, 0 falsos positivos
- [x] Fixes aplicados por el orquestador:
  - Fechas: `backend` reenvía `DD/MM/YYYY HH:mm:ss` (formato real de SEACE, no ISO); `frontend/src/lib/fechas.ts` no lo parseaba y mostraba el string crudo. Corregido con parser dedicado + test nuevo (`fechas.test.ts`).
  - Contratos que dejan de ser Bien+Vigente quedaban congelados en la DB para siempre. Agregado `pruneTendersNotIn` en `backend/src/db.js`, invocado en `syncService.js` tras cada sincronización completa (se omite si la paginación fue parcial por error de red, para no borrar por error). Test nuevo + verificado en vivo insertando un contrato falso y confirmando que una sync real lo elimina.
- [x] Integración verificada en vivo (backend real + frontend real, navegador)
- [x] Verificación visual en navegador: lista, filtro por departamento (Cusco), detalle con etapas, enlaces de proveedores, calculadora de margen con slider (drag probado, cálculo correcto)
- [x] Aceptación final: cumple el objetivo del LEDGER

## Acceso público (link desde cualquier dispositivo)

El usuario pidió poder abrir el portal desde cualquier dispositivo con un link,
sin depender del backend/frontend corriendo en esta Mac. No hay credenciales
de ningún proveedor de hosting configuradas en este entorno (se verificó:
vercel/netlify/flyctl/railway/wrangler/heroku/doctl, ninguno instalado ni
autenticado) y crear una cuenta nueva está fuera de lo que puedo hacer por el
usuario — se lo pregunté explícitamente (AskUserQuestion) y eligió la opción
de Artifact con snapshot + auto-actualización en vez de que lo guíe a
desplegar un backend real él mismo.

Solución implementada: **snapshot estático publicado como Artifact**, sin
backend propio. Los datos (contrataciones + items + enlaces de proveedores)
se incrustan como JSON dentro del HTML en tiempo de build.

- Link público: https://claude.ai/code/artifact/b44086a2-486a-480b-bbaa-cca4a29a70a7
  (persistido también en `snapshot/artifact-url.txt`)
- `snapshot/standalone-refresh.mjs`: script Node.js **autocontenido** (sin
  imports locales) que descarga los datos reales de SEACE, genera los enlaces
  de proveedores, y arma `snapshot/artifact.html` con el diseño completo
  incrustado. Es autocontenido a propósito: lo ejecuta tanto localmente como
  una rutina en la nube que NO tiene acceso al resto de este repo.
- `snapshot/build.mjs` + `snapshot/make-artifact.mjs` + `snapshot/template.html`:
  versión modular equivalente (reusa `backend/src/*.js`), más cómoda para
  iterar el diseño localmente. Si se edita el diseño ahí, hay que replicar el
  cambio en `standalone-refresh.mjs` Y en el prompt de la rutina programada
  (ver abajo) — están intencionalmente duplicados por la restricción de que
  la rutola en la nube no puede leer archivos de este repo.
- **Rutina programada** (`RemoteTrigger`, id `trig_01BJAud5kK96BD1buGA3w5oD`,
  nombre "Actualizar Licitaciones SEACE (Artifact)"): corre cada 3 horas
  (`cron_expression: "13 */3 * * *"` UTC, sin repo — `sources: []`), en un
  sandbox en la nube sin acceso a este Mac. Su prompt trae el contenido
  completo de `standalone-refresh.mjs` embebido literalmente (porque el
  sandbox no puede leerlo del filesystem local), le pide escribirlo, correrlo,
  y publicar `artifact.html` con `Artifact` pasando la MISMA `url` de arriba
  (crítico: sin eso crearía un artifact nuevo cada vez en lugar de actualizar
  el link ya compartido). Panel de rutinas: https://claude.ai/code/routines
  (ahí el usuario puede pausar/eliminar la rutina si ya no la quiere).
- Verificado: corrida manual disparada con `RemoteTrigger action:"run"`
  (session `cse_01LZmdVdejh8zpNG8CCEcYY5`) para confirmar que el pipeline
  completo funciona en el sandbox real, no solo localmente.

### Hallazgo: la rutina en la nube NO puede funcionar — pausada

La corrida de prueba falló: el entorno "Default" de rutinas en la nube
(`env_01E18o3y9bSrJP8xJzoeeXPi`) tiene una política de egress que **bloquea**
conexiones salientes a `prod6.seace.gob.pe` (403 en el túnel CONNECT del
proxy, confirmado como `connect_rejected` / "policy denial" en
`recentRelayFailures`, NO un error transitorio). El agente en la nube lo
diagnosticó correctamente, no reintentó indefinidamente, y NO tocó el
Artifact publicado (quedó intacto con los datos de la publicación manual
inicial). Rutina pausada (`enabled:false`) el 2026-08-20 para que no siga
fallando cada 3 horas en silencio — sigue existiendo en
https://claude.ai/code/routines por si en el futuro cambia la política de
red del entorno y conviene reactivarla.

Esta Mac local SÍ tiene acceso real a prod6.seace.gob.pe (probado
repetidamente). Opciones de refresco pendientes de decidir con el usuario:
manual bajo pedido (sin setup), `CronCreate` local (automático pero solo
mientras esta sesión de Claude Code siga abierta, máx. 7 días), o que el
usuario despliegue el backend ya construido en `backend/` en un host propio
para tener refresco real 24/7 sin depender de ninguna sesión.
