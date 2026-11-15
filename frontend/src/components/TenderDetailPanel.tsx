import { useEffect, useState } from "react";
import type { TenderDetail } from "../types/api";
import { formatearFecha } from "../lib/fechas";
import {
  formatearMoneda,
  resumirCotizacion,
  textoCotizacion,
  TOPE_8_UIT,
  type LineaCotizacion,
} from "../lib/margen";
import { urlOficialSeace } from "../lib/seaceLinks";
import { CalculadoraMargen } from "./CalculadoraMargen";

interface TenderDetailPanelProps {
  detalle: TenderDetail | null;
  cargando: boolean;
  error: string | null;
  onCerrar: () => void;
}

/**
 * Items de la licitación con su proveedor sugerido y la proyección de venta.
 * Un solo margen para toda la cotización y un total que suma todos los
 * productos costeados. Se monta con `key` = id de la licitación, así el costo
 * escrito no se arrastra de una licitación a otra.
 */
function ItemsYProyeccion({ detalle }: { detalle: TenderDetail }) {
  const [margen, setMargen] = useState(30);
  const [costos, setCostos] = useState<Record<string, string>>({});
  const [copiado, setCopiado] = useState(false);

  const lineas: LineaCotizacion[] = detalle.items.map((item) => ({
    producto: item.producto,
    cantidad: item.cantidad,
    unidadMedida: item.unidadMedida,
    costoUnitario: costos[String(item.idItem)] ?? "",
  }));
  const resumen = resumirCotizacion(lineas, margen);

  const copiar = async () => {
    const texto = textoCotizacion(
      `Cotización — ${detalle.entidad} (${detalle.codigo})`,
      lineas,
      margen,
    );
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso para el portapapeles: no se puede copiar desde aquí.
      setCopiado(false);
    }
  };

  return (
    <>
      <div className="cotizacion-resumen">
        <label className="campo">
          <span>
            Margen de ganancia sobre el costo: <strong>{margen}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={margen}
            onChange={(e) => setMargen(Number(e.target.value))}
            aria-label="Porcentaje de ganancia"
          />
        </label>

        <div className="calculadora-resultados">
          <div>
            <span className="resultado-label">Total a cotizar</span>
            <span className="resultado-valor">
              {formatearMoneda(resumen.precioTotal)}
            </span>
          </div>
          <div>
            <span className="resultado-label">Costo total</span>
            <span className="resultado-valor">
              {formatearMoneda(resumen.costoTotal)}
            </span>
          </div>
          <div>
            <span className="resultado-label">Ganancia total</span>
            <span className="resultado-valor resultado-ganancia">
              {formatearMoneda(resumen.gananciaTotal)}
            </span>
          </div>
        </div>

        <p className="cotizacion-nota">
          {resumen.costeados} de {resumen.total} productos con costo.
          {resumen.costeados < resumen.total &&
            " Escribe el costo de cada uno para completar el total."}{" "}
          Tope de contratación menor: 8 UIT = {formatearMoneda(TOPE_8_UIT)}.
        </p>

        {resumen.superaTope && (
          <p className="cotizacion-alerta" role="alert">
            El total supera el tope de 8 UIT ({formatearMoneda(TOPE_8_UIT)}).
            Revisa cantidades y costos antes de cotizar.
          </p>
        )}

        <button
          type="button"
          className="btn-copiar"
          onClick={copiar}
          disabled={resumen.costeados === 0}
        >
          {copiado ? "Copiado ✓" : "Copiar cotización"}
        </button>
      </div>

      <div className="items-list">
        {detalle.items.map((item) => (
          <div className="item-card" key={item.idItem}>
            <div className="item-header">
              <h4>{item.producto}</h4>
              <span className="item-meta">
                {item.cantidad} {item.unidadMedida} · {item.ciudad}
              </span>
            </div>

            <div className="proveedores">
              {item.proveedores.length === 0 ? (
                <p className="detalle-sin-datos">
                  No hay proveedores sugeridos para este producto.
                </p>
              ) : (
                item.proveedores.map((prov, i) => (
                  <a
                    key={`${prov.nombre}-${i}`}
                    href={prov.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="proveedor-link"
                  >
                    {prov.nombre}
                    <span className="proveedor-categoria">
                      {prov.categoria}
                    </span>
                  </a>
                ))
              )}
            </div>

            <CalculadoraMargen
              cantidad={item.cantidad}
              costoUnitario={costos[String(item.idItem)] ?? ""}
              onCostoChange={(v) =>
                setCostos((c) => ({ ...c, [String(item.idItem)]: v }))
              }
              margen={margen}
            />
          </div>
        ))}
      </div>
    </>
  );
}

export function TenderDetailPanel({
  detalle,
  cargando,
  error,
  onCerrar,
}: TenderDetailPanelProps) {
  // En desktop el panel es una barra lateral siempre visible (aunque no
  // haya nada seleccionado). En mobile se apila como el resto del
  // contenido, así que en vez de eso lo tratamos como una hoja a pantalla
  // completa que solo ocupa espacio (y bloquea el scroll de fondo) cuando
  // hay algo que mostrar — si no, "abierto" queda en false y el CSS lo
  // mantiene fuera de pantalla sin agregar alto a la página.
  const abierto = cargando || error !== null || detalle !== null;

  useEffect(() => {
    if (!abierto) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [abierto, onCerrar]);

  return (
    <>
      <div
        className={`detalle-backdrop${abierto ? " show" : ""}`}
        onClick={onCerrar}
        aria-hidden="true"
      />
      <aside
        className={`detalle-panel${abierto ? " detalle-panel-abierto" : ""}${
          !abierto ? " detalle-vacio" : ""
        }`}
      >
        {cargando && (
          <div className="estado-mensaje" role="status">
            Cargando detalle...
          </div>
        )}

        {!cargando && error && (
          <>
            <button type="button" className="btn-cerrar" onClick={onCerrar}>
              ✕ Cerrar
            </button>
            <div className="estado-mensaje estado-error" role="alert">
              <strong>No se pudo cargar el detalle de la licitación.</strong>
              <p>{error}</p>
            </div>
          </>
        )}

        {!cargando && !error && !detalle && (
          <p>Selecciona una licitación de la lista para ver su detalle.</p>
        )}

        {!cargando && !error && detalle && (
          <>
            <button type="button" className="btn-cerrar" onClick={onCerrar}>
              ✕ Cerrar
            </button>

            <header className="detalle-header">
              <span className="tender-codigo">{detalle.codigo}</span>
              <h2>
                <a
                  href={urlOficialSeace(detalle.idContrato)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tender-entidad-link"
                  title="Ver esta licitación en el portal oficial de SEACE"
                >
                  {detalle.entidad}
                  <span className="link-externo" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </h2>
              <p>{detalle.descripcion}</p>
            </header>

            <section className="detalle-seccion">
              <h3>Etapas del proceso</h3>
              {detalle.etapas.length === 0 ? (
                <p className="detalle-sin-datos">No hay etapas registradas.</p>
              ) : (
                <ul className="etapas-list">
                  {detalle.etapas.map((etapa, i) => (
                    <li key={`${etapa.nombre}-${i}`}>
                      <strong>{etapa.nombre}</strong>
                      <span>
                        {formatearFecha(etapa.inicio)} –{" "}
                        {formatearFecha(etapa.fin)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="detalle-seccion">
              <h3>Items y proyección de venta</h3>
              {detalle.items.length === 0 ? (
                <p className="detalle-sin-datos">
                  Esta licitación no tiene items.
                </p>
              ) : (
                <ItemsYProyeccion key={detalle.idContrato} detalle={detalle} />
              )}
            </section>
          </>
        )}
      </aside>
    </>
  );
}
