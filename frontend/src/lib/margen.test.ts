import { describe, expect, it } from "vitest";
import { calcularProyeccion, formatearMoneda } from "./margen";

describe("calcularProyeccion", () => {
  it("calcula precio de venta, total y ganancia con margen positivo", () => {
    const resultado = calcularProyeccion({
      costoUnitario: 100,
      margenPorcentaje: 20,
      cantidad: 10,
    });

    expect(resultado.precioVentaUnitario).toBe(120);
    expect(resultado.precioTotal).toBe(1200);
    expect(resultado.costoTotal).toBe(1000);
    expect(resultado.gananciaTotal).toBe(200);
    expect(resultado.gananciaUnitaria).toBe(20);
  });

  it("con margen 0% el precio de venta es igual al costo (ganancia 0)", () => {
    const resultado = calcularProyeccion({
      costoUnitario: 50,
      margenPorcentaje: 0,
      cantidad: 5,
    });

    expect(resultado.precioVentaUnitario).toBe(50);
    expect(resultado.gananciaTotal).toBe(0);
  });

  it("con margen 100% el precio de venta duplica el costo", () => {
    const resultado = calcularProyeccion({
      costoUnitario: 30,
      margenPorcentaje: 100,
      cantidad: 2,
    });

    expect(resultado.precioVentaUnitario).toBe(60);
    expect(resultado.precioTotal).toBe(120);
    expect(resultado.gananciaTotal).toBe(60);
  });

  it("trata costos negativos o inválidos como 0 (no rompe ni da negativo)", () => {
    const resultado = calcularProyeccion({
      costoUnitario: -10,
      margenPorcentaje: 25,
      cantidad: 4,
    });

    expect(resultado.precioVentaUnitario).toBe(0);
    expect(resultado.precioTotal).toBe(0);
    expect(resultado.gananciaTotal).toBe(0);
  });

  it("trata NaN como 0 en costo y cantidad", () => {
    const resultado = calcularProyeccion({
      costoUnitario: NaN,
      margenPorcentaje: 30,
      cantidad: NaN,
    });

    expect(resultado.precioTotal).toBe(0);
    expect(resultado.costoTotal).toBe(0);
  });

  it("cantidad 0 da precio total y ganancia total en 0", () => {
    const resultado = calcularProyeccion({
      costoUnitario: 100,
      margenPorcentaje: 50,
      cantidad: 0,
    });

    expect(resultado.precioVentaUnitario).toBe(150);
    expect(resultado.precioTotal).toBe(0);
    expect(resultado.gananciaTotal).toBe(0);
  });
});

describe("formatearMoneda", () => {
  it("formatea un número como soles peruanos", () => {
    const texto = formatearMoneda(1234.5);
    // Intl puede usar distintos separadores según el runtime, validamos el contenido clave.
    expect(texto).toContain("1");
    expect(texto).toContain("234");
    expect(texto).toMatch(/S\/\s?1[.,]?234[.,]50/);
  });

  it("no rompe con valores no finitos", () => {
    expect(() => formatearMoneda(NaN)).not.toThrow();
  });
});
