import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectorFuente, FUENTE_SEACE } from "./SelectorFuente";
import { TarjetaRequerimiento, VistaEntidad } from "./VistaEntidad";
import type { Entidad, Requerimiento, RequerimientosResponse } from "../types/api";

const sunarp: Entidad = {
  id: "sunarp",
  nombre: "SUNARP",
  nombreCompleto: "Superintendencia Nacional de los Registros Públicos",
  portal: "https://8uit.sunarp.gob.pe/portal",
  soloEnlace: false,
  motivo: null,
  nota: null,
  vigentes: 36,
  actualizadoEn: new Date().toISOString(),
  error: null,
};
const sbn: Entidad = { ...sunarp, id: "sbn", nombre: "SBN", nombreCompleto: "Bienes Estatales", portal: "https://8uit.sbn.gob.pe/portal", vigentes: 0 };

const req = (extra: Partial<Requerimiento> = {}): Requerimiento => ({
  id: "1",
  tipo: "Bien",
  titulo: "ADQUISICIÓN DE AGENDA INSTITUCIONAL – 2027",
  descripcion: null,
  zona: "SEDE CENTRAL",
  publicado: "2026-11-17T19:13:00-05:00",
  vence: "2099-01-01T16:00:00-05:00",
  documentos: [{ nombre: "Términos de referencia", url: "https://8uit.sunarp.gob.pe/storage/files2/x.pdf" }],
  enlace: "https://8uit.sunarp.gob.pe/portal",
  ...extra,
});

describe("SelectorFuente", () => {
  it("no se muestra si no hay otras entidades", () => {
    const { container } = render(<SelectorFuente fuente={FUENTE_SEACE} entidades={[]} onElegir={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lista SEACE y cada entidad con su cantidad de vigentes, y avisa al elegir", async () => {
    const onElegir = vi.fn();
    render(<SelectorFuente fuente={FUENTE_SEACE} entidades={[sunarp, sbn]} onElegir={onElegir} />);
    expect(screen.getByRole("button", { name: /^SEACE/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /SUNARP/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("36 vigentes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /SBN/ }));
    expect(onElegir).toHaveBeenCalledWith("sbn");
  });
});

describe("TarjetaRequerimiento", () => {
  it("muestra tipo, zona, cierre, el término de referencia y el enlace para postular", () => {
    render(<TarjetaRequerimiento r={req()} portal="https://8uit.sunarp.gob.pe/portal" />);
    expect(screen.getByText("Bien")).toBeInTheDocument();
    expect(screen.getByText("SEDE CENTRAL")).toBeInTheDocument();
    expect(screen.getByText(/ADQUISICIÓN DE AGENDA/)).toBeInTheDocument();
    const tdr = screen.getByRole("link", { name: /Términos de referencia/ });
    expect(tdr).toHaveAttribute("href", "https://8uit.sunarp.gob.pe/storage/files2/x.pdf");
    expect(tdr).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByRole("link", { name: /Ir al portal para postular/ })).toHaveAttribute("href", "https://8uit.sunarp.gob.pe/portal");
  });

  it("si el requerimiento tiene ficha propia, el enlace dice 'Ver y postular'", () => {
    render(<TarjetaRequerimiento r={req({ enlace: "https://8uit.minsa.gob.pe/portal/3769/convocatoria" })} portal="https://8uit.minsa.gob.pe/portal" />);
    expect(screen.getByRole("link", { name: /Ver y postular/ })).toHaveAttribute("href", "https://8uit.minsa.gob.pe/portal/3769/convocatoria");
  });

  it("marca el plazo como urgente cuando cierra en menos de 3 h", () => {
    const ahora = Date.parse("2026-11-18T10:00:00-05:00");
    render(<TarjetaRequerimiento r={req({ vence: "2026-11-18T12:00:00-05:00" })} portal="x" ahora={ahora} />);
    expect(screen.getByText("Cierra en 2 h")).toHaveClass("badge-plazo-urgente");
  });
});

describe("VistaEntidad", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respuesta = (extra: Partial<RequerimientosResponse> = {}): RequerimientosResponse => ({
    entidad: { id: "sunarp", nombre: "SUNARP", nombreCompleto: sunarp.nombreCompleto, portal: sunarp.portal, soloEnlace: false, motivo: null, nota: null },
    actualizadoEn: new Date().toISOString(),
    error: null,
    zonas: ["SEDE CENTRAL", "ZONA N° IX"],
    data: [req(), req({ id: "2", tipo: "Servicio", titulo: "SERVICIO DE LIMPIEZA", zona: "ZONA N° IX" })],
    total: 2,
    page: 1,
    pageSize: 20,
    ...extra,
  });

  const simular = (r: RequerimientosResponse) => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => r }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("carga los requerimientos de la entidad y ofrece filtrar por zona", async () => {
    const f = simular(respuesta());
    render(<VistaEntidad entidad={sunarp} />);
    expect(await screen.findByText("SERVICIO DE LIMPIEZA")).toBeInTheDocument();
    expect(screen.getByText("2 requerimientos · cierran primero")).toBeInTheDocument();
    expect(String(f.mock.calls[0][0])).toContain("/api/entidades/sunarp/requerimientos");
    expect(screen.getByLabelText(/zona registral/i)).toBeInTheDocument();
  });

  it("pide al servidor el tipo elegido", async () => {
    const f = simular(respuesta());
    render(<VistaEntidad entidad={sunarp} />);
    await screen.findByText("SERVICIO DE LIMPIEZA");
    await userEvent.selectOptions(screen.getByLabelText(/tipo de contratación/i), "Servicio");
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).includes("tipo=Servicio"))).toBe(true));
  });

  it("explica cuando la entidad no tiene nada abierto", async () => {
    simular(respuesta({ data: [], total: 0 }));
    render(<VistaEntidad entidad={{ ...sbn, vigentes: 0 }} />);
    expect(await screen.findByText(/SBN no tiene requerimientos abiertos en este momento/)).toBeInTheDocument();
  });

  it("avisa si la última lectura del portal falló", async () => {
    simular(respuesta({ error: "fetch failed" }));
    render(<VistaEntidad entidad={sunarp} />);
    expect(await screen.findByText(/No se pudo leer el portal de SUNARP en la última revisión/)).toBeInTheDocument();
  });

  it("muestra el error si el servidor falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    render(<VistaEntidad entidad={sunarp} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo cargar la lista/);
  });

  it("un portal de acceso directo no consulta al servidor: explica el motivo y lleva al portal", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const pj: Entidad = { ...sunarp, id: "poder-judicial", nombre: "Poder Judicial", nombreCompleto: "Poder Judicial", portal: "https://sap.pj.gob.pe/x", soloEnlace: true, motivo: "Su buscador exige un captcha.", vigentes: 0 };
    render(<VistaEntidad entidad={pj} />);
    expect(screen.getByTestId("vista-enlace")).toHaveTextContent("Su buscador exige un captcha.");
    const enlace = screen.getByRole("link", { name: /Abrir el portal de Poder Judicial/ });
    expect(enlace).toHaveAttribute("href", "https://sap.pj.gob.pe/x");
    expect(enlace).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(f).not.toHaveBeenCalled();
  });

  it("muestra el aviso propio de la entidad (p. ej. contrataciones mayores a 8 UIT)", async () => {
    simular(respuesta());
    render(<VistaEntidad entidad={{ ...sunarp, nota: "Ojo: contrataciones MAYORES a 8 UIT." }} />);
    expect(await screen.findByText(/Ojo: contrataciones MAYORES a 8 UIT\./)).toBeInTheDocument();
  });
});

describe("SelectorFuente con acceso directo", () => {
  it("marca con ↗ (no con un contador) a los portales que solo se enlazan", () => {
    const pj: Entidad = { ...sunarp, id: "poder-judicial", nombre: "Poder Judicial", soloEnlace: true, vigentes: 0 };
    render(<SelectorFuente fuente={FUENTE_SEACE} entidades={[sunarp, pj]} onElegir={() => {}} />);
    expect(screen.getByLabelText("acceso directo al portal")).toBeInTheDocument();
    expect(screen.getByLabelText("36 vigentes")).toBeInTheDocument();
    expect(screen.queryByLabelText("0 vigentes")).not.toBeInTheDocument();
  });
});
