import type { TenderSummary } from "../types/api";
import { formatearFecha } from "../lib/fechas";
import { describirPlazo } from "../lib/plazo";
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
  const plazo = describirPlazo(tender.cotizacionFin);
  const productos = tender.productos ?? [];
  const restantes = (tender.productosTotal ?? productos.length) - productos.length;

  return (
    <article
      className={`tender-card${seleccionado ? " tender-card-activa" : ""}`}
    >
      <div className="tender-card-header">
        <span className="tender-codigo">{tender.codigo}</span>
        {tender.objeto && (
          <span
            className={`badge ${
              tender.objeto === "Servicio" ? "badge-servicio" : "badge-bien"
            }`}
          >
            {tender.objeto}
          </span>
        )}
        {plazo && (
          <span className={`badge badge-plazo badge-plazo-${plazo.nivel}`}>
            {plazo.texto}
          </span>
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

        {productos.length > 0 && (
          <ul className="tender-productos" aria-label="Productos solicitados">
            {productos.map((p) => (
              <li key={p.producto}>
                {p.cantidad !== null && p.cantidad !== undefined && (
                  <strong>
                    {p.cantidad} {p.unidadMedida ?? ""}
                  </strong>
                )}{" "}
                {p.producto}
              </li>
            ))}
            {restantes > 0 && (
              <li className="tender-productos-mas">+{restantes} más</li>
            )}
          </ul>
        )}

        <div className="tender-meta">
          <span>
            <strong>Ciudades:</strong>{" "}
            {tender.ciudades.length > 0
              ? tender.ciudades.join(", ")
              : "No especificado"}
          </span>
          <span>
            <strong>Cierra:</strong> {formatearFecha(tender.cotizacionFin)}
          </span>
          <span>
            <strong>Publicado:</strong> {formatearFecha(tender.fechaPublicacion)}
          </span>
        </div>
      </button>
    </article>
  );
}
