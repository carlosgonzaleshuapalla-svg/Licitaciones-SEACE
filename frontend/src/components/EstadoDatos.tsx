import type { SyncStatus } from "../types/api";
import { haceCuanto } from "../lib/plazo";

interface EstadoDatosProps {
  estado: SyncStatus | null;
  onActualizar: () => void;
  // Para poder probar la antigüedad sin depender del reloj.
  ahora?: number;
}

// Si los datos son más viejos que esto, se avisa: la Mac que los renueva puede
// estar apagada o SEACE puede estar bloqueándola.
const DATOS_VIEJOS_MS = 12 * 60 * 60 * 1000;

function hora(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Avisa cuando lo que se ve en la lista puede ser incompleto o viejo, y por qué.
 * Si los datos están al día y completos, no muestra nada.
 */
export function EstadoDatos({ estado, onActualizar, ahora = Date.now() }: EstadoDatosProps) {
  if (!estado) return null;

  const { bloqueado, total, conDetalle, pendientesDetalle } = estado;

  if (total === 0) {
    return (
      <div className="estado-datos estado-datos-info" role="status">
        <strong>Todavía no hay licitaciones cargadas.</strong>
        <p>El servidor está por cargar los datos; vuelve en unos minutos.</p>
      </div>
    );
  }

  // Modo semilla: el servidor no habla con SEACE, los datos los renueva la Mac
  // del gerente cada pocas horas. Lo único que puede fallar es que se atrasen.
  if (estado.fuente === "semilla") {
    const desde = estado.datosAl ? Date.parse(estado.datosAl) : NaN;
    if (!Number.isNaN(desde) && ahora - desde > DATOS_VIEJOS_MS) {
      return (
        <div className="estado-datos estado-datos-aviso" role="status">
          <strong>Los datos tienen {haceCuanto(estado.datosAl, ahora)?.replace("hace ", "")}.</strong>
          <p>
            Es posible que ya haya licitaciones nuevas que todavía no aparecen,
            y que alguna de las que ves haya cerrado. Se renuevan solos cuando
            se actualiza la fuente.
          </p>
        </div>
      );
    }
    return null;
  }

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

  return null;
}
