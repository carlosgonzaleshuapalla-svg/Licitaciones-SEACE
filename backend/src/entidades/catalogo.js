/**
 * Entidades del Estado que publican sus compras en su propio portal. Para agregar
 * otra del mismo tipo basta con una fila aquí: `lector` elige el parser
 * ('clasico' | 'sunarp' | 'minsa' | 'pnsr' | 'jne', ver parsers.js).
 *
 * `lector: 'enlace'` son portales que NO se pueden leer desde aquí sin saltarse
 * una protección (captcha, reCAPTCHA, cabecera secreta del propio portal): no se
 * intenta; se muestran como acceso directo con el motivo (`motivo`).
 * `nota` es un aviso que se muestra junto a la entidad (p. ej. "mayores a 8 UIT").
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
  {
    id: 'otass',
    nombre: 'OTASS',
    nombreCompleto: 'Organismo Técnico de la Administración de los Servicios de Saneamiento',
    portal: 'https://8uit.otass.gob.pe/portal',
    lector: 'clasico',
  },
  {
    id: 'pnsr',
    nombre: 'Vivienda · PNSR',
    nombreCompleto: 'Programa Nacional de Saneamiento Rural (Ministerio de Vivienda)',
    portal: 'https://aplicacionespnsr.vivienda.gob.pe/spsPNSR/consulta',
    api: 'https://aplicacionespnsr.vivienda.gob.pe/spsPNSR/',
    lector: 'pnsr',
  },
  {
    id: 'jne',
    nombre: 'JNE',
    nombreCompleto: 'Jurado Nacional de Elecciones',
    portal: 'https://web.jne.gob.pe/contratacionesbs/contratacion',
    api: 'https://web.jne.gob.pe/contratacionesbs/',
    lector: 'jne',
    nota:
      'Ojo: el JNE publica aquí contrataciones MAYORES a 8 UIT para las elecciones de 2026 (Ley 32513). ' +
      'Se postula dentro de su plataforma, en la etapa de "Presentación de ofertas".',
  },
  {
    id: 'poder-judicial',
    nombre: 'Poder Judicial',
    nombreCompleto: 'Poder Judicial · Portal de Abastecimiento (cortes superiores y gerencia general)',
    portal: 'https://sap.pj.gob.pe/portalabastecimiento-web/Convocatorias8uit',
    lector: 'enlace',
    motivo: 'Su buscador exige resolver un captcha, y eso no se puede automatizar. Entra directo y busca ahí.',
  },
  {
    id: 'lima-compra',
    nombre: 'Lima Compra',
    nombreCompleto: 'Municipalidad Metropolitana de Lima y sus empresas (EMAPE, SAT, SERPAR, EMMSA y otras)',
    portal: 'https://limacompra.munlima.gob.pe/',
    lector: 'enlace',
    motivo: 'Su lista está protegida con reCAPTCHA y no se puede leer desde aquí. En la portada de Lima Compra ves cuántas convocatorias vigentes tiene cada entidad.',
  },
  {
    id: 'pvn',
    nombre: 'Provías Nacional',
    nombreCompleto: 'Proyecto Especial de Infraestructura de Transporte Nacional (PVN)',
    portal: 'https://cms.pvn.gob.pe:10443/PortalProceso/Forms/frmContratacionMenor8UIT_Ex',
    lector: 'enlace',
    motivo: 'Su sistema solo entrega los datos a su propia página con una cabecera interna; no se puede leer desde aquí.',
  },
  {
    id: 'midagri',
    nombre: 'MIDAGRI',
    nombreCompleto: 'Ministerio de Desarrollo Agrario y Riego',
    portal: 'https://www.midagri.gob.pe/portal/contrataciones-menores-a-8-uit',
    lector: 'enlace',
    motivo: 'Publica un PDF suelto por requerimiento, ordenado por mes, y la fecha de cierre solo está dentro de cada PDF.',
  },
  {
    id: 'senamhi',
    nombre: 'SENAMHI',
    nombreCompleto: 'Servicio Nacional de Meteorología e Hidrología del Perú',
    portal: 'https://www.senamhi.gob.pe/?p=contrataciones-8uit',
    lector: 'enlace',
    motivo: 'Su lista se arma con un sistema propio que no se pudo leer de forma automática. Entra directo al portal.',
  },
];

export const esSoloEnlace = (e) => e.lector === 'enlace';

export const entidadPorId = (id) => ENTIDADES.find((e) => e.id === id) ?? null;
