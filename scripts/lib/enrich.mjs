/**
 * Reglas de normalizacion del catalogo: marcas limpias, nombres sin sufijos y
 * categorias propias. El sitio original no tiene taxonomia real (sus
 * "colecciones" son landing pages de marketing con 2 productos por pagina), asi
 * que las categorias se derivan del nombre del producto.
 */

/** Marca canonica: [alias en el nombre, marca mostrada]. El orden importa. */
const BRAND_RULES = [
  ['iphone|ipod|ipad|macbook|imac|airpods|apple', 'Apple'],
  ['galaxy', 'Samsung'],
  ['samsung', 'Samsung'],
  ['redmi|poco', 'Xiaomi'],
  ['xiaomi', 'Xiaomi'],
  ['realme', 'Realme'],
  // \\b es imprescindible: sin el, "Bicimoto" se detectaba como Motorola.
  ['motorola|\\bmoto g\\b|\\bmoto e\\b|playgo', 'Motorola'],
  ['huawei|harmony', 'Huawei'],
  ['honor', 'Honor'],
  ['nokia', 'Nokia'],
  ['oppo', 'Oppo'],
  ['vivo', 'Vivo'],
  ['infinix', 'Infinix'],
  ['tecno', 'Tecno'],
  ['\\bzte\\b|\\bblade\\b', 'ZTE'],
  ['alcatel', 'Alcatel'],
  ['kalley', 'Kalley'],
  ['jbl|harman', 'JBL'],
  ['sony', 'Sony'],
  ['bose', 'Bose'],
  ['sennheiser|audio-technica', 'Sennheiser'],
  ['logitech', 'Logitech'],
  ['epson', 'Epson'],
  ['canon', 'Canon'],
  ['nikon', 'Nikon'],
  ['dyson', 'Dyson'],
  ['lenovo|thinkpad', 'Lenovo'],
  ['asus|\\brog\\b', 'Asus'],
  ['\\bacer\\b', 'Acer'],
  ['dell|inspiron|vostro|alienware|xdseries', 'Dell'],
  ['\\bhp\\b|hewlett|laserjet|deskjet', 'HP'],
  ['anker', 'Anker'],
  ['xiaomi mi', 'Xiaomi'],
  ['\\bamd\\b|ryzen', 'AMD'],
  ['nvidia|geforce|rtx', 'Nvidia'],
  ['intel|\\bcore i[3579]\\b', 'Intel'],
  ['yeti', 'Yeti'],
  ['crown', 'Crown'],
  ['oster', 'Oster'],
  ['fenix', 'Fenix'],
  ['klarus', 'Klarus'],
  ['google|chromecast|nest', 'Google'],
  ['huawei free', 'Huawei'],
  ['baseus', 'Baseus'],
  ['ugreen', 'Ugreen'],
  ['rompex|inovo|bathtub', 'Rompex'],
  ['vgr', 'VGR'],
  ['duratop|jctop', 'JCTOP'],
  ['apple pencil', 'Apple'],
  ['xiaomi band|redmi band', 'Xiaomi'],
  ['samsung galaxy', 'Samsung'],
];

/** Devuelve la marca y el alias que la produjo (sirve para limpiar el nombre). */
function findBrand(name) {
  const lower = ` ${String(name).toLowerCase()} `;
  for (const [pattern, brand] of BRAND_RULES) {
    const match = lower.match(new RegExp(pattern, 'i'));
    if (match) return { brand, alias: match[0] };
  }
  return { brand: '', alias: '' };
}

export function detectBrand(name) {
  return findBrand(name).brand;
}

/**
 * Quita el prefijo de marca repetido: "Xiaomi Redmi Note 15" con marca Xiaomi
 * se muestra como "Redmi Note 15" porque la tarjeta ya imprime la marca.
 */
export function stripBrand(name, brand) {
  if (!brand) return name;
  const pattern = new RegExp(`^\\s*${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
  const stripped = name.replace(pattern, '').trim();
  return stripped.length >= 8 ? stripped : name;
}

/** Limpia el nombre: entidades, espacios, ruido de codigo inicial. */
export function cleanName(name) {
  return String(name || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[-–]\s*COP\s*\$?[\d.,]+\s*$/i, '')
    .replace(/\s*[-–]\s*la\s*tienda\s*de\s*alex\s*$/i, '')
    .replace(/^[\s_\-–|:.]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Taxonomia propia. El orden importa: gana la primera categoria que coincide,
 * y un producto puede quedar en varias si aparece en distintas familias.
 */
export const CATEGORIES = [
  {
    name: 'Celulares y Smartphones',
    icon: '📱',
    keywords: [
      'iphone', 'galaxy', 'celular', 'smartphone', 'redmi', 'poco', 'moto g', 'moto e',
      'alcatel', 'nokia', 'oppo', 'vivo', 'realme', 'infinix', 'tecno', 'zte', 'honor',
      'huawei nova', 'huawei p', 'huawei y', 'playgo', 'android', 'dual sim',
      'smart phone', 'movil', 'telefono celular', 'pixel', 'nothing phone', 'mate 80',
      'element 5', 'black 1 128', 'corn 4g', 'airtag', 'freebuds', 'freeclip', 'gt 5 pro',
    ],
  },
  {
    name: 'Tablets y iPads',
    icon: '🖥️',
    keywords: ['ipad', 'tablet', 'tab ', 'galaxy tab', 'matepad', 'kindle', 'lectora', 'xpad'],
  },
  {
    name: 'Portatiles y MacBooks',
    icon: '💻',
    keywords: ['portatil', 'laptop', 'notebook', 'macbook', 'mac neo', 'macbook air', 'ultrabook', 'pc gaming', 'computador'],
  },
  {
    name: 'Monitores y Televisores',
    icon: '🖥️',
    keywords: [
      'monitor', 'pantalla', 'televisor', 'smart tv', 'tv ', 'led tv', 'oled', 'display',
      'proyector', 'iffalcon',
    ],
  },
  {
    name: 'Audio y Microfonos',
    icon: '🔊',
    keywords: [
      'audifono', 'audífono', 'headphone', 'headset', 'earphone', 'earbud', 'in-ear', 'auricular',
      'parlante', 'altavoz', 'bocina', 'bluetooth', 'jbl', 'airpods', 'sony wh', 'sonido',
      'microfono', 'micrófono', 'mic', 'karaoke', 'amplificador', 'bafle', 'ecualizador',
      'radio', 'vinil', 'sintetizador', 'audio', 'sonoro', 'loudspeaker', 'barras de sonido',
      'cabina', 'sonivox', 'earpods', 'weibo', 'combo inalambrico', 'diadema bose',
    ],
  },
  {
    name: 'Accesorios de Computador',
    icon: '🖱️',
    keywords: [
      'mouse', 'raton', 'teclado', 'keyboard', 'memoria', 'usb', 'cable', 'cargador', 'power bank',
      'adaptador', 'camara web', 'webcam', 'microsd', 'sd ', 'ssd', 'disco duro', 'disquete',
      'dongle', 'hub', 'splitter', 'soporte monitor', 'base de laptop', 'pad mouse', 'mousepad',
      'teclado mecanico', 'cable hdmi', 'cable de red', 'papel bond', 'toner', 'cartucho',
      'router', 'wifi', 'wi-fi', 'access point', 'antena wifi', 'impresora 3d', 'plotter',
    ],
  },
  {
    name: 'Smartwatches y Relojes',
    icon: '⌚',
    keywords: [
      'smartwatch', 'smart watch', 'reloj', 'watch', 'wearable', 'mi band', 'apple watch',
      'amazfit', 'band fit', 'fit 3 band', 'gt 6 pro', 'gt 5 pro', 'smart band',
    ],
  },
  {
    name: 'Gaming y Consolas',
    icon: '🎮',
    keywords: [
      'consola', 'gamepad', 'joystick', 'xbox', 'playstation', 'ps4', 'ps5', 'nintendo',
      'gamer', 'gaming', 'game box', 'gameboy', 'game player', 'dualsense', 'joy pad',
      'control inalambrico', 'control universal', 'control de play', 'control curvo',
      'control de pc', 'teclado gamer', 'manejador', 'atari', 'sega', 'mp5', 'tetris',
      'control pc', 'ipega', 'control x3', 'control inalam',
    ],
  },
  {
    name: 'Soportes y Bases',
    icon: '🖥️',
    keywords: [
      'base fija', 'base pedestal', 'base doble brazo', 'soporte', 'holder', 'base portátil',
      'base portátil', 'base gatillo', 'pedestal', 'brazo', 'montaje', 'base para monitor',
      'base refrigerante', 'soporte de tv', 'mesa para tv', 'rack', 'base an', 'base p4',
    ],
  },
  {
    name: 'Accesorios de Celular',
    icon: '🔌',
    keywords: [
      'airtag', 'pencil pro', 'apple pencil', 'osmo', 'cargador iphone', 'cargador samsung',
      'microsd', 'celular', 'telefono', 'sim', 'memoria micro', 'cover', 'carcasa', 'fundas',
      'protector de pantalla', 'vidrio templado',
    ],
  },
  {
    name: 'Seguridad y Domotica',
    icon: '🔒',
    keywords: [
      'control de acceso', 'biometrico', 'huella', 'intercomunicador', 'vigilancia',
      'seguridad', 'alarma', 'cerrajuria', 'llave electronica', 'smart lock', 'cerradura',
      'interfon', 'videoportero',
    ],
  },
  {
    name: 'Camaras y Fotografia',
    icon: '📷',
    keywords: [
      'camara', 'cámara', 'camra', 'fotograf', 'lente', 'tripod', 'dron', 'gimbal',
      'ring light', 'selfie', 'lupa', 'microscopio', 'osmo', 'capturadora de video',
      'estabilizador', 'gafas vr',
    ],
  },
  {
    name: 'Impresoras y Escáneres',
    icon: '🖨️',
    keywords: ['impresor', 'impresora', 'tinta', 'escaner', 'escáner', 'plotter', ' multifuncion'],
  },
  {
    name: 'Hogar y Electrodomesticos',
    icon: '🍳',
    keywords: [
      'nevera', 'refrigerador', 'lavadora', 'secadora', 'aspiradora', 'microondas', 'horno', 'plancha',
      'cafetera', 'freidora', 'ventilador', 'calentador', 'licuadora', 'batidora', 'sarten', 'olla',
      'paila', 'tostador', 'sandwich', 'waffle', 'popper', 'purificador', 'humidificador', 'bebe',
      'termo', 'vaso', 'vajilla', 'cocina', 'domestico', 'electrodomestico', 'grill', 'sandwichera',
      'frazada', 'edredon', 'cojin', 'alfombra', 'cama', 'closet', 'organizador', 'carrito', 'helado',
      'aire acondicionado', 'split', 'congelador', 'enfriador', 'dispensador de agua', 'hervidor',
      'chocolatera', 'exprimidor', 'crispetera', 'cuchillo', 'cubierto', 'escurridora', 'jabonera',
      'encendedor', 'cesta', 'maleta', 'mochila', 'bolso', 'fuente de chocolate', 'almohada',
      'humificador', 'humidificador', 'humigicador', 'minibar', 'nevecon', 'nevecón', 'vitrina',
      'lonchera', 'waflera', 'molino',
    ],
  },
  {
    name: 'Iluminacion y Energia',
    icon: '💡',
    keywords: [
      'led', 'lampara', 'lámpara', 'foco', 'panel solar', 'bateria', 'batería', 'inversor',
      'ups', 'generador', 'planta electrica', 'antena de tv', 'antena a terrestrial',
      'torre de control', 'ahumador', 'extractor', 'vela', 'linterna', 'reflector', 'poste',
      'tuberia led', 'bombillo', 'aro luz',
      'aro de media luna', 'aro luz estrella', 'enchufe inteligente', 'estación de energía',
      'energia solar', 'solar portatil', 'decodificador', 'luz de relleno', 'copa en t',
    ],
  },
  {
    name: 'Herramientas y Maquineria',
    icon: '🛠️',
    keywords: [
      'herramienta', 'taladro', 'pistola', 'pintar', 'pintura', 'brocha', 'rodillo', 'compresor',
      'llave', 'multimetro', 'abdominal', 'soldadora', 'corte', 'lija', 'destornillador', 'alicate',
      'juego de herramientas', 'aire comprimido', 'pulidora', 'escopillo', 'escalera', 'carretilla',
      'nivel', 'bomba', 'motor', 'maquina', 'maquinaria', 'cinta', 'empaque', 'herrajes', 'llave impacto',
      'boquilla', 'airless', 'cizalla', 'serrucho', 'pinza', 'llana', 'atomillador', 'sierra',
      'desgarrador', 'punzon', 'electrodo', 'fumigadora', 'cortador', 'atornillador', 'polichadora',
      'máquina de', 'hidrolavadora', 'caladora', 'taladro percutor', 'sierra circular',
    ],
  },
  {
    name: 'Motos y Vehiculos',
    icon: '🏍️',
    keywords: ['moto', 'helicoptero', 'casco', 'llanta', 'neumatico', 'caucho', 'patineta', 'patinete', 'bici', 'bicicleta', 'patin', 'carro', 'vehiculo'],
  },
  {
    name: 'Juguetes y diversion',
    icon: '🧸',
    keywords: ['juguete', 'muñeca', 'lego', 'rompecabezas', 'peluche', 'cubo', 'balon', 'fútbol', 'futbol', 'bici', 'puzzle', 'figura'],
  },
  {
    name: 'Deportes y Fitness',
    icon: '🏋️',
    keywords: ['gym', 'pesas', 'yoga', 'balon', 'caja', 'abdominal', 'cardio', 'deporte', 'fitness', 'entrenamiento', 'poleas'],
  },
  {
    name: 'Belleza y Cuidado Personal',
    icon: '💇',
    keywords: [
      'afeitadora', 'shaver', 'perfume', 'barber', 'masaje', 'secador', 'cepillo', 'plancha de pelo',
      'rasuradora', 'belleza', 'cosmetico', 'skincare', 'crema', 'uñas', 'manicure', 'ondulador',
      'rizadora', 'diadema', 'encrespador', 'depiladora', 'keratina', 'facial', 'geemy', 'dermawand',
      'bascula', 'báscula', 'cera en perla', 'capilar', 'afeitar', 'maricura', 'nano titanium',
      'aguacte', 'liss',
    ],
  },
  {
    name: 'Papeleria y Otros',
    icon: '🗂️',
    keywords: [
      'cuaderno', 'libro', 'papel', 'boligrafo', 'bolígrafo', 'escritorio', 'organizador',
      'decoracion', 'regalo', 'pack', 'paquete', 'kit', 'unidad', 'sirve para', 'juego de',
      'juguete', 'muñeca', 'lego', 'rompecabezas', 'peluche', 'cubo', 'puzzle', 'figura',
    ],
  },
];

const OTHER = { name: 'Otros productos', icon: '📦', keywords: [] };

/**
 * El sitio original nombra muchos celulares solo por su codigo de modelo
 * ("Note 60 Pro 8+256GB", "Magic 8 Lite", "G85 5G"). La combinacion de
 * almacenamiento con un nombre corto es una senal muy fiable de telefono.
 */
const PHONE_LIKE = /(\d{1,4}\s?GB\s*[+\/]|\b\d{1,4}\s?GB\b\s*$)/i;
const PHONE_SERIES = /\b(magic|play|note|hot|edge|smart|pura|xpad|gt|g\d{2}|x\d{1,2}[a-z]?|h400|400)\b\s*(?:\d|\b)/i;

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundary = '(?<![a-z0-9áéíóúüñ])';
const keywordCache = new Map();

/**
 * Busca la palabra clave exigiendo que no este pegada al final de otra
 * palabra. Sin esta comprobacion "motorola" activaba "motor" y "moto"
 * (Herramientas y Motos) y "bicimoto" activaba "bici" (Juguetes).
 * No se exige limite a la derecha para no romper los plurales
 * ("audífonos" sigue encontrando "audífono").
 */
function keywordMatch(hay, word) {
  if (!word) return false;
  let re = keywordCache.get(word);
  if (!re) {
    re = new RegExp(`${boundary}${escapeRe(word.trim()).replace(/\\\s+/g, '\\s+')}`, 'i');
    keywordCache.set(word, re);
  }
  return re.test(hay);
}

/** Quita el prefijo tecnico de las colecciones del sitio original. */
function cleanCollectionLabel(label) {
  return String(label)
    .replace(/^collections\s*\/\s*/i, '')
    .replace(/^\d{6,}\s*\/\s*/, '')
    .replace(/^\d{6,}\s+/, '')
    .trim();
}

export function deriveCategories(product) {
  const name = String(product.name || '');
  const brand = String(product.brand || '');
  let hay = ` ${name} ${brand} `.toLowerCase();

  // La marca no debe clasificar. "Cargador Motorola Turbo Power" contiene
  // "motor" y "moto" dentro de "Motorola", y eso lo mandaba a Herramientas
  // y a Motos. Se borra el token exacto de la marca, no sus pedazos.
  if (brand) hay = hay.replace(new RegExp(escapeRe(brand.toLowerCase()), 'g'), ' ');

  const found = [];

  for (const category of CATEGORIES) {
    if (category.keywords.some((word) => keywordMatch(hay, word))) {
      found.push({ name: category.name, icon: category.icon, source: 'derived' });
    }
  }
  if (!found.length && PHONE_LIKE.test(name) && PHONE_SERIES.test(name)) {
    const phones = CATEGORIES.find((c) => c.name === 'Celulares y Smartphones');
    found.push({ name: phones.name, icon: phones.icon, source: 'derived' });
  }
  for (const label of product.collections || []) {
    const clean = cleanCollectionLabel(label);
    if (clean && !found.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      found.push({ name: clean, icon: '🏷️', source: 'collection' });
    }
  }
  if (!found.length) found.push({ ...OTHER, source: 'derived' });
  return found.slice(0, 4);
}

/** Aplica todo el saneo a un producto del catalogo. */
export function enrichProduct(product) {
  const name = cleanName(product.name);
  const { brand } = findBrand(name);
  // cleanName otra vez: al quitar la marca puede quedar "- Edge 50 Fusion".
  return {
    ...product,
    name: cleanName(stripBrand(name, brand)),
    brand,
    categories: deriveCategories({ ...product, name, brand }),
  };
}

/** Reconstruye el listado de categorias con sus conteos. */
export function buildCategories(products) {
  const counts = new Map();
  for (const product of products) {
    for (const category of product.categories || []) {
      counts.set(category.name, (counts.get(category.name) || 0) + 1);
    }
  }
  const known = new Map(CATEGORIES.map((c) => [c.name, c.icon]));
  known.set(OTHER.name, OTHER.icon);
  return [...counts.entries()]
    .map(([name, total]) => ({ name, products: total, icon: known.get(name) || '🏷️' }))
    .sort((a, b) => b.products - a.products);
}
