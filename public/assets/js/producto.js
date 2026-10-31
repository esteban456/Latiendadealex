import { $, escapeHtml, getImageSrc, getThumbSrc, initChrome, loadConfig, money, plainText, productCard, addToCart, bindAddButtons, toast } from './core.js?v=20261016-catalogo';

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#eef0f6"/></svg>');

const toWebp = (p) => !p || /^https?:\/\//i.test(p) ? p : p.replace('/productos/', '/productos-webp/').replace(/\.(jpg|jpeg|png)$/i, '.webp');

const state = { qty: 1, variant: null, imageIndex: 0 };
let current = null;

const ZOOM = { min: 1, max: 5, step: 1.8 };

function gallerySources() {
  const list = (current?.images?.length ? current.images : [current?.image]).filter(Boolean);
  return list.map((src) => getImageSrc(src));
}

let zoombox = null;

// Visor de imagen a pantalla completa con zoom (rueda/pellizco) y arrastre.
function ensureZoombox() {
  if (zoombox) return zoombox;

  const el = document.createElement('div');
  el.className = 'zoombox';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Imagen ampliada');
  el.innerHTML = `
    <div class="zoombox__stage" data-stage>
      <img class="zoombox__img" alt="" draggable="false" data-zoomimg />
    </div>
    <span class="zoombox__hint">Rueda o pellizca para ampliar · arrastra para mover</span>
    <button class="zoombox__close" data-close type="button" aria-label="Cerrar">×</button>
    <button class="zoombox__nav" data-dir="prev" type="button" aria-label="Imagen anterior">‹</button>
    <button class="zoombox__nav" data-dir="next" type="button" aria-label="Imagen siguiente">›</button>
    <div class="zoombox__tools">
      <button data-out type="button" aria-label="Alejar">−</button>
      <span data-level>100%</span>
      <button data-in type="button" aria-label="Acercar">+</button>
      <button data-reset type="button" aria-label="Restablecer">⤢</button>
    </div>`;
  document.body.appendChild(el);

  const stage = el.querySelector('[data-stage]');
  const img = el.querySelector('[data-zoomimg]');
  const level = el.querySelector('[data-level]');
  const prevBtn = el.querySelector('[data-dir="prev"]');
  const nextBtn = el.querySelector('[data-dir="next"]');

  const view = { scale: 1, tx: 0, ty: 0, sources: [], index: 0 };
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let tap = null;
  let moved = 0;

  const apply = (animate) => {
    img.classList.toggle('dragging', !animate);
    img.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    level.textContent = `${Math.round(view.scale * 100)}%`;
    stage.classList.toggle('zoomed', view.scale > 1.01);
  };

  const clamp = () => {
    const maxX = Math.max(0, (img.clientWidth * view.scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * view.scale - stage.clientHeight) / 2);
    view.tx = Math.min(maxX, Math.max(-maxX, view.tx));
    view.ty = Math.min(maxY, Math.max(-maxY, view.ty));
  };

  const centerOffset = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  };

  const zoomAt = (next, px, py) => {
    const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
    const ratio = scale / view.scale;
    view.tx = px - ratio * (px - view.tx);
    view.ty = py - ratio * (py - view.ty);
    view.scale = scale;
    clamp();
    apply(true);
  };

  const reset = (animate) => {
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
    apply(animate !== false);
  };

  const show = (i) => {
    view.index = (i + view.sources.length) % view.sources.length;
    img.src = view.sources[view.index];
    img.alt = current ? current.name : '';
    reset(false);
    const multi = view.sources.length > 1;
    prevBtn.hidden = !multi;
    nextBtn.hidden = !multi;
    document.querySelectorAll('.thumb').forEach((btn, k) => btn.classList.toggle('active', k === view.index));
    const main = document.getElementById('main-image');
    if (main && view.sources[view.index]) {
      main.src = view.sources[view.index];
      state.imageIndex = view.index;
    }
  };

  const close = () => {
    el.classList.remove('open');
    document.body.style.overflow = '';
    pointers.clear();
    drag = pinch = tap = null;
  };

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const p = centerOffset(event.clientX, event.clientY);
    zoomAt(view.scale * Math.exp(-event.deltaY * 0.0016), p.x, p.y);
  }, { passive: false });

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stage.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = 0;
    img.classList.add('dragging');
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
      tap = { x: event.clientX, y: event.clientY, onImage: event.target === img };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mid = centerOffset((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale, tx: view.tx, ty: view.ty, mx: mid.x, my: mid.y };
      drag = null;
      tap = null;
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = centerOffset((a.x + b.x) / 2, (a.y + b.y) / 2);
      const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, pinch.scale * (dist / pinch.dist)));
      const ratio = scale / pinch.scale;
      view.scale = scale;
      view.tx = mid.x - ratio * (pinch.mx - pinch.tx);
      view.ty = mid.y - ratio * (pinch.my - pinch.ty);
      clamp();
      apply(false);
      moved = 99;
      return;
    }

    if (pointers.size === 1 && drag && view.scale > 1.01) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      view.tx = drag.tx + dx;
      view.ty = drag.ty + dy;
      clamp();
      apply(false);
    } else if (tap) {
      moved = Math.max(moved, Math.hypot(event.clientX - tap.x, event.clientY - tap.y));
    }
  });

  const endPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);

    if (tap && moved < 8) {
      const p = centerOffset(tap.x, tap.y);
      if (tap.onImage) {
        if (view.scale > 1.01) reset(true);
        else zoomAt(ZOOM.step + 0.7, p.x, p.y);
      } else {
        close();
        return;
      }
    }
    tap = null;

    if (pointers.size === 1) {
      const [only] = [...pointers.values()];
      drag = { x: only.x, y: only.y, tx: view.tx, ty: view.ty };
      pinch = null;
    } else if (pointers.size === 0) {
      drag = pinch = null;
      apply(true);
    }
  };

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  el.querySelector('[data-close]').addEventListener('click', close);
  prevBtn.addEventListener('click', () => show(view.index - 1));
  nextBtn.addEventListener('click', () => show(view.index + 1));
  el.querySelector('[data-in]').addEventListener('click', () => zoomAt(view.scale * ZOOM.step, 0, 0));
  el.querySelector('[data-out]').addEventListener('click', () => zoomAt(view.scale / ZOOM.step, 0, 0));
  el.querySelector('[data-reset]').addEventListener('click', () => reset(true));

  document.addEventListener('keydown', (event) => {
    if (!el.classList.contains('open')) return;
    if (event.key === 'Escape') close();
    else if (event.key === '+' || event.key === '=') zoomAt(view.scale * ZOOM.step, 0, 0);
    else if (event.key === '-' || event.key === '_') zoomAt(view.scale / ZOOM.step, 0, 0);
    else if (event.key === 'ArrowLeft') show(view.index - 1);
    else if (event.key === 'ArrowRight') show(view.index + 1);
  });

  zoombox = {
    open(index = 0) {
      view.sources = gallerySources();
      if (!view.sources.length) return;
      show(index);
      el.classList.add('open');
      document.body.style.overflow = 'hidden';
      el.querySelector('[data-close]').focus?.();
    },
    close,
  };
  return zoombox;
}

async function main() {
  $('[data-year]').textContent = new Date().getFullYear();
  const catalog = await initChrome();
  const slug = new URLSearchParams(location.search).get('slug');
  const product = (catalog.products || []).find((p) => p.slug === slug);

  if (!product) {
    location.href = 'catalogo.html';
    return;
  }

  current = product;
  state.variant = (product.variants || [])[0];
  state.imageIndex = 0;
  document.title = `${product.name} | La Tienda de Alex`;
  updateProductMetadata(product);
  $('[data-crumb]').textContent = product.name;

  $('[data-product]').innerHTML = render(product);
  updatePaymentChoice();
  bindAddButtons(catalog);
  renderRelated(catalog, product);
  injectSchema(product);

  const config = await loadConfig();
  const freeFrom = config.store?.freeShippingFrom ?? 0;
  const freeEl = $('[data-free-shipping]');
  if (freeEl) {
    freeEl.textContent = freeFrom
      ? `En compras desde ${money(freeFrom)}`
      : 'Consultanos el costo de envio';
  }
  const instEl = $('[data-installments]');
  if (instEl) instEl.textContent = config.paymentReady ? 'Con Mercado Pago' : 'Mercado Pago (modo demo)';
}

function render(product) {
  const images = (product.images?.length ? product.images : [product.image]).filter(Boolean);
  const categories = (product.categories || []).slice(0, 3);
  const visibleVariants = (product.variants || []).filter((variant) => !variant.legacy);
  const paymentVariants = visibleVariants.filter((variant) => /contado|cr[eé]dito/i.test(variant.label));
  const description = plainText(product.description) || `Consulta disponibilidad y detalles de ${product.name} con nuestro equipo.`;
  return `
    <div class="product">
      <div class="gallery">
        <img id="main-image" src="${escapeHtml(getImageSrc(images[0]))}" alt="${escapeHtml(product.name)}" data-fallback${images.length ? ' data-zoom' : ''} />
        ${images.length ? '<button type="button" class="zoom-trigger" data-zoom aria-label="Ampliar imagen">🔍<span>Ampliar</span></button>' : ''}
        ${
          images.length > 1
            ? `<div class="thumbs">${images
                .map(
                  (src, i) =>
                    `<button class="thumb ${i === 0 ? 'active' : ''}" data-img="${escapeHtml(getImageSrc(src))}" data-index="${i}"><img src="${escapeHtml(getThumbSrc(src))}" alt="" data-fallback /></button>`,
                )
                .join('')}</div>`
            : ''
        }
      </div>

      <div>
        ${product.brand ? `<span class="card-brand">${escapeHtml(product.brand)}</span>` : ''}
        <h1 style="font-size:1.9rem;margin:.25rem 0 .5rem">${escapeHtml(product.name)}</h1>
        ${
          categories.length
            ? `<div class="chips" style="margin-bottom:.75rem">${categories
                .map(
                  (c) =>
                    `<a class="chip" href="catalogo.html?c=${encodeURIComponent(c.name)}">${c.icon ? `${escapeHtml(c.icon)} ` : ''}${escapeHtml(c.name)}</a>`,
                )
                .join('')}</div>`
            : ''
        }

        <div class="price price-big">${money(state.variant?.price || product.price)}</div>
        ${
          product.maxPrice > product.price
            ? `<p class="muted" style="margin:0">Precio mas alto con credito: <b>${money(product.maxPrice)}</b></p>`
            : ''
        }
        <p class="muted" style="font-size:.9rem">
          ${
            product.available
              ? '✅ Disponible — sale en 24 horas habiles'
              : '⏳ Sin stock por el momento — consultanos cuando llegue'
          }
        </p>
        ${product.stock > 0 ? `<p class="product-stock">${Number(product.stock)} unidades disponibles</p>` : ''}

        ${
          paymentVariants.length > 1
            ? `<section class="payment-choice" aria-labelledby="payment-choice-title">
                <h2 id="payment-choice-title">¿Cómo quieres pagar?</h2>
                <div class="variants payment-options">
                  ${paymentVariants.map((v, i) => `<button class="variant payment-option ${v.sku === state.variant?.sku ? 'active' : ''}" data-variant="${escapeHtml(v.sku)}" ${v.available ? '' : 'disabled'} aria-pressed="${v.sku === state.variant?.sku}">
                    <span><b>${/contado/i.test(v.label) ? 'Contado' : 'A crédito'}</b><small>${/contado/i.test(v.label) ? 'Pago en una sola vez' : 'Elige el plazo de pago'}</small></span><b>${money(v.price)}</b>
                  </button>`).join('')}
                </div>
                <div class="installment-picker" data-installment-wrap hidden>
                  <label for="installment-count">¿A cuántas cuotas?</label>
                  <select id="installment-count" data-installment-count>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i === 11 ? 'selected' : ''}>${i + 1} ${i === 0 ? 'cuota' : 'cuotas'}</option>`).join('')}</select>
                  <p data-installment-estimate></p>
                  <small>Valor estimado por cuota según el precio a crédito. Las condiciones finales dependen del medio de pago.</small>
                </div>
              </section>`
            : visibleVariants.length > 1
            ? `<div class="variants">${visibleVariants
                .map(
                  (v, i) => `
                <button class="variant ${i === 0 ? 'active' : ''}" data-variant="${escapeHtml(v.sku)}" ${v.available ? '' : 'disabled'}>
                  <span><b>${escapeHtml(v.label)}</b>${v.available ? '' : ' <span class="muted">(agotado)</span>'}</span>
                  <b>${money(v.price)}</b>
                </button>`,
                )
                .join('')}</div>`
            : ''
        }

        <div class="buy-row">
          <div class="qty">
            <button data-qty="-1" aria-label="Quitar uno">−</button>
            <span data-qty-value>1</span>
            <button data-qty="1" aria-label="Agregar uno">+</button>
          </div>
          <button class="btn" data-add ${product.available ? '' : 'disabled'}>Agregar al carrito</button>
          <button class="btn btn-accent" data-buy-now ${product.available ? '' : 'disabled'}>Comprar ahora</button>
        </div>

        <div class="features" style="grid-template-columns:1fr 1fr; gap:.6rem">
          <div class="feature" style="padding:.9rem"><div class="ico" style="width:34px;height:34px;font-size:1rem">🚚</div><b style="font-size:.9rem">Envio gratis</b><p style="font-size:.82rem" data-free-shipping></p></div>
          <div class="feature" style="padding:.9rem"><div class="ico" style="width:34px;height:34px;font-size:1rem">💳</div><b style="font-size:.9rem">Hasta 12 cuotas</b><p style="font-size:.82rem" data-installments></p></div>
        </div>

        <div class="accordion">
          <details open>
            <summary>Descripcion</summary>
            <p>${escapeHtml(description).replace(/\r?\n/g, '<br>')}</p>
          </details>
          <details>
            <summary>Envios y entregas</summary>
            <p>Despachamos en 24 horas hables a todo Colombia. Entrega estimada de 2 a 5 dias depending del destino. Pagas al recibir si lo prefieres (contra entrega disponible en ciudades principales).</p>
          </details>
          <details>
            <summary>Garantia</summary>
            <p>Todos los productos incluyen garantia del fabricante. Cambios y devoluciones dentro de los primeros 30 dias con producto en su empaque original.</p>
          </details>
        </div>
      </div>
    </div>`;
}

function renderRelated(catalog, product) {
  const category = (product.categories || [])[0]?.name;
  const pool = (catalog.products || []).filter((p) => p.price > 0 && p.slug !== product.slug);
  const related = category
    ? pool.filter((p) => (p.categories || []).some((c) => c.name === category))
    : [];
  const list = (related.length >= 4 ? related : pool.filter((p) => p.brand && p.brand === product.brand)).slice(0, 4);
  if (!list.length) return;
  $('[data-related]').innerHTML = list.map(productCard).join('');
  $('[data-related-wrap]').hidden = false;
}

function injectSchema(product) {
  const canonicalUrl = new URL(`/producto.html?slug=${encodeURIComponent(product.slug)}`, location.origin).href;
  const imageSources = (product.images?.length ? product.images : [product.image]).filter(Boolean).map((src) => new URL(getImageSrc(src), location.origin).href);
  const cashVariant = product.variants?.find((variant) => /contado/i.test(variant.label));
  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: plainText(product.description).slice(0, 5000),
    ...(imageSources.length ? { image: imageSources } : {}),
    ...(product.id ? { sku: product.id } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      price: Number(cashVariant?.price || product.price),
      priceCurrency: 'COP',
      availability: product.available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${location.origin}/` },
      { '@type': 'ListItem', position: 2, name: 'Catálogo', item: `${location.origin}/catalogo.html` },
      { '@type': 'ListItem', position: 3, name: product.name, item: canonicalUrl },
    ],
  };
  for (const [id, data] of [['product-structured-data', productSchema], ['product-breadcrumb-data', breadcrumbSchema]]) {
    let script = document.getElementById(id);
    if (!script) { script = document.createElement('script'); script.id = id; script.type = 'application/ld+json'; document.head.appendChild(script); }
    script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }
}

function updateProductMetadata(product) {
  const canonicalUrl = new URL(`/producto.html?slug=${encodeURIComponent(product.slug)}`, location.origin).href;
  const description = (plainText(product.description) || `Consulta precio, disponibilidad y detalles de ${product.name} en La Tienda de Alex.`).slice(0, 160);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
  canonical.href = canonicalUrl;
  const setMeta = (selector, attribute, key, value) => {
    let meta = document.head.querySelector(`${selector}[${attribute}="${key}"]`);
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute(attribute, key); document.head.appendChild(meta); }
    meta.content = value;
  };
  setMeta('meta', 'name', 'description', description);
  setMeta('meta', 'property', 'og:type', 'product');
  setMeta('meta', 'property', 'og:title', document.title);
  setMeta('meta', 'property', 'og:description', description);
  setMeta('meta', 'property', 'og:url', canonicalUrl);
  setMeta('meta', 'property', 'og:site_name', 'La Tienda de Alex');
  if (product.image) setMeta('meta', 'property', 'og:image', new URL(getImageSrc(product.image), location.origin).href);
}

document.addEventListener('click', (event) => {
  if (!current) return;

  if (event.target.closest('[data-qty]')) {
    const delta = Number(event.target.closest('[data-qty]').dataset.qty);
    state.qty = Math.max(1, Math.min(99, state.qty + delta));
    $('[data-qty-value]').textContent = state.qty;
  }

  const variantButton = event.target.closest('[data-variant]');
  if (variantButton) {
    document.querySelectorAll('[data-variant]').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    variantButton.classList.add('active');
    const found = (current.variants || []).find((v) => v.sku === variantButton.dataset.variant);
    if (found) {
      state.variant = found;
      $('.price-big').textContent = money(found.price);
      variantButton.setAttribute('aria-pressed', 'true');
      updatePaymentChoice();
    }
  }

  const thumb = event.target.closest('[data-img]');
  if (thumb) {
    $('#main-image').src = thumb.dataset.img;
    state.imageIndex = Number(thumb.dataset.index) || 0;
    document.querySelectorAll('.thumb').forEach((t) => t.classList.remove('active'));
    thumb.classList.add('active');
  }

  const zoomTrigger = event.target.closest('[data-zoom]');
  if (zoomTrigger) {
    ensureZoombox().open(state.imageIndex);
    return;
  }

  if (event.target.closest('[data-add]')) addToCart(current, state.variant, state.qty);

  if (event.target.closest('[data-buy-now]')) {
    addToCart(current, state.variant, state.qty);
    location.href = 'carrito.html';
  }
});

function updatePaymentChoice() {
  const wrap = $('[data-installment-wrap]');
  if (!wrap || !state.variant) return;
  const isCredit = /cr[eé]dito/i.test(state.variant.label);
  wrap.hidden = !isCredit;
  const select = $('[data-installment-count]');
  const estimate = $('[data-installment-estimate]');
  if (isCredit && select && estimate) {
    const count = Number(select.value) || 12;
    estimate.textContent = `${count} ${count === 1 ? 'cuota estimada de' : 'cuotas estimadas de'} ${money(Math.ceil(state.variant.price / count))}`;
  }
}

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-installment-count]')) updatePaymentChoice();
});

main().catch((err) => {
  console.error(err);
  toast('No se pudo cargar el producto', 'err');
});

