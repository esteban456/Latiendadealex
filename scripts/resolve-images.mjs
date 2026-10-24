/**
 * Resuelve la URL de imagen de cada producto a partir de su pagina, sin
 * descargar la imagen. Hace falta porque:
 *
 *  1. El CDN del sitio anterior corta el acceso a esta IP tras unas 1.200
 *     peticiones, asi que no se puede comprobar cada imagen por HTTP.
 *  2. Al reescribir URLs a ciegas se acabam eligiendo miniaturas de 192x192,
 *     que se ven mal en la ficha de producto.
 *
 * Aqui solo se leen las paginas (que siguen respondiendo) y se elige la foto
 * grande del producto, que es la que el sitio usa como portada.
 *
 *   node scripts/resolve-images.mjs                  # todos los pendientes
 *   node scripts/resolve-images.mjs --sample 10      # prueba rapida
 *   node scripts/resolve-images.mjs --keep-remote    # no cambia el catalogo
 */
import { readFile, writeFile } from 'node:fs/promises';

const ARGV = process.argv.slice(2);
const hasFlag = (name) => ARGV.includes(name);
const optNumber = (name, fallback) => {
  const i = ARGV.indexOf(name);
  return i > -1 ? Number(ARGV[i + 1]) : fallback;
};

const SAMPLE = optNumber('--sample', 0);
const CONCURRENCY = optNumber('--concurrency', 4);
const KEEP_REMOTE = hasFlag('--keep-remote');
const CATALOG = 'data/catalog.json';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST = /https:\/\/[a-z0-9.-]*(?:cloudfront|shopify|amazonaws|wix)\.net\/[^"'\\\s)]+/g;

// OJO: la foto del producto muchas veces NO lleva extension
// (`.../filters:quality(80)/af2c811d-0c8d-...`). Por eso no se puede filtrar
// por `.png`/`.webp`: se filtra por la ruta `fit-in/<ancho>x<alto>/`, que es la
// que genera el CDN. Si se filtra por extension, el unico resultado es el logo
// del sitio y todos los productos acaban con la misma imagen.
const IS_IMAGE = /\/fit-in\/\d+x\d+\//i;

// El sitio sirve la foto del producto en 700x700 o 1200x1200. Se descartan
// 192x192 y 384x384 porque son miniaturas de icono/navegacion, no del producto.
const MIN_SIZE = 600;
const sizeOf = (url) => {
  const m = /\/fit-in\/(\d+)x(\d+)\//.exec(url);
  return m ? Math.min(Number(m[1]), Number(m[2])) : 0;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url, intentos = 4) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      if (intento === intentos) return null;
      await sleep(1500 * intento * intento);
    }
  }
  return null;
}

/** Elige la mejor foto del producto: grande, y sin repetir variantes del mismo
 *  asset en distintos tamanos (mismo nombre de archivo). */
function elegirImagen(urls) {
  const candidates = [...new Set(urls.filter((u) => IS_IMAGE.test(u) && sizeOf(u) >= MIN_SIZE))];
  if (!candidates.length) return null;

  const porArchivo = new Map();
  for (const url of candidates) {
    const archivo = url.split('/').pop();
    const actual = porArchivo.get(archivo);
    if (!actual || sizeOf(url) > sizeOf(actual)) porArchivo.set(archivo, url);
  }

  const únicas = [...new Set(porArchivo.values())];
  únicas.sort((a, b) => sizeOf(b) - sizeOf(a));
  return únicas;
}

const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));

// Solo los que siguen en el CDN. Las ya bajadas al disco no se tocan.
const pending = catalog.products.filter((p) => p.image?.startsWith('http'));
const queue = SAMPLE ? pending.slice(0, SAMPLE) : [...pending];
const TOTAL = queue.length;

console.log(`Resolviendo ${TOTAL} producto(s) de ${pending.length} en el CDN...`);

let fixed = 0;
let hopeless = 0;
let done = 0;

// OJO: esta funcion no puede llamarse `process`. En un modulo, una declaracion
// de function se hoiste y tapa el global `process` de Node en todo el
// archivo, y `process.argv` quedaria undefined.
async function revisarProducto(product) {
  const html = await fetchPage(product.sourceUrl);
  const urls = html ? elegirImagen([...html.matchAll(HOST)].map((m) => m[0])) : null;

  if (urls?.length) {
    product.image = urls[0];
    product.images = urls;
    fixed++;
  } else {
    hopeless++;
  }

  done++;
  if (done % 25 === 0 || done === TOTAL) {
    console.log(
      `  ${done}/${TOTAL} (${Math.round((done / TOTAL) * 100)}%)  resueltas ${fixed}  sin foto ${hopeless}`,
    );
    // Guardado parcial: si se interrumpe, no se pierde lo ya hecho.
    if (!KEEP_REMOTE && done % 100 === 0) {
      await writeFile(CATALOG, JSON.stringify(catalog, null, 2), 'utf8');
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, TOTAL) }, async () => {
    while (queue.length) await revisarProducto(queue.shift());
  }),
);

if (KEEP_REMOTE) {
  console.log('\n--keep-remote: el catalogo no se modifico.');
} else {
  await writeFile(CATALOG, JSON.stringify(catalog, null, 2), 'utf8');
  console.log('\nCatalogo actualizado.');
}

const local = catalog.products.filter((p) => p.image && !p.image.startsWith('http')).length;
const remote = catalog.products.filter((p) => p.image?.startsWith('http')).length;
const none = catalog.products.filter((p) => !p.image).length;
console.log(`\nResueltas ${fixed} | sin foto ${hopeless}`);
console.log(`Catalogo -> CDN ${remote} | ya bajadas ${local} | sin imagen ${none}`);
