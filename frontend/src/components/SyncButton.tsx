import { useState } from "react";
import { postSync } from "../api/client";

interface SyncButtonProps {
  onSincronizado: () => void;
}

export function SyncButton({ onSincronizado }: SyncButtonProps) {
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [esError, setEsError] = useState(false);

  const handleClick = async () => {
    setCargando(true);
    setMensaje(null);
    setEsError(false);
    try {
      const res = await postSync();
      setMensaje(
        `Sincronización completada: ${res.sincronizados} licitaciones actualizadas.`,
      );
      onSincronizado();
    } catch (err) {
      setEsError(true);
      setMensaje(
        err instanceof Error
          ? err.message
          : "Ocurrió un error al sincronizar.",
      );
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="sync-button-wrap">
      <button
        type="button"
        className="btn-sync"
        onClick={handleClick}
        disabled={cargando}
      >
        {cargando ? "Sincronizando..." : "Sincronizar ahora"}
      </button>
      {mensaje && (
        <span className={`sync-mensaje ${esError ? "sync-mensaje-error" : ""}`}>
          {mensaje}
        </span>
      )}
    </div>
  );
}
