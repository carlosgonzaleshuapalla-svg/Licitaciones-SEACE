import { useEffect, useState } from "react";
import { getEntidades } from "./api/client";
import { SelectorFuente, FUENTE_SEACE } from "./components/SelectorFuente";
import { VistaEntidad } from "./components/VistaEntidad";
import { VistaSeace } from "./VistaSeace";
import type { Entidad } from "./types/api";
import "./App.css";

// La fuente elegida viaja en la dirección (#sunarp) para poder compartir el enlace
// o recargar sin volver a SEACE.
const leerFuenteDeLaUrl = () => decodeURIComponent(window.location.hash.replace(/^#/, "")) || FUENTE_SEACE;

function App() {
  const [fuente, setFuente] = useState<string>(leerFuenteDeLaUrl);
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [entidadesListas, setEntidadesListas] = useState(false);

  useEffect(() => {
    getEntidades()
      .then((r) => setEntidades(r.entidades))
      .catch(() => {
        // Sin la lista de entidades queda solo SEACE; no se bloquea nada.
      })
      .finally(() => setEntidadesListas(true));
  }, []);

  useEffect(() => {
    const alCambiarLaUrl = () => setFuente(leerFuenteDeLaUrl());
    window.addEventListener("hashchange", alCambiarLaUrl);
    return () => window.removeEventListener("hashchange", alCambiarLaUrl);
  }, []);

  const elegir = (id: string) => {
    window.location.hash = id === FUENTE_SEACE ? "" : encodeURIComponent(id);
    setFuente(id);
  };

  const entidad = entidades.find((e) => e.id === fuente) ?? null;

  return (
    <div className="app">
      <SelectorFuente fuente={fuente} entidades={entidades} onElegir={elegir} />
      {entidad ? (
        <VistaEntidad key={entidad.id} entidad={entidad} />
      ) : fuente !== FUENTE_SEACE && !entidadesListas ? (
        <div className="estado-mensaje" role="status">
          Cargando…
        </div>
      ) : (
        <VistaSeace />
      )}
    </div>
  );
}

export default App;
