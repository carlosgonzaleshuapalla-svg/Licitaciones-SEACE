import { useEffect, useState } from "react";
import { getMeta, getTenderDetail, getTenders } from "./api/client";
import { Filtros, type FiltrosState } from "./components/Filtros";
import { TenderList } from "./components/TenderList";
import { Paginacion } from "./components/Paginacion";
import { SyncButton } from "./components/SyncButton";
import { TenderDetailPanel } from "./components/TenderDetailPanel";
import type { Meta, TenderDetail, TenderSummary } from "./types/api";
import "./App.css";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

function App() {
  const [meta, setMeta] = useState<Meta>({ departamentos: [], estados: [] });

  const [filtros, setFiltros] = useState<FiltrosState>({
    departamento: "",
    estado: "Vigente",
    q: "",
    objeto: "Bien",
    ocultarVencidas: true,
  });
  const [qDebounced, setQDebounced] = useState("");

  const [page, setPage] = useState(1);
  const [tenders, setTenders] = useState<TenderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [refrescar, setRefrescar] = useState(0);

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

  // Debounce del texto libre de búsqueda.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(filtros.q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filtros.q]);

  // Volver a página 1 cuando cambian los filtros.
  useEffect(() => {
    setPage(1);
  }, [
    filtros.departamento,
    filtros.estado,
    filtros.objeto,
    filtros.ocultarVencidas,
    qDebounced,
  ]);

  // Cargar lista de licitaciones.
  useEffect(() => {
    let cancelado = false;
    setCargandoLista(true);
    setErrorLista(null);

    getTenders({
      departamento: filtros.departamento || undefined,
      estado: filtros.estado || undefined,
      q: qDebounced || undefined,
      objeto: filtros.objeto || undefined,
      ocultarVencidas: filtros.ocultarVencidas,
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
    filtros.estado,
    filtros.objeto,
    filtros.ocultarVencidas,
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

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Licitaciones SEACE</h1>
          <p className="app-subtitulo">
            Contrataciones vigentes del Estado peruano, listas para cotizar
          </p>
        </div>
        <SyncButton onSincronizado={() => setRefrescar((r) => r + 1)} />
      </header>

      <main className="app-main">
        <section className="panel-lista">
          <Filtros
            filtros={filtros}
            departamentos={meta.departamentos}
            estados={meta.estados.length > 0 ? meta.estados : ["Vigente"]}
            onChange={setFiltros}
          />

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
