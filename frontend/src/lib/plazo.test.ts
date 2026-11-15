import { describe, expect, it } from "vitest";
import { describirPlazo, haceCuanto, instanteDeSeace } from "./plazo";

// Las fechas de SEACE están en hora de Lima (UTC-5): 12:00 en Lima = 17:00 UTC.
const lima = (d: string) => Date.parse(d.replace(" ", "T") + "-05:00");

describe("instanteDeSeace", () => {
  it("interpreta la fecha en hora de Lima, sin importar la zona del navegador", () => {
    expect(instanteDeSeace("24/10/2026 12:00:00")).toBe(Date.parse("2026-10-24T17:00:00Z"));
  });
  it("acepta sin segundos y rechaza lo que no es fecha", () => {
    expect(instanteDeSeace("24/10/2026 12:00")).toBe(Date.parse("2026-10-24T17:00:00Z"));
    expect(instanteDeSeace("mañana")).toBeNull();
    expect(instanteDeSeace(null)).toBeNull();
  });
});

describe("describirPlazo", () => {
  const ahora = lima("2026-10-24 09:00:00");

  it("marca urgente lo que cierra en menos de 3 horas, con minutos si falta menos de 1 h", () => {
    expect(describirPlazo("24/10/2026 09:30:00", ahora)).toEqual({ texto: "Cierra en 30 min", nivel: "urgente" });
    expect(describirPlazo("24/10/2026 11:30:00", ahora)).toEqual({ texto: "Cierra en 2 h", nivel: "urgente" });
  });
  it("marca pronto lo que cierra hoy o dentro de 24 h", () => {
    expect(describirPlazo("24/10/2026 17:00:00", ahora)).toEqual({ texto: "Cierra en 8 h", nivel: "pronto" });
  });
  it("cuenta en días cuando falta más de un día", () => {
    expect(describirPlazo("25/10/2026 10:00:00", ahora)).toEqual({ texto: "Cierra en 1 día", nivel: "normal" });
    expect(describirPlazo("29/10/2026 09:00:00", ahora)).toEqual({ texto: "Cierra en 5 días", nivel: "normal" });
  });
  it("avisa si el plazo ya venció y no inventa nada si no hay fecha", () => {
    expect(describirPlazo("24/10/2026 08:00:00", ahora)).toEqual({ texto: "Plazo vencido", nivel: "vencida" });
    expect(describirPlazo(undefined, ahora)).toBeNull();
  });
});

describe("haceCuanto", () => {
  const ahora = Date.parse("2026-10-24T12:00:00Z");
  it("expresa la antigüedad de los datos", () => {
    expect(haceCuanto("2026-10-24T11:59:30Z", ahora)).toBe("hace un momento");
    expect(haceCuanto("2026-10-24T11:15:00Z", ahora)).toBe("hace 45 min");
    expect(haceCuanto("2026-10-24T07:00:00Z", ahora)).toBe("hace 5 h");
    expect(haceCuanto("2026-10-22T12:00:00Z", ahora)).toBe("hace 2 días");
    expect(haceCuanto(null, ahora)).toBeNull();
    expect(haceCuanto("no es fecha", ahora)).toBeNull();
  });
});
