const $ = (selector) => document.querySelector(selector);
const state = { csrf: '', offset: 0, limit: 50, total: 0, search: '', category: '', stock: '', categories: [] };
const authView = $('#admin-login-view');
const appView = $('#admin-app');
const productForm = $('#product-form');
const editor = $('#product-editor');
const ordersState = { offset: 0, limit: 30, total: 0, query: '', status: '' };

$('.admin-side-nav').addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  $('.admin-side-nav .active')?.classList.remove('active');
  $('.admin-side-nav [aria-current="page"]')?.removeAttribute('aria-current');
  link.classList.add('active');
  link.setAttribute('aria-current', 'page');
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function priceForCost(cost) {
  const value = Math.max(0, Number(cost) || 0);
  let contado;
  let credito;
  if (value < 200000) { contado = value * 2; credito = value * 2; }
  else if (value < 500000) { contado = value * 1.35; credito = value * 1.4; }
  else if (value < 1500000) { contado = value * 1.3; credito = value * 1.4; }
  else { contado = value * 1.2; credito = value * 1.3; }
  const round = (amount) => Math.round(amount / 100) * 100;
  return { contado: round(contado), credito: round(credito) };
}

function applyCost() {
  const cost = Number($('#field-cost').value);
  if (!cost) { $('#field-price').value = ''; $('#field-credit-price').value = ''; return; }
  const { contado, credito } = priceForCost(cost);
  $('#field-price').value = contado;
  $('#field-credit-price').value = $('#field-credit-enabled').checked ? credito : '';
}

function notice(message, kind = '') {
  const node = $(authView.hidden ? '#admin-notice-app' : '#admin-notice-login');
  node.textContent = message;
  node.className = `notice ${kind}`;
  node.hidden = !message;
}

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ocurrió un error. Intenta de nuevo.');
  return data;
}

function showLogin() {
  authView.hidden = false;
  appView.hidden = true;
  $('#logout-button').hidden = true;
  $('#setup-form').hidden = true;
  $('#login-form').hidden = false;
}

function showSetup() {
  authView.hidden = false;
  appView.hidden = true;
  $('#logout-button').hidden = true;
  $('#login-form').hidden = true;
  $('#setup-form').hidden = false;
  $('#admin-setup-name').focus();
}

async function enterPanel() {
  const response = await fetch('/api/admin/products?limit=1', { credentials: 'same-origin' });
  if (response.status === 401) return showLogin();
  const data = await response.json();
  authView.hidden = true;
  appView.hidden = false;
  $('#logout-button').hidden = false;
  state.total = data.total;
  $('#admin-total').textContent = data.total.toLocaleString('es-CO');
  await loadProducts();
  await loadOrders();
}

async function openPanel() {
  try {
    const session = await request('/api/admin/session');
    if (session.authenticated) return enterPanel();
    if (session.setupRequired) return showSetup();
    showLogin();
  } catch { showLogin(); }
}

async function loadProducts() {
  const params = new URLSearchParams({ offset: String(state.offset), limit: String(state.limit), q: state.search, category: state.category, stock: state.stock });
  const data = await request(`/api/admin/products?${params}`);
  state.total = data.total;
  state.categories = data.categories || [];
  $('#category-filter').innerHTML = '<option value="">Todas las categorías</option>' + state.categories.map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join('');
  $('#category-filter').value = state.category;
  const summary = data.summary || {};
  $('#stat-total').textContent = Number(summary.total ?? state.total).toLocaleString('es-CO');
  $('#stat-available').textContent = Number(summary.available || 0).toLocaleString('es-CO');
  $('#stat-low').textContent = Number(summary.lowStock || 0).toLocaleString('es-CO');
  $('#stat-out').textContent = Number(summary.outOfStock || 0).toLocaleString('es-CO');
  $('#stat-no-image').textContent = Number(summary.noImage || 0).toLocaleString('es-CO');
  $('#admin-total').textContent = data.total.toLocaleString('es-CO');
  $('#product-rows').innerHTML = data.products.map((product) => `
    <tr>
      <td><img class="product-thumb" src="${escapeHtml(product.image || 'icon.png')}" alt="" onerror="this.src='icon.png'"></td>
      <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.id)}</small></td>
      <td>${escapeHtml(product.categories?.[0]?.name || 'Sin categoría')}</td>
      <td>$${Number(product.price || 0).toLocaleString('es-CO')}</td>
      <td>${Number(product.stock || 0).toLocaleString('es-CO')}</td>
      <td><div class="row-actions"><button class="small-button" data-edit="${escapeHtml(product.id)}">Editar</button><button class="small-button danger-text" data-delete="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}">Eliminar</button></div></td>
    </tr>`).join('');
  $('#page-label').textContent = state.total ? `${state.offset + 1}–${Math.min(state.offset + data.products.length, state.total)} de ${state.total}` : '0 productos';
  $('#page-prev').disabled = state.offset === 0;
  $('#page-next').disabled = state.offset + state.limit >= state.total;
  $('#empty-state').hidden = data.products.length !== 0;
  $('#product-table').hidden = data.products.length === 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

async function loadOrders() {
  const params = new URLSearchParams({ offset: String(ordersState.offset), limit: String(ordersState.limit), q: ordersState.query, status: ordersState.status });
  const data = await request(`/api/admin/orders?${params}`);
  ordersState.total = data.total;
  $('#orders-total').textContent = Number(data.summary?.total || 0).toLocaleString('es-CO');
  $('#orders-paid').textContent = Number(data.summary?.paid || 0).toLocaleString('es-CO');
  $('#orders-pending').textContent = Number(data.summary?.pending || 0).toLocaleString('es-CO');
  const paymentLabels = { pendiente: 'Pendiente', pagado: 'Pagado', fallido: 'Fallido', demo: 'Prueba' };
  const fulfillmentOptions = [
    ['pendiente', 'Por preparar'], ['preparando', 'Preparando'], ['enviado', 'Enviado'], ['entregado', 'Entregado'], ['cancelado', 'Cancelado'],
  ];
  $('#order-rows').innerHTML = data.orders.map((order) => {
    const customer = order.customer || {};
    const phone = String(customer.phone || '').replace(/\D/g, '');
    const whatsappPhone = phone.length === 10 ? `57${phone}` : phone;
    const message = encodeURIComponent(`Hola ${customer.name || ''}, te contactamos por tu pedido ${order.id}.`);
    const prepStatus = order.fulfillmentStatus || 'pendiente';
    const lines = (order.lines || []).map((line) => `${line.name || 'Producto'} × ${line.qty || 1}`).join(', ');
    const date = order.createdAt ? new Date(order.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const options = fulfillmentOptions.map(([value, label]) => `<option value="${value}" ${prepStatus === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<tr>
      <td><strong>${escapeHtml(order.id)}</strong><small>${escapeHtml(date)}</small></td>
      <td class="order-customer"><strong>${escapeHtml(customer.name || 'Cliente')}</strong><small>${escapeHtml(customer.email || '')}</small><small>${escapeHtml([customer.address, customer.city].filter(Boolean).join(', '))}</small></td>
      <td class="order-lines">${escapeHtml(lines || 'Sin detalle')}<small>${(order.lines || []).reduce((sum, line) => sum + Number(line.qty || 0), 0)} unidad(es)</small></td>
      <td><strong>${formatMoney(order.total)}</strong></td>
      <td><span class="order-payment ${order.status === 'pagado' ? 'paid' : order.status === 'fallido' ? 'failed' : ''}">${escapeHtml(paymentLabels[order.status] || order.status || 'Pendiente')}</span></td>
      <td><select class="order-status-select" data-order-status="${escapeHtml(order.id)}" aria-label="Estado de entrega para ${escapeHtml(order.id)}">${options}</select></td>
      <td>${whatsappPhone ? `<a class="order-contact" href="https://wa.me/${whatsappPhone}?text=${message}" target="_blank" rel="noopener">WhatsApp</a>` : '<span class="subtle">Sin teléfono</span>'}</td>
    </tr>`;
  }).join('');
  $('#orders-page-label').textContent = ordersState.total ? `${ordersState.offset + 1}–${Math.min(ordersState.offset + data.orders.length, ordersState.total)} de ${ordersState.total} pedidos` : '0 pedidos';
  $('#orders-prev').disabled = ordersState.offset === 0;
  $('#orders-next').disabled = ordersState.offset + ordersState.limit >= ordersState.total;
  $('#orders-empty').hidden = data.orders.length !== 0;
  $('#orders-table').hidden = data.orders.length === 0;
}

function showEditor(product = null) {
  productForm.reset();
  $('#edit-id').value = product?.id || '';
  $('#edit-title').textContent = product ? 'Editar producto' : 'Agregar producto';
  $('#field-name').value = product?.name || '';
  $('#field-brand').value = product?.brand || '';
  const contado = product?.variants?.find((variant) => /contado/i.test(variant.label)) || product?.variants?.find((variant) => /precio único/i.test(variant.label));
  const credito = product?.variants?.find((variant) => /cr[eé]dito/i.test(variant.label));
  $('#field-cost').value = product?.cost || contado?.price || product?.price || '';
  $('#field-credit-enabled').checked = product ? Boolean(credito) : true;
  $('#field-credit-price').disabled = !$('#field-credit-enabled').checked;
  applyCost();
  $('#field-stock').value = product?.stock ?? 0;
  $('#field-category').value = product?.categories?.[0]?.name || '';
  $('#field-description').value = product?.description || '';
  $('#field-image').value = product?.image || '';
  $('#image-preview').src = product?.image || '';
  $('#image-preview').hidden = !product?.image;
  $('#image-file').value = '';
  $('#category-options').innerHTML = state.categories.map((category) => `<option value="${escapeHtml(category.name)}"></option>`).join('');
  editor.hidden = false;
  document.body.classList.add('modal-open');
  $('#field-name').focus();
}

function hideEditor() {
  editor.hidden = true;
  document.body.classList.remove('modal-open');
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  notice('Verificando acceso…');
  try {
    const data = await request('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: $('#admin-identifier').value.trim(), password: $('#admin-password').value }),
    });
    state.csrf = data.csrf;
    notice('');
    await enterPanel();
  } catch (error) { notice(error.message, 'error'); }
});

$('#setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  notice('Creando la cuenta de administrador…');
  try {
    const data = await request('/api/admin/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#admin-setup-name').value.trim(),
        username: $('#admin-setup-username').value.trim(),
        email: $('#admin-setup-email').value.trim(),
        password: $('#admin-setup-password').value,
      }),
    });
    state.csrf = data.csrf;
    notice('');
    await enterPanel();
  } catch (error) { notice(error.message, 'error'); }
});

$('#logout-button').addEventListener('click', async () => {
  try { await request('/api/admin/logout', { method: 'POST' }); } catch { /* limpiar la vista igualmente */ }
  $('#admin-password').value = '';
  showLogin();
});

$('#new-product').addEventListener('click', () => showEditor());
$('#cancel-editor').addEventListener('click', hideEditor);
$('#close-editor').addEventListener('click', hideEditor);
editor.addEventListener('click', (event) => { if (event.target === editor) hideEditor(); });

$('#product-rows').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit]');
  if (editButton) {
    try {
      const data = await request(`/api/admin/products?id=${encodeURIComponent(editButton.dataset.edit)}&limit=1`);
      const product = data.products.find((item) => item.id === editButton.dataset.edit);
      if (product) showEditor(product);
    } catch (error) { notice(error.message, 'error'); }
  }
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton && confirm(`¿Eliminar “${deleteButton.dataset.name}” del catálogo?`)) {
    try {
      await request('/api/admin/products', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteButton.dataset.delete, csrf: state.csrf }),
      });
      notice('Producto eliminado.', 'success');
      if (state.offset && state.offset >= state.total - 1) state.offset -= state.limit;
      await loadProducts();
    } catch (error) { notice(error.message, 'error'); }
  }
});

$('#product-search').addEventListener('input', () => {
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(() => {
    state.search = $('#product-search').value.trim();
    state.offset = 0;
    loadProducts().catch((error) => notice(error.message, 'error'));
  }, 250);
});

$('#category-filter').addEventListener('change', () => {
  state.category = $('#category-filter').value;
  state.offset = 0;
  loadProducts().catch((error) => notice(error.message, 'error'));
});

$('#stock-filter').addEventListener('change', () => {
  state.stock = $('#stock-filter').value;
  state.offset = 0;
  loadProducts().catch((error) => notice(error.message, 'error'));
});

$('#reset-filters').addEventListener('click', () => {
  state.search = '';
  state.category = '';
  state.stock = '';
  state.offset = 0;
  $('#product-search').value = '';
  $('#category-filter').value = '';
  $('#stock-filter').value = '';
  loadProducts().catch((error) => notice(error.message, 'error'));
});

async function collectProducts(filtered = true) {
  const products = [];
  let total = 0;
  let offset = 0;
  let categories = [];
  do {
    const params = new URLSearchParams({ offset: String(offset), limit: '100' });
    if (filtered) {
      params.set('q', state.search);
      params.set('category', state.category);
      params.set('stock', state.stock);
    }
    const data = await request(`/api/admin/products?${params}`);
    total = data.total;
    categories = data.categories || categories;
    if (!data.products.length) break;
    products.push(...data.products);
    offset += data.products.length;
    if (products.length >= total) break;
  } while (offset < total);
  return { products, categories };
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportProducts(format) {
  const button = format === 'csv' ? $('#export-csv') : $('#backup-json');
  button.disabled = true;
  notice(format === 'csv' ? 'Preparando el CSV con los filtros actuales…' : 'Preparando el respaldo completo del catálogo…');
  try {
    const { products, categories } = await collectProducts(format === 'csv');
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const columns = ['id', 'name', 'brand', 'category', 'price', 'stock', 'image', 'description'];
      const rows = products.map((product) => [
        product.id, product.name, product.brand, product.categories?.[0]?.name || '', product.price, product.stock, product.image,
        String(product.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      ]);
      const content = [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
      downloadFile(`catalogo-filtrado-${stamp}.csv`, `\uFEFF${content}`, 'text/csv;charset=utf-8');
      notice(`CSV descargado: ${products.length.toLocaleString('es-CO')} productos.`, 'success');
    } else {
      const backup = { exportedAt: new Date().toISOString(), total: products.length, categories, products };
      downloadFile(`respaldo-catalogo-${stamp}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
      notice(`Respaldo JSON descargado: ${products.length.toLocaleString('es-CO')} productos.`, 'success');
    }
  } catch (error) { notice(error.message || 'No se pudo preparar la descarga.', 'error'); }
  finally { button.disabled = false; }
}

$('#export-csv').addEventListener('click', () => exportProducts('csv'));
$('#backup-json').addEventListener('click', () => exportProducts('json'));

$('#refresh-orders').addEventListener('click', () => loadOrders().then(() => notice('Pedidos actualizados.', 'success')).catch((error) => notice(error.message, 'error')));
$('#order-search').addEventListener('input', () => {
  clearTimeout(window.orderSearchTimer);
  window.orderSearchTimer = setTimeout(() => {
    ordersState.query = $('#order-search').value.trim();
    ordersState.offset = 0;
    loadOrders().catch((error) => notice(error.message, 'error'));
  }, 250);
});
$('#order-status-filter').addEventListener('change', () => {
  ordersState.status = $('#order-status-filter').value;
  ordersState.offset = 0;
  loadOrders().catch((error) => notice(error.message, 'error'));
});
$('#orders-prev').addEventListener('click', () => {
  ordersState.offset = Math.max(0, ordersState.offset - ordersState.limit);
  loadOrders().catch((error) => notice(error.message, 'error'));
});
$('#orders-next').addEventListener('click', () => {
  ordersState.offset += ordersState.limit;
  loadOrders().catch((error) => notice(error.message, 'error'));
});
$('#order-rows').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-order-status]');
  if (!select) return;
  select.disabled = true;
  try {
    await request('/api/admin/orders/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: select.dataset.orderStatus, fulfillmentStatus: select.value, csrf: state.csrf }),
    });
    notice('Estado de preparación actualizado.', 'success');
  } catch (error) {
    notice(error.message, 'error');
    await loadOrders();
  } finally { select.disabled = false; }
});

window.setInterval(() => {
  if (!document.hidden && !appView.hidden) loadOrders().catch(() => {});
}, 60_000);

$('#page-prev').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadProducts().catch((error) => notice(error.message, 'error')); });
$('#page-next').addEventListener('click', () => { state.offset += state.limit; loadProducts().catch((error) => notice(error.message, 'error')); });

let backgroundRemoverPromise;
function loadBackgroundRemover() {
  if (!backgroundRemoverPromise) {
    backgroundRemoverPromise = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.8/+esm')
      .then((module) => module.removeBackground || module.default)
      .catch((error) => { console.warn('No se pudo cargar el quitafondos:', error); return null; });
  }
  return backgroundRemoverPromise;
}

async function removePhotoBackground(file) {
  const removeBackground = await loadBackgroundRemover();
  if (typeof removeBackground !== 'function') return file;
  notice('Quitando el fondo de la foto…');
  try {
    const blob = await removeBackground(file, {
      output: { format: 'image/png' },
      progress: (key, current, total) => {
        if (String(key).startsWith('fetch:') && total) notice(`Descargando el modelo de recorte… ${Math.round((current / total) * 100)}%`);
      },
    });
    return blob;
  } catch (error) {
    console.warn('No se pudo quitar el fondo:', error);
    return file;
  }
}

async function uploadProductImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return notice('Selecciona una imagen JPG, PNG o WebP.', 'error');
  try {
    const [productSource, templateResponse] = await Promise.all([
      removePhotoBackground(file),
      fetch('/assets/img/plantilla.jpg', { cache: 'force-cache' }),
    ]);
    if (!templateResponse.ok) throw new Error('No se encontró la plantilla de imagen.');
    const templateBitmap = await createImageBitmap(await templateResponse.blob());
    const productBitmap = await createImageBitmap(productSource);
    const canvas = document.createElement('canvas');
    canvas.width = templateBitmap.width;
    canvas.height = templateBitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(templateBitmap, 0, 0, canvas.width, canvas.height);

    // Ubica el producto en la zona libre del diseño, antes de la franja inferior.
    const maxWidth = canvas.width * 0.72;
    const maxHeight = canvas.height * 0.43;
    const scale = Math.min(maxWidth / productBitmap.width, maxHeight / productBitmap.height);
    const productWidth = productBitmap.width * scale;
    const productHeight = productBitmap.height * scale;
    const x = (canvas.width - productWidth) / 2;
    const y = canvas.height * 0.49 - productHeight / 2;
    context.drawImage(productBitmap, x, y, productWidth, productHeight);
    productBitmap.close();
    templateBitmap.close();
    const dataUrl = canvas.toDataURL('image/webp', 0.82);
    if (dataUrl.length > 5_300_000) throw new Error('La imagen sigue siendo muy pesada. Prueba con otra más pequeña.');
    notice('Subiendo imagen…');
    const uploaded = await request('/api/admin/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, csrf: state.csrf }),
    });
    $('#field-image').value = uploaded.image;
    $('#image-preview').src = uploaded.image;
    $('#image-preview').hidden = false;
    notice('Imagen subida. Guarda el producto para aplicar los cambios.', 'success');
  } catch (error) { notice(error.message || 'No se pudo subir la imagen.', 'error'); }
}

const imageDropZone = $('.image-row');
$('#image-file').addEventListener('change', async (event) => {
  await uploadProductImage(event.target.files?.[0]);
  event.target.value = '';
});

imageDropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  imageDropZone.classList.add('drag-active');
});
imageDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
imageDropZone.addEventListener('dragleave', (event) => {
  if (!imageDropZone.contains(event.relatedTarget)) imageDropZone.classList.remove('drag-active');
});
imageDropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  imageDropZone.classList.remove('drag-active');
  const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'))
    || [...(event.dataTransfer?.items || [])].map((item) => item.getAsFile?.()).find((item) => item?.type.startsWith('image/'));
  if (!file) return notice('El navegador no entregó el archivo de imagen. Prueba copiarla y pegarla o guardarla primero.', 'error');
  await uploadProductImage(file);
});

document.addEventListener('paste', async (event) => {
  if ($('#product-editor').hidden) return;
  const file = [...(event.clipboardData?.items || [])]
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .find(Boolean);
  if (!file) return;
  event.preventDefault();
  await uploadProductImage(file);
});

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#save-product');
  button.disabled = true;
  button.textContent = 'Guardando…';
  const product = {
    id: $('#edit-id').value || undefined,
    name: $('#field-name').value,
    brand: $('#field-brand').value,
    cost: Number($('#field-cost').value),
    price: Number($('#field-price').value),
    offerCredit: $('#field-credit-enabled').checked,
    creditPrice: $('#field-credit-enabled').checked ? Number($('#field-credit-price').value || $('#field-price').value) : null,
    stock: Number($('#field-stock').value),
    category: $('#field-category').value,
    description: $('#field-description').value,
    image: $('#field-image').value,
    csrf: state.csrf,
  };
  try {
    await request('/api/admin/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(product),
    });
    hideEditor();
    state.offset = 0;
    notice('Producto guardado en el catálogo JSON.', 'success');
    await loadProducts();
  } catch (error) { notice(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = 'Guardar producto'; }
});

$('#field-credit-enabled').addEventListener('change', (event) => {
  $('#field-credit-price').disabled = !event.target.checked;
  applyCost();
});

$('#field-cost').addEventListener('input', applyCost);

$('#field-image').addEventListener('input', () => {
  const image = $('#field-image').value.trim();
  $('#image-preview').src = image;
  $('#image-preview').hidden = !image;
});

openPanel();
