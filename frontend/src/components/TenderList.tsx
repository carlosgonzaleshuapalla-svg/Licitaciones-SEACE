import type { TenderSummary } from "../types/api";
import { TenderCard } from "./TenderCard";

interface TenderListProps {
  tenders: TenderSummary[];
  cargando: boolean;
  error: string | null;
  seleccionadoId: TenderSummary["idContrato"] | null;
  onSeleccionar: (id: TenderSummary["idContrato"]) => void;
}

export function TenderList({
  tenders,
  cargando,
  error,
  seleccionadoId,
  onSeleccionar,
}: TenderListProps) {
  if (error) {
    return (
      <div className="estado-mensaje estado-error" role="alert">
        <strong>No se pudo cargar la lista de licitaciones.</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (cargando) {
    return (
      <div className="estado-mensaje" role="status">
        Cargando licitaciones...
      </div>
    );
  }

  if (tenders.length === 0) {
    return (
      <div className="estado-mensaje">
        No se encontraron licitaciones con los filtros actuales.
      </div>
    );
  }

  return (
    <div className="tender-list" data-testid="tender-list">
      {tenders.map((t) => (
        <TenderCard
          key={t.idContrato}
          tender={t}
          seleccionado={t.idContrato === seleccionadoId}
          onSeleccionar={onSeleccionar}
        />
      ))}
    </div>
  );
}
