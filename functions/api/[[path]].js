const DEFAULT_CLIENT_ID = '484973380597-2ava9io0f4mf34fplkfin6j29uplh6uf.apps.googleusercontent.com';
const encoder = new TextEncoder();
let googleKeysCache;
let googleKeysExpiry = 0;
const oidcKeysCache = new Map();
const loginAttempts = new Map();
let adminSchemaReady = false;
let cachedSessionSecret;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  try {
    if (route === 'GET /api/config') {
      return json({ store: storeConfig(env), currency: 'COP', paymentReady: Boolean(env.MP_ACCESS_TOKEN), mode: env.MP_ACCESS_TOKEN ? 'real' : 'demo' });
    }
    if (route === 'GET /api/catalog') return catalogResponse(env.DB, url, env);

    if (route === 'GET /api/auth/google/config') return json({ clientId: env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID });
    if (route === 'GET /api/auth/providers') return json({ google: env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID, apple: env.APPLE_CLIENT_ID || '', microsoft: env.MICROSOFT_CLIENT_ID || '' });
    if (route === 'GET /api/auth/google/csrf') {
      const csrf = crypto.randomUUID();
      return json({ csrf }, 200, { 'Set-Cookie': cookie('google_csrf', csrf, request, 600) });
    }
    if (route === 'POST /api/auth/google') return googleLogin(request, env);
    if (route === 'POST /api/auth/register') return accountAuth(request, env, 'register');
    if (route === 'POST /api/auth/login') return accountAuth(request, env, 'login');
    if (route === 'POST /api/auth/oidc') return providerLogin(request, env);
    if (route === 'GET /api/auth/me') return json({ user: await verifyUserSession(request, env) });
    if (route === 'POST /api/auth/logout') return json({ ok: true }, 200, { 'Set-Cookie': [cookie('account_session', '', request, 0, true), cookie('google_session', '', request, 0, true)] });

    if (route === 'GET /api/admin/session') {
      const authenticated = await verifyAdminSession(request, env);
      return json({ authenticated, csrf: authenticated ? getCookie(request, 'admin_csrf') : '', setupRequired: authenticated ? false : await adminSetupRequired(env) });
    }
    if (route === 'POST /api/admin/login') return adminLogin(request, env);
    if (route === 'POST /api/admin/setup') return adminSetup(request, env);
    if (route === 'POST /api/admin/logout') {
      return json({ ok: true }, 200, { 'Set-Cookie': [cookie('admin_session', '', request, 0, true), cookie('admin_csrf', '', request, 0)] });
    }
    if (url.pathname.startsWith('/api/admin/')) return await adminApi(request, url, env);

    if (route === 'POST /api/checkout') return checkout(request, env);
    if (route === 'POST /api/webhook') return webhook(request, url, env);
    if (route === 'POST /api/lead') return saveLead(request, env);
    if (route === 'GET /api/order') return getOrder(url, env);
    return json({ error: 'Ruta no encontrada' }, 404);
  } catch (error) {
    console.error('Pages API:', error);
    return json({ error: 'Error interno. Intenta de nuevo.' }, 500);
  }
}

async function catalogResponse(db, url, env) {
  if (!db) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const [meta, rows] = await Promise.all([
    db.prepare("SELECT data FROM catalog_meta WHERE id = 'catalog'").first(),
    db.prepare('SELECT data FROM products').all(),
  ]);
  const catalog = meta?.data ? JSON.parse(meta.data) : { generatedAt: null, categories: [], counts: {} };
  const products = (rows.results || []).map((row) => JSON.parse(row.data));
  const q = normalize(url.searchParams.get('q') || '');
  const category = normalize(url.searchParams.get('category') || '');
  const brand = url.searchParams.get('brand') || '';
  const min = Number(url.searchParams.get('minPrice')) || 0;
  const max = Number(url.searchParams.get('maxPrice')) || Infinity;
  const stock = url.searchParams.get('stock') === '1';
  const shipping = url.searchParams.get('shipping') === '1';
  const offers = url.searchParams.get('offers') === '1';
  const sort = url.searchParams.get('sort') || 'relevancia';
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const requestedLimit = url.searchParams.get('limit');
  const limit = requestedLimit ? Math.min(200, Math.max(1, Number(requestedLimit) || 48)) : Infinity;
  const shippingFrom = Number(env.FREE_SHIPPING_FROM ?? 300000);
  let filtered = products.filter((product) => {
    const cats = (product.categories || []).map((item) => normalize(item.name));
    const haystack = normalize(`${product.name} ${product.brand || ''} ${cats.join(' ')} ${product.description || ''}`);
    return (!category || cats.some((cat) => cat === category || cat.startsWith(category))
      && (!brand || product.brand === brand)
      && Number(product.price) >= min && Number(product.price) <= max
      && (!stock || Boolean(product.available))
      && (!shipping || Number(product.price) >= shippingFrom)
      && (!offers || Number(product.compareAt) > Number(product.price))
      && (!q || q.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term))));
  });
  if (sort === 'precio-asc') filtered.sort((a, b) => a.price - b.price);
  else if (sort === 'precio-desc') filtered.sort((a, b) => b.price - a.price);
  else if (sort === 'nombre') filtered.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  else if (sort === 'ventas') filtered.sort((a, b) => (b.sales || 0) - (a.sales || 0));
  else if (sort === 'novedad') filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  else filtered.sort((a, b) => Number(b.available) - Number(a.available) || (b.sales || 0) - (a.sales || 0));
  const total = filtered.length;
  return json({ ...catalog, products: filtered.slice(offset, offset + limit).map((product) => withImageKit(product, env)), pagination: { total, offset, limit, hasMore: offset + limit < total } });
}

async function ensureAdminSchema(env) {
  if (adminSchemaReady || !env.DB) return;
  try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0').run(); } catch { /* ya existe */ }
  adminSchemaReady = true;
}
async function countAdmins(env) {
  if (!env.DB) return 0;
  await ensureAdminSchema(env);
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE is_admin = 1').first();
  return Number(row?.total || 0);
}
async function adminSetupRequired(env) {
  if (env.ADMIN_PASSWORD) return false;
  try { return (await countAdmins(env)) === 0; } catch { return false; }
}
async function adminSessionResponse(request, env) {
  const csrf = crypto.randomUUID();
  return json({ ok: true, csrf }, 200, { 'Set-Cookie': [
    cookie('admin_session', await signedToken({ admin: true, exp: Date.now() + 12 * 60 * 60 * 1000 }, env), request, 43200, true),
    cookie('admin_csrf', csrf, request, 43200),
  ] });
}
async function adminLogin(request, env) {
  if (isLoginThrottled(request)) return json({ error: 'Demasiados intentos. Espera un momento.' }, 429);
  const body = await readJson(request);
  const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (identifier) {
    if (!env.DB) return json({ error: 'Falta configurar la base de datos para las cuentas.' }, 503);
    await ensureAdminSchema(env);
    const account = await env.DB.prepare('SELECT password_salt, password_hash, is_admin FROM users WHERE email = ? OR username = ?').bind(identifier, identifier).first();
    if (!account?.password_hash || !Number(account.is_admin) || !(await verifyPassword(password, account.password_salt, account.password_hash))) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  } else if (env.ADMIN_PASSWORD) {
    if (!constantTimeEqual(password, env.ADMIN_PASSWORD)) return json({ error: 'Contraseña incorrecta.' }, 401);
  } else {
    return json({ error: 'Escribe tu usuario o correo para entrar.' }, 400);
  }
  return adminSessionResponse(request, env);
}
async function adminSetup(request, env) {
  if (isLoginThrottled(request)) return json({ error: 'Demasiados intentos. Espera un momento.' }, 429);
  if (!env.DB) return json({ error: 'Falta configurar la base de datos para las cuentas.' }, 503);
  if (!(await adminSetupRequired(env))) return json({ error: 'Ya existe una cuenta de administrador. Inicia sesión.' }, 409);
  const body = await readJson(request, 20_000);
  const name = clean(body.name, 100);
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!name) return json({ error: 'Escribe tu nombre para crear la cuenta.' }, 400);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'El usuario debe tener entre 3 y 30 caracteres.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return json({ error: 'Escribe un correo electrónico válido.' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'La contraseña debe tener entre 10 y 128 caracteres.' }, 400);
  await ensureAdminSchema(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, salt);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? OR username = ?').bind(email, username).first();
  if (existing) {
    await env.DB.prepare('UPDATE users SET name = ?, password_salt = ?, password_hash = ?, is_admin = 1 WHERE id = ?').bind(name, toBase64Url(salt), passwordHash, existing.id).run();
  } else {
    await env.DB.prepare('INSERT INTO users (id,email,username,name,password_salt,password_hash,created_at,is_admin) VALUES (?,?,?,?,?,?,?,1)')
      .bind(crypto.randomUUID(), email, username, name, toBase64Url(salt), passwordHash, new Date().toISOString()).run();
  }
  return adminSessionResponse(request, env);
}

async function adminApi(request, url, env) {
  if (!(await verifyAdminSession(request, env))) return json({ error: 'Inicia sesión como administrador.' }, 401);
  let body = {};
  if (request.method !== 'GET') {
    body = await readJson(request, url.pathname.endsWith('/upload') ? 5_500_000 : 1_000_000);
    if (!body.csrf || body.csrf !== getCookie(request, 'admin_csrf')) return json({ error: 'La sesión expiró. Vuelve a iniciar sesión.' }, 403);
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/products') {
    try {
      return await adminList(env.DB, url, env);
    } catch (error) {
      console.error('adminList error:', error);
      const detail = String(error?.message || error || 'Error desconocido').slice(0, 300);
      return json({ error: 'No se pudo consultar el catálogo en D1.', detail }, 500);
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/orders') return adminListOrders(env.DB, url);
  if (request.method === 'POST' && url.pathname === '/api/admin/orders/status') return adminUpdateOrderStatus(env.DB, body);
  if (request.method === 'POST' && url.pathname === '/api/admin/products') return adminSave(env.DB, body);
  if (request.method === 'DELETE' && url.pathname === '/api/admin/products') return adminDelete(env.DB, body.id);
  if (request.method === 'POST' && url.pathname === '/api/admin/upload') return uploadImage(env, body);
  return json({ error: 'Ruta de administración no encontrada.' }, 404);
}

async function adminList(db, url) {
  if (!db) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  let products = (await db.prepare('SELECT data FROM products').all()).results.map((row) => JSON.parse(row.data));
  const id = url.searchParams.get('id');
  const q = normalize(url.searchParams.get('q') || '');
  const category = url.searchParams.get('category') || '';
  const stock = url.searchParams.get('stock') || '';
  const summary = {
    total: products.length,
    available: products.filter((product) => Number(product.stock || 0) > 0).length,
    lowStock: products.filter((product) => Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 3).length,
    outOfStock: products.filter((product) => Number(product.stock || 0) <= 0).length,
    noImage: products.filter((product) => !product.image).length,
  };
  products = products.filter((product) => {
    if (id && product.id !== id) return false;
    if (q && !normalize(`${product.name} ${product.brand || ''} ${product.id} ${(product.categories || []).map((cat) => cat.name).join(' ')}`).includes(q)) return false;
    if (category && !(product.categories || []).some((cat) => cat.name === category)) return false;
    const units = Number(product.stock || 0);
    if (stock === 'available' && units <= 0) return false;
    if (stock === 'low' && (units <= 0 || units > 3)) return false;
    if (stock === 'out' && units > 0) return false;
    if (stock === 'no-image' && product.image) return false;
    return true;
  });
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const meta = await db.prepare("SELECT data FROM catalog_meta WHERE id = 'catalog'").first();
  const catalog = meta?.data ? JSON.parse(meta.data) : { categories: [] };
  return json({ products: products.slice(offset, offset + limit).map((product) => withImageKit(product, env)), total: products.length, offset, limit, categories: catalog.categories || [], summary });
}

async function adminListOrders(db, url) {
  if (!db) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const q = String(url.searchParams.get('q') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  const pattern = `%${q}%`;
  const where = "(? = '' OR status = ?) AND (? = '' OR data LIKE ?)";
  const bindings = [status, status, q, pattern];
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
  const [rows, countRow, statusRows] = await Promise.all([
    db.prepare(`SELECT data FROM orders WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all(),
    db.prepare(`SELECT COUNT(*) AS total FROM orders WHERE ${where}`).bind(...bindings).first(),
    db.prepare('SELECT status, COUNT(*) AS total FROM orders GROUP BY status').all(),
  ]);
  const counts = Object.fromEntries((statusRows.results || []).map((row) => [row.status, Number(row.total)]));
  return json({
    orders: (rows.results || []).map((row) => JSON.parse(row.data)),
    total: Number(countRow?.total || 0), offset, limit,
    summary: { total: Object.values(counts).reduce((sum, value) => sum + value, 0), paid: counts.pagado || 0, pending: counts.pendiente || 0 },
  });
}

async function adminUpdateOrderStatus(db, body) {
  if (!db) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const allowed = new Set(['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado']);
  const id = String(body.id || '');
  const fulfillmentStatus = String(body.fulfillmentStatus || '');
  if (!id || !allowed.has(fulfillmentStatus)) return json({ error: 'Selecciona un estado de entrega válido.' }, 400);
  const row = await db.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'No se encontró el pedido.' }, 404);
  const order = { ...JSON.parse(row.data), fulfillmentStatus, fulfillmentUpdatedAt: new Date().toISOString() };
  await db.prepare('UPDATE orders SET data = ? WHERE id = ?').bind(JSON.stringify(order), id).run();
  return json({ ok: true, order });
}

function priceForCost(cost) {
  const value = Math.max(0, Number(cost) || 0);
  let contado;
  let credito;
  if (value < 200000) { contado = value * 2; credito = value * 2; }
  else if (value < 500000) { contado = value * 1.35; credito = value * 1.4; }
  else if (value < 1500000) { contado = value * 1.3; credito = value * 1.4; }
  else { contado = value * 1.2; credito = value * 1.3; }
  const round = (amount) => Math.round(amount / 100) * 100;
  return { contado: round(contado), credito: round(credito) };
}

async function adminSave(db, body) {
  if (!db) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const name = clean(body.name, 180);
  const category = clean(body.category, 100);
  const cost = Number(body.cost);
  const hasCost = Number.isFinite(cost) && cost > 0;
  const priced = hasCost ? priceForCost(cost) : null;
  const price = priced ? priced.contado : Number(body.price);
  const offerCredit = body.offerCredit !== false;
  const creditPrice = priced ? priced.credito : (offerCredit ? Number(body.creditPrice || price) : price);
  const stock = Math.max(0, Math.floor(Number(body.stock) || 0));
  if (offerCredit && (!Number.isFinite(creditPrice) || creditPrice <= 0)) return json({ error: 'El precio a credito debe ser valido.' }, 400);
  if (!name || !category || !Number.isFinite(price) || price <= 0) return json({ error: 'Nombre, categoría y precio válido son obligatorios.' }, 400);
  const old = body.id ? await db.prepare('SELECT data FROM products WHERE id = ?').bind(body.id).first() : null;
  if (body.id && !old) return json({ error: 'No se encontró el producto.' }, 404);
  const previous = old ? JSON.parse(old.data) : {};
  const slug = clean(body.slug, 180) || normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160);
  const image = clean(body.image, 600);
  const cashVariant = previous.variants?.find((variant) => /contado/i.test(variant.label)) || previous.variants?.[0];
  const creditVariant = previous.variants?.find((variant) => /credito/i.test(variant.sku) || /cr.dito/i.test(variant.label));
  const cashSku = cashVariant?.sku || `admin-${crypto.randomUUID().slice(0, 12)}-contado`;
  const paymentVariants = [
    { sku: cashSku, label: 'CONTADO', price, available: stock > 0 },
    ...(offerCredit ? [{ sku: creditVariant?.sku || `${cashSku}-credito`, label: 'CR\u00c9DITO', price: creditPrice, available: stock > 0 }] : []),
  ];
  const categoryIcon = previous.categories?.find((item) => item.name === category)?.icon || '📦';
  const variants = previous.variants?.length
    ? previous.variants.map((variant, index) => ({ ...variant, ...(index === 0 ? { price } : {}), available: stock > 0 }))
    : [{ sku: `admin-${crypto.randomUUID().slice(0, 12)}`, label: 'Precio único', price, available: stock > 0 }];
  const product = {
    ...previous, id: previous.id || `admin-${crypto.randomUUID()}`, slug, name,
    brand: clean(body.brand, 100), description: clean(body.description, 5000), price,
    cost: hasCost ? cost : (Number(previous.cost) || undefined),
    maxPrice: offerCredit ? creditPrice : price, compareAt: priced ? price : (Number(previous.compareAt) || price),
    image, images: image ? [image] : [], categories: [{ name: category, icon: categoryIcon }], variants,
    available: stock > 0, stock, specs: previous.specs || {}, tags: previous.tags || [], source: previous.source || 'panel-admin',
  };
  product.variants = paymentVariants;
  await db.prepare('INSERT INTO products (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').bind(product.id, JSON.stringify(product)).run();
  await refreshCatalogMeta(db);
  return json({ ok: true, product });
}

async function adminDelete(db, id) {
  if (!db) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  if (!id) return json({ error: 'Falta el ID del producto.' }, 400);
  const result = await db.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return json({ error: 'No se encontró el producto.' }, 404);
  await refreshCatalogMeta(db);
  return json({ ok: true });
}

async function refreshCatalogMeta(db) {
  const [metaRow, productRows] = await Promise.all([
    db.prepare("SELECT data FROM catalog_meta WHERE id = 'catalog'").first(), db.prepare('SELECT data FROM products').all(),
  ]);
  const catalog = metaRow?.data ? JSON.parse(metaRow.data) : {};
  const products = productRows.results.map((row) => JSON.parse(row.data));
  const categories = new Map();
  for (const product of products) for (const cat of product.categories || []) {
    if (!cat.name) continue;
    const entry = categories.get(cat.name) || { name: cat.name, icon: cat.icon || '📦', products: 0 };
    entry.products++;
    categories.set(cat.name, entry);
  }
  catalog.generatedAt = new Date().toISOString();
  catalog.categories = [...categories.values()];
  catalog.counts = { ...(catalog.counts || {}), products: products.length, withDescription: products.filter((p) => p.description).length, withImage: products.filter((p) => p.image).length, available: products.filter((p) => p.available).length };
  await db.prepare("INSERT INTO catalog_meta (id, data) VALUES ('catalog', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(JSON.stringify(catalog)).run();
}

async function uploadImage(env, body) {
  if (!env.IMAGEKIT_PRIVATE_KEY) return json({ error: 'Configura IMAGEKIT_PRIVATE_KEY en los secretos de Cloudflare.' }, 503);
  const match = String(body.dataUrl || '').match(/^data:image\/webp;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return json({ error: 'Formato de imagen no compatible. Sube una imagen JPG, PNG o WebP.' }, 400);
  const binary = atob(match[1]);
  if (!binary.length || binary.length > 4 * 1024 * 1024) return json({ error: 'La imagen debe pesar menos de 4 MB.' }, 413);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const fileName = `producto-${crypto.randomUUID()}.webp`;
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'image/webp' }), fileName);
  form.set('fileName', fileName);
  form.set('folder', env.IMAGEKIT_FOLDER || '/Latiendadealex');
  form.set('useUniqueFileName', 'true');
  const authorization = btoa(`${env.IMAGEKIT_PRIVATE_KEY}:`);
  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST', headers: { Authorization: `Basic ${authorization}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) {
    console.error('ImageKit upload:', response.status, result.message || result);
    return json({ error: result.message || 'ImageKit no pudo guardar la imagen.' }, 502);
  }
  return json({ image: result.url });
}

function withImageKit(product, env) {
  const endpoint = String(env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/eayqxn9lnz').replace(/\/+$/, '');
  if (!endpoint) return product;
  const folder = `/${String(env.IMAGEKIT_FOLDER || '/Latiendadealex').replace(/^\/+|\/+$/g, '')}`;
  const mapImage = (image) => {
    if (!image || /^https?:\/\//i.test(image) || image.startsWith('data:')) return image;
    const filename = image.split('/').pop();
    return `${endpoint}${folder}/${encodeURIComponent(filename)}`;
  };
  return { ...product, image: mapImage(product.image), images: Array.isArray(product.images) ? product.images.map(mapImage) : product.images };
}

async function checkout(request, env) {
  if (!env.DB) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const raw = await readJson(request);
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (!items.length) return json({ error: 'El carrito está vacío.' }, 400);
  const rows = await env.DB.prepare('SELECT data FROM products').all();
  const byId = new Map(rows.results.map((row) => { const product = JSON.parse(row.data); return [product.id, product]; }));
  const lines = [];
  for (const item of items.slice(0, 50)) {
    const product = byId.get(String(item.id || ''));
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
    if (!product) return json({ error: `Producto no disponible: ${item.id}` }, 400);
    const variant = (product.variants || []).find((candidate) => candidate.sku === item.sku) || (product.variants || [])[0];
    if (!variant || !variant.available) return json({ error: `${product.name} no está disponible.` }, 400);
    lines.push({ product, variant, qty, unitPrice: variant.price || product.price });
  }
  const customer = { name: clean(raw.customer?.name, 120) || 'Cliente', email: clean(raw.customer?.email, 160), phone: clean(raw.customer?.phone, 40), city: clean(raw.customer?.city, 120), address: clean(raw.customer?.address, 200), notes: clean(raw.customer?.notes, 400) };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) return json({ error: 'Correo electrónico inválido.' }, 400);
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const freeShipping = Number(env.FREE_SHIPPING_FROM ?? 300000);
  const shipping = freeShipping > 0 && subtotal >= freeShipping ? 0 : Number(env.SHIPPING_FLAT ?? 25000);
  const order = {
    id: `ALX-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    createdAt: new Date().toISOString(), status: 'pendiente', customer,
    lines: lines.map(({ product, variant, qty, unitPrice }) => ({ id: product.id, name: product.name, variant: variant.label, sku: variant.sku, qty, unitPrice, total: unitPrice * qty, image: product.image })),
    subtotal, shipping, total: subtotal + shipping, currency: 'COP', payment: null,
  };
  if (!env.MP_ACCESS_TOKEN) {
    order.status = 'demo';
    await env.DB.prepare('INSERT INTO orders (id, status, data) VALUES (?, ?, ?)').bind(order.id, order.status, JSON.stringify(order)).run();
    return json({ demo: true, orderId: order.id, order: publicOrder(order) });
  }
  const base = env.PUBLIC_URL || new URL(request.url).origin;
  let phone = customer.phone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  if (phone.startsWith('57') && phone.length > 10) phone = phone.slice(2);
  const parsedPhone = phone.length === 10 ? { area_code: phone.slice(0, 3), number: phone.slice(3) } : undefined;
  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST', headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': order.id },
    body: JSON.stringify({
      items: order.lines.map((line) => ({ title: line.name.slice(0, 60), description: String(line.variant || '').slice(0, 60), quantity: line.qty, unit_price: line.unitPrice, currency_id: 'COP' })),
      payer: { name: customer.name, email: customer.email, phone: parsedPhone, address: customer.address ? { street_name: customer.address, city: customer.city || undefined } : undefined },
      shipments: { cost: order.shipping, mode: 'not_specified' }, payment_methods: { installments: Number(env.MP_INSTALLMENTS || 12) },
      external_reference: order.id, notification_url: `${base}/api/webhook`,
      back_urls: { success: `${base}/gracias.html`, pending: `${base}/gracias.html`, failure: `${base}/carrito.html` },
      auto_return: 'approved', metadata: { orderId: order.id },
      statement_descriptor: String(env.STORE_NAME || 'TIENDA DE ALEX').replace(/[^\w\s]/g, '').trim().toUpperCase().slice(0, 22),
    }),
  });
  if (!response.ok) return json({ error: 'Mercado Pago no respondió. Intenta de nuevo.' }, 502);
  const preference = await response.json();
  order.payment = { provider: 'mercadopago', preferenceId: preference.id, initPoint: preference.init_point, sandbox: preference.sandbox_init_point };
  await env.DB.prepare('INSERT INTO orders (id, status, data) VALUES (?, ?, ?)').bind(order.id, order.status, JSON.stringify(order)).run();
  const sandbox = env.MP_SANDBOX !== 'false';
  return json({ orderId: order.id, checkoutUrl: sandbox ? preference.sandbox_init_point || preference.init_point : preference.init_point, total: order.total });
}

async function webhook(request, url, env) {
  if (!env.DB) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const raw = await request.text();
  if (env.MP_WEBHOOK_SECRET && !(await verifyPaymentSignature(request, url, env.MP_WEBHOOK_SECRET))) return json({ error: 'Firma inválida.' }, 401);
  let event;
  try { event = JSON.parse(raw || '{}'); } catch { return json({ error: 'Evento inválido.' }, 400); }
  const paymentId = event?.data?.id || url.searchParams.get('data_id') || url.searchParams.get('id');
  if (!paymentId || !env.MP_ACCESS_TOKEN) return json({ received: true });
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!response.ok) return json({ received: true });
  const payment = await response.json();
  const id = payment.external_reference || payment.metadata?.orderId;
  if (!id) return json({ received: true });
  const row = await env.DB.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first();
  if (!row) return json({ received: true });
  const order = JSON.parse(row.data);
  const approved = payment.status === 'approved';
  order.payment = { provider: 'mercadopago', paymentId: payment.id, status: payment.status, statusDetail: payment.status_detail, paidAt: approved ? new Date().toISOString() : null };
  if (approved) order.status = 'pagado';
  else if (['rejected', 'cancelled'].includes(payment.status)) order.status = 'fallido';
  await env.DB.prepare('UPDATE orders SET status = ?, data = ? WHERE id = ?').bind(order.status, JSON.stringify(order), id).run();
  return json({ received: true });
}

async function saveLead(request, env) {
  if (!env.DB) return json({ error: 'Falta vincular la base de datos D1 (DB).' }, 503);
  const body = await readJson(request);
  const lead = { id: crypto.randomUUID(), at: new Date().toISOString(), name: clean(body.name, 120), email: clean(body.email, 160), phone: clean(body.phone, 40), message: clean(body.message, 600), source: clean(body.source, 60) || 'web' };
  if (!lead.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) return json({ error: 'Correo electrónico inválido.' }, 400);
  await env.DB.prepare('INSERT INTO leads (id, data) VALUES (?, ?)').bind(lead.id, JSON.stringify(lead)).run();
  return json({ ok: true, id: lead.id });
}

async function getOrder(url, env) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Falta el ID del pedido.' }, 400);
  const row = await env.DB.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Pedido no encontrado.' }, 404);
  return json(publicOrder(JSON.parse(row.data)));
}

async function googleLogin(request, env) {
  const body = await readJson(request);
  if (!body.csrf || body.csrf !== getCookie(request, 'google_csrf')) return json({ error: 'La sesión expiró. Recarga e inténtalo de nuevo.' }, 403);
  try {
    const user = await verifyGoogleCredential(body.credential, env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID);
    return json({ ok: true, user }, 200, { 'Set-Cookie': [
      cookie('google_session', await signedToken({ ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }, env), request, 604800, true),
      cookie('google_csrf', '', request, 0),
    ] });
  } catch (error) { return json({ error: error.message || 'No se pudo validar la cuenta de Google.' }, 401); }
}

async function verifyGoogleCredential(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Credencial de Google inválida.');
  const header = JSON.parse(decodeBase64Url(parts[0]));
  const claims = JSON.parse(decodeBase64Url(parts[1]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Firma de Google no válida.');
  if (!googleKeysCache || Date.now() > googleKeysExpiry) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!response.ok) throw new Error('No se pudieron verificar los servidores de Google.');
    googleKeysCache = await response.json();
    googleKeysExpiry = Date.now() + (Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]) || 3600) * 1000;
  }
  const jwk = (googleKeysCache.keys || []).find((key) => key.kid === header.kid && key.alg === 'RS256');
  if (!jwk) { googleKeysExpiry = 0; throw new Error('La firma de Google expiró. Intenta de nuevo.'); }
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64UrlBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  const correctAudience = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!valid || !correctAudience || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
    || claims.exp <= now || claims.iat > now + 60 || !claims.sub || !claims.email || ![true, 'true'].includes(claims.email_verified)) {
    throw new Error('No se pudo verificar la cuenta de Google.');
  }
  return { sub: claims.sub, email: claims.email, name: claims.name || claims.email, picture: claims.picture || '' };
}

async function accountAuth(request, env, mode) {
  if (isLoginThrottled(request)) return json({ error: 'Demasiados intentos. Espera un momento.' }, 429);
  if (!env.DB) return json({ error: 'Falta configurar la base de datos para las cuentas.' }, 503);
  const body = await readJson(request, 20_000);
  if (!body.csrf || body.csrf !== getCookie(request, 'google_csrf')) return json({ error: 'La sesión expiró. Recarga e inténtalo de nuevo.' }, 403);
  const identifier = String(mode === 'register' ? body.email || '' : body.identifier || body.email || '').trim().toLowerCase();
  const email = mode === 'register' ? identifier : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ? identifier : `${identifier}@usuario.invalid`);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (mode === 'login' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) && !/^[a-z0-9._-]{3,30}$/.test(identifier)) return json({ error: 'Escribe un correo o usuario válido.' }, 400);
  if (mode === 'register' && !/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'El usuario debe tener entre 3 y 30 caracteres.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return json({ error: 'Escribe un correo electrónico válido.' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'La contraseña debe tener entre 10 y 128 caracteres.' }, 400);

  let account;
  if (mode === 'register') {
    const name = clean(body.name, 100);
    if (!name) return json({ error: 'Escribe tu nombre para crear la cuenta.' }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await hashPassword(password, salt);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO users (id,email,username,name,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, email, username, name, toBase64Url(salt), passwordHash, new Date().toISOString()).run();
    } catch {
      return json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' }, 409);
    }
    account = { id, email, name, picture: '' };
  } else {
    account = await env.DB.prepare('SELECT id,email,name,picture,password_salt,password_hash FROM users WHERE email = ? OR username = ?').bind(identifier, identifier).first();
    if (!account?.password_hash || !await verifyPassword(password, account.password_salt, account.password_hash)) {
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
  }
  const user = { sub: `account:${account.id}`, email: account.email, name: account.name, picture: account.picture || '' };
  return json({ ok: true, user }, 200, { 'Set-Cookie': cookie('account_session', await signedToken({ ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }, env), request, 604800, true) });
}

async function providerLogin(request, env) {
  if (isLoginThrottled(request)) return json({ error: 'Demasiados intentos. Espera un momento.' }, 429);
  const body = await readJson(request, 20_000);
  if (!body.csrf || body.csrf !== getCookie(request, 'google_csrf')) return json({ error: 'La sesión expiró. Recarga e inténtalo de nuevo.' }, 403);
  try {
    const provider = String(body.provider || '').toLowerCase();
    const identity = await verifyExternalCredential(provider, body.credential, env);
    if (!env.DB) return json({ error: 'Falta configurar la base de datos de cuentas.' }, 503);
    let account = await env.DB.prepare('SELECT users.id,users.email,users.name,users.picture FROM user_identities JOIN users ON users.id = user_identities.user_id WHERE user_identities.provider = ? AND user_identities.provider_sub = ?')
      .bind(provider, identity.sub).first();
    if (!account) {
      account = await env.DB.prepare('SELECT id,email,name,picture FROM users WHERE email = ?').bind(identity.email).first();
      if (account) return json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión con el método que usaste al crearla.' }, 409);
      account = { id: crypto.randomUUID(), email: identity.email, name: identity.name, picture: identity.picture || '' };
      await env.DB.prepare('INSERT INTO users (id,email,name,picture,password_salt,password_hash,created_at) VALUES (?,?,?,?,NULL,NULL,?)')
        .bind(account.id, account.email, account.name, account.picture, new Date().toISOString()).run();
      try {
        await env.DB.prepare('INSERT INTO user_identities (provider,provider_sub,user_id,created_at) VALUES (?,?,?,?)')
          .bind(provider, identity.sub, account.id, new Date().toISOString()).run();
      } catch {
        return json({ error: 'No se pudo vincular esta cuenta. Inicia sesión con el método original.' }, 409);
      }
    }
    const user = { sub: `account:${account.id}`, email: account.email, name: account.name || identity.name, picture: account.picture || identity.picture || '' };
    return json({ ok: true, user }, 200, { 'Set-Cookie': cookie('account_session', await signedToken({ ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }, env), request, 604800, true) });
  } catch (error) { return json({ error: error.message || 'No se pudo verificar la cuenta del proveedor.' }, 401); }
}

async function verifyExternalCredential(provider, token, env) {
  if (provider === 'google') return verifyGoogleCredential(token, env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID);
  const config = provider === 'apple'
    ? { clientId: env.APPLE_CLIENT_ID, issuer: 'https://appleid.apple.com', jwks: 'https://appleid.apple.com/auth/keys' }
    : provider === 'microsoft'
      ? { clientId: env.MICROSOFT_CLIENT_ID, issuer: '', jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys' }
      : null;
  if (!config) throw new Error('Proveedor de acceso no compatible.');
  if (!config.clientId) throw new Error(`Falta configurar ${provider === 'apple' ? 'APPLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID'} en Cloudflare.`);
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Credencial del proveedor inválida.');
  const header = JSON.parse(decodeBase64Url(parts[0]));
  const claims = JSON.parse(decodeBase64Url(parts[1]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Firma del proveedor no válida.');
  let keySet = oidcKeysCache.get(provider);
  if (!keySet || keySet.expires < Date.now()) {
    const response = await fetch(config.jwks);
    if (!response.ok) throw new Error('No se pudieron verificar los servidores del proveedor.');
    keySet = { keys: await response.json(), expires: Date.now() + 3_600_000 };
    oidcKeysCache.set(provider, keySet);
  }
  const jwk = (keySet.keys.keys || []).find((key) => key.kid === header.kid && key.alg === 'RS256');
  if (!jwk) { oidcKeysCache.delete(provider); throw new Error('La firma del proveedor expiró. Intenta de nuevo.'); }
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64UrlBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  const audienceValid = Array.isArray(claims.aud) ? claims.aud.includes(config.clientId) : claims.aud === config.clientId;
  const issuerTenant = String(claims.iss || '').split('/')[3] || '';
  const issuerValid = provider === 'apple'
    ? claims.iss === config.issuer
    : /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i.test(claims.iss || '') && Boolean(claims.tid) && issuerTenant.toLowerCase() === String(claims.tid).toLowerCase();
  const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
  if (!valid || !audienceValid || !issuerValid || claims.exp <= now || claims.iat > now + 60 || !claims.sub || !email || (provider === 'apple' && ![true, 'true'].includes(claims.email_verified))) {
    throw new Error('No se pudo verificar tu cuenta. Revisa el proveedor e inténtalo de nuevo.');
  }
  return { provider, sub: claims.sub, email, name: claims.name || email, picture: '' };
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 }, key, 256);
  return toBase64Url(new Uint8Array(result));
}
async function verifyPassword(password, salt, expected) {
  return constantTimeEqual(await hashPassword(password, decodeBase64UrlBytes(salt)), expected);
}

async function verifyUserSession(request, env) {
  const session = await verifySignedToken(getCookie(request, 'account_session') || getCookie(request, 'google_session'), env);
  return session?.sub && session?.exp > Date.now() ? { sub: session.sub, email: session.email, name: session.name, picture: session.picture } : null;
}
async function verifyAdminSession(request, env) { const session = await verifySignedToken(getCookie(request, 'admin_session'), env); return session?.admin === true && session.exp > Date.now(); }

async function getSessionSecret(env) {
  if (env.GOOGLE_SESSION_SECRET) return env.GOOGLE_SESSION_SECRET;
  if (cachedSessionSecret) return cachedSessionSecret;
  if (!env.DB) throw new Error('Configura GOOGLE_SESSION_SECRET en Pages.');
  try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run(); } catch { /* ya existe */ }
  const existing = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('session_secret').first();
  if (existing?.value) { cachedSessionSecret = existing.value; return cachedSessionSecret; }
  const generated = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  try { await env.DB.prepare('INSERT INTO app_settings (key,value) VALUES (?,?)').bind('session_secret', generated).run(); } catch { /* otro lo creó */ }
  const stored = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('session_secret').first();
  cachedSessionSecret = stored?.value || generated;
  return cachedSessionSecret;
}
async function signedToken(payload, env) {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await hmac(encoded, env)}`;
}
async function verifySignedToken(token, env) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  let secret;
  try { secret = await getSessionSecret(env); } catch { return null; }
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('HMAC', key, decodeBase64UrlBytes(signature), encoder.encode(payload)))) return null;
  try { return JSON.parse(decodeBase64Url(payload)); } catch { return null; }
}
async function hmac(value, env) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(await getSessionSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function verifyPaymentSignature(request, url, secret) {
  const header = request.headers.get('x-signature') || '';
  const requestId = request.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(header.split(',').map((piece) => { const i = piece.indexOf('='); return i > 0 ? [piece.slice(0, i).trim(), piece.slice(i + 1).trim()] : ['', '']; }).filter(([key]) => key));
  if (!parts.ts || !parts.v1) return false;
  const dataId = (url.searchParams.get('data.id') || '').toLowerCase();
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(manifest)));
  return constantTimeEqual([...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''), parts.v1);
}

function publicOrder(order) {
  return { id: order.id, status: order.status, total: order.total, subtotal: order.subtotal, shipping: order.shipping, createdAt: order.createdAt, customer: { name: order.customer.name, email: order.customer.email, city: order.customer.city }, lines: order.lines.map(({ image, ...line }) => line), paymentStatus: order.payment?.status || null };
}
function storeConfig(env) { return { name: env.STORE_NAME || 'La Tienda de Alex', whatsapp: env.STORE_WHATSAPP || '573124885850', email: env.STORE_EMAIL || '', address: env.STORE_ADDRESS || '', freeShippingFrom: Number(env.FREE_SHIPPING_FROM ?? 300000), shippingFlat: Number(env.SHIPPING_FLAT ?? 25000) }; }
async function readJson(request, maxBytes = 1_000_000) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('El archivo es demasiado grande.');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('El archivo es demasiado grande.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes) || '{}');
}
function clean(value, max = 200) { return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max); }
function normalize(value) { return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function getCookie(request, name) { for (const part of (request.headers.get('cookie') || '').split(';')) { const index = part.indexOf('='); if (index >= 0 && part.slice(0, index).trim() === name) { try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; } } } return ''; }
function cookie(name, value, request, maxAge, httpOnly = false) { const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''; return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}${secure}`; }
function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'set-cookie' && Array.isArray(value)) for (const cookieValue of value) responseHeaders.append('Set-Cookie', cookieValue);
    else responseHeaders.set(key, value);
  }
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}
function isLoginThrottled(request) {
  const now = Date.now();
  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  const recent = (loginAttempts.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 8) return true;
  recent.push(now);
  loginAttempts.set(key, recent);
  return false;
}
function constantTimeEqual(first, second) { const a = encoder.encode(String(first)); const b = encoder.encode(String(second)); let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0); return diff === 0; }
function toBase64Url(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function decodeBase64UrlBytes(value) { const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function decodeBase64Url(value) { return new TextDecoder().decode(decodeBase64UrlBytes(value)); }
