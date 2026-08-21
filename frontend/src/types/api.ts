// Tipos derivados del contrato de API congelado en LEDGER.md
// Backend: http://localhost:4000

export interface Meta {
  departamentos: string[];
  estados: string[];
}

export interface TenderSummary {
  idContrato: number | string;
  codigo: string;
  entidad: string;
  objeto: string;
  descripcion: string;
  estado: string;
  fechaPublicacion: string;
  cotizacionInicio: string;
  cotizacionFin: string;
  ciudades: string[];
  cantidadItems: number;
  esProductoRapido: boolean;
}

export interface Proveedor {
  nombre: string;
  url: string;
  categoria: string;
}

export interface TenderItem {
  idItem: number | string;
  producto: string;
  cantidad: number;
  unidadMedida: string;
  ciudad: string;
  proveedores: Proveedor[];
}

export interface Etapa {
  nombre: string;
  inicio: string;
  fin: string;
}

export interface TenderDetail extends TenderSummary {
  etapas: Etapa[];
  items: TenderItem[];
}

export interface TendersResponse {
  data: TenderSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SyncResponse {
  ok: boolean;
  sincronizados: number;
  timestamp: string;
}

// El portal solo sincroniza estos dos tipos de contratación (Obra y
// Consultoría de Obra quedan fuera de alcance).
export type ObjetoContrato = "Bien" | "Servicio";

export interface TendersQuery {
  departamento?: string;
  estado?: string;
  q?: string;
  objeto?: ObjetoContrato;
  ocultarVencidas?: boolean;
  page?: number;
  pageSize?: number;
}
