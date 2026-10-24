import { $, PLACEHOLDER, cart, escapeHtml, getThumbSrc, initChrome, loadConfig, money, toast } from './core.js?v=20261016-catalogo';

let FREE_SHIPPING_FROM = 300000;
let SHIPPING_FLAT = 25000;

async function main() {
  $('[data-year]').textContent = new Date().getFullYear();
  let config = { store: {}, paymentReady: false };

  // Paint persisted items immediately; catalog/config requests must not hold the cart hostage.
  render();
  const configPromise = loadConfig();
  const chromeReady = initChrome({ catalog: { categories: [], products: [] }, config: configPromise });
  window.addEventListener('cart:change', render);
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key === 'alx.cart.v1') render();
  });

  const form = $('[data-checkout]');
  form.addEventListener('submit', (event) => submit(event, form, config));

  config = await configPromise;
  FREE_SHIPPING_FROM = config.store?.freeShippingFrom ?? FREE_SHIPPING_FROM;
  SHIPPING_FLAT = config.store?.shippingFlat ?? SHIPPING_FLAT;
  render();
  await chromeReady;
}

function render() {
  const items = cart.all();
  const lines = $('[data-lines]');
  const summary = $('[data-summary]');
  const formPanel = $('[data-form-panel]');

  if (!items.length) {
    lines.innerHTML = `
      <div class="empty">
        <div class="ico">🛒</div>
        <b>Tu carrito esta vacio</b>
        <p>Explora el catalogo y agrega los productos que necesites para tu negocio.</p>
        <a class="btn" href="catalogo.html">Ir al catalogo</a>
      </div>`;
    summary.innerHTML = '';
    formPanel.hidden = true;
    return;
  }

  lines.innerHTML = items
    .map(
      (item) => `
      <div class="cart-line">
        <a href="producto.html?slug=${encodeURIComponent(item.slug)}" class="cart-line-img">
          <img src="${escapeHtml(getThumbSrc(item.image) || PLACEHOLDER)}" alt="${escapeHtml(item.name)}" data-fallback />
        </a>
        <div class="cart-line-info">
          <a class="cart-line-name" href="producto.html?slug=${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a>
          ${item.variant ? `<span class="muted" style="font-size:.85rem">${escapeHtml(item.variant)}</span>` : ''}
          <div class="qty" style="margin-top:.5rem">
            <button data-line="${escapeHtml(item.sku)}" data-step="-1" aria-label="Quitar uno">−</button>
            <span>${item.qty}</span>
            <button data-line="${escapeHtml(item.sku)}" data-step="1" aria-label="Agregar uno">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <div class="price">${money(item.price * item.qty)}</div>
          ${item.qty > 1 ? `<div class="price-old">${money(item.price)} c/u</div>` : ''}
          <button class="link" data-line="${escapeHtml(item.sku)}" data-remove>Quitar</button>
        </div>
      </div>`,
    )
    .join('');

  const subtotal = cart.subtotal();
  const freeShipping = subtotal >= FREE_SHIPPING_FROM;
  const shipping = freeShipping ? 0 : SHIPPING_FLAT;
  const missing = Math.max(0, FREE_SHIPPING_FROM - subtotal);

  summary.innerHTML = `
    <h3 style="margin-top:0">Resumen</h3>
    <div class="summary-row"><span>Subtotal (${cart.count()} productos)</span><b>${money(subtotal)}</b></div>
    <div class="summary-row"><span>Envio</span><b>${shipping === 0 ? '<span style="color:var(--success)">Gratis</span>' : money(shipping)}</b></div>
    ${
      missing > 0
        ? `<p class="muted" style="font-size:.85rem">Te faltan <b>${money(missing)}</b> para envio gratis.</p>
           <div class="progress"><div class="progress-bar" style="width:${Math.min(100, (subtotal / FREE_SHIPPING_FROM) * 100)}%"></div></div>`
        : '<p style="font-size:.85rem;color:var(--success)">🎉 Tienes envio gratis en este pedido.</p>'
    }
    <div class="summary-total"><span>Total</span><b>${money(subtotal + shipping)}</b></div>
    <p class="muted" style="font-size:.8rem">Impuestos incluidos. El total final se confirma en el checkout de Mercado Pago.</p>`;

  formPanel.hidden = false;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-line]');
  if (!button) return;
  const { line, step, remove } = button.dataset;

  if (remove) {
    cart.remove(line);
    toast('Producto eliminado del carrito');
    return;
  }
  const item = cart.all().find((i) => i.sku === line);
  if (item) cart.setQty(line, item.qty + Number(step));
});

async function submit(event, form, config) {
  event.preventDefault();
  const errorNode = $('[data-checkout-error]');
  const payButton = $('[data-pay]');
  errorNode.hidden = true;

  const readField = (name) => String(form.elements.namedItem(name)?.value || '').trim();
  const customer = {
    name: readField('name'),
    phone: readField('phone'),
    email: readField('email'),
    city: readField('city'),
    address: readField('address'),
    notes: readField('notes'),
  };

  if (!customer.name || !customer.phone || !customer.email || !customer.city || !customer.address) {
    errorNode.textContent = 'Completa los campos obligatorios.';
    errorNode.hidden = false;
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) {
    errorNode.textContent = 'El correo electronico no es valido.';
    errorNode.hidden = false;
    return;
  }

  payButton.disabled = true;
  payButton.textContent = 'Generando pago...';

  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.all().map((i) => ({ id: i.id, sku: i.sku, qty: i.qty })),
        customer,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo generar el pago');

    if (data.checkoutUrl) {
      location.href = data.checkoutUrl;
      return;
    }

    cart.clear();
    sessionStorage.setItem('alx.lastOrder', data.orderId || '');
    location.href = `gracias.html?demo=1&order=${encodeURIComponent(data.orderId || '')}`;
  } catch (err) {
    errorNode.textContent = err.message;
    errorNode.hidden = false;
    payButton.disabled = false;
    payButton.textContent = 'Pagar con Mercado Pago';
    if (!config?.paymentReady) toast('Modo demo: no se cobro nada real', '');
  }
}

main().catch((err) => {
  console.error(err);
  toast('No se pudo inicializar el carrito', 'err');
});
