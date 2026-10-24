/**
 * Importa la lista productos.txt (categoria + producto con precio base e
 * imagenes) al catalogo, aplicando la regla de precios y resolviendo las
 * imagenes ya subidas a ImageKit (data/catalogo-imagekit.json).
 *
 * Los productos se AÑADEN a los existentes. Es idempotente: antes de añadir
 * borra los productos con source "productos.txt".
 *
 *   node scripts/import-catalogo.mjs            # escribe data/catalog.json
 *   node scripts/import-catalogo.mjs --dry-run  # solo informa
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const LIST_FILE = join(ROOT, 'productos.txt');
const MAP_FILE = join(ROOT, 'data', 'catalogo-imagekit.json');
const CATALOG_FILE = join(ROOT, 'data', 'catalog.json');
const DRY = process.argv.includes('--dry-run');
const SOURCE = 'productos.txt';

// Mantener en sincronia con server/index.js, functions/api/[[path]].js y admin.js.
function priceForCost(cost) {
  const value = Math.max(0, Number(cost) || 0);
  let contado;
  let credito;
  if (value < 200000) { contado = value * 2; credito = value * 2; }
  else if (value < 500000) { contado = value * 1.35; credito = value * 1.4; }
  else if (value < 1500000) { contado = value * 1.3; credito = value * 1.4; }
  else { contado = value * 1.2; credito = value * 1.3; }
  const round = (amount) => Math.round(amount / 100) * 100;
  return { contado: round(contado), credito: round(credito) };
}

const CATS = [
  { name: 'Cámaras y Fotografía', icon: '📷' },
  { name: 'Micrófonos, Parlantes y Audio', icon: '🎤' },
  { name: 'Televisores, Streaming y Gadgets de Entretenimiento', icon: '📺' },
  { name: 'Cuidado Personal, Belleza y Cabello', icon: '💇' },
  { name: 'Electrodomésticos y Cocina', icon: '🍳' },
  { name: 'Hogar, Organización y Aseo', icon: '🏠' },
  { name: 'Tecnología, Herramientas y Vehículos', icon: '🛠️' },
  { name: 'Salud y Bienestar', icon: '🩺' },
  { name: 'Mascotas', icon: '🐾' },
  { name: 'Juguetes, Bebés y Niños', icon: '🧸' },
  { name: 'Papelería, Accesorios y Entretenimiento Familiar', icon: '✏️' },
];

const num = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;
const imageList = (seg) => {
  const m = seg.match(/\[Imágenes:\s*([^\]]+)\]/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
};
const stripImg = (seg) => seg.replace(/\[Imágenes:[^\]]*\]/g, '').trim();
const isVariantLabel = (s) => /^[0-9]+\s*"/.test(s) || /^x[0-9]/i.test(s) || /^KV[.\s]?[0-9]/i.test(s);

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'producto';
}

const RAW = await readFile(LIST_FILE, 'utf8');
let imageMap = {};
try { imageMap = JSON.parse(await readFile(MAP_FILE, 'utf8')); } catch { /* sin mapa */ }

const positions = CATS.map((c) => ({ c, i: RAW.indexOf(c.name) }));
for (const p of positions) if (p.i < 0) console.error('Categoria no encontrada:', p.c.name);
const ordered = positions.filter((p) => p.i >= 0).sort((a, b) => a.i - b.i);

const parsed = [];
for (let k = 0; k < ordered.length; k++) {
  const cat = ordered[k].c;
  const body = RAW.slice(ordered[k].i + cat.name.length, k + 1 < ordered.length ? ordered[k + 1].i : RAW.length);
  const segs = body.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  let current = null;
  for (const seg of segs) {
    const images = imageList(seg);
    const core = stripImg(seg);
    if (isVariantLabel(core) && current) {
      const label = core.replace(/\$.*$/, '').replace(/:\s*$/, '').trim();
      current.variants.push({ label: label || `Opción ${current.variants.length + 1}`, cost: num((core.match(/\$\s*([0-9][0-9.'\u00a0 ]*)/) || [])[1]) });
      current.images.push(...images);
      continue;
    }
    const costs = [...core.matchAll(/\$\s*([0-9][0-9.'\u00a0 ]*)/g)].map((m) => num(m[1]));
    const [left] = core.split(/:\s*\$/);
    let name = left.trim();
    const variants = [];
    const cut = name.lastIndexOf(':');
    if (cut >= 0 && isVariantLabel(name.slice(cut + 1).trim())) {
      variants.push({ label: name.slice(cut + 1).trim(), cost: costs.shift() });
      name = name.slice(0, cut).trim();
    }
    if (!name) name = 'Producto';
    current = { category: cat.name, icon: cat.icon, name, costs, images: [...images], variants };
    parsed.push(current);
  }
}

const newProducts = [];
const usedSlugs = new Set();
for (let i = 0; i < parsed.length; i++) {
  const p = parsed[i];
  const base = p.variants.length ? p.variants[0].cost : p.costs[0] || 0;
  if (!base) { console.warn('Sin precio, se omite:', p.name); continue; }
  const { contado, credito } = priceForCost(base);

  let options = [];
  if (p.variants.length) options = p.variants;
  else if (p.costs.length > 1) options = p.costs.map((c, j) => ({ label: `Opción ${j + 1}`, cost: c }));

  let slug = slugify(p.name);
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${slugify(p.name)}-${suffix++}`;
  usedSlugs.add(slug);
  const id = `cat-${slug}`;

  const variants = options.length
    ? options.flatMap((o, j) => {
        const r = priceForCost(o.cost);
        const sku = `${slug}-${j + 1}`;
        return [
          { sku: `${sku}-contado`, label: `${o.label} · CONTADO`, price: r.contado, available: true },
          { sku: `${sku}-credito`, label: `${o.label} · CRÉDITO`, price: r.credito, available: true },
        ];
      })
    : [
        { sku: `${slug}-contado`, label: 'CONTADO', price: contado, available: true },
        { sku: `${slug}-credito`, label: 'CRÉDITO', price: credito, available: true },
      ];

  const images = p.images.map((n) => imageMap[n]).filter(Boolean);
  newProducts.push({
    id,
    slug,
    name: p.name,
    brand: '',
    description: '',
    price: contado,
    maxPrice: credito,
    compareAt: contado,
    image: images[0] || '',
    images,
    categories: [{ name: p.category, icon: p.icon }],
    variants,
    available: true,
    stock: 0,
    specs: {},
    tags: [],
    source: SOURCE,
    cost: base,
    createdAt: new Date().toISOString(),
  });
}

const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
const existing = (catalog.products || []).filter((p) => p.source !== SOURCE);
const existingIds = new Set(existing.map((p) => p.id));
for (const p of newProducts) {
  let id = p.id;
  let n = 2;
  while (existingIds.has(id)) id = `${p.id}-${n++}`;
  p.id = id;
  existingIds.add(id);
}
const products = [...existing, ...newProducts];

const counts = new Map((catalog.categories || []).map((c) => [c.name, { ...c }]));
for (const p of products) {
  const c = p.categories?.[0];
  if (!c) continue;
  const entry = counts.get(c.name) || { name: c.name, icon: c.icon, products: 0 };
  entry.products += 1;
  counts.set(c.name, entry);
}
for (const [name, entry] of counts) if (entry.products === 0) counts.delete(name);
catalog.categories = [...counts.values()];
catalog.products = products;
catalog.counts = { ...(catalog.counts || {}), products: products.length, categories: catalog.categories.length };
catalog.generatedAt = new Date().toISOString();

const byCat = new Map();
for (const p of newProducts) byCat.set(p.categories[0].name, (byCat.get(p.categories[0].name) || 0) + 1);
console.log(`Nuevos: ${newProducts.length}  |  Existian: ${existing.length}  |  Total: ${products.length}`);
console.log(`Con imagen: ${newProducts.filter((p) => p.image).length}, sin imagen: ${newProducts.filter((p) => !p.image).length}`);
console.log(`Con variantes multiples: ${newProducts.filter((p) => p.variants.length > 2).length}`);
for (const [name, n] of byCat) console.log(`   ${n.toString().padStart(3)}  ${name}`);
console.log('Ejemplo:', JSON.stringify(newProducts[0], null, 1).slice(0, 900));

if (!DRY) {
  const tmp = `${CATALOG_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(catalog), 'utf8');
  await rename(tmp, CATALOG_FILE);
  console.log(`\nEscrito ${CATALOG_FILE}`);
} else {
  console.log('\nDRY RUN: no se escribio nada');
}
