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
  // ¿La licitación pide experiencia previa al postor? SEACE no tiene un campo
  // oficial: se lee el anexo de la contratación (las bases) y la descripción
  // (ver backend/src/bases.js). "No la pide" solo se puede afirmar si basesEstado = "leido".
  exigeExperiencia?: boolean | null;
  notaExperiencia?: string | null;
  // De dónde salió ("anexo" = las bases; "descripcion" = el texto de la licitación) y
  // si las bases ya se leyeron: "leido" | "sin-anexo" | "no-soportado" | "ilegible" | "error" | null (sin revisar).
  experienciaFuente?: "anexo" | "descripcion" | null;
  basesEstado?: string | null;
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

// "con": el texto menciona que piden experiencia; "sin": no la menciona.
export type FiltroExperiencia = "con" | "sin";

export interface TendersQuery {
  departamento?: string;
  estado?: string;
  q?: string;
  objeto?: ObjetoContrato;
  ocultarVencidas?: boolean;
  experiencia?: FiltroExperiencia;
  orden?: OrdenLista;
  page?: number;
  pageSize?: number;
}

// --- Otras entidades del Estado (compras menores o iguales a 8 UIT en su propio portal) ---

export interface Entidad {
  id: string;
  nombre: string;
  nombreCompleto: string;
  portal: string;
  // Portal que no se puede leer desde aquí (captcha, etc.): solo se ofrece el acceso directo.
  soloEnlace: boolean;
  // Por qué es solo enlace (null si se lee normalmente).
  motivo: string | null;
  // Aviso propio de la entidad (p. ej. "contrataciones mayores a 8 UIT").
  nota: string | null;
  // Requerimientos con el plazo todavía abierto.
  vigentes: number;
  // Cuándo se leyó por última vez el portal de la entidad (ISO), o null si nunca.
  actualizadoEn: string | null;
  // Si la última lectura falló: lo que se muestra es de la lectura anterior.
  error: string | null;
}

export interface EntidadesResponse {
  datosAl: string | null;
  entidades: Entidad[];
}

export interface Requerimiento {
  id: string;
  tipo: ObjetoContrato | null;
  titulo: string;
  descripcion: string | null;
  zona: string | null;
  publicado: string | null;
  // Cierre de la cotización (ISO con zona de Lima).
  vence: string;
  documentos: { nombre: string; url: string }[];
  // Dónde ver/postular: la ficha del requerimiento o el portal de la entidad.
  enlace: string;
}

export interface RequerimientosResponse {
  entidad: Pick<Entidad, "id" | "nombre" | "nombreCompleto" | "portal" | "soloEnlace" | "motivo" | "nota">;
  actualizadoEn: string | null;
  error: string | null;
  zonas: string[];
  data: Requerimiento[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequerimientosQuery {
  q?: string;
  tipo?: ObjetoContrato;
  zona?: string;
  orden?: "cierre" | "publicacion";
  page?: number;
  pageSize?: number;
}
