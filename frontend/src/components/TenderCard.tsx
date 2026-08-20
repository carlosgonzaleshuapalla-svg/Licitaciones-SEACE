import type { TenderSummary } from "../types/api";
import { formatearFecha } from "../lib/fechas";
import { urlOficialSeace } from "../lib/seaceLinks";

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

      <a
        href={urlOficialSeace(tender.idContrato)}
        target="_blank"
        rel="noopener noreferrer"
        className="tender-entidad tender-entidad-link"
        title="Ver esta licitación en el portal oficial de SEACE"
      >
        {tender.entidad}
        <span className="link-externo" aria-hidden="true">
          ↗
        </span>
      </a>

      <button
        type="button"
        className="tender-card-clickzone"
        onClick={() => onSeleccionar(tender.idContrato)}
        aria-pressed={seleccionado}
      >
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
