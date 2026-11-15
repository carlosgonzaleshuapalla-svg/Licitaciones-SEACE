// Tipos derivados del contrato de API congelado en LEDGER.md
// Backend: http://localhost:4000

export interface Meta {
  departamentos: string[];
  estados: string[];
}

// Primeros productos de una licitación, para verlos en la lista sin abrir el detalle.
export interface ProductoResumen {
  producto: string;
  cantidad: number | null;
  unidadMedida: string | null;
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
  // Solo vienen en la lista (no en el detalle, que trae todos los items).
  productos?: ProductoResumen[];
  productosTotal?: number;
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
  // La sincronización corre en segundo plano: "iniciado" = ya arrancó.
  iniciado?: boolean;
  sincronizados?: number;
  // Si no se pudo iniciar: "ya-en-curso" | "cooldown" | "bloqueado" | "desactivada".
  motivo?: string;
  proximoIntento?: string | null;
  timestamp: string;
}

// Estado de la sincronización con SEACE y qué tan completos están los datos.
export interface SyncStatus {
  sincronizando: boolean;
  // SEACE rechazó nuestras peticiones (firewall) y estamos esperando para reintentar.
  bloqueado: boolean;
  bloqueadoDesde: string | null;
  ultimoIntento: string | null;
  ultimoExito: string | null;
  proximoIntento: string | null;
  total: number;
  conDetalle: number;
  pendientesDetalle: number;
  // De dónde salen los datos: "semilla" = los renueva la Mac del gerente y el
  // servidor solo los relee; "seace" = el servidor sincroniza él mismo.
  fuente?: "semilla" | "seace";
  // Desde cuándo son los datos que se están mostrando (ISO).
  datosAl?: string | null;
}

// El portal solo sincroniza estos dos tipos de contratación (Obra y
// Consultoría de Obra quedan fuera de alcance).
export type ObjetoContrato = "Bien" | "Servicio";

// "publicacion": lo más reciente primero. "cierre": lo que antes vence primero.
export type OrdenLista = "publicacion" | "cierre";

export interface TendersQuery {
  departamento?: string;
  estado?: string;
  q?: string;
  objeto?: ObjetoContrato;
  ocultarVencidas?: boolean;
  orden?: OrdenLista;
  page?: number;
  pageSize?: number;
}
