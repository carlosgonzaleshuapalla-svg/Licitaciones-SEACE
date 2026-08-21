import type {
  Meta,
  SyncResponse,
  TenderDetail,
  TendersQuery,
  TendersResponse,
} from "../types/api";

// La URL del backend es configurable vía variable de entorno de Vite
// (usada en dev, ver .env.development). Sin definir, apunta a same-origin
// ("") — el caso de producción, donde el backend sirve este mismo build
// como archivos estáticos (ver backend/src/app.js).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servidor. Verifica que el backend esté corriendo en " +
        API_BASE +
        ".",
    );
  }

  if (!res.ok) {
    throw new ApiError(
      `El servidor respondió con un error (${res.status}).`,
      res.status,
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("La respuesta del servidor no tiene un formato válido.");
  }
}

function buildQueryString(query: TendersQuery): string {
  const params = new URLSearchParams();
  if (query.departamento) params.set("departamento", query.departamento);
  if (query.estado) params.set("estado", query.estado);
  if (query.q) params.set("q", query.q);
  if (query.objeto) params.set("objeto", query.objeto);
  if (query.ocultarVencidas !== undefined)
    params.set("ocultarVencidas", String(query.ocultarVencidas));
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined)
    params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function getMeta(): Promise<Meta> {
  return request<Meta>("/api/meta");
}

export function getTenders(query: TendersQuery): Promise<TendersResponse> {
  return request<TendersResponse>(`/api/tenders${buildQueryString(query)}`);
}

export function getTenderDetail(id: string | number): Promise<TenderDetail> {
  return request<TenderDetail>(`/api/tenders/${id}`);
}

export async function postSync(): Promise<SyncResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/sync`, { method: "POST" });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servidor para sincronizar.",
    );
  }
  if (!res.ok) {
    throw new ApiError(`La sincronización falló (${res.status}).`, res.status);
  }
  return (await res.json()) as SyncResponse;
}
