import {
  $,
  $$,
  escapeHtml,
  getThumbSrc,
  initChrome,
  loadConfig,
  money,
  productCard,
  bindAddButtons,
  toast,
} from './core.js?v=20261016-catalogo';

const PAGE_SIZE = 48;
let FREE_SHIPPING_FROM = 300000;

const state = {
  q: '',
  category: '',
  brand: '',
  maxPrice: Infinity,
  minPrice: 0,
  onlyStock: false,
  freeShipping: false,
  onlyOffers: false,
  sort: 'relevancia',
  view: 'grid',
  offset: 0,
  total: 0,
  loading: false,
  requestId: 0,
};

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// Historial de búsqueda
const SEARCH_HISTORY_KEY = 'alx_search_history';
const MAX_HISTORY = 8;

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function addToSearchHistory(query) {
  if (!query || query.length < 2) return;
  let history = getSearchHistory().filter((item) => item !== query);
  history.unshift(query);
  history = history.slice(0, MAX_HISTORY);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

// Countdown para ofertas
function startCountdown() {
  const el = $('[data-countdown]');
  if (!el) return;
  const update = () => {
    const now = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const diff = end - now;
    if (diff <= 0) {
      el.innerHTML = '00:00:00';
      return;
    }
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    el.innerHTML = `${h}:${m}:${s}`;
  };
  update();
  setInterval(update, 1000);
}

async function fetchCatalog() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('category', state.category);
  if (state.brand) params.set('brand', state.brand);
  if (state.minPrice > 0) params.set('minPrice', state.minPrice);
  if (state.maxPrice < Infinity) params.set('maxPrice', state.maxPrice);
  if (state.onlyStock) params.set('stock', '1');
  if (state.freeShipping) params.set('shipping', '1');
  if (state.onlyOffers) params.set('offers', '1');
  if (state.sort) params.set('sort', state.sort);
  params.set('offset', state.offset);
  params.set('limit', PAGE_SIZE);

  const response = await fetch(`/api/catalog?${params.toString()}`);
  if (!response.ok) throw new Error('No se pudo cargar el catálogo');
  return response.json();
}

async function main() {
  $('[data-year]').textContent = new Date().getFullYear();
  const catalog = await initChrome();
  const config = await loadConfig();
  const mobileFilterDisclosure = $('[data-mobile-filter-disclosure]');
  if (mobileFilterDisclosure) {
    const mobileLayout = window.matchMedia('(max-width: 760px)');
    const syncFilterDisclosure = (event) => { mobileFilterDisclosure.open = !event.matches; };
    syncFilterDisclosure(mobileLayout);
    mobileLayout.addEventListener?.('change', syncFilterDisclosure);
  }
  FREE_SHIPPING_FROM = config.store?.freeShippingFrom ?? FREE_SHIPPING_FROM;
  const products = catalog.products || [];
  const categories = catalog.categories || [];
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const catNames = products.flatMap((p) => (p.categories || []).map((c) => c.name));

  const params = new URLSearchParams(location.search);
  state.q = params.get('q') || '';
  state.category = params.get('c') || '';
  $('#search-form input').value = state.q;

  const maxCatalog = Math.max(100000, ...products.map((p) => p.price));
  const priceInput = $('#f-price');
  priceInput.max = Math.ceil(maxCatalog / 50000) * 50000;
  priceInput.value = priceInput.max;
  state.maxPrice = Number(priceInput.value);
  $('#f-price-label').textContent = money(state.maxPrice);

  // Build category filter list
  const catCounts = new Map();
  for (const name of catNames) catCounts.set(name, (catCounts.get(name) || 0) + 1);
  const sortedCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));

  $('[data-filter-categories]').innerHTML = sortedCats
    .map(
      ([name, count]) => `
      <button type="button" class="filter-item ${normalize(state.category) === normalize(name) || Boolean(state.category && normalize(name).startsWith(normalize(state.category))) ? 'active' : ''}" data-cat="${escapeHtml(name)}" aria-pressed="${normalize(state.category) === normalize(name) || Boolean(state.category && normalize(name).startsWith(normalize(state.category)))}">
        <span>${escapeHtml(name)}</span>
        <span class="count">${count}</span>
      </button>`,
    )
    .join('');

  // Build brand filter list
  $('[data-filter-brands]').innerHTML = brands
    .map(
      (b) => `
      <label class="filter-item ${state.brand === b ? 'active' : ''}">
        <input type="checkbox" data-brand="${escapeHtml(b)}" ${state.brand === b ? 'checked' : ''} />
        <span>${escapeHtml(b)}</span>
      </label>`,
    )
    .join('');

  const grid = $('[data-results]');
  grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');

  function renderChips() {
    const chips = [];
    if (state.q) chips.push(['q', `Buscar: ${state.q}`]);
    if (state.category) chips.push(['category', state.category]);
    if (state.brand) chips.push(['brand', state.brand]);
    if (state.maxPrice < maxCatalog) chips.push(['maxPrice', `Hasta ${money(state.maxPrice)}`]);
    if (state.minPrice > 0) chips.push(['minPrice', `Desde ${money(state.minPrice)}`]);
    if (state.onlyStock) chips.push(['onlyStock', 'Solo disponibles']);
    if (state.freeShipping) chips.push(['freeShipping', 'Envío gratis']);
    if (state.onlyOffers) chips.push(['onlyOffers', 'Con descuento']);

    $('[data-chips]').innerHTML = chips
      .map(([key, label]) => `<button class="chip active" data-clear="${key}">${escapeHtml(label)} ✕</button>`)
      .join('');

    $('[data-crumb]').textContent = state.category || (state.q ? `Buscar: ${state.q}` : 'Catálogo');
    document.title = `${state.category || 'Catálogo'} | La Tienda de Alex`;
    const hasFilters = Boolean(state.q || state.category || state.brand || state.minPrice > 0 || state.maxPrice < maxCatalog || state.onlyStock || state.freeShipping || state.onlyOffers);
    $$('[data-deals-section], [data-best-section]').forEach((section) => { section.hidden = hasFilters; });
  }

  async function render(append = false) {
    if (state.loading && append) return;
    state.loading = true;
    const requestId = ++state.requestId;

    const grid = $('[data-results]');
    if (!append) {
      grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');
    }

    try {
      const data = await fetchCatalog();
      if (requestId !== state.requestId) return;
      const products = data.products || [];
      state.total = data.pagination?.total || 0;

      $('[data-count]').textContent = state.total;

      if (append) {
        // Remove existing skeletons
        grid.querySelectorAll('.skeleton').forEach((s) => s.remove());
        grid.insertAdjacentHTML('beforeend', products.map(productCard).join(''));
      } else {
        grid.innerHTML = products.length
          ? products.map(productCard).join('')
          : `<div class="empty" style="grid-column:1/-1">
               <div class="ico">🔍</div>
               <b>No encontramos productos con esos filtros</b>
               <p>Prueba con otra palabra o quita algún filtro.</p>
             </div>`;
      }

      $('[data-more]').hidden = !data.pagination?.hasMore;
      renderChips();

      const url = new URLSearchParams();
      if (state.q) url.set('q', state.q);
      if (state.category) url.set('c', state.category);
      history.replaceState(null, '', `?${url.toString()}`);
    } catch (err) {
      if (requestId !== state.requestId) return;
      console.error(err);
      if (!append) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No pudimos cargar los productos</b><p>Comprueba que la tienda esté abierta desde su servidor y vuelve a intentarlo.</p><button class="btn btn-ghost" data-retry>Reintentar</button></div>`;
      toast('Error al cargar productos', 'err');
    } finally {
      if (requestId === state.requestId) state.loading = false;
    }
  }

  function update(patch) {
    Object.assign(state, patch, { offset: 0 });
    render(false);
  }

  // Search
  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    update({ q: $('#search-form input').value.trim() });
  });

  let searchTimer;
  $('#search-form input').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value.trim();
    searchTimer = setTimeout(() => update({ q: value }), 300);
    showSuggestions(value, products);
  });

  // Category filter
  $('[data-filter-categories]').addEventListener('click', (event) => {
    const item = event.target.closest('[data-cat]');
    if (!item) return;
    const cat = item.dataset.cat;
    const sameCategory = normalize(state.category) === normalize(cat) || Boolean(state.category && normalize(cat).startsWith(normalize(state.category)));
    update({ category: sameCategory ? '' : cat });
    $$('[data-filter-categories] [data-cat]').forEach((el) => {
      const active = Boolean(state.category && normalize(el.dataset.cat) === normalize(state.category));
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', String(active));
    });
  });

  // Brand filter
  $('[data-filter-brands]').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-brand]');
    if (!checkbox) return;
    update({ brand: checkbox.checked ? checkbox.dataset.brand : '' });
  });

  // Price filter
  priceInput.addEventListener('input', (event) => {
    $('#f-price-label').textContent = money(event.target.value);
    update({ maxPrice: Number(event.target.value) });
  });

  $('#f-price-min').addEventListener('change', (event) => {
    update({ minPrice: Number(event.target.value) || 0 });
  });

  $('#f-price-max').addEventListener('change', (event) => {
    update({ maxPrice: Number(event.target.value) || Number(priceInput.max) });
  });

  // Options
  $('#f-stock').addEventListener('change', (event) => update({ onlyStock: event.target.checked }));
  $('#f-shipping').addEventListener('change', (event) => update({ freeShipping: event.target.checked }));
  $('#f-offers').addEventListener('change', (event) => update({ onlyOffers: event.target.checked }));

  // Sort
  $('#f-sort').addEventListener('change', (event) => update({ sort: event.target.value }));

  // View toggle
  $('[data-view-toggle]').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-view]');
    if (!btn) return;
    state.view = btn.dataset.view;
    $$('.view-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    grid.classList.toggle('list-view', state.view === 'list');
  });

  // Load more (scroll infinito)
  $('[data-more]').addEventListener('click', () => {
    state.offset += PAGE_SIZE;
    render(true);
  });

  // Scroll infinito automático
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      if (scrollTop + clientHeight >= scrollHeight - 500 && !$('[data-more]').hidden && !state.loading) {
        state.offset += PAGE_SIZE;
        render(true);
      }
    }, 100);
  }, { passive: true });

  // Clear filters
  $('#f-clear').addEventListener('click', () => {
    state.q = '';
    state.category = '';
    state.brand = '';
    state.maxPrice = Number(priceInput.max);
    state.minPrice = 0;
    state.onlyStock = false;
    state.freeShipping = false;
    state.onlyOffers = false;
    state.sort = 'relevancia';
    $('#search-form input').value = '';
    $$('[data-filter-categories] .filter-item').forEach((el) => el.classList.remove('active'));
    $$('[data-filter-brands] input').forEach((el) => (el.checked = false));
    priceInput.value = priceInput.max;
    $('#f-price-label').textContent = money(state.maxPrice);
    $('#f-price-min').value = '';
    $('#f-price-max').value = '';
    $('#f-stock').checked = false;
    $('#f-shipping').checked = false;
    $('#f-offers').checked = false;
    $('#f-sort').value = 'relevancia';
    update({});
  });

  // Clear individual chips
  $('[data-chips]').addEventListener('click', (event) => {
    const key = event.target.dataset?.clear;
    if (!key) return;
    const resets = {
      q: () => ($('#search-form input').value = ''),
      category: () => $$('[data-filter-categories] .filter-item').forEach((el) => el.classList.remove('active')),
      brand: () => $$('[data-filter-brands] input').forEach((el) => (el.checked = false)),
      maxPrice: () => {
        priceInput.value = priceInput.max;
        $('#f-price-label').textContent = money(priceInput.max);
      },
      minPrice: () => ($('#f-price-min').value = ''),
      onlyStock: () => ($('#f-stock').checked = false),
      freeShipping: () => ($('#f-shipping').checked = false),
      onlyOffers: () => ($('#f-offers').checked = false),
    };
    resets[key]?.();
    const patch = {
      [key]:
        key === 'maxPrice'
          ? Number(priceInput.max)
          : key === 'minPrice'
            ? 0
            : key === 'onlyStock' || key === 'freeShipping' || key === 'onlyOffers'
              ? false
              : '',
    };
    update(patch);
  });

  $('[data-results]').addEventListener('click', (event) => {
    if (event.target.closest('[data-retry]')) render(false);
  });

  // Search suggestions con historial
  function showSuggestions(query, products) {
    const container = $('[data-suggestions]');
    if (!query || query.length < 2) {
      // Mostrar historial si no hay query
      const history = getSearchHistory();
      if (history.length > 0) {
        container.innerHTML = `
          <div class="search-history">
            ${history
              .slice(0, 5)
              .map(
                (item) => `
              <div class="search-history-item" data-history="${escapeHtml(item)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                ${escapeHtml(item)}
              </div>`,
              )
              .join('')}
          </div>`,
        container.hidden = false;
      } else {
        container.hidden = true;
      }
      return;
    }

    const q = normalize(query);
    const matches = products
      .filter((p) => normalize(`${p.name} ${p.brand}`).includes(q))
      .slice(0, 6);

    if (!matches.length) {
      container.innerHTML = '<div class="sug-empty">Sin resultados</div>';
      container.hidden = false;
      return;
    }

    container.innerHTML = matches
      .map(
        (p) => `
        <a href="producto.html?slug=${encodeURIComponent(p.slug)}">
          <img src="${escapeHtml(getThumbSrc(p.image))}" alt="" loading="lazy" />
          <span class="sug-info">
            <span class="sug-name">${escapeHtml(p.name)}</span>
            <span class="sug-price">${money(p.price)}</span>
          </span>
          ${(p.sales || 0) > 50 ? '<span class="sug-badge badge-best">Más vendido</span>' : ''}
        </a>`,
      )
      .join('');
    container.hidden = false;
  }

  // Click en historial
  $('[data-suggestions]').addEventListener('click', (event) => {
    const historyItem = event.target.closest('[data-history]');
    if (historyItem) {
      const query = historyItem.dataset.history;
      $('#search-form input').value = query;
      update({ q: query });
      $('[data-suggestions]').hidden = true;
    }
  });

  // Guardar en historial al buscar
  $('#search-form').addEventListener('submit', () => {
    const query = $('#search-form input').value.trim();
    if (query) addToSearchHistory(query);
  });

  // Close suggestions on outside click
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search')) {
      $('[data-suggestions]').hidden = true;
    }
  });

  bindAddButtons(catalog);
  render(false);

  // Cargar secciones especiales
  loadSpecialSections(products);

  // Iniciar countdown
  startCountdown();

  if (!products.length) toast('El catálogo está vacío. Ejecuta: npm run scrape', 'err');
}

async function loadSpecialSections(products) {
  // Ofertas del día: productos con descuento
  const deals = products
    .filter((p) => p.available && Number(p.compareAt) > Number(p.price))
    .sort((a, b) => (Number(b.compareAt) - b.price) / Number(b.compareAt) - (Number(a.compareAt) - a.price) / Number(a.compareAt))
    .slice(0, 8);

  const dealsGrid = $('[data-deals-grid]');
  if (dealsGrid && deals.length) {
    dealsGrid.innerHTML = deals.map(productCard).join('');
  }

  // Más vendidos: productos con más ventas
  const bestSellers = products
    .filter((p) => p.available)
    .sort((a, b) => (b.sales || 0) - (a.sales || 0))
    .slice(0, 8);

  const bestGrid = $('[data-best-grid]');
  if (bestGrid && bestSellers.length) {
    bestGrid.innerHTML = bestSellers.map(productCard).join('');
  }
}

main().catch((err) => {
  console.error(err);
  toast('No se pudo cargar el catálogo', 'err');
});
