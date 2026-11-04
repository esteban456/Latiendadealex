const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Cache-Control': 'public, max-age=30',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers }); }
function normalize(value) { return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
  if (!env.DB) return json({ error: 'El catálogo no está disponible.' }, 503);
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  if (query.length < 2) return json({ error: 'Escribe al menos dos caracteres para buscar.' }, 400);
  const category = normalize(url.searchParams.get('category') || '');
  const limit = Math.min(8, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '6', 10) || 6));
  try {
    const result = await env.DB.prepare('SELECT data FROM products').all();
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const matches = (result.results || []).map((row) => JSON.parse(row.data)).filter((product) => {
      const categories = (product.categories || []).map((item) => normalize(item.name));
      const searchable = normalize(`${product.name || ''} ${product.brand || ''} ${categories.join(' ')} ${product.description || ''}`);
      return (!category || categories.some((item) => item === category || item.startsWith(category)))
        && terms.every((term) => searchable.includes(term));
    }).sort((a, b) => Number(Boolean(b.available)) - Number(Boolean(a.available)) || (Number(b.sales) || 0) - (Number(a.sales) || 0));
    const products = matches.slice(0, limit).map((product) => ({
      nombre: product.name || '', marca: product.brand || '', descripcion: product.description || '',
      categoria: (product.categories || []).map((item) => item.name).filter(Boolean).join(', '),
      stock: Boolean(product.available), precio: Number(product.price) || 0, moneda: 'COP',
      imagen: product.image || (product.images || [])[0] || '',
      url: new URL(`/producto.html?slug=${encodeURIComponent(product.slug || '')}`, url.origin).href,
    }));
    const first = products[0] || null;
    return json({
      query, encontrado: Boolean(first), nombre: first?.nombre || '', stock: first?.stock || false,
      precio: first?.precio ?? null, moneda: 'COP', url: first?.url || '',
      productos, total: matches.length,
    });
  } catch {
    return json({ error: 'No se pudo consultar el catálogo.' }, 503);
  }
}
