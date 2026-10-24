/**
 * Reconstruye data/catalog.json, que quedo truncado a mitad de escritura.
 *
 * Lo que se puede recuperar:
 *   - data/catalog.truncated.json: los productos completos que siirdscribieron
 *     antes de que el archivo se cortara (con description, variants, specs...).
 *   - data/search-index.json: los 1945 productos en version resumida (nombre,
 *     precio, slug, imagen, categorias). Sirven para los que no salieron
 *     enteros, a los que hay que anadirles una variante unica para que el
 *     checkout los pueda vender.
 *
 * Nada se sobrescribe aqui: escribe en data/catalog.recovered.json.
 */
import { readFile, writeFile } from 'node:fs/promises';

const truncado = await readFile('data/catalog.truncated.json', 'utf8');
const indice = JSON.parse(await readFile('data/search-index.json', 'utf8'));

// --- Cabecera del archivo truncado: store, categories y demas metadatos ---
// Ojo: "products" tambien aparece dentro de "counts", asi que se busca el
// patron con corchete, que solo es el array de productos.
const claveProductos = truncado.indexOf('"products": [');
const inicioArray = truncado.indexOf('[', claveProductos);
if (claveProductos < 0 || inicioArray < 0) throw new Error('no encuentro el array de productos');

// La cabecera se lee cortando justo antes de la clave "products" y cerrando el
// objeto: hasta ahi ya viene cerrado generatedAt, store, counts y categories,
// asi que solo falta la llave final.
const sinProductos = truncado.slice(0, claveProductos).replace(/,\s*$/, '') + '}';
const meta = JSON.parse(sinProductos);
console.log(`  metadatos recuperados: store="${meta.store?.name}", categories=${meta.categories?.length}`);

// El store.source del archivo viejo venia sin barra entre el dominio y el slug
// ("...ecometri.shop573124885850/") por un fallo de concat en scrape.mjs.
if (meta.store?.source && /:\/\/([^/]+)(\d{6,})\//.test(meta.store.source)) {
  const malo = meta.store.source;
  meta.store.source = meta.store.source.replace(/:\/\/([^/]+?)(\d{6,})\//, '://$1/$2/');
  console.log(`  store.source corregido:\n    ${malo}\n -> ${meta.store.source}`);
}

// --- Recorre el array roto y saca cada objeto que este completo ---
const completos = new Map();
let i = inicioArray + 1;
let profundidad = 1;
let inicioObj = -1;
let enCadena = false;
let escapado = false;

for (; i < truncado.length; i++) {
  const c = truncado[i];
  if (enCadena) {
    if (escapado) escapado = false;
    else if (c === '\\') escapado = true;
    else if (c === '"') enCadena = false;
    continue;
  }
  if (c === '"') {
    enCadena = true;
    continue;
  }
  if (c === '{') {
    if (profundidad === 1) inicioObj = i;
    profundidad++;
    continue;
  }
  if (c === '}') {
    profundidad--;
    if (profundidad === 1 && inicioObj >= 0) {
      const bruto = truncado.slice(inicioObj, i + 1);
      try {
        const p = JSON.parse(bruto);
        if (p.id) completos.set(p.id, p);
      } catch {
        // Objeto incompleto: se ignora.
      }
      inicioObj = -1;
    }
    continue;
  }
  if (c === '[') {
    // Array anidado (categories, images, variants, specs...).
    profundidad++;
    continue;
  }
  if (c === ']') {
    profundidad--;
    if (profundidad === 0) break;
  }
}
console.log(`  productos completos recuperados del truncado: ${completos.size}`);
console.log(`  el archivo se corto en el byte ${truncado.length} (indice ${i})`);

// --- Completa con el indice de busqueda ---
const resumen = indice.products;
const claves = Object.keys(resumen);
console.log(`  productos en el indice de busqueda: ${claves.length}`);

const IconosPorCategoria = new Map();
for (const p of completos.values())
  for (const c of p.categories || []) if (c && c.icon) IconosPorCategoria.set(c.name, c.icon);

const soloResumen = [];
for (const slug of claves) {
  if (completos.has(slug)) continue;
  const r = resumen[slug];
  soloResumen.push({
    id: r.id,
    slug: r.slug,
    name: r.name,
    brand: r.brand || '',
    description: '',
    price: r.price,
    compareAt: 0,
    image: r.image || '',
    images: r.image ? [r.image] : [],
    categories: (r.categories || []).map((name) => ({
      name,
      icon: IconosPorCategoria.get(name) || '📦',
      source: 'derived',
    })),
    variants: [
      {
        sku: `${r.id}-1`,
        label: 'Precio unico',
        price: r.price,
        available: !!r.available,
      },
    ],
    available: !!r.available,
    specs: {},
    tags: [],
    source: '',
  });
}
console.log(`  productos que solo existian en el indice: ${soloResumen.length}`);

// --- Une y ordena ---
const productos = [...completos.values(), ...soloResumen].sort((a, b) =>
  String(a.name).localeCompare(String(b.name), 'es'),
);
const Categories = new Map();
for (const p of productos) for (const c of p.categories || []) if (c?.name) Categories.set(c.name, c);

const catalogo = {
  ...meta,
  products: productos,
  categories: meta.categories?.length
    ? meta.categories
    : [...Categories.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
  recoveredAt: new Date().toISOString(),
  recovery: {
    from: 'catalog.truncated.json + search-index.json',
    completos: completos.size,
    soloIndice: soloResumen.length,
  },
};

await writeFile('data/catalog.recovered.json', JSON.stringify(catalogo, null, 2), 'utf8');

const conImagen = productos.filter((p) => p.image).length;
const conVariantes = productos.filter((p) => (p.variants || []).length).length;
console.log(`\n  escrito data/catalog.recovered.json`);
console.log(`  productos: ${productos.length}`);
console.log(`  con imagen: ${conImagen}`);
console.log(`  con variantes (vendibles): ${conVariantes}`);
console.log(`  categorias: ${catalogo.categories.length}`);
