import { useState } from "react";
import { postSync } from "../api/client";
import type { SyncResponse } from "../types/api";

// La sincronización corre en segundo plano, así que la respuesta casi nunca
// es "completada": dice si arrancó o por qué no. El avance real lo muestra el
// aviso de estado de arriba.
function mensajeDe(res: SyncResponse): string {
  if (res.iniciado)
    return "Sincronización iniciada en segundo plano. El avance aparece arriba.";
  switch (res.motivo) {
    case "ya-en-curso":
      return "Ya hay una sincronización en curso.";
    case "cooldown":
      return "Se sincronizó hace instantes. Espera un minuto e intenta de nuevo.";
    case "bloqueado":
      return "SEACE está limitando el acceso; se reintenta solo más tarde.";
    default:
      return "Sincronización solicitada.";
  }
}

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
      setMensaje(mensajeDe(res));
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
