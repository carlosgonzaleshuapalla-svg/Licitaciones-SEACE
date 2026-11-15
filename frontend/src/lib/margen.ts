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

/**
 * Tope de una contratación menor: 8 UIT. UIT 2026 = S/ 5 500 (D.S. 301-2025-EF),
 * o sea S/ 44 000. Es solo una referencia para avisar si la cotización se pasa;
 * el monto que cuenta es el que figure en la contratación.
 */
export const UIT_2026 = 5_500;
export const TOPE_8_UIT = 8 * UIT_2026;

export interface LineaCotizacion {
  producto: string;
  cantidad: number;
  unidadMedida: string;
  /** Texto tal como lo escribió el usuario; vacío o inválido = sin costear. */
  costoUnitario: string;
}

export interface ResumenCotizacion {
  costeados: number;
  total: number;
  costoTotal: number;
  precioTotal: number;
  gananciaTotal: number;
  superaTope: boolean;
}

export function resumirCotizacion(lineas: LineaCotizacion[], margenPorcentaje: number): ResumenCotizacion {
  let costeados = 0;
  let costoTotal = 0;
  let precioTotal = 0;
  for (const l of lineas) {
    const costo = parseFloat(l.costoUnitario);
    if (!(costo > 0)) continue;
    costeados++;
    const r = calcularProyeccion({ costoUnitario: costo, margenPorcentaje, cantidad: l.cantidad });
    costoTotal += r.costoTotal;
    precioTotal += r.precioTotal;
  }
  return {
    costeados,
    total: lineas.length,
    costoTotal,
    precioTotal,
    gananciaTotal: precioTotal - costoTotal,
    superaTope: precioTotal > TOPE_8_UIT,
  };
}

/** Texto listo para pegar en un WhatsApp o correo; solo con lo que ya tiene costo. */
export function textoCotizacion(
  encabezado: string,
  lineas: LineaCotizacion[],
  margenPorcentaje: number,
): string {
  const filas: string[] = [];
  let total = 0;
  for (const l of lineas) {
    const costo = parseFloat(l.costoUnitario);
    if (!(costo > 0)) continue;
    const r = calcularProyeccion({ costoUnitario: costo, margenPorcentaje, cantidad: l.cantidad });
    total += r.precioTotal;
    filas.push(
      `- ${l.producto}: ${l.cantidad} ${l.unidadMedida} x ${formatearMoneda(r.precioVentaUnitario)} = ${formatearMoneda(r.precioTotal)}`,
    );
  }
  return [encabezado, ...filas, `TOTAL: ${formatearMoneda(total)}`].join("\n");
}
