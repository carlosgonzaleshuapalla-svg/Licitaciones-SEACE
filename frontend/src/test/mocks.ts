import type { TenderSummary } from "../types/api";

export const tendersMock: TenderSummary[] = [
  {
    idContrato: 1,
    codigo: "CONT-001-2026",
    entidad: "Municipalidad de Lima",
    objeto: "Bien",
    descripcion: "Adquisición de laptops para oficinas administrativas",
    estado: "Vigente",
    fechaPublicacion: "2026-08-01T00:00:00.000Z",
    cotizacionInicio: "2026-08-05T00:00:00.000Z",
    cotizacionFin: "2026-08-15T00:00:00.000Z",
    ciudades: ["LIMA"],
    cantidadItems: 3,
    esProductoRapido: true,
  },
  {
    idContrato: 2,
    codigo: "CONT-002-2026",
    entidad: "Gobierno Regional de Arequipa",
    objeto: "Bien",
    descripcion: "Compra de mobiliario escolar",
    estado: "Vigente",
    fechaPublicacion: "2026-08-03T00:00:00.000Z",
    cotizacionInicio: "2026-08-06T00:00:00.000Z",
    cotizacionFin: "2026-08-20T00:00:00.000Z",
    ciudades: ["AREQUIPA"],
    cantidadItems: 1,
    esProductoRapido: true,
  },
];
