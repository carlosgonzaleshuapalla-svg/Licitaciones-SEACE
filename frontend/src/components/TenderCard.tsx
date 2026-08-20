import type { TenderSummary } from "../types/api";
import { formatearFecha } from "../lib/fechas";

interface TenderCardProps {
  tender: TenderSummary;
  seleccionado: boolean;
  onSeleccionar: (id: TenderSummary["idContrato"]) => void;
}

export function TenderCard({
  tender,
  seleccionado,
  onSeleccionar,
}: TenderCardProps) {
  return (
    <article
      className={`tender-card${seleccionado ? " tender-card-activa" : ""}`}
    >
      <button
        type="button"
        className="tender-card-clickzone"
        onClick={() => onSeleccionar(tender.idContrato)}
        aria-pressed={seleccionado}
      >
        <div className="tender-card-header">
          <span className="tender-codigo">{tender.codigo}</span>
          <span
            className={`badge badge-estado ${
              tender.estado === "Vigente" ? "badge-vigente" : ""
            }`}
          >
            {tender.estado}
          </span>
          {tender.esProductoRapido && (
            <span className="badge badge-bien">Bien</span>
          )}
        </div>

        <h3 className="tender-entidad">{tender.entidad}</h3>
        <p className="tender-descripcion">{tender.descripcion}</p>

        <div className="tender-meta">
          <span>
            <strong>Ciudades:</strong>{" "}
            {tender.ciudades.length > 0
              ? tender.ciudades.join(", ")
              : "No especificado"}
          </span>
          <span>
            <strong>Publicado:</strong> {formatearFecha(tender.fechaPublicacion)}
          </span>
          <span>
            <strong>Cotización:</strong>{" "}
            {formatearFecha(tender.cotizacionInicio)} –{" "}
            {formatearFecha(tender.cotizacionFin)}
          </span>
          <span>
            <strong>Items:</strong> {tender.cantidadItems}
          </span>
        </div>
      </button>
    </article>
  );
}
