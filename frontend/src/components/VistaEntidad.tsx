import { useEffect, useState, type ChangeEvent } from "react";
import { getRequerimientos } from "../api/client";
import { formatearFechaIso } from "../lib/fechas";
import { describirPlazoIso, haceCuanto } from "../lib/plazo";
import type { Entidad, ObjetoContrato, Requerimiento, RequerimientosResponse } from "../types/api";
import { Paginacion } from "./Paginacion";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

export function TarjetaRequerimiento({ r, portal, ahora }: { r: Requerimiento; portal: string; ahora?: number }) {
  const plazo = describirPlazoIso(r.vence, ahora);
  return (
    <article className="tender-card req-card">
      <div className="tender-card-header">
        {r.tipo && (
          <span className={`badge ${r.tipo === "Servicio" ? "badge-servicio" : "badge-bien"}`}>{r.tipo}</span>
        )}
        {r.zona && <span className="badge badge-zona">{r.zona}</span>}
        {plazo && <span className={`badge badge-plazo badge-plazo-${plazo.nivel}`}>{plazo.texto}</span>}
      </div>

      <h3 className="req-titulo">{r.titulo}</h3>
      {r.descripcion && <p className="tender-descripcion">{r.descripcion}</p>}

      <div className="tender-meta">
        <span>
          <strong>Cierra:</strong> {formatearFechaIso(r.vence)}
        </span>
        {r.publicado && (
          <span>
            <strong>Publicado:</strong> {formatearFechaIso(r.publicado)}
          </span>
        )}
      </div>

      <div className="req-acciones">
        {r.documentos.map((d) => (
          <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="req-doc">
            📄 {d.nombre} <span aria-hidden="true">↗</span>
          </a>
        ))}
        <a href={r.enlace} target="_blank" rel="noopener noreferrer" className="req-postular">
          {r.enlace === portal ? "Ir al portal para postular" : "Ver y postular"} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

/** Portal que no se puede leer desde aquí: se explica por qué y se lleva al portal. */
function VistaEnlace({ entidad }: { entidad: Entidad }) {
  return (
    <>
      <header className="app-header">
        <div>
          <h1>{entidad.nombre}</h1>
          <p className="app-subtitulo">{entidad.nombreCompleto}</p>
        </div>
      </header>
      <main className="app-main-entidad">
        <section className="panel-lista">
          <div className="estado-mensaje enlace-directo" data-testid="vista-enlace">
            <strong>Este portal se consulta directamente en su página.</strong>
            {entidad.motivo && <p>{entidad.motivo}</p>}
            {entidad.nota && <p>{entidad.nota}</p>}
            <p>
              <a href={entidad.portal} target="_blank" rel="noopener noreferrer" className="req-postular">
                Abrir el portal de {entidad.nombre} <span aria-hidden="true">↗</span>
              </a>
            </p>
            <p className="enlace-directo-pie">
              Para cotizar normalmente se necesita RNP vigente y registrarse (gratis) en ese portal; cada entidad define
              sus reglas.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

/** Compras de una entidad que publica en su propio portal (se lee, o se enlaza si no se puede leer). */
export function VistaEntidad({ entidad }: { entidad: Entidad }) {
  return entidad.soloEnlace ? <VistaEnlace entidad={entidad} /> : <VistaLista entidad={entidad} />;
}

function VistaLista({ entidad }: { entidad: Entidad }) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [tipo, setTipo] = useState<ObjetoContrato | "">("");
  const [zona, setZona] = useState("");
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<RequerimientosResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refrescar, setRefrescar] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [qDebounced, tipo, zona]);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    getRequerimientos(entidad.id, {
      q: qDebounced || undefined,
      tipo: tipo || undefined,
      zona: zona || undefined,
      orden: "cierre",
      page,
      pageSize: PAGE_SIZE,
    })
      .then((r) => {
        if (!cancelado) setRes(r);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof Error ? err.message : "Error desconocido al cargar.");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [entidad.id, qDebounced, tipo, zona, page, refrescar]);

  const zonas = res?.zonas ?? [];
  const hace = haceCuanto(res?.actualizadoEn ?? entidad.actualizadoEn);

  return (
    <>
      <header className="app-header">
        <div>
          <h1>{entidad.nombre}</h1>
          <p className="app-subtitulo">
            {entidad.nombreCompleto} · {entidad.nota ? "compras publicadas en su propio portal" : "compras menores o iguales a 8 UIT, publicadas en su propio portal"}
          </p>
        </div>
        <div className="sync-button-wrap">
          <button type="button" className="btn-sync" onClick={() => setRefrescar((n) => n + 1)}>
            Actualizar
          </button>
          {hace && <span className="sync-mensaje">Datos de {hace}</span>}
        </div>
      </header>

      <main className="app-main-entidad">
        <section className="panel-lista">
          {entidad.nota && (
            <div className="estado-mensaje estado-aviso" role="note">
              {entidad.nota}
            </div>
          )}
          {res?.error && (
            <div className="estado-mensaje estado-aviso" role="status">
              No se pudo leer el portal de {entidad.nombre} en la última revisión; se muestra lo que había
              {hace ? ` (de ${hace})` : ""}. Confirma en el portal antes de cotizar.
            </div>
          )}

          <div className="filtros">
            <div className="filtros-fila">
              <div className="campo">
                <label htmlFor="e-tipo">Tipo de contratación</label>
                <select
                  id="e-tipo"
                  value={tipo}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setTipo(e.target.value as ObjetoContrato | "")}
                >
                  <option value="">Bien y Servicio</option>
                  <option value="Bien">Solo Bien</option>
                  <option value="Servicio">Solo Servicio</option>
                </select>
              </div>
              {zonas.length > 1 && (
                <div className="campo">
                  <label htmlFor="e-zona">Zona registral / sede</label>
                  <select id="e-zona" value={zona} onChange={(e: ChangeEvent<HTMLSelectElement>) => setZona(e.target.value)}>
                    <option value="">Todas</option>
                    {zonas.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="campo campo-busqueda">
                <label htmlFor="e-q">Buscar</label>
                <input
                  id="e-q"
                  type="text"
                  placeholder="Producto o servicio…"
                  value={q}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
                />
              </div>
            </div>
            <details className="ayuda-detalle">
              <summary>¿Cómo se postula aquí?</summary>
              <p>
                {entidad.nombre} publica estas compras en su propio portal, no en SEACE. Cada entidad define sus
                reglas, pero en general hay que registrarse (gratis) en ese portal, tener el RNP vigente y subir la
                cotización con los anexos que pidan los términos de referencia antes de la hora de cierre. Aquí se
                muestran solo los requerimientos con el plazo abierto, los que cierran antes primero.
              </p>
              <p>
                <a href={entidad.portal} target="_blank" rel="noopener noreferrer">
                  Abrir el portal de {entidad.nombre} ↗
                </a>
              </p>
            </details>
          </div>

          {!cargando && !error && res && (
            <p className="lista-resumen" role="status">
              {res.total === 1 ? "1 requerimiento" : `${res.total} requerimientos`} · cierran primero
            </p>
          )}

          {error ? (
            <div className="estado-mensaje estado-error" role="alert">
              <strong>No se pudo cargar la lista.</strong>
              <p>{error}</p>
            </div>
          ) : cargando ? (
            <div className="estado-mensaje" role="status">
              Cargando requerimientos...
            </div>
          ) : !res || res.data.length === 0 ? (
            <div className="estado-mensaje">
              {entidad.vigentes === 0 && !q && !tipo && !zona
                ? `${entidad.nombre} no tiene requerimientos abiertos en este momento.`
                : "No se encontraron requerimientos con los filtros actuales."}
            </div>
          ) : (
            <div className="tender-list" data-testid="req-list">
              {res.data.map((r) => (
                <TarjetaRequerimiento key={r.id} r={r} portal={entidad.portal} />
              ))}
            </div>
          )}

          <Paginacion page={page} pageSize={PAGE_SIZE} total={res?.total ?? 0} onCambiarPage={setPage} />
        </section>
      </main>
    </>
  );
}
