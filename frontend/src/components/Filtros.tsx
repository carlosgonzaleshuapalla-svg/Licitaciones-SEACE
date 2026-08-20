import type { ChangeEvent } from "react";

export interface FiltrosState {
  departamento: string;
  estado: string;
  q: string;
  soloBienes: boolean;
}

interface FiltrosProps {
  filtros: FiltrosState;
  departamentos: string[];
  estados: string[];
  onChange: (filtros: FiltrosState) => void;
}

export function Filtros({
  filtros,
  departamentos,
  estados,
  onChange,
}: FiltrosProps) {
  const actualizar = (cambios: Partial<FiltrosState>) => {
    onChange({ ...filtros, ...cambios });
  };

  return (
    <div className="filtros">
      <div className="filtros-fila">
        <div className="campo">
          <label htmlFor="f-departamento">Ciudad / departamento</label>
          <select
            id="f-departamento"
            value={filtros.departamento}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              actualizar({ departamento: e.target.value })
            }
          >
            <option value="">Todos los departamentos</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-estado">Estado</label>
          <select
            id="f-estado"
            value={filtros.estado}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              actualizar({ estado: e.target.value })
            }
          >
            {estados.map((es) => (
              <option key={es} value={es}>
                {es}
              </option>
            ))}
          </select>
        </div>

        <div className="campo campo-busqueda">
          <label htmlFor="f-q">Buscar</label>
          <input
            id="f-q"
            type="text"
            placeholder="Descripción o entidad..."
            value={filtros.q}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              actualizar({ q: e.target.value })
            }
          />
        </div>
      </div>

      <div className="campo-checkbox">
        <label>
          <input
            type="checkbox"
            checked={filtros.soloBienes}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              actualizar({ soloBienes: e.target.checked })
            }
          />
          Solo productos que se pueden comprar y entregar (Bienes)
        </label>
        <p className="ayuda">
          Este es el criterio real disponible en la fuente oficial: contratos
          clasificados como "Bien" (compra de producto físico) frente a
          Servicio/Obra/Consultoría. SEACE no publica un plazo de entrega
          estructurado, así que no podemos mostrarte "rapidez de entrega" —
          solo el tipo de contratación.
        </p>
      </div>
    </div>
  );
}
