import type { ChangeEvent } from "react";
import type { ObjetoContrato, OrdenLista } from "../types/api";

export interface FiltrosState {
  departamento: string;
  q: string;
  // "" = Bien y Servicio juntos (el portal no sincroniza Obra ni
  // Consultoría de Obra, así que estas son las únicas opciones reales).
  objeto: ObjetoContrato | "";
  orden: OrdenLista;
}

interface FiltrosProps {
  filtros: FiltrosState;
  departamentos: string[];
  onChange: (filtros: FiltrosState) => void;
}

export function Filtros({ filtros, departamentos, onChange }: FiltrosProps) {
  const actualizar = (cambios: Partial<FiltrosState>) => {
    onChange({ ...filtros, ...cambios });
  };

  return (
    <div className="filtros">
      <div className="filtros-fila">
        <div className="campo">
          <label htmlFor="f-departamento">Ciudad</label>
          <select
            id="f-departamento"
            value={filtros.departamento}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              actualizar({ departamento: e.target.value })
            }
          >
            <option value="">Todas</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-objeto">Tipo de contratación</label>
          <select
            id="f-objeto"
            value={filtros.objeto}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              actualizar({
                objeto: e.target.value as FiltrosState["objeto"],
              })
            }
          >
            <option value="">Bien y Servicio</option>
            <option value="Bien">Solo Bien</option>
            <option value="Servicio">Solo Servicio</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-orden">Ordenar por</label>
          <select
            id="f-orden"
            value={filtros.orden}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              actualizar({ orden: e.target.value as FiltrosState["orden"] })
            }
          >
            <option value="publicacion">Más recientes</option>
            <option value="cierre">Cierran primero</option>
          </select>
        </div>

        <div className="campo campo-busqueda">
          <label htmlFor="f-q">Buscar</label>
          <input
            id="f-q"
            type="text"
            placeholder="Producto, descripción o entidad..."
            value={filtros.q}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              actualizar({ q: e.target.value })
            }
          />
        </div>
      </div>

      <details className="ayuda-detalle">
        <summary>¿Qué se muestra aquí?</summary>
        <p>
          Solo licitaciones vigentes con el plazo de cotización todavía abierto
          (SEACE a veces sigue marcando "Vigente" contratos que ya vencieron;
          esos se descartan con la fecha real de cierre). "Bien" es compra de
          un producto; "Servicio" es contratar un trabajo. SEACE no publica un
          plazo de entrega, así que no se puede filtrar por rapidez de entrega.
        </p>
      </details>
    </div>
  );
}
