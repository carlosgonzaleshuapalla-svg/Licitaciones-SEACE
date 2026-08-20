import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CalculadoraMargen } from "./CalculadoraMargen";

describe("CalculadoraMargen", () => {
  it("actualiza los resultados en vivo al ingresar costo y mover el slider", async () => {
    const user = userEvent.setup();
    render(<CalculadoraMargen cantidad={10} />);

    const inputCosto = screen.getByLabelText(/costo unitario estimado/i);
    await user.type(inputCosto, "100");

    const slider = screen.getByLabelText(/porcentaje de ganancia/i);
    fireEvent.change(slider, { target: { value: "20" } });

    // precioVentaUnitario = 100 * 1.20 = 120 -> precioTotal = 1200
    expect(await screen.findByText(/S\/\s?1[.,]?200[.,]00/)).toBeInTheDocument();
  });

  it("no rompe sin costo ingresado (todo en cero)", () => {
    render(<CalculadoraMargen cantidad={5} />);
    expect(screen.getAllByText(/S\/\s?0[.,]00/).length).toBeGreaterThan(0);
  });
});
