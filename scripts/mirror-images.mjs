/**
 * Descarga las imagenes del catalogo para que la tienda no dependa del CDN del
 * sitio original. Si el sitio viejo se cae, las fotos siguen en pie.
 *
 *   node scripts/mirror-images.mjs                # todas
 *   node scripts/mirror-images.mjs --limit 50     # rapido, para probar
 *   node scripts/mirror-images.mjs --dry-run      # solo informa
 *
 * Escribe:
 *   public/assets/img/productos/<hash>.<ext>   las fotos
 *   data/mirror.json                          mapa url original -> ruta local
 *   data/catalog.json                         image/images actualizados a la ruta local
 *
 * Con --keep-remote el catalogo sigue apuntando al CDN y solo se descargan
 * los archivos (util para tenerlas de respaldo sin cambiar nada).
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const CATALOG_FILE = join(ROOT, 'data', 'catalog.json');
const MIRROR_FILE = join(ROOT, 'data', 'mirror.json');
const IMG_DIR = join(ROOT, 'public', 'assets', 'img', 'productos');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const LIMIT = Number(arg('limit', Infinity));
const DRY = has('dry-run');
const KEEP_REMOTE = has('keep-remote');
// 4 y no 8: el CDN del sitio anterior corta el acceso a la IP tras unas 1.200
// peticiones seguidas, y a 8 se bloquea antes de terminar.
const CONCURRENCY = Number(arg('concurrency', 4));

const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
const products = catalog.products || [];

/** Todas las URLs distintas de un producto: la principal y la galeria. */
function urlsOf(product) {
  const list = [product.image, ...(product.images || [])];
  return [...new Set(list.filter((u) => typeof u === 'string' && u.startsWith('http')))];
}

const targets = [];
for (const product of products) {
  for (const url of urlsOf(product)) targets.push({ id: product.id, url });
}
const unique = [...new Map(targets.map((t) => [t.url, t])).values()].slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

console.log(`\n1/4 ${unique.length} imagenes unicas de ${targets.length} referencias`);
if (DRY) {
  const hosts = new Map();
  for (const { url } of unique) hosts.set(new URL(url).host, (hosts.get(new URL(url).host) || 0) + 1);
  for (const [host, count] of hosts) console.log(`   ${host}: ${count}`);
  console.log('\nDRY RUN: no se descargo nada\n');
  process.exit(0);
}

let mirror = {};
try {
  mirror = JSON.parse(await readFile(MIRROR_FILE, 'utf8'));
} catch {
  mirror = {};
}

await mkdir(IMG_DIR, { recursive: true });

let cursor = 0;
let ok = 0;
let reused = 0;
let consecutivos = 0;
const failed = [];

// El CDN corta el acceso a esta IP tras unas 1.200 peticiones seguidas. Cuando
// pasa, responde 403 a todo; sin esto el script marcaria como fallidas todas
// las imagenes siguientes y habria que adivinar cuales se bajado. Se detecta el
// bloqueo, se para, y el progreso queda guardado en mirror.json para continuar
// mas tarde con otro comando.
const BLOQUEO = 12;
let bloqueado = false;

async function download({ url }) {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const known = mirror[url];
  if (known) {
    try {
      await stat(join(ROOT, 'public', known));
      reused++;
      return;
    } catch {
      delete mirror[url];
    }
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error(`no es imagen: ${type}`);
    const ext = EXT[type.split(';')[0].trim()] || extname(new URL(url).pathname) || '.jpg';
    const file = `assets/img/productos/${hash}${ext}`;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 512) throw new Error('archivo demasiado pequeno');
    // Rutas con '/' siempre: en una URL una barra invertida rompe la imagen.
    await writeFile(join(ROOT, 'public', ...file.split('/')), body);
    mirror[url] = file;
    ok++;
    consecutivos = 0;
  } catch (err) {
    failed.push({ url, error: err.message });
    consecutivos++;
    if (consecutivos >= BLOQUEO) bloqueado = true;
  }
}

const runners = Array.from({ length: Math.max(1, Math.min(CONCURRENCY, unique.length)) }, async () => {
  while (cursor < unique.length && !bloqueado) {
    await download(unique[cursor++]);
    if ((ok + reused + failed.length) % 100 === 0) {
      process.stdout.write(`   ${ok + reused + failed.length}/${unique.length}\r`);
    }
  }
});
await Promise.all(runners);

// Guardado incremental: si el proceso se corta, no se pierde lo bajado.
await writeFile(MIRROR_FILE, JSON.stringify(mirror, null, 2), 'utf8');

console.log(`\n2/4 descargadas ${ok}, ya existentes ${reused}, fallidas ${failed.length}`);

if (bloqueado) {
  console.log(
    `\n!! El CDN bloqueo esta IP (${BLOQUEO} rechazos seguidos). ` +
      `Se guardaron las ${ok} imagenes de esta vuelta en data/mirror.json.\n` +
      `   Espera un rato o cambia de red y ejecuta de nuevo el mismo comando:\n` +
      `   continuara donde se quedo, sin volver a bajar lo ya descargado.\n`,
  );
  process.exit(2);
}

if (KEEP_REMOTE) {
  console.log('4/4 --keep-remote: el catalogo sigue apuntando al CDN\n');
} else {
  const local = (url) => (mirror[url] ? `/${mirror[url]}` : url);
  for (const product of products) {
    if (product.image) product.image = local(product.image);
    if (Array.isArray(product.images)) product.images = product.images.map(local);
  }
  await writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2), 'utf8');
  const pending = products.filter((p) => p.image?.startsWith('http')).length;
  console.log(`4/4 catalogo actualizado${pending ? ` (${pending} productos siguen en el CDN)` : ''}\n`);
}

console.log(`3/4 data/mirror.json con ${Object.keys(mirror).length} entradas`);

if (failed.length) {
  console.log(`Fallaron ${failed.length}. Primeras 5:`);
  for (const f of failed.slice(0, 5)) console.log(`   ${f.error} ${f.url}`);
}
