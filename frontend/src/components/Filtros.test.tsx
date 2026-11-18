import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Filtros, type FiltrosState } from "./Filtros";

const base: FiltrosState = { departamento: "", q: "", objeto: "Bien", orden: "publicacion", experiencia: "" };

describe("Filtros: experiencia previa", () => {
  it("ofrece cualquiera / no menciona / pide, y avisa al elegir", async () => {
    const onChange = vi.fn();
    render(<Filtros filtros={base} departamentos={["LIMA"]} onChange={onChange} />);
    const combo = screen.getByLabelText(/experiencia previa/i);
    expect(combo).toHaveValue("");
    expect(screen.getByRole("option", { name: /sin exigencia de experiencia/i })).toBeInTheDocument();
    await userEvent.selectOptions(combo, "con");
    expect(onChange).toHaveBeenCalledWith({ ...base, experiencia: "con" });
  });

  it("aclara cuándo entra en 'sin exigencia'", () => {
    render(<Filtros filtros={base} departamentos={[]} onChange={() => {}} />);
    expect(screen.getByText(/aparece solo cuando el anexo se leyó completo/)).toBeInTheDocument();
  });
});
