/**
 * Apunta el catalogo a las imagenes WebP de public/assets/img/productos-webp.
 *
 * Los nombres conservan el hash, solo cambia la extension y la carpeta, asi que
 * la conversion es /assets/img/productos/abc.png -> /assets/img/productos-webp/abc.webp
 *
 * Si un WebP no existe, la ruta se deja como estaba (el original sigue ahi), y
 * se avisa: es preferible una imagen grande a una rota.
 */
import { readFile, writeFile, rename, stat } from 'node:fs/promises';

const ORIGEN = 'productos';
const DESTINO = 'productos-webp';

const ruta = process.argv[2] || 'data/catalog.recovered.json';
const catalog = JSON.parse(await readFile(ruta, 'utf8'));

let migradas = 0;
let sinWebp = 0;
const faltantes = new Set();

const migrar = async (valor) => {
  if (!valor) return valor;
  const m = valor.match(new RegExp(`^/assets/img/${ORIGEN}/([^/]+)\\.[a-z0-9]+$`, 'i'));
  if (!m) return valor;
  const base = m[1];
  const destino = `/assets/img/${DESTINO}/${base}.webp`;
  try {
    await stat(`public${destino}`);
    migradas++;
    return destino;
  } catch {
    sinWebp++;
    faltantes.add(valor);
    return valor;
  }
};

for (const p of catalog.products) {
  p.image = await migrar(p.image);
  if (Array.isArray(p.images)) {
    const otras = [];
    for (const img of p.images) {
      const n = await migrar(img);
      if (!otras.includes(n)) otras.push(n);
    }
    p.images = otras;
  }
}

// El conteo se saca del resultado final, no de las migraciones de esta pasada:
// asi un reejecutado sobre un catalogo ya migrado no vuelve a poner 0.
let webp = 0;
const vistas = new Set();
for (const p of catalog.products) {
  for (const img of [p.image, ...(p.images || [])]) {
    if (img && img.includes(`/${DESTINO}/`)) webp++;
    if (img) vistas.add(img);
  }
}

catalog.counts = {
  ...catalog.counts,
  sinImagen: catalog.products.filter((p) => !p.image).length,
  imagenesWebp: webp,
};

const tmp = `${ruta}.tmp`;
await writeFile(tmp, JSON.stringify(catalog), 'utf8');
await rename(tmp, ruta);

console.log(`  ${ruta}`);
console.log(`  rutas migradas a WebP: ${migradas}`);
console.log(`  sin WebP (se dejan como estaban): ${sinWebp}`);
if (faltantes.size) {
  console.log(`  ejemplos sin WebP:`);
  [...faltantes].slice(0, 5).forEach((f) => console.log(`    ${f}`));
}

// Comprobacion final: que toda imagen referenciada exista de verdad
// (conjunto aparte del de arriba, que ya tiene todo dentro)
let rotas = 0;
const revisadas = new Set();
for (const p of catalog.products) {
  for (const img of [p.image, ...(p.images || [])]) {
    if (!img || revisadas.has(img)) continue;
    revisadas.add(img);
    try {
      await stat(`public${img}`);
    } catch {
      rotas++;
      if (rotas <= 5) console.log(`  ROTA: ${img}  (${p.name})`);
    }
  }
}
console.log(`  imagenes referenciadas: ${vistas.size}, rotas: ${rotas}`);
