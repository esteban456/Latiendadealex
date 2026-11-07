(() => {
  const $ = (selector) => document.querySelector(selector);
  const modal = $('#bulk-products-modal');
  if (!modal) return;
  let rows = [];

  const aliases = {
    name: ['nombre', 'name', 'producto', 'product'],
    brand: ['marca', 'brand'],
    cost: ['costo', 'cost', 'precio costo', 'precio_costo'],
    stock: ['stock', 'existencias', 'unidades', 'inventario'],
    category: ['categoria', 'categoría', 'category'],
    description: ['descripcion', 'descripción', 'description', 'detalle'],
    image: ['imagen', 'image', 'foto', 'url imagen', 'url_imagen'],
    images: ['imagenes', 'imágenes', 'images', 'fotos', 'urls'],
    credit: ['credito', 'crédito', 'ofrecer credito', 'offer credit'],
  };

  function normalize(value) {
    return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ _-]+/g, ' ');
  }

  function pick(record, names) {
    const keys = Object.keys(record);
    const key = keys.find((candidate) => names.includes(normalize(candidate)));
    return key ? record[key] : '';
  }

  function number(value, fallback = 0) {
    const text = String(value ?? '').trim().replace(/\s/g, '');
    if (!text) return fallback;
    const parsed = text.includes(',') && text.includes('.')
      ? Number(text.replace(/\./g, '').replace(',', '.'))
      : Number(text.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function toProduct(record) {
    const name = String(pick(record, aliases.name) || '').trim();
    const category = String(pick(record, aliases.category) || '').trim();
    const image = String(pick(record, aliases.image) || '').trim();
    const imageList = String(pick(record, aliases.images) || '').split(/[|;\n]/).map((item) => item.trim()).filter(Boolean);
    const images = [...new Set([image, ...imageList])].slice(0, 8);
    const cost = number(pick(record, aliases.cost));
    const stock = Math.max(0, Math.floor(number(pick(record, aliases.stock))));
    const credit = String(pick(record, aliases.credit)).toLowerCase();
    return {
      name, brand: String(pick(record, aliases.brand) || '').trim(),
      cost, stock, category, description: String(pick(record, aliases.description) || '').trim(),
      image: images[0] || '', images,
      offerCredit: !['no', 'no ofrecer', 'false', '0'].includes(credit),
    };
  }

  function csvRows(text) {
    const lines = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i], next = text[i + 1];
      if (char === '"' && quoted && next === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(value); value = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(value); if (row.some((item) => item.trim())) lines.push(row);
        row = []; value = '';
      } else value += char;
    }
    row.push(value); if (row.some((item) => item.trim())) lines.push(row);
    const headers = lines.shift() || [];
    return lines.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
  }

  async function readFile(file) {
    if (window.XLSX) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const first = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_json(first, { defval: '' });
    }
    return csvRows(await file.text());
  }

  function message(text, kind = '') {
    const node = $('#bulk-products-notice');
    node.textContent = text; node.className = `notice ${kind}`; node.hidden = !text;
  }

  function render() {
    const preview = $('#bulk-products-preview');
    const valid = rows.filter((item) => item.name && item.category && item.cost > 0);
    $('#bulk-products-summary').textContent = rows.length
      ? `${rows.length} filas detectadas; ${valid.length} listas para importar.`
      : 'Aún no has seleccionado un archivo.';
    preview.innerHTML = rows.slice(0, 100).map((item, index) => {
      const ok = item.name && item.category && item.cost > 0;
      const reason = ok ? 'Lista' : (!item.name ? 'Falta nombre' : !item.category ? 'Falta categoría' : 'Costo inválido');
      return `<tr><td>${index + 2}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.category)}</td><td>${item.cost ? item.cost.toLocaleString('es-CO') : '—'}</td><td>${item.stock}</td><td class="${ok ? '' : 'danger-text'}">${reason}</td></tr>`;
    }).join('');
    $('#bulk-products-preview-wrap').hidden = !rows.length;
    $('#bulk-products-submit').disabled = valid.length === 0;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function close() {
    modal.hidden = true; document.body.classList.remove('modal-open');
    rows = []; $('#bulk-products-file').value = ''; message(''); render();
  }

  $('#bulk-products-open').addEventListener('click', () => { modal.hidden = false; document.body.classList.add('modal-open'); });
  $('#bulk-products-close').addEventListener('click', close);
  $('#bulk-products-cancel').addEventListener('click', close);
  $('#bulk-products-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('El archivo no puede superar 2 MB.');
      const records = await readFile(file);
      rows = records.map(toProduct).slice(0, 100);
      if (records.length > 100) message('Solo se tomarán las primeras 100 filas.', 'error');
      render();
    } catch (error) {
      rows = []; render(); message(error.message || 'No se pudo leer el archivo.', 'error');
    }
  });

  $('#bulk-products-submit').addEventListener('click', async () => {
    const products = rows.filter((item) => item.name && item.category && item.cost > 0);
    const button = $('#bulk-products-submit');
    button.disabled = true; button.textContent = 'Importando…'; message('Guardando productos, espera un momento…');
    try {
      const sessionResponse = await fetch('/api/admin/session', { credentials: 'same-origin' });
      const session = await sessionResponse.json();
      if (!session.authenticated || !session.csrf) throw new Error('La sesión expiró. Vuelve a entrar al panel.');
      const response = await fetch('/api/admin/products/bulk', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrf: session.csrf, products }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo importar el archivo.');
      const text = data.failed ? `Importados: ${data.processed}. Filas con error: ${data.failed}.` : `Se importaron ${data.processed} productos correctamente.`;
      message(text, data.failed ? 'error' : '');
      button.textContent = 'Importar productos';
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      message(error.message || 'No se pudo completar la importación.', 'error');
      button.disabled = false; button.textContent = 'Importar productos';
    }
  });
})();
