import { useEffect, useState } from "react";
import { getMeta, getStatus, getTenderDetail, getTenders } from "./api/client";
import { Filtros, type FiltrosState } from "./components/Filtros";
import { TenderList } from "./components/TenderList";
import { Paginacion } from "./components/Paginacion";
import { SyncButton } from "./components/SyncButton";
import { EstadoDatos } from "./components/EstadoDatos";
import { TenderDetailPanel } from "./components/TenderDetailPanel";
import { guardarPreferencias, leerPreferencias } from "./lib/preferencias";
import { haceCuanto } from "./lib/plazo";
import type { Meta, SyncStatus, TenderDetail, TenderSummary } from "./types/api";
import "./App.css";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;
const STATUS_POLL_MS = 30_000;
// El portal solo sincroniza licitaciones vigentes, así que el estado ya no es
// un filtro que el usuario elija.
const ESTADO_VIGENTE = "Vigente";

function App() {
  const [meta, setMeta] = useState<Meta>({ departamentos: [], estados: [] });

  // Ciudad, tipo y orden se recuerdan entre visitas; la búsqueda por texto no.
  const [filtros, setFiltros] = useState<FiltrosState>(() => ({
    ...leerPreferencias(),
    q: "",
  }));
  const [qDebounced, setQDebounced] = useState("");

  const [page, setPage] = useState(1);
  const [tenders, setTenders] = useState<TenderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [refrescar, setRefrescar] = useState(0);
  const [estado, setEstado] = useState<SyncStatus | null>(null);
  const [refrescarEstado, setRefrescarEstado] = useState(0);

  const [seleccionadoId, setSeleccionadoId] = useState<
    TenderSummary["idContrato"] | null
  >(null);
  const [detalle, setDetalle] = useState<TenderDetail | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);

  // Meta: departamentos y estados para poblar los dropdowns.
  useEffect(() => {
    getMeta()
      .then((m) => setMeta(m))
      .catch(() => {
        // Si falla /api/meta, dejamos los dropdowns con lo mínimo (no bloquea la app).
        setMeta({ departamentos: [], estados: ["Vigente", "En Evaluación", "Culminado"] });
      });
  }, []);

  // Estado de la sincronización: avisa si lo que se ve es parcial y por qué.
  useEffect(() => {
    let activo = true;
    const cargar = () =>
      getStatus()
        .then((s) => {
          if (activo) setEstado(s);
        })
        .catch(() => {
          // Si /api/status falla no se bloquea la app: simplemente no hay aviso.
        });
    cargar();
    const t = setInterval(cargar, STATUS_POLL_MS);
    return () => {
      activo = false;
      clearInterval(t);
    };
  }, [refrescarEstado]);

  useEffect(() => {
    guardarPreferencias({
      departamento: filtros.departamento,
      objeto: filtros.objeto,
      orden: filtros.orden,
    });
  }, [filtros.departamento, filtros.objeto, filtros.orden]);

  // Si la ciudad recordada ya no tiene licitaciones, se vuelve a "Todas" en vez
  // de mostrar una lista vacía sin explicación.
  useEffect(() => {
    if (
      filtros.departamento &&
      meta.departamentos.length > 0 &&
      !meta.departamentos.includes(filtros.departamento)
    ) {
      setFiltros((f) => ({ ...f, departamento: "" }));
    }
  }, [meta.departamentos, filtros.departamento]);

  // Debounce del texto libre de búsqueda.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(filtros.q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filtros.q]);

  // Volver a página 1 cuando cambian los filtros.
  useEffect(() => {
    setPage(1);
  }, [filtros.departamento, filtros.objeto, filtros.orden, qDebounced]);

  // Cargar lista de licitaciones.
  useEffect(() => {
    let cancelado = false;
    setCargandoLista(true);
    setErrorLista(null);

    getTenders({
      departamento: filtros.departamento || undefined,
      estado: ESTADO_VIGENTE,
      q: qDebounced || undefined,
      objeto: filtros.objeto || undefined,
      orden: filtros.orden,
      // Siempre solo lo que aún se puede cotizar (el portal no es un histórico).
      ocultarVencidas: true,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelado) return;
        setTenders(res.data);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelado) return;
        setTenders([]);
        setTotal(0);
        setErrorLista(
          err instanceof Error ? err.message : "Error desconocido al cargar.",
        );
      })
      .finally(() => {
        if (!cancelado) setCargandoLista(false);
      });

    return () => {
      cancelado = true;
    };
  }, [
    filtros.departamento,
    filtros.objeto,
    filtros.orden,
    qDebounced,
    page,
    refrescar,
  ]);

  // Cargar detalle cuando cambia la selección.
  useEffect(() => {
    if (seleccionadoId === null) {
      setDetalle(null);
      return;
    }
    let cancelado = false;
    setCargandoDetalle(true);
    setErrorDetalle(null);
    setDetalle(null);

    getTenderDetail(seleccionadoId)
      .then((d) => {
        if (!cancelado) setDetalle(d);
      })
      .catch((err) => {
        if (!cancelado)
          setErrorDetalle(
            err instanceof Error
              ? err.message
              : "Error desconocido al cargar el detalle.",
          );
      })
      .finally(() => {
        if (!cancelado) setCargandoDetalle(false);
      });

    return () => {
      cancelado = true;
    };
  }, [seleccionadoId]);

  const actualizarTodo = () => {
    setRefrescar((r) => r + 1);
    setRefrescarEstado((r) => r + 1);
  };

  const datosHace = haceCuanto(estado?.datosAl);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Licitaciones SEACE</h1>
          <p className="app-subtitulo">
            Contrataciones vigentes del Estado peruano, listas para cotizar
          </p>
        </div>
        {/* Solo si el servidor sincroniza él mismo con SEACE tiene sentido pedir
            una sincronización; si no, los datos los renueva la Mac y aquí solo
            se vuelve a leer lo que ya hay. */}
        {estado?.fuente === "seace" ? (
          <SyncButton onSincronizado={actualizarTodo} />
        ) : (
          <div className="sync-button-wrap">
            <button type="button" className="btn-sync" onClick={actualizarTodo}>
              Actualizar
            </button>
            {datosHace && (
              <span className="sync-mensaje">Datos de {datosHace}</span>
            )}
          </div>
        )}
      </header>

      <main className="app-main">
        <section className="panel-lista">
          <EstadoDatos estado={estado} onActualizar={actualizarTodo} />

          <Filtros
            filtros={filtros}
            departamentos={meta.departamentos}
            onChange={setFiltros}
          />

          {!cargandoLista && !errorLista && (
            <p className="lista-resumen" role="status">
              {total === 1 ? "1 licitación" : `${total} licitaciones`}
              {filtros.orden === "cierre" ? " · cierran primero" : ""}
            </p>
          )}

          <TenderList
            tenders={tenders}
            cargando={cargandoLista}
            error={errorLista}
            seleccionadoId={seleccionadoId}
            onSeleccionar={setSeleccionadoId}
          />

          <Paginacion
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onCambiarPage={setPage}
          />
        </section>

        <TenderDetailPanel
          detalle={detalle}
          cargando={cargandoDetalle}
          error={errorDetalle}
          onCerrar={() => setSeleccionadoId(null)}
        />
      </main>
    </div>
  );
}

export default App;
