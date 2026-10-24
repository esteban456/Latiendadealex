import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const INPUT_DIR = new URL('../public/assets/img/productos/', import.meta.url).pathname;
const OUTPUT_DIR = new URL('../public/assets/img/productos-webp/', import.meta.url).pathname;
const THUMB_DIR = new URL('../public/assets/img/thumbnails/', import.meta.url).pathname;

const QUALITY_WEBP = 80;
const QUALITY_JPEG = 85;
const THUMB_SIZE = 200;
const MEDIUM_SIZE = 400;

async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch { /* ya existe */ }
}

async function getFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(jpg|jpeg|png)$/i.test(e.name))
    .map((e) => e.name);
}

async function convertImage(inputPath, outputPath, format, quality, size) {
  const args = [inputPath];
  if (size) {
    args.push('-resize', `${size}x${size}>`);
  }
  args.push('-quality', String(quality));
  args.push(outputPath);

  try {
    await execFileAsync('convert', args, { timeout: 30000 });
    return true;
  } catch {
    // Si ImageMagick no está disponible, copiar el original
    try {
      const data = await readFile(inputPath);
      await writeFile(outputPath, data);
      return false;
    } catch {
      return false;
    }
  }
}

async function main() {
  console.log('=== Optimizador de imágenes ===\n');

  await ensureDir(OUTPUT_DIR);
  await ensureDir(THUMB_DIR);

  const files = await getFiles(INPUT_DIR);
  console.log(`📁 ${files.length} imágenes encontradas\n`);

  let webpCount = 0;
  let thumbCount = 0;
  let mediumCount = 0;
  let errorCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const inputPath = join(INPUT_DIR, file);
    const ext = extname(file).toLowerCase();
    const baseName = file.replace(/\.[^.]+$/, '');

    // WebP versión completa
    const webpPath = join(OUTPUT_DIR, `${baseName}.webp`);
    const webpOk = await convertImage(inputPath, webpPath, 'webp', QUALITY_WEBP);
    if (webpOk) webpCount++;

    // Thumbnail 200x200
    const thumbPath = join(THUMB_DIR, `${baseName}.webp`);
    const thumbOk = await convertImage(inputPath, thumbPath, 'webp', QUALITY_WEBP, THUMB_SIZE);
    if (thumbOk) thumbCount++;

    // Medium 400x400
    const mediumPath = join(OUTPUT_DIR, `${baseName}-400.webp`);
    const mediumOk = await convertImage(inputPath, mediumPath, 'webp', QUALITY_WEBP, MEDIUM_SIZE);
    if (mediumOk) mediumCount++;

    if (!webpOk && !thumbOk && !mediumOk) errorCount++;

    if ((i + 1) % 100 === 0 || i === files.length - 1) {
      console.log(`  Procesadas: ${i + 1}/${files.length}`);
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`  WebP completos: ${webpCount}`);
  console.log(`  Thumbnails: ${thumbCount}`);
  console.log(`  Medium (400px): ${mediumCount}`);
  console.log(`  Errores: ${errorCount}`);
  console.log(`\n✅ Optimización completada`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
