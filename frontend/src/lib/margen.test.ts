import { describe, expect, it } from "vitest";
import { calcularProyeccion, formatearMoneda, resumirCotizacion, textoCotizacion, TOPE_8_UIT } from "./margen";

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

describe("resumen de la cotización completa", () => {
  const lineas = [
    { producto: "CEMENTO", cantidad: 10, unidadMedida: "BOLSA", costoUnitario: "30" },
    { producto: "ARENA", cantidad: 4, unidadMedida: "M3", costoUnitario: "" },
    { producto: "FIERRO", cantidad: 2, unidadMedida: "UNIDAD", costoUnitario: "100" },
  ];

  it("suma solo lo que ya tiene costo y dice cuánto falta por costear", () => {
    const r = resumirCotizacion(lineas, 20);
    expect(r.costeados).toBe(2);
    expect(r.total).toBe(3);
    expect(r.costoTotal).toBeCloseTo(10 * 30 + 2 * 100);
    expect(r.precioTotal).toBeCloseTo((10 * 30 + 2 * 100) * 1.2);
    expect(r.gananciaTotal).toBeCloseTo((10 * 30 + 2 * 100) * 0.2);
    expect(r.superaTope).toBe(false);
  });

  it("avisa si el total pasa de 8 UIT (S/ 44 000 con la UIT 2026)", () => {
    expect(TOPE_8_UIT).toBe(44000);
    const grande = [{ producto: "X", cantidad: 100, unidadMedida: "UNIDAD", costoUnitario: "400" }];
    expect(resumirCotizacion(grande, 20).superaTope).toBe(true); // 100 * 480 = 48 000
    expect(resumirCotizacion(grande, 0).superaTope).toBe(false); // 100 * 400 = 40 000
  });

  it("ignora costos inválidos o negativos", () => {
    const r = resumirCotizacion([{ producto: "X", cantidad: 1, unidadMedida: "U", costoUnitario: "-5" }], 30);
    expect(r.costeados).toBe(0);
    expect(r.precioTotal).toBe(0);
  });

  it("arma un texto copiable solo con los productos costeados", () => {
    const t = textoCotizacion("Cotización — MUNI (CM-1)", lineas, 20);
    expect(t).toContain("Cotización — MUNI (CM-1)");
    expect(t).toContain("CEMENTO");
    expect(t).toContain("FIERRO");
    expect(t).not.toContain("ARENA");
    expect(t).toMatch(/TOTAL: S\/\s?600[.,]00/);
  });
});
