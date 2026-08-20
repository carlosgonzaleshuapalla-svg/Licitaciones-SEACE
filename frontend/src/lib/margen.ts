// Lógica pura de la calculadora de proyección de venta.
// Sin llamadas al backend: el cálculo es 100% local y reactivo al slider.

export interface ProyeccionInput {
  costoUnitario: number;
  margenPorcentaje: number; // 0 a 100
  cantidad: number;
}

export interface ProyeccionResultado {
  precioVentaUnitario: number;
  precioTotal: number;
  costoTotal: number;
  gananciaTotal: number;
  gananciaUnitaria: number;
}

/**
 * Calcula la proyección de venta a partir de un costo unitario estimado
 * y un margen de ganancia porcentual.
 *
 * precioVentaUnitario = costo * (1 + margen / 100)
 * precioTotal = precioVentaUnitario * cantidad
 * gananciaTotal = precioTotal - costoTotal
 */
export function calcularProyeccion({
  costoUnitario,
  margenPorcentaje,
  cantidad,
}: ProyeccionInput): ProyeccionResultado {
  const costo = Number.isFinite(costoUnitario) && costoUnitario > 0 ? costoUnitario : 0;
  const margen = Number.isFinite(margenPorcentaje) ? margenPorcentaje : 0;
  const cant = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 0;

  const precioVentaUnitario = costo * (1 + margen / 100);
  const precioTotal = precioVentaUnitario * cant;
  const costoTotal = costo * cant;
  const gananciaTotal = precioTotal - costoTotal;
  const gananciaUnitaria = precioVentaUnitario - costo;

  return {
    precioVentaUnitario,
    precioTotal,
    costoTotal,
    gananciaTotal,
    gananciaUnitaria,
  };
}

export function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(valor) ? valor : 0);
}
