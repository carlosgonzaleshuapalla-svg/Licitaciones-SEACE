import type { TenderDetail } from "../types/api";
import { formatearFecha } from "../lib/fechas";
import { urlOficialSeace } from "../lib/seaceLinks";
import { CalculadoraMargen } from "./CalculadoraMargen";

interface TenderDetailPanelProps {
  detalle: TenderDetail | null;
  cargando: boolean;
  error: string | null;
  onCerrar: () => void;
}

export function TenderDetailPanel({
  detalle,
  cargando,
  error,
  onCerrar,
}: TenderDetailPanelProps) {
  if (cargando) {
    return (
      <aside className="detalle-panel">
        <div className="estado-mensaje" role="status">
          Cargando detalle...
        </div>
      </aside>
    );
  }

  if (error) {
    return (
      <aside className="detalle-panel">
        <button type="button" className="btn-cerrar" onClick={onCerrar}>
          ✕ Cerrar
        </button>
        <div className="estado-mensaje estado-error" role="alert">
          <strong>No se pudo cargar el detalle de la licitación.</strong>
          <p>{error}</p>
        </div>
      </aside>
    );
  }

  if (!detalle) {
    return (
      <aside className="detalle-panel detalle-vacio">
        <p>Selecciona una licitación de la lista para ver su detalle.</p>
      </aside>
    );
  }

  return (
    <aside className="detalle-panel">
      <button type="button" className="btn-cerrar" onClick={onCerrar}>
        ✕ Cerrar
      </button>

      <header className="detalle-header">
        <span className="tender-codigo">{detalle.codigo}</span>
        <h2>
          <a
            href={urlOficialSeace(detalle.idContrato)}
            target="_blank"
            rel="noopener noreferrer"
            className="tender-entidad-link"
            title="Ver esta licitación en el portal oficial de SEACE"
          >
            {detalle.entidad}
            <span className="link-externo" aria-hidden="true">
              ↗
            </span>
          </a>
        </h2>
        <p>{detalle.descripcion}</p>
      </header>

      <section className="detalle-seccion">
        <h3>Etapas del proceso</h3>
        {detalle.etapas.length === 0 ? (
          <p className="detalle-sin-datos">No hay etapas registradas.</p>
        ) : (
          <ul className="etapas-list">
            {detalle.etapas.map((etapa, i) => (
              <li key={`${etapa.nombre}-${i}`}>
                <strong>{etapa.nombre}</strong>
                <span>
                  {formatearFecha(etapa.inicio)} – {formatearFecha(etapa.fin)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detalle-seccion">
        <h3>Items y proyección de venta</h3>
        {detalle.items.length === 0 ? (
          <p className="detalle-sin-datos">Esta licitación no tiene items.</p>
        ) : (
          <div className="items-list">
            {detalle.items.map((item) => (
              <div className="item-card" key={item.idItem}>
                <div className="item-header">
                  <h4>{item.producto}</h4>
                  <span className="item-meta">
                    {item.cantidad} {item.unidadMedida} · {item.ciudad}
                  </span>
                </div>

                <div className="proveedores">
                  {item.proveedores.length === 0 ? (
                    <p className="detalle-sin-datos">
                      No hay proveedores sugeridos para este producto.
                    </p>
                  ) : (
                    item.proveedores.map((prov, i) => (
                      <a
                        key={`${prov.nombre}-${i}`}
                        href={prov.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="proveedor-link"
                      >
                        {prov.nombre}
                        <span className="proveedor-categoria">
                          {prov.categoria}
                        </span>
                      </a>
                    ))
                  )}
                </div>

                <CalculadoraMargen cantidad={item.cantidad} />
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
