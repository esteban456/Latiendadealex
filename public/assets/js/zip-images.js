/* Lee un .zip en el navegador y devuelve solo las imágenes que contiene.
   No sube el ZIP a ningún servidor: la descompresión ocurre en el equipo. */
(function () {
  'use strict';

  const IMAGE_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
  };
  const MAX_ENTRIES = 300;
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const LOCAL_SIGNATURE = 0x04034b50;

  function isZip(file) {
    return /\.zip$/i.test(file?.name || '') || /zip/i.test(file?.type || '');
  }

  function baseName(path) {
    return String(path).split('/').pop().split('\\').pop();
  }

  function findEndOfCentralDirectory(view) {
    const min = Math.max(0, view.byteLength - 22 - 0xffff);
    for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
      if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
    }
    throw new Error('El archivo no parece un ZIP válido.');
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Tu navegador no puede descomprimir ZIP. Actualízalo o sube las imágenes sueltas.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extractImages(file) {
    if (!isZip(file)) throw new Error('Selecciona un archivo .zip.');
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const eocd = findEndOfCentralDirectory(view);
    const totalEntries = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);

    if (totalEntries === 0xffff || centralOffset === 0xffffffff) {
      throw new Error('El ZIP es demasiado grande o usa un formato no compatible.');
    }
    if (totalEntries > MAX_ENTRIES) {
      throw new Error(`El ZIP tiene demasiados archivos (${totalEntries}). Usa uno con máximo ${MAX_ENTRIES}.`);
    }

    const decoder = new TextDecoder('utf-8');
    const images = [];
    let totalBytes = 0;
    let offset = centralOffset;
    let encrypted = 0;

    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > buffer.byteLength) break;
      if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
      offset += 46 + nameLength + extraLength + commentLength;

      if (!name || name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
      if (/(^|\/)\./.test(name)) continue;
      if (flags & 1) { encrypted += 1; continue; } // archivo cifrado

      const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      const type = IMAGE_TYPES[extension];
      if (!type) continue;
      if (uncompressedSize > MAX_IMAGE_BYTES) continue;
      if (totalBytes + uncompressedSize > MAX_TOTAL_BYTES) break;
      if (compressedSize === 0) continue;
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) continue;
      if (localOffset + 30 > buffer.byteLength) continue;
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;

      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.byteLength) continue;

      const compressed = new Uint8Array(buffer, dataStart, compressedSize);
      let data;
      if (method === 0) data = compressed.slice();
      else if (method === 8) data = await inflateRaw(compressed);
      else continue;

      totalBytes += data.byteLength;
      images.push(new File([data], baseName(name), { type, lastModified: Date.now() }));
    }

    if (!images.length && encrypted) {
      throw new Error('El ZIP está protegido con contraseña. Quítale la contraseña e inténtalo de nuevo.');
    }

    return images;
  }

  window.AlxZip = { extractImages, isZip };
})();
