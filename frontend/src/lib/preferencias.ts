// Filtros que se recuerdan entre visitas (ciudad, tipo y orden). Se guardan en
// el navegador de quien usa la página; si el almacenamiento no está disponible
// (modo privado, bloqueado) simplemente no se recuerda nada.
import type { ObjetoContrato, OrdenLista } from "../types/api";

const CLAVE = "seace-filtros-v1";

export interface Preferencias {
  departamento: string;
  objeto: ObjetoContrato | "";
  orden: OrdenLista;
}

export const PREFERENCIAS_POR_DEFECTO: Preferencias = {
  departamento: "",
  objeto: "Bien",
  orden: "publicacion",
};

export function leerPreferencias(almacen: Pick<Storage, "getItem"> | null = seguro()): Preferencias {
  try {
    const crudo = almacen?.getItem(CLAVE);
    if (!crudo) return PREFERENCIAS_POR_DEFECTO;
    const v = JSON.parse(crudo) as Partial<Preferencias>;
    return {
      departamento:
        typeof v.departamento === "string" && v.departamento.length <= 100 ? v.departamento : "",
      objeto: v.objeto === "" || v.objeto === "Bien" || v.objeto === "Servicio" ? v.objeto : "Bien",
      orden: v.orden === "cierre" ? "cierre" : "publicacion",
    };
  } catch {
    return PREFERENCIAS_POR_DEFECTO;
  }
}

export function guardarPreferencias(
  prefs: Preferencias,
  almacen: Pick<Storage, "setItem"> | null = seguro(),
): void {
  try {
    almacen?.setItem(CLAVE, JSON.stringify(prefs));
  } catch {
    // sin almacenamiento: no pasa nada
  }
}

function seguro(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
