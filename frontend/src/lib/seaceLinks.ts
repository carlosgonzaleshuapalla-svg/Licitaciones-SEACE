// URL del detalle de una contratación en el portal público oficial de SEACE.
// Patrón confirmado navegando el sitio real: al hacer click en "Ver detalle"
// sobre una licitación, prod6.seace.gob.pe navega a esta misma ruta con el
// idContrato como último segmento.
export function urlOficialSeace(idContrato: number | string): string {
  return `https://prod6.seace.gob.pe/buscador-publico/contrataciones/${idContrato}`;
}
