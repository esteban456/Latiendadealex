import { $, $$, escapeHtml, getImageSrc, getThumbSrc, initChrome, loadConfig, money, productCard, bindAddButtons, toast } from './core.js?v=20261016-catalogo';

const FEATURED_KEYWORDS = [
  'iphone', 'samsung galaxy', 'macbook', 'notebook', 'laptop', 'ipad', 'jbl', 'airpods',
  'smartwatch', 'smart watch', 'reloj inteligente', 'proyector', 'camara', 'impresora',
  'audifonos', 'parlante', 'nevera', 'lavadora', 'microondas', 'patineta', 'monitor',
];

const USAGE_MAP = {
  gaming: ['gaming', 'gamer', 'consola', 'videojuego', 'xbox', 'playstation', 'nintendo', 'control', 'mouse', 'teclado'],
  estudio: ['tablet', 'ipad', 'laptop', 'notebook', 'cuaderno', 'lapiz', 'maletin', 'mochila'],
  trabajo: ['laptop', 'notebook', 'computador', 'monitor', 'impresora', 'mouse', 'teclado', 'webcam', 'microfono'],
  diario: ['celular', 'smartphone', 'auriculares', 'cargador', 'power bank', 'cable'],
  regalo: ['smartwatch', 'reloj', 'audifonos', 'parlante', 'pulseka', 'tarjeta'],
};

function pickFeatured(products, count) {
  const available = products.filter((p) => p.available && p.price > 0);
  const scored = available.map((p) => {
    const name = p.name.toLowerCase();
    let score = 0;
    for (const word of FEATURED_KEYWORDS) if (name.includes(word)) score += 2;
    if (p.description.length > 40) score += 1;
    if (p.brand) score += 1;
    if (p.variants?.length > 1) score += 1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score || b.p.price - a.p.price);
  return scored.slice(0, count).map((s) => s.p);
}

function pickDeals(products, count) {
  return products
    .filter((p) => p.available && p.price >= 50000 && p.price <= 900000 && Number(p.compareAt) > Number(p.price))
    .sort((a, b) => (Number(b.compareAt) - b.price) / Number(b.compareAt) - (Number(a.compareAt) - a.price) / Number(a.compareAt))
    .slice(0, count);
}

function pickBestSellers(products, count) {
  return products
    .filter((p) => p.available && p.price > 0)
    .sort((a, b) => (b.sales || 0) - (a.sales || 0))
    .slice(0, count);
}

function renderHeroProducts(products) {
  const container = $('[data-hero-products]');
  if (!container) return;
  const top = pickFeatured(products, 4);
  if (!top.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = top
    .map(
      (p) => `
      <div class="hero-product">
        <img src="${escapeHtml(getThumbSrc(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy" data-fallback />
        <div class="hero-product-name">${escapeHtml(p.name.slice(0, 40))}</div>
        <div class="hero-product-price">${money(p.price)}</div>
      </div>`,
    )
    .join('');
}

function renderOffers(products) {
  const deals = pickDeals(products, 5);
  const main = $('[data-offer-main]');
  const side = $('[data-offer-side]');

  if (!deals.length) {
    if (main) main.closest('.section-offers').style.display = 'none';
    return;
  }

  const [mainDeal, ...restDeals] = deals;
  const discount = Math.round(((mainDeal.compareAt - mainDeal.price) / mainDeal.compareAt) * 100);

  if (main) {
    main.innerHTML = `
      <span class="offer-badge">-${discount}%</span>
      <img src="${escapeHtml(getImageSrc(mainDeal.image))}" alt="${escapeHtml(mainDeal.name)}" data-fallback />
      <div class="offer-main-info">
        <div class="offer-name">${escapeHtml(mainDeal.name)}</div>
        <div class="offer-prices">
          <span class="offer-price-old">${money(mainDeal.compareAt)}</span>
          <span class="offer-price-new">${money(mainDeal.price)}</span>
        </div>
        <div class="offer-stock">Disponible</div>
        <a class="btn btn-primary btn-block" style="margin-top:1rem" href="producto.html?slug=${encodeURIComponent(mainDeal.slug)}">Comprar ahora</a>
      </div>`;
  }

  if (side && restDeals.length) {
    side.innerHTML = restDeals
      .slice(0, 4)
      .map(
        (p) => `
        <a class="offer-small" href="producto.html?slug=${encodeURIComponent(p.slug)}">
          <img src="${escapeHtml(getThumbSrc(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy" data-fallback />
          <div class="offer-small-info">
            <div class="offer-small-name">${escapeHtml(p.name.slice(0, 40))}</div>
            <div class="offer-small-price">${money(p.price)}</div>
            <div class="offer-small-old">${money(p.compareAt)}</div>
          </div>
        </a>`,
      )
      .join('');
  }
}

function renderFeatured(products) {
  const container = $('[data-featured]');
  if (!container) return;
  const featured = pickFeatured(products, 4);
  container.innerHTML = featured.length
    ? featured.map(productCard).join('')
    : '<div class="empty" style="grid-column:1/-1"><div class="ico">📦</div><b>No hay productos destacados</b></div>';
}

function renderBestSellers(products) {
  const container = $('[data-best-sellers]');
  if (!container) return;
  const bestSellers = pickBestSellers(products, 4);
  container.innerHTML = bestSellers.length
    ? bestSellers.map(productCard).join('')
    : '<div class="empty" style="grid-column:1/-1"><div class="ico">📦</div><b>Aún no hay productos disponibles</b></div>';
}

function renderAlexRecommendation(products) {
  const container = $('[data-alex-recommendation]');
  if (!container) return;
  const best = pickBestSellers(products, 1)[0];
  if (!best) {
    container.innerHTML = '';
    return;
  }
  const installments = Math.min(12, Math.max(3, Math.floor(best.price / 100000) * 3));
  container.innerHTML = `
    <img src="${escapeHtml(getImageSrc(best.image))}" alt="${escapeHtml(best.name)}" data-fallback />
    <div class="alex-rec-content">
      <span class="alex-badge">⭐ Recomendado</span>
      <h3>${escapeHtml(best.name)}</h3>
      <p class="alex-quote">"Si buscas algo bueno para usar todos los días sin gastar demasiado, esta es una opción que recomendamos."</p>
      <div class="alex-price">${money(best.price)}</div>
      <a class="btn btn-primary" href="producto.html?slug=${encodeURIComponent(best.slug)}">Ver producto →</a>
    </div>`;
}

function renderDifferential(products) {
  const resultContainer = $('[data-diff-result]');
  const productsContainer = $('[data-diff-products]');
  if (!resultContainer || !productsContainer) return;

  let selectedUsage = null;
  let selectedBudget = null;

  function filterAndShow() {
    if (!selectedUsage || !selectedBudget) return;
    const budget = Number(selectedBudget);
    const keywords = USAGE_MAP[selectedUsage] || [];
    const matches = products
      .filter((p) => p.available && p.price > 0 && p.price <= budget)
      .filter((p) => {
        const name = p.name.toLowerCase();
        return keywords.some((k) => name.includes(k));
      })
      .slice(0, 4);

    resultContainer.hidden = false;
    productsContainer.innerHTML = matches.length
      ? matches.map(productCard).join('')
      : '<div class="empty" style="grid-column:1/-1"><div class="ico">🔍</div><b>No encontramos productos en ese rango</b></div>';
  }

  $('[data-usage-options]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-usage]');
    if (!btn) return;
    $$('[data-usage-options] .diff-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedUsage = btn.dataset.usage;
    filterAndShow();
  });

  $('[data-budget-options]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-budget]');
    if (!btn) return;
    $$('[data-budget-options] .diff-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedBudget = btn.dataset.budget;
    filterAndShow();
  });
}

function renderCountdown() {
  const el = $('[data-countdown]');
  if (!el) return;
  const update = () => {
    const now = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const diff = end - now;
    if (diff <= 0) {
      el.textContent = '00:00:00';
      return;
    }
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  };
  update();
  setInterval(update, 1000);
}

function initMobileMenu() {
  const toggle = $('[data-menu-toggle]');
  const mobileNav = $('[data-nav-mobile]');
  const mobileSearch = $('[data-mobile-search]');
  if (!toggle || !mobileNav) return;

  toggle.addEventListener('click', () => {
    const isOpen = mobileNav.hidden;
    mobileNav.hidden = !isOpen;
    mobileSearch.hidden = !isOpen;
  });
}

function initServiceModal() {
  const modal = $('[data-service-modal]');
  const closeBtn = $('[data-service-close]');
  if (!modal) return;

  $$('[data-service]').forEach((card) => {
    card.addEventListener('click', () => {
      modal.hidden = false;
      const type = card.dataset.service;
      const deviceInput = modal.querySelector('[name="device"]');
      if (deviceInput) deviceInput.focus();
    });
  });

  closeBtn?.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  const form = $('[data-service-form]');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    console.log('Solicitud de servicio:', data);
    toast('Solicitud enviada. Te contactaremos pronto.', 'ok');
    form.reset();
    modal.hidden = true;
  });
}

function initHomeReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll(
    '#categorias .section-head, #categorias .cat-card, #ofertas .section-head, #ofertas .offer-main, #ofertas .offer-small, .section-differential .section-head, .section-differential .diff-step, #destacados .section-head, #destacados .card, .section-alex .section-head, .section-alex .alex-recommendation, #servicio-tecnico .section-head, #servicio-tecnico .service-card, .section-trust .trust-item, .section-store .store-info, .section-store .store-map',
  );
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });
  targets.forEach((element, index) => {
    element.classList.add('home-reveal');
    element.style.setProperty('--reveal-delay', `${(index % 4) * 65}ms`);
    observer.observe(element);
  });
}
async function main() {
  $('[data-year]').textContent = new Date().getFullYear();
  const catalog = await initChrome();
  const products = (catalog.products || []).filter((p) => p.price > 0);

  renderHeroProducts(products);
  renderOffers(products);
  renderFeatured(products);
  renderBestSellers(products);
  renderAlexRecommendation(products);
  renderDifferential(products);
  renderCountdown();
  initMobileMenu();
  initServiceModal();
  initHomeReveal();

  bindAddButtons(catalog);

  // Lazy loading para imágenes dinámicas
  if (window.lazyLoadObserver) {
    document.querySelectorAll('.hero-product img, .offer-small img').forEach((img) => {
      window.lazyLoadObserver(img);
    });
  }
}

main().catch((err) => {
  console.error(err);
  toast('No se pudo cargar la página', 'err');
});
