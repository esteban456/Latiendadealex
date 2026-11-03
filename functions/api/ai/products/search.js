const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'public, max-age=30',
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

function normalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function mapImage(image, env) {
  const lower = String(image || '').toLowerCase();
  if (!image || lower.startsWith('http://') || lower.startsWith('https://') || image.startsWith('data:')) return image || '';
  const endpoint = String(env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/eayqxn9lnz').replace(/\/+$/, '');
  const folder = String(env.IMAGEKIT_FOLDER || '/Latiendadealex').replace(/^\/+|\/+$/g, '');
  return `${endpoint}/${folder}/${encodeURIComponent(image.split('/').pop())}`;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return reply({ error: 'Método no permitido.' }, 405);
  if (!env.DB) return reply({ error: 'El catálogo no está disponible.' }, 503);

  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  if (query.length < 2) return reply({ error: 'Escribe al menos dos caracteres para buscar.' }, 400);
  const category = normalize(url.searchParams.get('category') || '');
  const limit = Math.min(8, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '6', 10) || 6));
  try {
    const result = await env.DB.prepare('SELECT data FROM products').all();
    const terms = normalize(query).split(/\\s+/).filter(Boolean);
    const products = (result.results || []).map((row) => JSON.parse(row.data)).filter((product) => {
      const categories = (product.categories || []).map((item) => normalize(item.name));
      const haystack = normalize(`${product.name || ''} ${product.brand || ''} ${categories.join(' ')} ${product.description || ''}`);
      return (!category || categories.some((item) => item === category || item.startsWith(category)))
        && terms.every((term) => haystack.includes(term));
    }).sort((a, b) => Number(Boolean(b.available)) - Number(Boolean(a.available)) || (Number(b.sales) || 0) - (Number(a.sales) || 0));

    const total = products.length;
    const items = products.slice(0, limit).map((product) => {
      const images = [...new Set((Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(Boolean))]
        .slice(0, 8).map((image) => mapImage(image, env));
      return {
        name: product.name || '',
        brand: product.brand || '',
        description: product.description || '',
        category: (product.categories || []).map((item) => item.name).filter(Boolean).join(', '),
        price: Number(product.price) || 0,
        available: Boolean(product.available),
        image: images[0] || '',
        images,
        url: new URL(`/producto.html?slug=${encodeURIComponent(product.slug || '')}`, url.origin).href,
        paymentOptions: (product.variants || []).filter((variant) => variant.available !== false && Number(variant.price) > 0)
          .map((variant) => ({ label: String(variant.label || ''), price: Number(variant.price) })),
      };
    });
    return reply({ query, currency: 'COP', total, count: items.length, products: items });
  } catch (error) {
    return reply({ error: 'No se pudo consultar el catálogo.' }, 503);
  }
}
