/**
 * Aplica la regla de precios por tramos sobre el COSTO de cada producto.
 *
 * Tramo del costo (pesos) -> precio de contado / credito:
 *   < 200.000             -> x2      / x2
 *   200.000 – 499.999     -> +35%    / +40%
 *   500.000 – 1.499.999   -> +30%    / +40%
 *   >= 1.500.000          -> +20%    / +30%
 *
 * El costo de partida es product.cost si ya existe; si no, el precio de contado
 * actual. El script es idempotente: volver a correrlo reusa el mismo costo.
 *
 *   node scripts/apply-pricing.mjs                    # data/catalog.json
 *   node scripts/apply-pricing.mjs data/otro.json
 */
import { readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const FILE = process.argv[2] ? join(ROOT, process.argv[2]) : join(ROOT, 'data', 'catalog.json');
const BACKUP_FILE = join(ROOT, 'data', 'catalog.before-pricing.json');

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

const catalog = JSON.parse(await readFile(FILE, 'utf8'));
const products = catalog.products || [];
let updated = 0;
let skipped = 0;

for (const product of products) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  // Productos con opciones propias (medidas, x2/x3, refs): su costo base no
  // permite reconstruir cada opcion, asi que no se tocan.
  const plain = variants.length <= 2 && variants.every((variant) => /contado|cr[eé]dito|precio .?nico/i.test(String(variant.label)));
  if (!plain) { skipped += 1; continue; }
  const cashVariant = variants.find((variant) => /contado/i.test(variant.label))
    || variants.find((variant) => /precio .?nico/i.test(variant.label))
    || variants[0];
  const creditVariant = variants.find((variant) => /cr[eé]dito/i.test(variant.label));
  const base = Number(product.cost) > 0 ? Number(product.cost) : (Number(cashVariant?.price) || Number(product.price) || 0);
  if (!base) { skipped += 1; continue; }

  const { contado, credito } = priceForCost(base);
  const available = product.available !== false;
  const cashSku = cashVariant?.sku || `admin-${String(product.id || updated).slice(0, 20)}-contado`;

  product.cost = base;
  product.price = contado;
  product.maxPrice = credito;
  product.compareAt = contado;
  product.variants = [
    { sku: cashSku, label: 'CONTADO', price: contado, available },
    { sku: creditVariant?.sku || `${cashSku}-credito`, label: 'CRÉDITO', price: credito, available },
  ];
  updated += 1;
}

catalog.pricedAt = new Date().toISOString();

try {
  await readFile(BACKUP_FILE);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await copyFile(FILE, BACKUP_FILE);
}

const tmp = `${FILE}.tmp`;
await writeFile(tmp, `${JSON.stringify(catalog)}\n`, 'utf8');
await rename(tmp, FILE);

console.log(`Precios actualizados en ${updated} de ${products.length} productos (${skipped} sin precio).`);
for (const product of products.slice(0, 8)) {
  console.log(`  ${product.name.slice(0, 48)}: costo ${product.cost} -> contado ${product.price} / credito ${product.maxPrice}`);
}
