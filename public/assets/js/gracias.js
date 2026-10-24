import { $, escapeHtml, initChrome, money } from './core.js?v=20261016-catalogo';

const STATUS_COPY = {
  pagado: {
    icon: '✅',
    title: '¡Pago confirmado!',
    lead: 'Tu pago fue aprobado. Ya estamos preparando tu pedido.',
  },
  aprobado: {
    icon: '✅',
    title: '¡Pago confirmado!',
    lead: 'Tu pago fue aprobado. Ya estamos preparando tu pedido.',
  },
  pendiente: {
    icon: '⏳',
    title: 'Tu pago esta en revision',
    lead: 'Estamos verificando tu pago con Mercado Pago. Te avisamos en cuanto se confirme.',
  },
  rechazado: {
    icon: '⚠️',
    title: 'No pudimos procesar tu pago',
    lead: 'El pago fue rechazado. Puedes intentarlo de nuevo con otro metodo de pago.',
  },
  demo: {
    icon: '🧪',
    title: 'Pedido de prueba creado',
    lead: 'Esto fue una simulacion: no se realizo ningun cobro real. Con las llaves de Mercado Pago el pago sera real.',
  },
  fallido: {
    icon: '⚠️',
    title: 'El pago no se completo',
    lead: 'Hubo un problema con el pago. Escribenos y te ayudamos a resolverlo.',
  },
  pendiente_pago: {
    icon: '⏳',
    title: 'Tu pedido esta reservado',
    lead: 'Guardamos los productos 24 horas mientras completas el pago.',
  },
};

async function main() {
  $('[data-year]').textContent = new Date().getFullYear();
  await initChrome();

  const params = new URLSearchParams(location.search);
  const isDemo = params.get('demo') === '1';
  const paymentId = params.get('payment_id') || params.get('collection_id');
  let orderId = params.get('order') || sessionStorage.getItem('alx.lastOrder') || '';

  if (isDemo) {
    const note = $('[data-demo-note]');
    note.hidden = false;
    note.textContent = 'Modo demostracion: no se realizo ningun cobro real.';
    const copy = STATUS_COPY.demo;
    $('[data-title]').textContent = copy.title;
    $('[data-lead]').textContent = copy.lead;
  }

  if (!orderId) {
    $('[data-order]').hidden = true;
    return;
  }

  try {
    const response = await fetch(`/api/order?id=${encodeURIComponent(orderId)}`);
    if (!response.ok) return;
    const order = await response.json();
    sessionStorage.removeItem('alx.lastOrder');

    if (!isDemo) {
      const copy = STATUS_COPY[order.status] || STATUS_COPY.pendiente;
      $('[data-title]').textContent = copy.title;
      $('[data-lead]').textContent = copy.lead;
    }

    $('[data-order]').hidden = false;
    $('[data-order]').innerHTML = `
      <div class="summary-row"><span>Numero de pedido</span><b>${escapeHtml(order.id)}</b></div>
      <div class="summary-row"><span>Estado</span><b>${escapeHtml(order.status)}</b></div>
      <div class="summary-row"><span>Fecha</span><b>${new Date(order.createdAt).toLocaleString('es-CO')}</b></div>
      ${order.customer?.email ? `<div class="summary-row"><span>Correo</span><b>${escapeHtml(order.customer.email)}</b></div>` : ''}
      <div class="summary-row"><span>Envio</span><b>${order.shipping === 0 ? 'Gratis' : money(order.shipping)}</b></div>
      <div class="summary-total"><span>Total</span><b>${money(order.total)}</b></div>
      <h4 style="margin:1rem 0 .4rem">Productos</h4>
      ${(order.lines || [])
        .map(
          (line) => `
          <div class="summary-row" style="font-size:.9rem">
            <span>${escapeHtml(line.name)}${line.variant ? ` <span class="muted">(${escapeHtml(line.variant)})</span>` : ''} x${line.qty}</span>
            <b>${money(line.total)}</b>
          </div>`,
        )
        .join('')}`;

    if (paymentId) $('[data-lead]').textContent += ` Referencia de pago: ${paymentId}.`;
  } catch (err) {
    console.error(err);
  }
}

main();
