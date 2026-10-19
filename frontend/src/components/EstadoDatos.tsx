import type { SyncStatus } from "../types/api";

interface EstadoDatosProps {
  estado: SyncStatus | null;
  onActualizar: () => void;
}

function hora(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Avisa cuando lo que se ve en la lista puede ser incompleto, y por qué.
 * Si está todo descargado y SEACE responde bien, no muestra nada.
 */
export function EstadoDatos({ estado, onActualizar }: EstadoDatosProps) {
  if (!estado) return null;

  const { bloqueado, total, conDetalle, pendientesDetalle } = estado;

  if (bloqueado) {
    const proximo = hora(estado.proximoIntento);
    return (
      <div className="estado-datos estado-datos-aviso" role="status">
        <strong>SEACE está limitando temporalmente nuestro acceso.</strong>
        <p>
          Por eso puede que no veas todas las licitaciones: hay {total} guardadas
          y {conDetalle} con su detalle completo (productos, ciudad, fechas).
          Reintentamos automáticamente{proximo ? ` a eso de las ${proximo}` : ""}
          ; no hace falta que hagas nada.
        </p>
      </div>
    );
  }

  // Solo se avisa si de verdad faltan detalles. Refrescar la lista con todo
  // ya descargado (lo normal tras cargar la semilla) no merece un aviso.
  if (pendientesDetalle > 0) {
    return (
      <div className="estado-datos estado-datos-info" role="status">
        <strong>Descargando datos desde SEACE…</strong>
        <p>
          {conDetalle} de {total} licitaciones con detalle completo (las más
          recientes primero). Las que aún no lo tienen se ven sin productos ni
          ciudad, y no aparecen al filtrar por departamento.
        </p>
        <button type="button" className="btn-estado" onClick={onActualizar}>
          Actualizar lista
        </button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="estado-datos estado-datos-info" role="status">
        <strong>Todavía no hay licitaciones descargadas.</strong>
        <p>El servidor está por sincronizar con SEACE; vuelve en unos minutos.</p>
      </div>
    );
  }

  return null;
}
