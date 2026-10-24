import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const SOURCE_FILE = join(ROOT, 'productos (8).json');
const CATALOG_FILE = join(ROOT, 'data', 'catalog.json');
const BACKUP_FILE = join(ROOT, 'data', 'catalog.before-json-import.json');

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const keyOf = (value) => normalize(value).replace(/[^a-z0-9]/g, '');
const slugify = (value) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110);
const field = (row, ...names) => {
  const wanted = new Set(names.map(keyOf));
  const entry = Object.entries(row).find(([key]) => wanted.has(keyOf(key)));
  return entry?.[1];
};
const numeric = (value) => {
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

function readExport(text) {
  const trimmed = text.trim().replace(/^\uFEFF/, '').replace(/,\s*$/, '');
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // The spreadsheet export contains comma-separated objects without [] around them.
    return JSON.parse(`[${trimmed}]`);
  }
}

function toStoreCategory(raw, existingCategories) {
  const source = String(raw ?? '').split(',')[0].split('>').map((part) => part.trim()).filter(Boolean)[0] || 'Otros productos';
  const normalized = normalize(source);
  const aliases = [
    [/accesorio.*celular/, 'Accesorios de Celular'],
    [/celular|smartphone|iphone|android/, 'Celulares y Smartphones'],
    [/computador|computacion|portatil|laptop/, 'Accesorios de Computador'],
    [/maquinaria|herramienta|taller/, 'Herramientas y Maquineria'],
    [/sonido|audio|audifono|parlante|bocina/, 'Audio y Microfonos'],
    [/hogar|cocina|electrodomestico|mueble/, 'Hogar y Electrodomesticos'],
    [/televisor|television|monitor|proyector|tv/, 'Monitores y Televisores'],
    [/consola|videojuego|gaming|xbox|playstation/, 'Gaming y Consolas'],
    [/smartwatch|reloj/, 'Smartwatches y Relojes'],
    [/juguete|juego/, 'Juguetes y diversion'],
    [/belleza|cuidado personal|plancha|secador/, 'Belleza y Cuidado Personal'],
    [/camara|fotografia/, 'Camaras y Fotografia'],
    [/deporte|fitness/, 'Deportes y Fitness'],
    [/iluminacion|energia|luz|linterna/, 'Iluminacion y Energia'],
    [/moto|vehiculo|auto|carro/, 'Motos y Vehiculos'],
    [/tablet|ipad/, 'Tablets y iPads'],
    [/impresora|escaner/, 'Impresoras y Escáneres'],
    [/seguridad|domotica/, 'Seguridad y Domotica'],
  ];
  const match = aliases.find(([pattern]) => pattern.test(normalized));
  if (match) return match[1];
  const existing = existingCategories.find((category) => normalize(category.name) === normalized);
  return existing?.name || source.replace(/\s+/g, ' ').slice(0, 80);
}

function collectProducts(rows, oldCatalog) {
  const oldByName = new Map((oldCatalog.products || []).map((product) => [keyOf(product.name), product]));
  const groups = [];
  const usedIds = new Set();
  let current = null;

  for (const row of rows) {
    const name = String(field(row, 'NOMBRE PRODUCTO') ?? '').trim();
    if (name) {
      current = { first: row, rows: [row], name };
      groups.push(current);
    } else if (current) {
      current.rows.push(row);
    }
  }

  const products = [];
  for (const group of groups) {
    const source = group.first;
    const sku = String(field(source, 'REFERENCIA - SKU') || slugify(group.name)).trim();
    const old = oldByName.get(keyOf(group.name));
    const description = String(field(source, 'DESCRIPCION') ?? '').trim() || old?.description || '';
    const rawCategory = field(source, 'CATEGORIAS') || old?.categories?.[0]?.name || 'Otros productos';
    const categoryName = toStoreCategory(rawCategory, oldCatalog.categories || []);
    const icon = (oldCatalog.categories || []).find((category) => category.name === categoryName)?.icon || '📦';
    const optionRows = group.rows.filter((row) => field(row, 'OPCION VARIACION 2 (OPCIONAL)', 'OPCION PRECIO VARIACION (OPCIONAL)') !== undefined);
    const variantRows = optionRows.length ? optionRows : [source];
    const variants = variantRows.map((row, index) => {
      const label = String(field(row, 'OPCION VARIACION 2 (OPCIONAL)') || field(row, 'NOMBRE VARIACION 1 (OPCIONAL)') || 'Precio único').trim();
      const optionPrice = numeric(field(row, 'OPCION PRECIO VARIACION (OPCIONAL)'));
      const regular = optionPrice || numeric(field(row, 'PRECIO'));
      const discount = numeric(field(row, 'PRECIO CON DESCUENTO'));
      const price = discount > 0 && discount < regular ? discount : regular;
      const quantityValue = field(row, 'CANTIDAD');
      const activeValue = field(row, 'ACTIVO');
      const available = activeValue === undefined || String(activeValue) === '1' ? (quantityValue === undefined || numeric(quantityValue) > 0) : false;
      return {
        sku: `${slugify(sku)}-${slugify(label) || index + 1}`,
        label,
        price,
        available,
      };
    }).filter((variant) => variant.price > 0);

    const sortedPrices = variants.map((variant) => variant.price).sort((a, b) => a - b);
    const lowestPrice = sortedPrices[0] || 0;
    const sourcePrice = numeric(field(source, 'PRECIO'));
    const activeValue = field(source, 'ACTIVO');
    const productAvailable = variants.some((variant) => variant.available) && (activeValue === undefined || String(activeValue) === '1');
    const productId = old?.id && !usedIds.has(old.id) ? old.id : `import-${slugify(sku)}`;
    usedIds.add(productId);
    const legacyVariants = (old?.variants || [])
      .filter((variant) => !variants.some((currentVariant) => currentVariant.sku === variant.sku))
      .map((variant) => ({ ...variant, available: productAvailable && variant.available !== false, legacy: true }));
    const product = {
      id: productId,
      slug: `${slugify(group.name)}-${slugify(sku).slice(-20)}`,
      name: group.name,
      brand: old?.brand || '',
      description,
      price: lowestPrice,
      maxPrice: sourcePrice > lowestPrice ? sourcePrice : lowestPrice,
      compareAt: sourcePrice,
      image: old?.image || '',
      images: old?.images?.length ? old.images : (old?.image ? [old.image] : []),
      categories: [{ name: categoryName, icon }],
      variants: [...variants, ...legacyVariants],
      available: productAvailable && lowestPrice > 0,
      stock: numeric(field(source, 'CANTIDAD')),
      specs: {},
      tags: [],
      source: 'productos (8).json',
    };
    products.push(product);
  }

  return products;
}

const [sourceText, oldText] = await Promise.all([
  readFile(SOURCE_FILE, 'utf8'),
  readFile(CATALOG_FILE, 'utf8'),
]);
const importedRows = readExport(sourceText);
const oldCatalog = JSON.parse(oldText);
const products = collectProducts(importedRows, oldCatalog);
if (products.length < 1000) throw new Error(`Importación detenida: solo se convirtieron ${products.length} productos.`);

const categoriesMap = new Map();
for (const product of products) {
  const category = product.categories[0];
  const entry = categoriesMap.get(category.name) || { ...category, products: 0 };
  entry.products += 1;
  categoriesMap.set(category.name, entry);
}

const catalog = {
  generatedAt: new Date().toISOString(),
  importedFrom: 'productos (8).json',
  counts: {
    products: products.length,
    categories: categoriesMap.size,
    withDescription: products.filter((product) => product.description).length,
    withImage: products.filter((product) => product.image).length,
    available: products.filter((product) => product.available).length,
  },
  categories: [...categoriesMap.values()].sort((a, b) => b.products - a.products || a.name.localeCompare(b.name, 'es')),
  products,
};

try {
  await readFile(BACKUP_FILE);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await copyFile(CATALOG_FILE, BACKUP_FILE);
}
await writeFile(CATALOG_FILE, `${JSON.stringify(catalog)}\n`, 'utf8');
console.log(`Importados ${products.length} productos (${catalog.counts.available} disponibles, ${catalog.counts.withDescription} con descripción, ${catalog.counts.withImage} con imagen).`);
