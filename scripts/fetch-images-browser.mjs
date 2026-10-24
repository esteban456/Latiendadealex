#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_FILE = join(ROOT, 'data', 'catalog.json');
const LOG_FILE = join(ROOT, 'data', 'fetch-images.log.jsonl');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const LIMIT = Number(opt('limit', 0));
const OFFSET = Number(opt('offset', 0));

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  const pending = (catalog.products || []).filter(needsImage);
  console.log(`sin imagen: ${pending.length}`);
  const queue = pending.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined);
  console.log(`procesar: ${queue.length}`);
  const qfile = join(ROOT, 'data', 'fetch-queue.json');
  await writeFile(qfile, JSON.stringify({ queue }, null, 1));
  const url = 'http://localhost:3000/admin.html';
  await openBrowser(url + '#bulk-fetch');
}
function needsImage(product) {
  const image = String(product.image || '');
  if (!image) return true;
  if (image.startsWith('/assets/img/productos-webp/')) return false;
  if (/^https?:\/\//i.test(image)) return false;
  return true;
}
async function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') {
    cmd = 'start'; args = ['""', url];
  } else if (platform === 'darwin') cmd = 'open'; args = [url];
  else cmd = 'xdg-open'; args = [url];
  const p = spawn(cmd, args, { shell: true, detached: true });
  p.unref();
}
main().catch(e => { console.error(e); process.exit(1); });
