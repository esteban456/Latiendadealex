#!/usr/bin/env node
/**
 * fetch-images.mjs — Busca en internet fotos de los productos SIN imagen del
 * catálogo y las procesa con el mismo flujo del panel de administración:
 *
 *   1. Busca una imagen del producto en la web (DuckDuckGo, fallback Bing).
 *   2. Descarga y valida la foto (mínimo 300 px, JPEG/PNG/WebP).
 *   3. Le quita el fondo con @imgly/background-removal-node.
 *   4. La superpone sobre public/assets/img/plantilla.jpg con la misma
 *      geometría del admin (72% ancho × 43% alto, centrada en X y a la
 *      altura 49% de la plantilla).
 *   5. La sube a ImageKit con la clave privada de .env y guarda la URL
 *      devuelta en el catálogo (igual que hace el admin).
 *
 * El catálogo se escribe de forma atómica (tmp + rename) cada pocos
 * productos, así que el proceso se puede cortar y reanudar sin perder
 * nada: al volver a ejecutarlo salta los que ya tienen imagen.
 *
 * Uso:
 *   node scripts/fetch-images.mjs                 # todo lo que falta
 *   node scripts/fetch-images.mjs --limit 5       # prueba rápida
 *   node scripts/fetch-images.mjs --offset 50     # saltar los primeros 50
 *   node scripts/fetch-images.mjs --dry-run       # busca y descarga, no sube
 *   node scripts/fetch-images.mjs --keep-remote   # mantiene la URL previa si
 *                                                 # el producto ya tenía http
 *
 * Progreso y fallos quedan en data/fetch-images.log.jsonl (un JSON por línea).
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_FILE = join(ROOT, 'data', 'catalog.json');
const TEMPLATE_FILE = join(ROOT, 'public', 'assets', 'img', 'plantilla.jpg');
const LOCAL_IMAGES_DIR = join(ROOT, 'data', 'fetched-images');
const LOG_FILE = join(ROOT, 'data', 'fetch-images.log.jsonl');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const LIMIT = Number(opt('limit', 0));
const OFFSET = Number(opt('offset', 0));
const DRY_RUN = flag('dry-run');
const SAVE_REMOTE = flag('keep-remote');

const env = await readEnv();
const IK_KEY = env.IMAGEKIT_PRIVATE_KEY || '';
const IK_FOLDER = env.IMAGEKIT_FOLDER || '/Latiendadealex';
const IK_ENDPOINT = 'https://upload.imagekit.io/api/v1/files/upload';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

main().catch((error) => {
  console.error('Error fatal:', error.message);
  process.exit(1);
});

async function main() {
  if (!existsSync(TEMPLATE_FILE)) throw new Error(`No existe la plantilla: ${TEMPLATE_FILE}`);
  if (!DRY_RUN && !IK_KEY) throw new Error('Falta IMAGEKIT_PRIVATE_KEY en .env (o usa --dry-run).');

  const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  const pending = (catalog.products || []).filter((product) => needsImage(product));

  console.log(`Productos en el catálogo: ${catalog.products.length}`);
  console.log(`Sin imagen (o imagen rota): ${pending.length}`);
  console.log(`Modo: ${DRY_RUN ? 'prueba (sin subir a ImageKit)' : 'producción (sube a ImageKit)'}\n`);

  const queue = pending.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined);
  console.log(`Esta ejecución procesará: ${queue.length} productos\n`);

  let done = 0;
  let failed = 0;
  for (const [index, product] of queue.entries()) {
    const label = `[${index + 1}/${queue.length}] ${product.name}`;
    try {
      const url = await processProduct(product);
      product.image = url;
      done += 1;
      console.log(`✔ ${label}\n  → ${url}`);
      await log({ ok: true, id: product.id, name: product.name, url });
    } catch (error) {
      failed += 1;
      console.log(`✘ ${label}\n  → ${error.message}`);
      await log({ ok: false, id: product.id, name: product.name, error: error.message });
    }
    // Guarda el catálogo cada 5 productos para poder reanudar.
    if ((index + 1) % 5 === 0 || index === queue.length - 1) {
      await writeCatalogAtomic(catalog);
      console.log(`  …catálogo guardado (${done} listos, ${failed} fallos)\n`);
    }
  }

  await writeCatalogAtomic(catalog);
  console.log(`\nListo: ${done} imágenes procesadas, ${failed} fallos.`);
}

function needsImage(product) {
  const image = String(product.image || '');
  if (!image) return true;
  // Rutas locales a /assets/img/productos-webp/ se sirven desde ImageKit
  // (las convierte server/index.js con withImageKit), esas cuentan como imagen.
  if (image.startsWith('/assets/img/productos-webp/')) return false;
  if (/^https?:\/\//i.test(image)) return false;
  return true;
}

async function processProduct(product) {
  const query = buildQuery(product);
  const candidates = await searchImages(query);
  if (!candidates.length) throw new Error(`Sin resultados para: ${query}`);

  const photo = await downloadFirstValid(candidates);
  const noBg = await removePhotoBackground(photo);

  const composed = await composeOnTemplate(noBg);
  const localPath = join(LOCAL_IMAGES_DIR, `${product.id}.webp`);
  await mkdir(LOCAL_IMAGES_DIR, { recursive: true });
  await writeFile(localPath, composed);

  if (DRY_RUN) return `data/fetched-images/${product.id}.webp (dry-run)`;
  return uploadToImageKit(composed, product.id);
}

function buildQuery(product) {
  const parts = [product.brand, product.name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Quita ruido de nombres comerciales: medidas, códigos muy raros no estorban
  // en la búsqueda, pero sí los emoji y comillas tipográficas.
  return parts
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[''""«»]/g, '')
    .trim();
}

/* ---------- búsqueda de imágenes ---------- */

async function searchImages(query) {
  try {
    const results = await searchDuckDuckGo(query);
    if (results.length) return results;
  } catch (error) {
    console.log(`  (DuckDuckGo falló: ${error.message}, intentando con Bing)`);
  }
  try {
    return await searchBing(query);
  } catch (error) {
    throw new Error(`Bing también falló: ${error.message}`);
  }
}

async function searchDuckDuckGo(query) {
  const page = await fetchText(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`
  );
  const vqd =
    page.match(/vqd=["']?([\d-]+)["']?/)?.[1] ||
    page.match(/vqd=([\d-]+)/)?.[1];
  if (!vqd) throw new Error('No se encontró el token vqd');

  const url =
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}` +
    `&vqd=${vqd}&f=,,,,,&p=1`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      Referer: 'https://duckduckgo.com/',
    },
  });
  if (!response.ok) throw new Error(`i.js respondió ${response.status}`);
  const data = await response.json().catch(() => null);
  const items = Array.isArray(data?.results) ? data.results : [];
  return items
    .map((item) => ({ url: item.image, width: item.width, height: item.height, title: item.title }))
    .filter((item) => item.url && /^https?:/i.test(item.url));
}

async function searchBing(query) {
  const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=1&count=35&mmasync=1`;
  const html = await fetchText(url);
  const results = [];
  const regex = /murl&quot;:&quot;(.*?)&quot;/g;
  let match;
  while ((match = regex.exec(html)) && results.length < 20) {
    const raw = match[1].replace(/&amp;/g, '&').replace(/\\u002f/gi, '/');
    if (/^https?:/i.test(raw)) results.push({ url: raw });
  }
  return results;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/json' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/* ---------- descarga y validación ---------- */

async function downloadFirstValid(candidates) {
  let lastError = null;
  for (const candidate of candidates.slice(0, 8)) {
    try {
      const response = await fetch(candidate.url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 5_000) throw new Error('archivo demasiado pequeño');
      if (buffer.length > 12 * 1024 * 1024) throw new Error('archivo demasiado grande');

      const metadata = await sharp(buffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      if (width < 300 || height < 300) throw new Error(`resolución baja (${width}x${height})`);
      return buffer;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Ninguna imagen válida de ${candidates.length} candidatas (${lastError?.message})`);
}

/* ---------- quita de fondo y plantilla (igual que el admin) ---------- */

async function removePhotoBackground(buffer) {
  // @imgly/background-removal-node decodifica la foto con un sharp anidado
  // que falla en Windows ("colourspace: parameter space not set"). Se lo
  // entregamos ya decodificado en RAW RGBA (modo image/x-rgba8, que el
  // paquete soporta) usando el sharp principal, que sí funciona bien.
  const decoded = sharp(buffer).ensureAlpha();
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  const mime = `image/x-rgba8; width=${info.width}; height=${info.height}`;
  const result = await removeBackground(new Blob([data], { type: mime }));
  return Buffer.from(await result.arrayBuffer());
}

async function composeOnTemplate(noBgPng) {
  const template = sharp(TEMPLATE_FILE);
  const { width: canvasWidth, height: canvasHeight } = await template.metadata();
  const base = await template.png().toBuffer();

  const source = sharp(noBgPng);
  const { width: sourceWidth, height: sourceHeight } = await source.metadata();

  const maxWidth = canvasWidth * 0.72;
  const maxHeight = canvasHeight * 0.43;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const productWidth = Math.round(sourceWidth * scale);
  const productHeight = Math.round(sourceHeight * scale);
  const x = Math.round((canvasWidth - productWidth) / 2);
  const y = Math.round(canvasHeight * 0.49 - productHeight / 2);

  const resized = await source.resize(productWidth, productHeight).png().toBuffer();

  return sharp(base)
    .composite([{ input: resized, left: x, top: Math.max(0, y) }])
    .webp({ quality: 82 })
    .toBuffer();
}

/* ---------- subida a ImageKit (misma lógica que server/index.js) ---------- */

async function uploadToImageKit(buffer, productId) {
  const form = new FormData();
  const fileName = `producto-${productId}-${Date.now()}.webp`;
  form.set('file', new Blob([buffer], { type: 'image/webp' }), fileName);
  form.set('fileName', fileName);
  form.set('folder', IK_FOLDER);
  form.set('useUniqueFileName', 'true');

  const authorization = Buffer.from(`${IK_KEY}:`).toString('base64');
  const response = await fetch(IK_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}` },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) {
    throw new Error(`ImageKit ${response.status}: ${result.message || 'sin URL'}`);
  }
  return result.url;
}

/* ---------- catálogo y utilidades ---------- */

async function writeCatalogAtomic(catalog) {
  catalog.generatedAt = new Date().toISOString();
  const tmp = `${CATALOG_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(catalog, null, 1));
  await rename(tmp, CATALOG_FILE);
}

async function log(entry) {
  await mkdir(dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, {
    flag: 'a',
  });
}

async function readEnv() {
  try {
    const text = await readFile(join(ROOT, '.env'), 'utf8');
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}
