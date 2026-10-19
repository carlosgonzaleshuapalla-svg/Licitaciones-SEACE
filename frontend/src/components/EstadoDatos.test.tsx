import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EstadoDatos } from "./EstadoDatos";
import type { SyncStatus } from "../types/api";

const base: SyncStatus = {
  sincronizando: false,
  bloqueado: false,
  bloqueadoDesde: null,
  ultimoIntento: "2026-10-18T20:00:00.000Z",
  ultimoExito: "2026-10-18T20:00:00.000Z",
  proximoIntento: null,
  total: 2272,
  conDetalle: 2272,
  pendientesDetalle: 0,
};

describe("EstadoDatos", () => {
  it("no muestra nada cuando todo está descargado y SEACE responde bien", () => {
    const { container } = render(
      <EstadoDatos estado={base} onActualizar={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("no muestra nada mientras todavía no llegó el estado", () => {
    const { container } = render(
      <EstadoDatos estado={null} onActualizar={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("avisa que SEACE está limitando el acceso y explica por qué faltan licitaciones", () => {
    render(
      <EstadoDatos
        estado={{
          ...base,
          bloqueado: true,
          total: 500,
          conDetalle: 40,
          pendientesDetalle: 460,
          proximoIntento: "2026-10-18T21:30:00.000Z",
        }}
        onActualizar={() => {}}
      />,
    );
    expect(
      screen.getByText(/SEACE está limitando temporalmente nuestro acceso/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no veas todas las licitaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/500 guardadas/i)).toBeInTheDocument();
  });

  it("muestra el avance de la descarga cuando faltan detalles", () => {
    render(
      <EstadoDatos
        estado={{ ...base, sincronizando: true, conDetalle: 800, pendientesDetalle: 1472 }}
        onActualizar={() => {}}
      />,
    );
    expect(screen.getByText(/Descargando datos desde SEACE/i)).toBeInTheDocument();
    expect(screen.getByText(/800 de 2272/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actualizar lista/i })).toBeInTheDocument();
  });

  it("avisa cuando todavía no hay ninguna licitación descargada", () => {
    render(
      <EstadoDatos
        estado={{ ...base, total: 0, conDetalle: 0, ultimoExito: null }}
        onActualizar={() => {}}
      />,
    );
    expect(
      screen.getByText(/Todavía no hay licitaciones descargadas/i),
    ).toBeInTheDocument();
  });
});
