import { calcularProyeccion, formatearMoneda } from "../lib/margen";

interface CalculadoraMargenProps {
  cantidad: number;
  // Costo unitario tal como se escribe (texto), y el margen que elige el
  // deslizador general de la cotización: ambos viven en el panel, que suma
  // todos los productos en un solo total.
  costoUnitario: string;
  onCostoChange: (valor: string) => void;
  margen: number;
}

export function CalculadoraMargen({
  cantidad,
  costoUnitario,
  onCostoChange,
  margen,
}: CalculadoraMargenProps) {
  const costo = parseFloat(costoUnitario);
  const resultado = calcularProyeccion({
    costoUnitario: Number.isNaN(costo) ? 0 : costo,
    margenPorcentaje: margen,
    cantidad,
  });

  return (
    <div className="calculadora">
      <div className="calculadora-fila">
        <label className="campo">
          <span>Costo unitario estimado (S/)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={costoUnitario}
            onChange={(e) => onCostoChange(e.target.value)}
          />
        </label>
      </div>

      <div className="calculadora-resultados">
        <div>
          <span className="resultado-label">Precio venta unitario</span>
          <span className="resultado-valor">
            {formatearMoneda(resultado.precioVentaUnitario)}
          </span>
        </div>
        <div>
          <span className="resultado-label">Precio total ({cantidad})</span>
          <span className="resultado-valor">
            {formatearMoneda(resultado.precioTotal)}
          </span>
        </div>
        <div>
          <span className="resultado-label">Ganancia total</span>
          <span className="resultado-valor resultado-ganancia">
            {formatearMoneda(resultado.gananciaTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
