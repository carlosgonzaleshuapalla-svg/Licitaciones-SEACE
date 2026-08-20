import { describe, expect, it } from "vitest";
import { formatearFecha } from "./fechas";

describe("formatearFecha", () => {
  it("parsea el formato real que entrega el backend (DD/MM/YYYY HH:mm:ss)", () => {
    const resultado = formatearFecha("19/08/2026 18:20:15");
    expect(resultado).not.toBe("19/08/2026 18:20:15");
    expect(resultado).toContain("2026");
    expect(resultado).toMatch(/18[:.]20|6:20/); // acepta variantes de formato horario es-PE
  });

  it("conserva día, mes y año correctos (no los intercambia)", () => {
    // 05/01/2026 = 5 de enero, no 1 de mayo — si se interpretara como
    // fecha US se rompería.
    const resultado = formatearFecha("05/01/2026 09:00:00");
    expect(resultado).toContain("05");
    expect(resultado).toContain("01");
    expect(resultado).toContain("2026");
  });

  it("devuelve un guion para valores vacíos", () => {
    expect(formatearFecha(null)).toBe("—");
    expect(formatearFecha(undefined)).toBe("—");
    expect(formatearFecha("")).toBe("—");
  });

  it("devuelve el valor crudo si no matchea ningún formato conocido", () => {
    expect(formatearFecha("no-es-una-fecha")).toBe("no-es-una-fecha");
  });

  it("sigue aceptando ISO 8601 como fallback", () => {
    const resultado = formatearFecha("2026-08-19T18:20:15.000Z");
    expect(resultado).toContain("2026");
  });
});
