import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2] || 'data/catalog.json';
const output = process.argv[3] || 'cloudflare/seed.sql';
const catalog = JSON.parse(await readFile(input, 'utf8'));
const products = catalog.products || [];
const metadata = { ...catalog, products: undefined };
const sql = [];
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
sql.push(`INSERT INTO catalog_meta (id, data) VALUES ('catalog', ${quote(JSON.stringify(metadata))}) ON CONFLICT(id) DO UPDATE SET data = excluded.data;`);
for (let offset = 0; offset < products.length; offset += 40) {
  const values = products.slice(offset, offset + 40).map((product) => `(${quote(product.id)}, ${quote(JSON.stringify(product))})`);
  sql.push(`INSERT INTO products (id, data) VALUES ${values.join(', ')} ON CONFLICT(id) DO UPDATE SET data = excluded.data;`);
}
await writeFile(output, `${sql.join('\n')}\n`, 'utf8');
console.log(`Seed SQL preparado: ${products.length} productos → ${output}`);
