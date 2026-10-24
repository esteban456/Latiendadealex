/**
 * Sube a ImageKit las imagenes de la carpeta "CATALOGO +1" que usa la lista
 * productos.txt, y guarda el mapa nombre-de-archivo -> URL en
 * data/catalogo-imagekit.json para que el importador arme los productos.
 *
 *   node scripts/upload-catalogo-images.mjs            # todas las referenciadas
 *   node scripts/upload-catalogo-images.mjs --limit 5  # prueba
 *
 * Lee IMAGEKIT_PRIVATE_KEY / IMAGEKIT_URL_ENDPOINT / IMAGEKIT_FOLDER del .env.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, '.env');
const IMG_DIR = join(ROOT, 'CATÁLOGO +1');
const LIST_FILE = join(ROOT, 'productos.txt');
const MAP_FILE = join(ROOT, 'data', 'catalogo-imagekit.json');

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const LIMIT = Number(arg('limit', Infinity)) || Infinity;

const env = loadEnv(await readFile(ENV_FILE, 'utf8'));
const KEY = env.IMAGEKIT_PRIVATE_KEY;
const FOLDER = env.IMAGEKIT_FOLDER || '/Latiendadealex';
if (!KEY) {
  console.error('Falta IMAGEKIT_PRIVATE_KEY en .env');
  process.exit(1);
}

const list = await readFile(LIST_FILE, 'utf8');
const refs = new Set();
for (const m of list.matchAll(/\[Imágenes:\s*([^\]]+)\]/g)) {
  for (const f of m[1].split(',')) {
    const name = f.trim();
    if (name) refs.add(name);
  }
}
const names = [...refs].slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

let map = {};
try { map = JSON.parse(await readFile(MAP_FILE, 'utf8')); } catch { /* nuevo */ }

const auth = Buffer.from(`${KEY}:`).toString('base64');
const failed = [];
let ok = 0;
let reused = 0;
let cursor = 0;

async function upload(name) {
  if (map[name]) { reused++; return; }
  let bytes;
  try {
    bytes = await readFile(join(IMG_DIR, name));
  } catch {
    failed.push({ name, error: 'no existe en la carpeta' });
    return;
  }
  const form = new FormData();
  form.set('file', new Blob([bytes]), name);
  form.set('fileName', name);
  form.set('folder', FOLDER);
  form.set('useUniqueFileName', 'false');
  try {
    const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.message || `HTTP ${res.status}`);
    map[name] = data.url;
    ok++;
  } catch (err) {
    failed.push({ name, error: err.message });
  }
}

const runners = Array.from({ length: 4 }, async () => {
  while (cursor < names.length) {
    const name = names[cursor++];
    await upload(name);
    process.stdout.write(`   ${ok + reused + failed.length}/${names.length}\r`);
  }
});
await Promise.all(runners);

await writeFile(MAP_FILE, JSON.stringify(map, null, 2), 'utf8');
console.log(`\nSubidas ${ok}, ya estaban ${reused}, fallidas ${failed.length}. Mapa en ${MAP_FILE}`);
for (const f of failed.slice(0, 20)) console.log(`   ${f.name}: ${f.error}`);
