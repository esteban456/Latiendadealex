/**
 * Lee las cabeceras de las imagenes sin librerias: IHDR de PNG y SOF de JPEG.
 * Sirve para decidir la estrategia de compresion antes de instalar nada.
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';

const DIR = 'public/assets/img/productos';
const archivos = (await readdir(DIR)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));

function png(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  const tipoColor = { 0: 'gris', 2: 'rgb', 3: 'paleta', 4: 'gris+alfa', 6: 'rgba' };
  return {
    ancho: buf.readUInt32BE(16),
    alto: buf.readUInt32BE(20),
    bits: buf[24],
    color: tipoColor[buf[25]] || buf[25],
    entrelazado: buf[28] === 1,
  };
}

function jpg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let o = 2;
  while (o < buf.length - 9) {
    if (buf[o] !== 0xff) {
      o++;
      continue;
    }
    const m = buf[o + 1];
    // SOF0..SOF15 salvo los marcadores que no son SOF (DHT/JPG/DAC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { ancho: buf.readUInt16BE(o + 7), alto: buf.readUInt16BE(o + 5), componentes: buf[o + 9] };
    }
    o += 2 + buf.readUInt16BE(o + 2);
  }
  return null;
}

const resumen = new Map();
let problemas = 0;

for (const f of archivos) {
  const buf = await readFile(`${DIR}/${f}`);
  const ext = extname(f).toLowerCase();
  const info = ext === '.png' ? png(buf) : jpg(buf);
  if (!info) {
    problemas++;
    console.log(`  no pude leer la cabecera: ${f}`);
    continue;
  }
  const grande = info.ancho > 800 || info.alto > 800;
  const clave = `${ext}|${info.ancho}x${info.alto}|${info.bits ?? ''}${info.color ?? ''}${info.componentes ?? ''}`;
  const r = resumen.get(clave) || { n: 0, bytes: 0, grande: grande };
  r.n++;
  r.bytes += buf.length;
  resumen.set(clave, r);
}

console.log(`\n${archivos.length} imagenes leidas, ${resumen.size} formas distintas:\n`);
const filas = [...resumen.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
console.log('  formato  dimensiones      profundidad  n     peso medio');
for (const [clave, r] of filas) {
  const [ext, dims, prof] = clave.split('|');
  console.log(
    `  ${ext.padEnd(7)} ${dims.padEnd(14)} ${(prof || '?').padEnd(11)} ${String(r.n).padStart(5)} ${Math.round(r.bytes / r.n / 1024)} KB${r.grande ? '  <- mayor de 800px' : ''}`,
  );
}
const total = [...resumen.values()].reduce((a, r) => a + r.bytes, 0);
console.log(`\n  total ${Math.round(total / 1024 / 1024)} MB, ${problemas} cabeceras ilegibles`);
