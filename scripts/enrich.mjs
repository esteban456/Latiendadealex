/**
 * Aplica el saneo (marcas, nombres, categorias propias) sobre un catalogo ya
 * scrapeado, sin volver a golpear el sitio.
 *
 *   node scripts/enrich.mjs                       # procesa data/catalog.json
 *   node scripts/enrich.mjs data/catalog.test.json
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { enrichProduct, buildCategories } from './lib/enrich.mjs';

const file = process.argv[2] || 'data/catalog.json';
const catalog = JSON.parse(await readFile(file, 'utf8'));

const products = catalog.products.map(enrichProduct);
const categories = buildCategories(products);

const out = {
  generatedAt: catalog.generatedAt,
  enrichedAt: new Date().toISOString(),
  store: catalog.store,
  counts: {
    products: products.length,
    categories: categories.length,
    sinPrecio: products.filter((p) => !p.price).length,
    sinImagen: products.filter((p) => !p.image).length,
  },
  categories,
  products,
};

// Escritura atomica: un corte de luz a mitad del write deja el catalogo entero
// en vez de truncado, que es justo como se perdio la version anterior.
const tmp = `${file}.tmp`;
await writeFile(tmp, JSON.stringify(out), 'utf8');
await rename(tmp, file);

console.log(`OK -> ${file}`);
console.log(`   ${products.length} productos, ${categories.length} categorias`);
console.log('\nCategorias:');
for (const c of categories) console.log(`   ${String(c.products).padStart(5)}  ${c.name}`);
const other = products.filter((p) => p.categories.every((c) => c.name === 'Otros productos'));
console.log(`\nProductos sin categoria especifica: ${other.length} (${((other.length / products.length) * 100).toFixed(1)}%)`);
for (const p of other.slice(0, 15)) console.log('   ', p.name.slice(0, 70));
