import type { Entidad } from "../types/api";

export const FUENTE_SEACE = "seace";

interface SelectorFuenteProps {
  fuente: string;
  entidades: Entidad[];
  onElegir: (id: string) => void;
}

/**
 * Barra para cambiar de dónde se ven las compras: SEACE (el buscador público de
 * contrataciones) o el portal propio de otra entidad del Estado (SUNARP, SBN…),
 * que publican sus compras de hasta 8 UIT por su cuenta. Las que no se pueden
 * leer desde aquí (captcha) llevan "↗": son acceso directo a su portal.
 */
export function SelectorFuente({ fuente, entidades, onElegir }: SelectorFuenteProps) {
  // Con una sola fuente no hay nada que elegir.
  if (entidades.length === 0) return null;

  return (
    <nav className="fuentes" aria-label="Entidad que publica las compras">
      <button
        type="button"
        className={`fuente-btn${fuente === FUENTE_SEACE ? " fuente-btn-activa" : ""}`}
        aria-pressed={fuente === FUENTE_SEACE}
        onClick={() => onElegir(FUENTE_SEACE)}
      >
        SEACE
        <span className="fuente-sub">todas las entidades</span>
      </button>
      {entidades.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`fuente-btn${fuente === e.id ? " fuente-btn-activa" : ""}`}
          aria-pressed={fuente === e.id}
          onClick={() => onElegir(e.id)}
          title={e.nombreCompleto}
        >
          {e.nombre}
          {e.soloEnlace ? (
            <span className="fuente-contador fuente-contador-enlace" aria-label="acceso directo al portal">
              ↗
            </span>
          ) : (
            <span className="fuente-contador" aria-label={`${e.vigentes} vigentes`}>
              {e.vigentes}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
