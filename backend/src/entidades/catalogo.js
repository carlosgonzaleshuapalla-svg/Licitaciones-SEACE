/**
 * Entidades del Estado cuyos requerimientos de compras menores o iguales a
 * 8 UIT se pueden leer sin sesión en su propio portal. Para agregar otra del
 * mismo tipo basta con una fila aquí: `lector` elige el parser
 * ('clasico' | 'sunarp' | 'minsa', ver parsers.js).
 *
 * SEACE (el "buscador público" de contrataciones menores) NO está aquí: tiene
 * su propia base y su propio flujo; este catálogo son las demás entidades.
 */
export const ENTIDADES = [
  {
    id: 'sunarp',
    nombre: 'SUNARP',
    nombreCompleto: 'Superintendencia Nacional de los Registros Públicos',
    portal: 'https://8uit.sunarp.gob.pe/portal',
    lector: 'sunarp',
  },
  {
    id: 'sbn',
    nombre: 'SBN',
    nombreCompleto: 'Superintendencia Nacional de Bienes Estatales',
    portal: 'https://8uit.sbn.gob.pe/portal',
    lector: 'clasico',
  },
  {
    id: 'sanipes',
    nombre: 'SANIPES',
    nombreCompleto: 'Autoridad Nacional de Sanidad e Inocuidad en Pesca y Acuicultura',
    portal: 'https://requerimiento8uit.sanipes.gob.pe/portal',
    lector: 'clasico',
  },
  {
    id: 'minsa',
    nombre: 'MINSA',
    nombreCompleto: 'Ministerio de Salud',
    portal: 'https://8uit.minsa.gob.pe/portal',
    lector: 'minsa',
  },
  {
    id: 'hospital-ventanilla',
    nombre: 'Hospital de Ventanilla',
    nombreCompleto: 'Hospital de Ventanilla',
    portal: 'https://8uit.hospitaldeventanilla.gob.pe/8uits/public/portal',
    lector: 'clasico',
  },
];

export const entidadPorId = (id) => ENTIDADES.find((e) => e.id === id) ?? null;
