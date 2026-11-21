/* Importa un ZIP de imágenes y asigna cada foto al producto cuyo código/SKU
   coincide con el nombre del archivo. Todo el proceso se revisa antes de subir. */
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const modal = $('#bulk-zip-modal');
  if (!modal) return;

  const MAX_IMAGES = 8;
  const MAX_BATCH = 100;
  const state = {
    rows: [],
    busy: false,
  };

  function setNotice(message = '', type = 'success') {
    const box = $('#bulk-zip-notice');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message;
    box.className = `notice${type === 'error' ? ' error' : ''}`;
  }

  function escapeHtml(value = '') {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function normalizeCode(value) {
    return String(value || '')
      .replace(/\.(png|jpe?g|webp|gif|avif)$/i, '')
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function statusLabel(row) {
    if (row.status === 'matched') return 'Lista';
    if (row.status === 'uploading') return 'Subiendo…';
    if (row.status === 'uploaded') return 'Subida';
    if (row.status === 'ready') return 'Falta asignar';
    if (row.status === 'saved') return 'Asignada';
    if (row.status === 'unmatched') return 'Sin coincidencia';
    if (row.status === 'ambiguous') return 'Código repetido';
    if (row.status === 'full') return 'Galería llena';
    if (row.status === 'error') return 'Error';
    return row.status;
  }

  function statusClass(status) {
    if (status === 'saved') return 'success-text';
    if (['unmatched', 'ambiguous', 'full', 'error'].includes(status)) return 'danger-text';
    return '';
  }

  function updateButtons() {
    const hasWork = state.rows.some((row) => ['matched', 'ready', 'uploaded'].includes(row.status));
    const submit = $('#bulk-zip-submit');
    if (submit) {
      submit.disabled = state.busy || !hasWork;
      submit.textContent = state.rows.some((row) => row.status === 'ready' || row.status === 'uploaded')
        ? 'Asignar imágenes pendientes'
        : 'Asignar imágenes';
    }
    $('#bulk-zip-file').disabled = state.busy;
    $('#bulk-zip-cancel').disabled = state.busy;
    $('#bulk-zip-close').disabled = state.busy;
  }

  function render() {
    const rows = state.rows;
    const matched = rows.filter((row) => ['matched', 'uploading', 'uploaded', 'ready', 'saved'].includes(row.status)).length;
    const saved = rows.filter((row) => row.status === 'saved').length;
    const problems = rows.filter((row) => ['unmatched', 'ambiguous', 'full', 'error'].includes(row.status)).length;
    const summary = $('#bulk-zip-summary');
    if (!rows.length) {
      summary.textContent = 'Aún no has seleccionado un ZIP.';
    } else {
      summary.textContent = `${rows.length} imágenes · ${matched} con producto · ${problems} con problema${saved ? ` · ${saved} asignadas` : ''}.`;
    }
    $('#bulk-zip-preview-wrap').hidden = rows.length === 0;
    $('#bulk-zip-preview').innerHTML = rows.map((row) => {
      const product = row.product
        ? `<strong>${escapeHtml(row.product.name || row.product.id)}</strong><small>${escapeHtml(row.product.id || '')}</small>`
        : '—';
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:8px"><img src="${escapeHtml(row.url)}" alt="" style="width:38px;height:38px;object-fit:contain;border:1px solid #e5e9ed;border-radius:6px;background:#fff" /><span>${escapeHtml(row.file.name)}</span></div></td>
        <td><code>${escapeHtml(row.code || '—')}</code></td>
        <td>${product}</td>
        <td class="${statusClass(row.status)}">${escapeHtml(statusLabel(row))}${row.message ? `<small>${escapeHtml(row.message)}</small>` : ''}</td>
      </tr>`;
    }).join('');
    updateButtons();
  }

  function reset() {
    for (const row of state.rows) {
      if (row.url) URL.revokeObjectURL(row.url);
    }
    state.rows = [];
    state.busy = false;
    setNotice('');
    const fileInput = $('#bulk-zip-file');
    if (fileInput) fileInput.value = '';
    render();
  }

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ocurrió un error. Intenta de nuevo.');
    return data;
  }

  function buildIndex(products) {
    const index = new Map();
    for (const product of products) {
      for (const code of product.codes || []) {
        const list = index.get(code) || [];
        if (!list.some((item) => item.id === product.id)) list.push(product);
        index.set(code, list);
      }
    }
    return index;
  }

  async function handleFile(file) {
    if (!file) return;
    reset();
    if (!window.AlxZip) {
      setNotice('No se cargó el lector de ZIP. Recarga la página e inténtalo de nuevo.', 'error');
      return;
    }
    state.busy = true;
    updateButtons();
    setNotice('Leyendo el ZIP…');
    try {
      let images = await window.AlxZip.extractImages(file);
      if (!images.length) throw new Error('El ZIP no contiene imágenes compatibles (JPG, PNG, WebP, GIF o AVIF).');
      const recortado = images.length > MAX_BATCH;
      if (recortado) images = images.slice(0, MAX_BATCH);

      setNotice('Buscando coincidencias con los códigos de los productos…');
      const data = await request('/api/admin/products/codes');
      const index = buildIndex(data.products || []);
      const rows = images.map((image) => {
        const code = normalizeCode(image.name);
        const matches = [...new Map((index.get(code) || []).map((product) => [product.id, product])).values()];
        const row = {
          file: image,
          url: URL.createObjectURL(image),
          code,
          product: null,
          status: 'unmatched',
          message: '',
          uploadedUrl: '',
        };
        if (!matches.length) {
          row.status = 'unmatched';
        } else if (matches.length > 1) {
          row.status = 'ambiguous';
          row.message = `${matches.length} productos usan este código`;
        } else {
          row.product = matches[0];
          row.status = Number(row.product.imageCount || 0) >= MAX_IMAGES ? 'full' : 'matched';
          if (row.status === 'full') row.message = `Ya tiene ${MAX_IMAGES} imágenes`;
        }
        return row;
      });

      const usados = new Map();
      for (const row of rows) {
        if (row.status !== 'matched') continue;
        const usadosProducto = usados.get(row.product.id) || 0;
        if (Number(row.product.imageCount || 0) + usadosProducto >= MAX_IMAGES) {
          row.status = 'full';
          row.message = `Ya tiene ${MAX_IMAGES} imágenes`;
        } else {
          usados.set(row.product.id, usadosProducto + 1);
        }
      }

      state.rows = rows;
      render();
      const listas = rows.filter((row) => row.status === 'matched').length;
      if (recortado) {
        setNotice(`El ZIP tiene más de ${MAX_BATCH} imágenes; solo se procesarán las primeras ${MAX_BATCH}. Listas: ${listas}.`, 'error');
      } else if (!listas) {
        setNotice('Ninguna imagen coincide con un código de producto. Revisa los nombres de los archivos.', 'error');
      } else {
        setNotice(`Listo: ${listas} imágenes coinciden y se pueden asignar.`, 'success');
      }
    } catch (error) {
      setNotice(error.message || 'No se pudo leer el ZIP.', 'error');
      state.rows = [];
      render();
    } finally {
      state.busy = false;
      updateButtons();
    }
  }

  async function composeImage(file, product) {
    if (file.size > 15 * 1024 * 1024) throw new Error('La imagen supera 15 MB.');
    const isPhone = typeof isAndroidPhoneCategory === 'function'
      && isAndroidPhoneCategory(product.category || '', product.brand || '', product.name || '');
    const templates = typeof PHONE_BACKGROUND_TEMPLATES !== 'undefined' ? PHONE_BACKGROUND_TEMPLATES : {};
    const background = product.imageBackground || 'phone-ice';
    const templatePath = isPhone
      ? (templates[background] || templates['phone-ice'] || '/assets/img/plantilla.jpg')
      : '/assets/img/plantilla.jpg';

    const templateResponse = await fetch(templatePath, { cache: 'force-cache' });
    if (!templateResponse.ok) throw new Error('No se encontró la plantilla de imagen.');
    const templateBitmap = await createImageBitmap(await templateResponse.blob());
    let hubBitmap = null;
    if (isPhone) {
      const hubResponse = await fetch('/assets/img/plantilla/Hub.png', { cache: 'force-cache' });
      if (!hubResponse.ok) throw new Error('No se encontró la capa Hub para celulares.');
      hubBitmap = await createImageBitmap(await hubResponse.blob());
    }

    const productBitmap = await createImageBitmap(file, { resizeWidth: 1400, resizeQuality: 'high' });
    const canvas = document.createElement('canvas');
    canvas.width = templateBitmap.width;
    canvas.height = templateBitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(templateBitmap, 0, 0, canvas.width, canvas.height);
    if (hubBitmap) context.drawImage(hubBitmap, 0, 0, canvas.width, canvas.height);
    const maxWidth = canvas.width * 0.72;
    const maxHeight = canvas.height * 0.43;
    const scale = Math.min(maxWidth / productBitmap.width, maxHeight / productBitmap.height);
    const productWidth = productBitmap.width * scale;
    const productHeight = productBitmap.height * scale;
    context.drawImage(productBitmap, (canvas.width - productWidth) / 2, canvas.height * 0.49 - productHeight / 2, productWidth, productHeight);
    productBitmap.close();
    templateBitmap.close();
    hubBitmap?.close();
    const dataUrl = canvas.toDataURL('image/webp', 0.78);
    if (dataUrl.length > 5_300_000) throw new Error('La imagen sigue siendo muy pesada.');
    return dataUrl;
  }

  async function uploadDataUrl(dataUrl, csrf) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      return await request('/api/admin/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, csrf }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('La subida tardó más de 45 segundos.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function submit() {
    if (state.busy) return;
    const rows = state.rows.filter((row) => ['matched', 'ready', 'uploaded'].includes(row.status));
    if (!rows.length) {
      setNotice('No hay imágenes coincidentes para asignar.', 'error');
      return;
    }
    state.busy = true;
    updateButtons();
    setNotice('Preparando las imágenes…');
    try {
      const session = await request('/api/admin/session');
      if (!session.authenticated || !session.csrf) {
        throw new Error('La sesión expiró. Recarga el panel e inicia sesión de nuevo.');
      }
      const csrf = session.csrf;
      const grouped = new Map();
      let failed = 0;

      for (const row of rows) {
        if (row.uploadedUrl) {
          const entry = grouped.get(row.product.id) || { id: row.product.id, images: [] };
          entry.images.push(row.uploadedUrl);
          grouped.set(row.product.id, entry);
          continue;
        }
        row.status = 'uploading';
        render();
        try {
          const dataUrl = await composeImage(row.file, row.product);
          const uploaded = await uploadDataUrl(dataUrl, csrf);
          row.uploadedUrl = uploaded.image;
          row.status = 'uploaded';
          const entry = grouped.get(row.product.id) || { id: row.product.id, images: [] };
          entry.images.push(row.uploadedUrl);
          grouped.set(row.product.id, entry);
        } catch (error) {
          row.status = 'error';
          row.message = error.message || 'No se pudo subir.';
          failed += 1;
        }
        render();
      }

      if (!grouped.size) throw new Error(failed ? 'No se pudo subir ninguna imagen.' : 'No hay imágenes para asignar.');
      setNotice('Asignando las imágenes a cada producto…');
      const saved = await request('/api/admin/products/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrf, items: [...grouped.values()] }),
      });
      const savedIds = new Set((saved.results || []).map((item) => item.id));
      let assigned = 0;
      for (const row of rows) {
        if (row.uploadedUrl && savedIds.has(row.product.id)) {
          row.status = 'saved';
          row.message = '';
          assigned += 1;
        } else if (row.uploadedUrl) {
          row.status = 'ready';
          row.message = 'Subida; falta asignar';
        }
      }
      if (failed) {
        setNotice(`Se asignaron ${assigned} imágenes. ${failed} no se pudieron subir; revisa la tabla.`, 'error');
      } else {
        setNotice(`Listo: ${assigned} imágenes asignadas. Recarga el panel para ver las miniaturas actualizadas.`, 'success');
      }
    } catch (error) {
      for (const row of rows) {
        if (row.uploadedUrl && row.status !== 'saved') {
          row.status = 'ready';
          row.message = 'Subida; falta asignar';
        }
      }
      setNotice(error.message || 'No se pudieron asignar las imágenes.', 'error');
    } finally {
      state.busy = false;
      updateButtons();
      render();
    }
  }

  $('#bulk-zip-open')?.addEventListener('click', () => {
    reset();
    modal.hidden = false;
    document.body.classList.add('modal-open');
  });
  const close = () => {
    if (state.busy) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    reset();
  };
  $('#bulk-zip-close')?.addEventListener('click', close);
  $('#bulk-zip-cancel')?.addEventListener('click', close);
  $('#bulk-zip-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file).catch((error) => setNotice(error.message, 'error'));
  });
  $('#bulk-zip-submit')?.addEventListener('click', () => submit().catch((error) => setNotice(error.message, 'error')));
})();
