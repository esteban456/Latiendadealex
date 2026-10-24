import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CATALOG_FILE = new URL('../data/catalog.json', import.meta.url).pathname;
const INDEX_FILE = new URL('../data/search-index.json', import.meta.url).pathname;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

async function main() {
  console.log('=== Constructor de índice de búsqueda ===\n');

  const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  const products = catalog.products || [];

  console.log(`📦 ${products.length} productos a indexar\n`);

  // Índice invertido: palabra -> Set de IDs de productos
  const invertedIndex = new Map();
  // Datos de productos para búsqueda rápida
  const productData = new Map();

  for (const product of products) {
    const id = String(product.id);
    productData.set(id, {
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand || '',
      price: product.price,
      image: product.image,
      categories: (product.categories || []).map((c) => c.name),
      available: product.available,
    });

    // Indexar nombre, marca, categorías y descripción
    const searchableText = [
      product.name,
      product.brand || '',
      ...(product.categories || []).map((c) => c.name),
      product.description || '',
    ].join(' ');

    const tokens = new Set(tokenize(searchableText));
    for (const token of tokens) {
      if (!invertedIndex.has(token)) {
        invertedIndex.set(token, new Set());
      }
      invertedIndex.get(token).add(id);
    }
  }

  // Convertir Sets a Arrays para JSON
  const index = {
    generatedAt: new Date().toISOString(),
    totalProducts: products.length,
    products: Object.fromEntries(productData),
    invertedIndex: Object.fromEntries(
      [...invertedIndex.entries()].map(([k, v]) => [k, [...v]]),
    ),
  };

  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');

  console.log(`  Palabras indexadas: ${invertedIndex.size}`);
  console.log(`  Productos indexados: ${productData.size}`);
  console.log(`\n✅ Índice guardado en ${INDEX_FILE}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
