interface PaginacionProps {
  page: number;
  pageSize: number;
  total: number;
  onCambiarPage: (page: number) => void;
}

export function Paginacion({
  page,
  pageSize,
  total,
  onCambiarPage,
}: PaginacionProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  if (total === 0) return null;

  const desde = (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);

  return (
    <div className="paginacion">
      <span className="paginacion-info">
        {desde}–{hasta} de {total}
      </span>
      <div className="paginacion-botones">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onCambiarPage(page - 1)}
        >
          ← Anterior
        </button>
        <span>
          Página {page} de {totalPaginas}
        </span>
        <button
          type="button"
          disabled={page >= totalPaginas}
          onClick={() => onCambiarPage(page + 1)}
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}
