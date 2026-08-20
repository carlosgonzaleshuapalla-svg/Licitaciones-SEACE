import { useState } from "react";
import { calcularProyeccion, formatearMoneda } from "../lib/margen";

interface CalculadoraMargenProps {
  cantidad: number;
}

export function CalculadoraMargen({ cantidad }: CalculadoraMargenProps) {
  const [costoUnitario, setCostoUnitario] = useState<string>("");
  const [margen, setMargen] = useState(30);

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
            placeholder="0.00"
            value={costoUnitario}
            onChange={(e) => setCostoUnitario(e.target.value)}
          />
        </label>
      </div>

      <div className="calculadora-fila">
        <label className="campo">
          <span>
            Margen de ganancia: <strong>{margen}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={margen}
            onChange={(e) => setMargen(Number(e.target.value))}
            aria-label="Porcentaje de ganancia"
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
