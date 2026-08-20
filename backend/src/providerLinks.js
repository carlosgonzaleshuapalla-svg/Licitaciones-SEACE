/**
 * Generador de enlaces de proveedores por item.
 *
 * No se scrapea precios de terceros (frágil / sin permiso / no verificable).
 * En su lugar se generan URLs de búsqueda reales hacia marketplaces
 * peruanos, calculadas al vuelo cuando se sirve el detalle de un tender
 * (no se persisten en DB).
 *
 * La "categoría" es un clasificador por palabras clave sobre nomCubso,
 * nada de IA/NLP: buscamos substrings conocidos y, si hay match, agregamos
 * un tercer enlace a una tienda especializada. Si no hay match claro se
 * omite el tercer enlace en vez de inventar una tienda irrelevante.
 */

const CATEGORIAS = [
  {
    categoria: 'Ferretería / eléctrico',
    keywords: [
      'cable', 'conector', 'electric', 'riel', 'interruptor', 'tomacorriente',
      'foco', 'lampara', 'lámpara', 'tuberia', 'tubería', 'pvc', 'tornillo',
      'valvula', 'válvula', 'jack rj45', 'llave termica', 'llave térmica',
      'caja de paso', 'enchufe', 'fluorescente', 'reflector',
    ],
    tienda: {
      nombre: 'Sodimac',
      buildUrl: (q) => `https://www.sodimac.com.pe/sodimac-pe/search?Ntt=${q}`,
    },
  },
  {
    categoria: 'Útiles de oficina',
    keywords: [
      'papel', 'oficina', 'formato', 'impresion', 'impresión', 'archivador',
      'lapicero', 'lapiz', 'lápiz', 'folder', 'engrapador', 'cuaderno',
      'carpeta', 'sobre manila', 'cinta adhesiva', 'plumon', 'plumón',
    ],
    tienda: {
      nombre: 'Tai Loy',
      buildUrl: (q) => `https://www.tailoy.com.pe/catalogsearch/result/?q=${q}`,
    },
  },
  {
    categoria: 'Cómputo',
    keywords: [
      'laptop', 'computadora', 'impresora', 'toner', 'tóner', 'tinta',
      'monitor', 'teclado', 'mouse', 'cpu', 'disco duro', 'memoria ram',
      'usb', 'cartucho', 'notebook', 'scanner', 'escáner',
    ],
    tienda: {
      nombre: 'Coolbox',
      buildUrl: (q) => `https://www.coolbox.pe/catalogsearch/result/?q=${q}`,
    },
  },
];

const DIACRITICOS_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizar(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICOS_REGEX, ''); // quita tildes para comparar sin acentos
}

/** Devuelve la categoría (con su tienda) que matchea por palabra clave, o null. */
export function clasificarProducto(nomCubso) {
  const texto = normalizar(nomCubso);
  for (const entry of CATEGORIAS) {
    const match = entry.keywords.some((kw) => texto.includes(normalizar(kw)));
    if (match) return entry;
  }
  return null;
}

/**
 * Genera la lista de proveedores sugeridos para un nombre de producto
 * (nomCubso). Siempre incluye MercadoLibre Perú y Google Shopping; agrega
 * una tienda especializada solo si hay match de categoría.
 */
export function generarProveedores(nomCubso) {
  const texto = (nomCubso || '').trim();
  const q = encodeURIComponent(texto);

  const proveedores = [
    {
      nombre: 'MercadoLibre Perú',
      url: `https://listado.mercadolibre.com.pe/${q}`,
      categoria: 'Marketplace general',
    },
    {
      nombre: 'Google Shopping',
      url: `https://www.google.com/search?tbm=shop&q=${q}`,
      categoria: 'Marketplace general',
    },
  ];

  const match = clasificarProducto(texto);
  if (match) {
    proveedores.push({
      nombre: match.tienda.nombre,
      url: match.tienda.buildUrl(q),
      categoria: match.categoria,
    });
  }

  return proveedores;
}
