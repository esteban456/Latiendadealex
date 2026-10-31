const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const urls = new Map([
    [`${origin}/`, new Date().toISOString().slice(0, 10)],
    [`${origin}/catalogo.html`, new Date().toISOString().slice(0, 10)],
  ]);

  try {
    const { results = [] } = await env.DB.prepare('SELECT data FROM products').all();
    for (const row of results) {
      let product;
      try { product = JSON.parse(row.data); } catch { continue; }
      if (!product.slug || !product.name) continue;
      const url = new URL('/producto.html', origin);
      url.searchParams.set('slug', product.slug);
      const updated = product.updatedAt || product.createdAt;
      const lastmod = updated && !Number.isNaN(Date.parse(updated))
        ? new Date(updated).toISOString().slice(0, 10)
        : undefined;
      urls.set(url.href, lastmod);
    }
  } catch {
    // Keep the homepage and catalog URLs in the sitemap if D1 is temporarily unavailable.
  }

  const entries = [...urls].map(([loc, lastmod]) => `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

