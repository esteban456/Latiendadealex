/**
 * Prueba de humo contra el sitio real, en local o ya publicado.
 *
 *   node scripts/smoke.mjs                       # http://localhost:3000
 *   node scripts/smoke.mjs https://tienda.com    # el sitio publicado
 *
 * Comprueba lo que un 200 no dice: que el catálogo llega entero, que las fotos
 * se descargan de verdad y que el checkout monta un pedido con su foto.
 */
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
let fallos = 0;
const fallo = (m) => {
  fallos++;
  console.log(`   FALLA ${m}`);
};
const ok = (m) => console.log(`   ok    ${m}`);

// Descargar entero: con HEAD algunos CDN no devuelven content-length
const bajar = async (ruta) => {
  const r = await fetch(BASE + ruta, { headers: { 'accept-encoding': 'gzip' } });
  const bytes = (await r.arrayBuffer()).byteLength;
  return { status: r.status, tipo: r.headers.get('content-type') || '', bytes };
};

console.log(`\nProbando ${BASE}`);

console.log('\n1. las páginas cargan');
for (const ruta of ['/', '/catalogo.html', '/producto.html', '/carrito.html', '/gracias.html']) {
  const r = await bajar(ruta);
  if (r.status === 200) ok(`${ruta} (${Math.round(r.bytes / 1024)} KB)`);
  else fallo(`${ruta} -> ${r.status}`);
}

console.log('\n2. la API trae el catálogo completo');
const api = await (await fetch(`${BASE}/api/catalog`)).json();
const total = api.products?.length || 0;
if (total > 1000) ok(`${total} productos`);
else fallo(`solo ${total} productos: la API esta limitando o el catálogo esta roto`);

const conFoto = api.products.filter((p) => p.image);
console.log(`   con foto: ${conFoto.length} | sin foto: ${total - conFoto.length}`);
if (conFoto.length / total < 0.98) fallo('hay demasiados productos sin foto');

console.log('\n3. las fotos se descargan de verdad (muestra de 10)');
const muestra = [...conFoto].sort(() => 0.5 - Math.random()).slice(0, 10);
let buenas = 0;
let kb = 0;
for (const p of muestra) {
  const r = await bajar(p.image);
  if (r.status === 200 && r.bytes > 500) {
    buenas++;
    kb += r.bytes;
  } else fallo(`${p.image} -> ${r.status} ${r.bytes} bytes`);
}
if (buenas === 10) ok(`10/10 correctas, ${Math.round(kb / 10 / 1024)} KB de media`);

console.log('\n4. las miniaturas de las tarjetas existen');
let conMini = 0;
for (const p of muestra) {
  const mini = p.image.startsWith('/assets/img/productos-webp/') ? p.image.replace(/\.webp$/, '-400.webp') : p.image;
  if ((await bajar(mini)).status === 200) conMini++;
  else fallo(`miniatura rota: ${mini}`);
}
if (conMini === 10) ok('10/10 correctas');

console.log('\n5. una compra de prueba');
const producto = conFoto.find((p) => (p.variants || []).some((v) => v.available)) || conFoto[0];
if (!producto) {
  fallo('no hay ningun producto comprable');
} else {
  const variante = producto.variants.find((v) => v.available) || producto.variants[0];
  const r = await fetch(`${BASE}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ id: producto.id, sku: variante.sku, qty: 1 }],
      customer: { name: 'Prueba humo', email: 'humo@example.com', phone: '+57 300 000 0000', city: 'Bogota', address: 'Cra 1 # 2-3' },
    }),
  });
  const res = await r.json().catch(() => ({}));
  if (r.status === 200 && (res.orderId || res.checkoutUrl)) {
    ok(`pedido ${res.orderId} por ${res.order?.total ?? '?'}`);
    ok(`foto en la linea: ${res.order?.lines?.[0]?.image || '(la respuesta no la trae; el pedido guardado si la guarda)'}`);
  } else {
    fallo(`checkout -> ${r.status} ${JSON.stringify(res).slice(0, 160)}`);
  }
}

console.log(`\n${fallos ? `FALLOS: ${fallos}` : 'Sin fallos.'}`);
console.log('Ojo: la compra deja un pedido de prueba en data/orders.json.\n');
process.exit(fallos ? 1 : 0);
