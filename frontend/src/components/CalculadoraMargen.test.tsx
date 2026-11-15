import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CalculadoraMargen } from "./CalculadoraMargen";

// El costo y el margen viven en el panel; aquí se simula con un contenedor mínimo.
function Contenedor({ cantidad, margen }: { cantidad: number; margen: number }) {
  const [costo, setCosto] = useState("");
  return <CalculadoraMargen cantidad={cantidad} costoUnitario={costo} onCostoChange={setCosto} margen={margen} />;
}

describe("CalculadoraMargen", () => {
  it("actualiza los resultados en vivo al ingresar el costo con el margen indicado", async () => {
    const user = userEvent.setup();
    render(<Contenedor cantidad={10} margen={20} />);

    await user.type(screen.getByLabelText(/costo unitario estimado/i), "100");

    // precioVentaUnitario = 100 * 1.20 = 120 -> precioTotal = 1200
    expect(await screen.findByText(/S\/\s?1[.,]?200[.,]00/)).toBeInTheDocument();
  });

  it("no rompe sin costo ingresado (todo en cero)", () => {
    render(<Contenedor cantidad={5} margen={30} />);
    expect(screen.getAllByText(/S\/\s?0[.,]00/).length).toBeGreaterThan(0);
  });
});
