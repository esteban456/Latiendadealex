const CART_KEY = 'alx.cart.v1';
export const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#eef0f6"/><text x="100" y="108" font-family="sans-serif" font-size="16" fill="#9aa3b5" text-anchor="middle">Sin imagen</text></svg>',
  );

export const money = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function plainText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function toast(message, type = '') {
  let node = $('.toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.className = `toast show ${type}`;
  clearTimeout(node._timer);
  node._timer = setTimeout(() => {
    node.className = 'toast';
  }, 3200);
}

export const readStore = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

export const writeStore = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* modo privado */
  }
  window.dispatchEvent(new CustomEvent('cart:change'));
};

export const cart = {
  all: () => {
    const items = readStore(CART_KEY, []);
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && item.sku && Number(item.qty) > 0 && Number(item.price) >= 0);
  },
  save: (items) => writeStore(CART_KEY, items),
  add(item, qty = 1) {
    const items = this.all();
    const found = items.find((i) => i.sku === item.sku);
    if (found) found.qty = Math.min(99, found.qty + qty);
    else items.push({ ...item, qty: Math.min(99, qty) });
    this.save(items);
  },
  setQty(sku, qty) {
    const items = this.all()
      .map((i) => (i.sku === sku ? { ...i, qty: Math.max(0, Math.min(99, qty)) } : i))
      .filter((i) => i.qty > 0);
    this.save(items);
  },
  remove(sku) {
    this.save(this.all().filter((i) => i.sku !== sku));
  },
  clear() {
    this.save([]);
  },
  count() {
    return this.all().reduce((sum, i) => sum + i.qty, 0);
  },
  subtotal() {
    return this.all().reduce((sum, i) => sum + i.price * i.qty, 0);
  },
};

export async function loadCatalog() {
  const response = await fetch('/api/catalog');
  if (!response.ok) throw new Error('No se pudo cargar el catalogo');
  return response.json();
}

export async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    return response.ok ? response.json() : { store: {}, paymentReady: false, mode: 'demo' };
  } catch {
    return { store: {}, paymentReady: false, mode: 'demo' };
  }
}

function getDeliveryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  return date.toLocaleDateString('es-CO', options);
}

function getStockWarning(product) {
  if (!product.available) return '';
  const stock = product.stock || 0;
  if (stock > 0 && stock <= 5) {
    return `<div class="card-stock-warning">¡Solo quedan ${stock}!</div>`;
  }
  return '';
}

// El fondo se quita al subir o editar la foto desde el admin (queda montada
// sobre la plantilla), asi que aqui solo se optimiza a WebP.
const IMAGEKIT_TR = 'f-webp';

function imagenSinFondo(url, extra) {
  if (!url || !/^https?:\/\/(?:[a-z0-9-]+\.)*ik\.imagekit\.io\//i.test(url)) return url;
  const [sin, query] = url.split('?');
  const params = new URLSearchParams(query || '');
  const previo = params.get('tr');
  const cadena = [extra, IMAGEKIT_TR].filter(Boolean).join(',');
  params.set('tr', previo ? `${previo},${cadena}` : cadena);
  return `${sin}?${params.toString()}`;
}

// Solo las imagenes locales viven en la carpeta productos-webp; en una URL
// remota (ImageKit) cambiar la extension rompe la imagen.
function localToWebp(imagePath) {
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  return imagePath.replace('/productos/', '/productos-webp/').replace(/\.(jpg|jpeg|png)$/i, '.webp');
}

export function getImageSrc(imagePath) {
  if (!imagePath) return PLACEHOLDER;
  return imagenSinFondo(localToWebp(imagePath), null);
}

// En los listados la miniatura recortada pesa ~8 KB contra ~21 KB de la completa.
export function getThumbSrc(imagePath) {
  if (!imagePath) return PLACEHOLDER;
  const base = localToWebp(imagePath);
  if (base.startsWith('/assets/img/productos-webp/')) return base.replace(/\.webp$/, '-400.webp');
  return imagenSinFondo(base, 'w-400');
}

export function productCard(product) {
  const off = !product.available;
  const creditVariant = (product.variants || []).find((variant) => /cr[eé]dito/i.test(variant.label));
  const price = Number(product.price) || 0;
  const creditPrice = Number(creditVariant?.price) > price ? Number(creditVariant.price) : (Number(product.maxPrice) > price ? Number(product.maxPrice) : 0);
  const listPrice = Number(product.compareAt) > price ? Number(product.compareAt) : 0;
  const hasOffer = listPrice > 0;
  const isBestSeller = (product.sales || 0) > 50;
  const hasFreeShipping = product.price >= 300000;
  const isNew = product.createdAt && (Date.now() - new Date(product.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
  const installments = Math.min(12, Math.max(3, Math.floor(product.price / 100000) * 3));
  const installmentPrice = Math.round(product.price / installments);
  const deliveryDate = getDeliveryDate();
  const stockWarning = getStockWarning(product);
  const description = plainText(product.description);

  let badges = '';
  if (off) badges += '<span class="tag tag-out">Agotado</span>';
  if (isBestSeller && !off) badges += '<span class="badge badge-best">Más vendido</span>';
  if (hasOffer && !off) badges += '<span class="badge badge-offer">Oferta</span>';
  if (hasFreeShipping && !off) badges += '<span class="badge badge-shipping">Envío gratis</span>';
  if (isNew && !off) badges += '<span class="badge badge-new">Nuevo</span>';

  const imgSrc = escapeHtml(getThumbSrc(product.image));
  const imgFull = escapeHtml(getImageSrc(product.image));
  const imgAlt = escapeHtml(product.name);

  return `
    <article class="card ${off ? 'stock-off' : ''}">
      <a class="card-media" href="producto.html?slug=${encodeURIComponent(product.slug)}" aria-label="${escapeHtml(product.name)}">
        ${badges}
        <img data-src="${imgSrc}" data-full="${imgFull}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" alt="${imgAlt}" loading="lazy" data-fallback class="lazy-img" />
      </a>
      <div class="card-body">
        ${product.brand ? `<span class="card-brand">${escapeHtml(product.brand)}</span>` : ''}
        <a href="producto.html?slug=${encodeURIComponent(product.slug)}" class="card-name">${escapeHtml(product.name)}</a>
        ${description ? `<p class="card-description">${escapeHtml(description)}</p>` : ''}
        <div class="card-foot">
          <div>
            <div class="card-price-row">
              <span class="card-price">${money(product.price)}</span>
              ${hasOffer ? `<span class="price-old">${money(listPrice)}</span>` : ''}
            </div>
            ${creditPrice ? `<div class="card-credit">o a crédito ${money(creditPrice)}</div>` : ''}
            <div class="card-installments">
              en ${installments} cuotas de ${money(installmentPrice)} ${hasFreeShipping ? '<span class="free">sin interés</span>' : ''}
            </div>
            ${hasFreeShipping ? '<div class="card-shipping">🚚 Envío gratis</div>' : ''}
            <div class="card-delivery">📅 Recíbelo el ${deliveryDate}</div>
            ${stockWarning}
          </div>
          <div class="card-buy-actions">
            <label class="card-quantity" aria-label="Cantidad">
              <span>Cant.</span><input type="number" min="1" max="99" value="1" data-card-qty="${escapeHtml(product.slug)}" ${off ? 'disabled' : ''} />
            </label>
            <button class="btn btn-sm" data-add-to-cart="${escapeHtml(product.slug)}" ${off ? 'disabled' : ''}>
              ${off ? 'Sin stock' : 'Agregar al carrito'}
            </button>
          </div>
        </div>
      </div>
    </article>`;
}

export function productFromCatalog(catalog, slug) {
  return (catalog.products || []).find((p) => p.slug === slug);
}

export function variantFromProduct(product, sku) {
  return (product.variants || []).find((v) => v.sku === sku) || (product.variants || [])[0];
}

export function addToCart(product, variant, qty = 1) {
  cart.add(
    {
      id: product.id,
      slug: product.slug,
      name: product.name,
      image: product.image,
      sku: variant.sku,
      variant: variant.label,
      price: variant.price || product.price,
    },
    qty,
  );
  toast(`${product.name} agregado al carrito`, 'ok');
}

export function bindAddButtons(catalog) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-to-cart]');
    if (!button) return;
    event.preventDefault();
    const product = productFromCatalog(catalog, button.dataset.addToCart);
    if (!product) return;
    const variant = variantFromProduct(product);
    const quantity = button.closest('.card')?.querySelector('[data-card-qty]');
    addToCart(product, variant, Math.max(1, Math.min(99, Number(quantity?.value) || 1)));
  });
}

export function initImageFallback() {
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      // Las tarjetas cargan la miniatura -400. Si esa falla se prueba la imagen
      // completa y, solo si tampoco existe, se cae al placeholder.
      if (img.dataset.full) {
        const completa = img.dataset.full;
        delete img.dataset.full;
        img.src = completa;
        return;
      }
      if (img.dataset.fallback !== undefined && img.src !== PLACEHOLDER) {
        img.dataset.fallback = 'done';
        img.src = PLACEHOLDER;
      }
    },
    true,
  );
}

export function initLazyLoading() {
  const imageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          imageObserver.unobserve(img);
        }
      });
    },
    { rootMargin: '200px 0px', threshold: 0.01 },
  );

  const observar = (raiz) => {
    raiz.querySelectorAll('img[data-src]').forEach((img) => imageObserver.observe(img));
  };

  // Observar todas las imágenes con data-src
  observar(document);

  // Las tarjetas se pintan despues del arranque, asi que hay que vigilar el DOM:
  // si no, las imagenes se quedan en el SVG transparente y el producto sale sin
  // foto. Antes dependia de que cada pagina llamara a la funcion devuelta, y
  // ninguna lo hacia.
  if (typeof MutationObserver !== 'undefined' && document.body) {
    new MutationObserver((mutaciones) => {
      for (const m of mutaciones) {
        for (const nodo of m.addedNodes) {
          if (nodo.nodeType !== 1) continue;
          if (nodo.matches?.('img[data-src]')) imageObserver.observe(nodo);
          if (nodo.querySelectorAll) observar(nodo);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Retornar función para observar nuevas imágenes dinámicamente
  return observar;
}

export function initCartBadge() {
  const paint = () => {
    const count = cart.count();
    $$('[data-cart-count]').forEach((node) => {
      node.textContent = count;
      node.hidden = count === 0;
    });
  };
  window.addEventListener('cart:change', paint);
  window.addEventListener('storage', paint);
  paint();
}

export function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
  );
  $$('.reveal').forEach((el) => observer.observe(el));
}

export function initHeaderScroll() {
  const header = $('.header');
  if (!header) return;
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function initColorTheme(nav) {
  const toggle = nav.matches?.('[data-theme-toggle]') ? nav : nav.querySelector('[data-theme-toggle]');
  if (!toggle) return;
  let theme = 'light';
  try { theme = localStorage.getItem('alx.theme') === 'dark' ? 'dark' : 'light'; } catch { /* almacenamiento bloqueado */ }
  const paint = () => {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    toggle.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg><span>Tema</span>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 13A8.5 8.5 0 0 1 11 3.2 8.8 8.8 0 1 0 20.8 13Z"/></svg><span>Tema</span>';
    toggle.setAttribute('aria-label', `Cambiar a modo ${dark ? 'claro' : 'oscuro'}`);
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.title = `Cambiar a modo ${dark ? 'claro' : 'oscuro'}`;
  };
  paint();
  toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('alx.theme', theme); } catch { /* almacenamiento bloqueado */ }
    paint();
  });
}
export function initMobileAppNavigation() {
  if (!document.body || document.querySelector('[data-mobile-app-nav]')) return;
  const page = location.pathname.split('/').pop() || 'index.html';
  const active = page === 'carrito.html' ? 'cart'
    : page === 'continuar-google.html' ? 'account'
    : ['catalogo.html', 'productos.html', 'producto.html'].includes(page) ? 'search'
    : 'home';
  const tabs = [
    { key: 'home', href: 'index.html', label: 'Inicio', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>' },
    { key: 'search', href: 'catalogo.html', label: 'Buscar', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/><path d="M8 10.8h5.6M10.8 8v5.6"/></svg>' },
    { key: 'account', href: 'continuar-google.html', label: 'Cuenta', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>' },
    { key: 'cart', href: 'carrito.html', label: 'Carrito', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L22 7H6"/></svg>' },
  ];
  const nav = document.createElement('nav');
  nav.className = 'mobile-app-nav';
  nav.dataset.mobileAppNav = '';
  nav.setAttribute('aria-label', 'Navegación principal');
  nav.innerHTML = tabs.map((tab) => `<a class="mobile-app-tab${tab.key === active ? ' active' : ''}" href="${tab.href}"${tab.key === active ? ' aria-current="page"' : ''}>${tab.icon}<span>${tab.label}</span>${tab.key === 'cart' ? '<b class="mobile-app-count" data-cart-count hidden>0</b>' : ''}</a>`).join('');
  const themeButton = document.createElement('button');
  themeButton.type = 'button';
  themeButton.dataset.themeToggle = '';
  themeButton.setAttribute('aria-pressed', 'false');
  let searchForm = document.querySelector('#search-form, .search[role="search"]');
  // Un buscador escondido dentro del menú móvil no sirve para anclar el botón de
  // tema: quedaría invisible. En ese caso se usa la barra de acciones del header.
  if (searchForm && searchForm.closest('[data-mobile-search]')) searchForm = null;
  const headerActions = document.querySelector('.header-actions');
  if (searchForm) {
    themeButton.className = 'search-theme-toggle';
    searchForm.append(themeButton);
  } else if (headerActions) {
    themeButton.className = 'icon-btn header-theme-toggle';
    headerActions.append(themeButton);
  } else {
    themeButton.className = 'mobile-app-tab mobile-theme-toggle';
    nav.append(themeButton);
  }
  document.body.append(nav);
  initColorTheme(themeButton);
}
export async function initChrome({ catalog, config: suppliedConfig } = {}) {
  initMobileAppNavigation();
  initCartBadge();
  initImageFallback();
  initLazyLoading();
  initScrollReveal();
  initHeaderScroll();

  const accountIcon = $('[data-account-icon]');
  if (accountIcon) {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const picture = data?.user?.picture;
        if (!picture) return;
        const avatar = document.createElement('img');
        avatar.className = 'account-avatar';
        avatar.src = picture;
        avatar.alt = '';
        avatar.referrerPolicy = 'no-referrer';
        avatar.onerror = () => avatar.remove();
        accountIcon.replaceChildren(avatar);
        accountIcon.setAttribute('aria-label', `Mi cuenta: ${data.user.name || data.user.email}`);
        accountIcon.title = data.user.name || data.user.email || 'Mi cuenta';
      })
      .catch(() => {});
  }

  const data = catalog || (await loadCatalog().catch(() => ({ categories: [], products: [] })));
  const nav = $('[data-nav]');
  if (nav) {
    const top = (data.categories || []).slice(0, 12);
    nav.innerHTML = [
      '<a href="index.html">Inicio</a>',
      '<a href="catalogo.html">Todo el catalogo</a>',
      ...top.map((c) => `<a href="catalogo.html?c=${encodeURIComponent(c.name)}">${escapeHtml(c.name)}</a>`),
    ].join('');
  }

  const footCats = $('[data-footer-cats]');
  if (footCats) {
    footCats.innerHTML = (data.categories || [])
      .slice(0, 10)
      .map((c) => `<li><a href="catalogo.html?c=${encodeURIComponent(c.name)}">${escapeHtml(c.name)}</a></li>`)
      .join('');
  }

  const demo = $('[data-demo-banner]');
  const config = await (suppliedConfig || loadConfig());
  if (demo && !config.paymentReady) {
    demo.className = 'banner-demo';
    demo.textContent = 'Modo demostracion: el pago real se activa cuando el cliente cargue sus llaves de Mercado Pago (.env).';
  }

  const waDigits = String(config.store?.whatsapp || '').replace(/\D/g, '');
  if (waDigits) {
    $$('[data-whatsapp]').forEach((node) => {
      node.href = `https://wa.me/${waDigits}`;
    });
  }

  return data;
}

