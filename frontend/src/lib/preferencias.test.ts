import { describe, expect, it } from "vitest";
import { guardarPreferencias, leerPreferencias, PREFERENCIAS_POR_DEFECTO } from "./preferencias";

const almacenFalso = (inicial?: string) => {
  const datos = new Map<string, string>();
  if (inicial !== undefined) datos.set("seace-filtros-v1", inicial);
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
  };
};

describe("preferencias de filtros", () => {
  it("devuelve los valores por defecto si no hay nada guardado", () => {
    expect(leerPreferencias(almacenFalso())).toEqual(PREFERENCIAS_POR_DEFECTO);
  });

  it("recuerda lo guardado", () => {
    const a = almacenFalso();
    guardarPreferencias({ departamento: "LIMA", objeto: "Servicio", orden: "cierre" }, a);
    expect(leerPreferencias(a)).toEqual({ departamento: "LIMA", objeto: "Servicio", orden: "cierre" });
  });

  it("descarta valores raros o corruptos sin romperse", () => {
    expect(leerPreferencias(almacenFalso("no es json"))).toEqual(PREFERENCIAS_POR_DEFECTO);
    expect(
      leerPreferencias(almacenFalso(JSON.stringify({ departamento: 5, objeto: "Obra", orden: "x".repeat(10) }))),
    ).toEqual(PREFERENCIAS_POR_DEFECTO);
  });

  it("sin almacenamiento disponible no falla", () => {
    expect(leerPreferencias(null)).toEqual(PREFERENCIAS_POR_DEFECTO);
    expect(() => guardarPreferencias(PREFERENCIAS_POR_DEFECTO, null)).not.toThrow();
  });
});
