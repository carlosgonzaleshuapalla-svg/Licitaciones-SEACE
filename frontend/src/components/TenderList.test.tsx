import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TenderList } from "./TenderList";
import { tendersMock } from "../test/mocks";

describe("TenderList", () => {
  it("muestra un mensaje de carga cuando cargando=true", () => {
    render(
      <TenderList
        tenders={[]}
        cargando={true}
        error={null}
        seleccionadoId={null}
        onSeleccionar={() => {}}
      />,
    );
    expect(screen.getByText(/cargando licitaciones/i)).toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", () => {
    render(
      <TenderList
        tenders={[]}
        cargando={false}
        error="No se pudo conectar con el servidor."
        seleccionadoId={null}
        onSeleccionar={() => {}}
      />,
    );
    expect(
      screen.getByText(/no se pudo cargar la lista de licitaciones/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no se pudo conectar con el servidor/i),
    ).toBeInTheDocument();
  });

  it("muestra un mensaje cuando no hay resultados", () => {
    render(
      <TenderList
        tenders={[]}
        cargando={false}
        error={null}
        seleccionadoId={null}
        onSeleccionar={() => {}}
      />,
    );
    expect(
      screen.getByText(/no se encontraron licitaciones/i),
    ).toBeInTheDocument();
  });

  it("renderiza una tarjeta por cada licitación con sus datos clave", () => {
    render(
      <TenderList
        tenders={tendersMock}
        cargando={false}
        error={null}
        seleccionadoId={null}
        onSeleccionar={() => {}}
      />,
    );

    expect(screen.getByText("CONT-001-2026")).toBeInTheDocument();
    expect(screen.getByText("Municipalidad de Lima")).toBeInTheDocument();
    expect(
      screen.getByText(/adquisición de laptops/i),
    ).toBeInTheDocument();
    expect(screen.getByText("CONT-002-2026")).toBeInTheDocument();
    expect(
      screen.getByText("Gobierno Regional de Arequipa"),
    ).toBeInTheDocument();
  });

  it("llama a onSeleccionar con el idContrato correcto al hacer click", async () => {
    const user = userEvent.setup();
    const onSeleccionar = vi.fn();

    render(
      <TenderList
        tenders={tendersMock}
        cargando={false}
        error={null}
        seleccionadoId={null}
        onSeleccionar={onSeleccionar}
      />,
    );

    // El nombre de la entidad ahora es un link al portal oficial de SEACE
    // (abre en pestaña nueva), no dispara la selección — se clickea la
    // descripción, que sigue dentro de la zona clickeable de la tarjeta.
    await user.click(screen.getByText(/adquisición de laptops/i));
    expect(onSeleccionar).toHaveBeenCalledWith(1);
  });

  it("el nombre de la entidad enlaza al detalle oficial de esa licitación en SEACE", () => {
    render(
      <TenderList
        tenders={tendersMock}
        cargando={false}
        error={null}
        seleccionadoId={null}
        onSeleccionar={() => {}}
      />,
    );

    const link = screen.getByRole("link", { name: /Municipalidad de Lima/i });
    expect(link).toHaveAttribute(
      "href",
      "https://prod6.seace.gob.pe/buscador-publico/contrataciones/1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
