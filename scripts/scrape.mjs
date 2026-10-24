/**
 * Migracion del catalogo: La Tienda de Alex -> data/catalog.json
 *
 *   node scripts/scrape.mjs --limit 40        # rapido, para probar
 *   node scripts/scrape.mjs                   # catalogo completo (~1950 productos)
 *   node scripts/scrape.mjs --concurrency 8
 *
 * Las imagenes NO se descargan: se guardan sus URLs de CloudFront y la pagina
 * las carga directamente. De este archivo solo salen los datos.
 *
 * Nota sobre precios: el JSON-LD de la tienda original trae "price": 1 en
 * varios productos (placeholder). El precio real va en el <title>, con formato
 * "NOMBRE - COP 3.300.000". Por eso el <title> manda y el JSON-LD solo se usa
 * para las variantes (contado / credito) cuando son consistentes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { enrichProduct, buildCategories } from './lib/enrich.mjs';

const HOST = 'https://latiendadealex.ecometri.shop';
const STORE = '573124885850';
const SUFFIX = /\s*[-–]\s*la\s*tienda\s*de\s*alex\s*$/i;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const LIMIT = Number(arg('limit', Infinity));
const OUT = arg('out', 'data/catalog.json');
const CONCURRENCY = Number(arg('concurrency', 8));
const CAT_PAGES = Number(arg('cat-pages', 4));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404 || res.status === 410) return null;
      if (res.status === 429) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === tries - 1) {
        console.warn(`  ! ${url} -> ${err.message}`);
        return null;
      }
      await sleep(700 * (attempt + 1));
    }
  }
  return null;
}

async function pool(items, size, worker, onProgress) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
      if (onProgress) onProgress(index + 1);
    }
  });
  await Promise.all(runners);
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1].trim();
    try {
      out.push(JSON.parse(raw));
    } catch {
      try {
        out.push(JSON.parse(raw.replace(/,\s*$/, '')));
      } catch {
        /* bloque roto: se ignora */
      }
    }
  }
  return out;
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Ntilde;/gi, 'Ñ')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

const stripHtml = (html = '') =>
  decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** "COP 3.300.000" -> 3300000 */
function parseCop(text) {
  if (!text) return 0;
  const match = String(text).match(/COP\s*\$?\s*([\d.,]+)/i) || String(text).match(/\$\s*([\d.,]+)/);
  if (!match) return 0;
  const digits = match[1].replace(/[^\d]/g, '');
  const value = Number(digits);
  return Number.isFinite(value) ? value : 0;
}

const IMAGE_RE = /^(.*?)\/fit-in\/\d+x\d+\/(?:filters:quality\(\d+\)\/)?(.+)$/;
function resize(url, size) {
  if (!url) return '';
  const match = url.match(IMAGE_RE);
  if (!match) return url;
  return `${match[1]}/fit-in/${size}x${size}/filters:quality(80)/${match[2]}`;
}

function prettify(slug) {
  const small = ['de', 'del', 'la', 'las', 'el', 'los', 'y', 'para', 'con', 'en', 'a', 'tu', 'un', 'una', 'su'];
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => (small.includes(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

const BRANDS = [
  'iphone', 'ipad', 'macbook', 'apple', 'airpods', 'samsung', 'galaxy', 'xiaomi', 'redmi', 'poco',
  'huawei', 'honor', 'motorola', 'nokia', 'oppo', 'vivo', 'realme', 'infinix', 'tecno', 'zte', 'kalley',
  'jbl', 'sony', 'bose', 'epson', 'canon', 'nikon', 'dyson', 'lenovo', 'asus', 'acer', 'dell', 'hp',
  'logitech', 'anker', 'yeti', 'crown', 'oster', 'fenix', 'klarus', 'intel', 'amd', 'nvidia',
];

/** Con limites de palabra: "inteligente" no debe devolver "Intel". */
function guessBrand(name) {
  const lower = ` ${name.toLowerCase()} `;
  const hit = BRANDS.find((b) => new RegExp(`\\b${b}\\b`, 'i').test(lower));
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : '';
}

function mapProduct(slug, html) {
  const ld = jsonLdBlocks(html).find((b) => b?.['@type'] === 'Product');

  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
  const titlePrice = parseCop(titleTag);
  // "NOMBRE - COP 3.300.000" -> "NOMBRE"
  const title = decodeEntities(titleTag)
    .replace(SUFFIX, '')
    .replace(/\s*[-–|]\s*COP\s*\$?[\d.,]+\s*$/i, '')
    .replace(/^[\s_\-–|]+/, '')
    .trim();

  const ldName = decodeEntities(ld?.name || '').trim();
  const name = (title || ldName || prettify(slug)).replace(/\s+/g, ' ').trim();

  const offers = Array.isArray(ld?.offers) ? ld.offers : ld?.offers ? [ld.offers] : [];
  const ldVariants = offers
    .map((offer) => ({
      sku: decodeEntities(offer.sku || '').trim() || null,
      label: decodeEntities(offer.name || 'Unico').trim(),
      price: parseCop(offer.price) || Number(offer.price) || 0,
      available: /InStock/i.test(offer.availability || ''),
    }))
    .filter((v) => v.price > 0);

  // El <title> es la fuente de verdad: si el JSON-LD no cuadra (placeholder 1),
  // se descarta y se arma una variante unica con el precio del titulo.
  const consistent = ldVariants.length > 1 && titlePrice > 0 &&
    Math.abs(Math.min(...ldVariants.map((v) => v.price)) - titlePrice) / titlePrice < 0.2;

  let variants;
  if (consistent) {
    variants = ldVariants.map((v, i) => ({
      sku: v.sku || `${slug}-${i + 1}`,
      label: v.label,
      price: v.price,
      available: v.available,
    }));
  } else {
    variants = [{ sku: `${slug}-1`, label: 'Precio unico', price: titlePrice, available: true }];
  }

  if (!variants.some((v) => v.price > 0)) return null;

  const rawImages = Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [];
  const images = rawImages.filter(Boolean);
  const prices = variants.map((v) => v.price);

  return {
    id: slug,
    slug,
    name,
    brand: guessBrand(name),
    description: stripHtml(ld?.description || '').slice(0, 600),
    image: resize(images[0] || '', 700),
    images: images.map((src) => resize(src, 1200)),
    price: Math.min(...prices),
    maxPrice: Math.max(...prices),
    available: variants.some((v) => v.available),
    variants: variants.map((v) => ({ ...v, price: v.price || titlePrice })),
    categories: [],
    sourceUrl: `${HOST}/${STORE}/${slug}/`,
  };
}

async function main() {
  console.log('1/4 Leyendo sitemap...');
  const sitemap = await get(`${HOST}/sitemap.xml`);
  if (!sitemap) throw new Error('No se pudo leer el sitemap');

  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const collectionUrls = [...new Set(locs.filter((u) => u.includes('/collections/')))];
  let productUrls = [...new Set(locs.filter((u) => !u.includes('/collections/')))];
  if (Number.isFinite(LIMIT)) productUrls = productUrls.slice(0, LIMIT);

  console.log(`    sitemap: ${collectionUrls.length} colecciones, ${productUrls.length} productos`);

  console.log(`2/4 Extrayendo categorias (hasta ${CAT_PAGES} paginas por coleccion)...`);
  const categoryOfProduct = new Map();
  const categories = new Map();
  let catDone = 0;
  await pool(collectionUrls, CONCURRENCY, async (url) => {
    const path = url.replace(`${HOST}${STORE}/collections/`, '').replace(/\/+$/, '');
    // "collections" es un segmento tecnico, no una categoria: /collections/celulares/redmi-2/
    const segments = path.split('/').filter((s) => s !== 'collections');
    const slug = segments[segments.length - 1];
    const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : null;

    const found = new Set();
    let name = prettify(slug);
    for (let page = 1; page <= CAT_PAGES; page++) {
      const html = await get(page === 1 ? url : `${url}?page=${page}`);
      if (!html) break;
      if (page === 1) {
        const pageTitle = decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '')
          .replace(SUFFIX, '')
          .replace(/\s*[-–|]\s*COP\s*\$?[\d.,]+\s*$/i, '')
          .trim();
        // Algunos titulos del sitio viejo dicen "Collections / ..." en vez del
        // nombre real; en ese caso gana el slug.
        if (pageTitle && !/collections/i.test(pageTitle) && pageTitle.length <= 60) {
          name = pageTitle;
        }
      }
      const before = found.size;
      for (const match of html.matchAll(new RegExp(`${STORE}/([a-z0-9][a-z0-9-]*)/`, 'gi'))) {
        const candidate = match[1];
        if (candidate === slug || candidate.split('/').pop() === slug) continue;
        found.add(candidate);
      }
      if (found.size === before) break;
    }

    if (found.size === 0) return;
    const parentName = parent ? prettify(parent.split('/').pop()) : '';
    const label = parentName ? `${parentName} / ${name}` : name;
    categories.set(slug, { slug, name: label, parent, products: found.size });
    for (const productSlug of found) {
      if (!categoryOfProduct.has(productSlug)) categoryOfProduct.set(productSlug, []);
      const list = categoryOfProduct.get(productSlug);
      if (list.length < 2) list.push(label);
    }
    catDone++;
    if (catDone % 25 === 0) console.log(`    colecciones ${catDone}/${collectionUrls.length}`);
  });

  console.log('3/4 Extrayendo productos...');
  const products = new Map();
  let fetched = 0;
  await pool(productUrls, CONCURRENCY, async (url) => {
    const html = await get(url);
    fetched++;
    if (fetched % 100 === 0) console.log(`    productos ${fetched}/${productUrls.length}`);
    if (!html) return;
    const slug = url.replace(/\/+$/, '').split('/').pop();
    const product = mapProduct(slug, html);
    if (!product) return;
    product.collections = categoryOfProduct.get(slug) || [];
    products.set(slug, product);
  });

  console.log('4/4 Guardando...');
  // El saneo (marcas, nombres, categorias propias) se aplica aqui para que el
  // catalogo quede listo para la web sin pasos extra.
  const list = [...products.values()].map(enrichProduct).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const catalog = {
    generatedAt: new Date().toISOString(),
    store: {
      name: 'La Tienda de Alex',
      currency: 'COP',
      source: `${HOST}/${STORE}/`,
    },
    counts: {
      products: list.length,
      categories: buildCategories(list).length,
      sinPrecio: list.filter((p) => !p.price).length,
      sinImagen: list.filter((p) => !p.image).length,
    },
    categories: buildCategories(list),
    products: list,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(catalog), 'utf8');
  console.log(`\nOK -> ${OUT}`);
  console.log(`   ${list.length} productos, ${catalog.categories.length} categorias, ${catalog.counts.sinPrecio} sin precio`);
}

main().catch((err) => {
  console.error('FALLO:', err.message);
  process.exit(1);
});
