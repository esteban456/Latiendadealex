import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, sep, dirname, basename } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual, createPublicKey, verify as verifyJwtSignature } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { OAuth2Client } from 'google-auth-library';
import { rename } from 'node:fs/promises';

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, 'public');
const env = await loadEnv();
const DATA_DIR = env.DATA_DIR ? join(env.DATA_DIR) : join(ROOT, 'data');
const ORDERS_FILE = join(DATA_DIR, 'orders.json');
const LEADS_FILE = join(DATA_DIR, 'leads.json');
const CATALOG_FILE = join(DATA_DIR, 'catalog.json');
const USERS_FILE = join(DATA_DIR, 'accounts.json');
const UPLOADS_DIR = join(DATA_DIR, 'uploads', 'products');
const BUNDLED_CATALOG_FILE = join(ROOT, 'data', 'catalog.json');

const PORT = Number(env.PORT || 3000);
const MP_TOKEN = env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = env.MP_WEBHOOK_SECRET || '';
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || '484973380597-2ava9io0f4mf34fplkfin6j29uplh6uf.apps.googleusercontent.com';
const GOOGLE_SESSION_SECRET = env.GOOGLE_SESSION_SECRET || randomUUID();
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
const googleAuth = new OAuth2Client(GOOGLE_CLIENT_ID);
const STORE = {
  name: env.STORE_NAME || 'La Tienda de Alex',
  whatsapp: env.STORE_WHATSAPP || '573124885850',
  email: env.STORE_EMAIL || '',
  address: env.STORE_ADDRESS || '',
  freeShippingFrom: Number(env.FREE_SHIPPING_FROM ?? 300000),
  shippingFlat: Number(env.SHIPPING_FLAT ?? 25000),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

let catalogCache = { data: null, at: 0 };
let writeQueue = Promise.resolve();
const hits = new Map();
const normalizeText = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

await initializeDataDirectory();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) return await api(req, res, url);

    const uploadName = pathname.match(/^\/uploads\/products\/([a-f0-9-]+\.(?:webp|png|jpe?g))$/i)?.[1];
    if (uploadName) {
      const image = await readFile(join(UPLOADS_DIR, uploadName));
      const extension = extname(uploadName).toLowerCase();
      const type = extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : 'image/jpeg';
      return send(res, 200, type, image, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    const filePath = resolveFile(pathname);
    if (!filePath) return send(res, 404, 'text/plain; charset=utf-8', 'No encontrado');

    const ext = extname(filePath).toLowerCase();
    const body = await readFile(filePath);
    const immutable = /\/assets\/img\//.test(pathname);
  sendMaybeGzipped(res.req, res, 200, MIME[ext] || 'application/octet-stream', body, {
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      return send(res, 404, 'text/plain; charset=utf-8', 'No encontrado');
    }
    console.error(err);
    send(res, 500, 'text/plain; charset=utf-8', 'Error interno');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n  El puerto ${PORT} ya esta ocupado: hay otra copia del servidor corriendo.\n` +
        `  Cierra la anterior, o arranca con otro puerto:  PORT=3001 node server/index.js\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  ${STORE.name}  ->  http://localhost:${PORT}`);
  console.log(`  Pago: ${MP_TOKEN ? 'Mercado Pago (modo real)' : 'MODO DEMO (faltan llaves MP_ACCESS_TOKEN)'}`);
  console.log(`  WhatsApp: ${STORE.whatsapp || 'sin configurar'}\n`);
});

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/admin/session') {
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = Boolean(verifyAdminSession(cookies.admin_session));
    return json(res, 200, { authenticated, csrf: authenticated ? cookies.admin_csrf : '', setupRequired: authenticated ? false : await adminSetupRequired() });
  }

  if (route === 'POST /api/admin/login') {
    if (!allowRequest(res, 'admin-login', 8, 60_000)) return;
    const body = await readJson(req);
    const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (identifier) {
      const accounts = await readJsonFile(USERS_FILE, []);
      const account = accounts.find((item) => item.isAdmin && (item.email === identifier || item.username === identifier));
      if (!account?.passwordHash || !await verifyPassword(password, account.salt, account.passwordHash)) {
        return json(res, 401, { error: 'Usuario o contraseña incorrectos.' });
      }
    } else if (ADMIN_PASSWORD) {
      const supplied = Buffer.from(password, 'utf8');
      const expected = Buffer.from(ADMIN_PASSWORD, 'utf8');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return json(res, 401, { error: 'Contraseña incorrecta.' });
      }
    } else {
      return json(res, 400, { error: 'Escribe tu usuario o correo para entrar.' });
    }
    const csrf = randomUUID();
    res.setHeader('Set-Cookie', [
      cookie('admin_session', signAdminSession(), req, 60 * 60 * 12, true),
      cookie('admin_csrf', csrf, req, 60 * 60 * 12),
    ]);
    return json(res, 200, { ok: true, csrf });
  }

  if (route === 'POST /api/admin/setup') {
    if (!allowRequest(res, 'admin-setup', 8, 60_000)) return;
    if (!(await adminSetupRequired())) return json(res, 409, { error: 'Ya existe una cuenta de administrador. Inicia sesión.' });
    const body = await readJson(req, 20_000);
    const name = clean(body.name, 100);
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name) return json(res, 400, { error: 'Escribe tu nombre para crear la cuenta.' });
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json(res, 400, { error: 'El usuario debe tener entre 3 y 30 caracteres.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return json(res, 400, { error: 'Escribe un correo electrónico válido.' });
    if (password.length < 10 || password.length > 128) return json(res, 400, { error: 'La contraseña debe tener entre 10 y 128 caracteres.' });
    const accounts = await readJsonFile(USERS_FILE, []);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePasswordHash(password, salt);
    const existing = accounts.find((account) => account.email === email || account.username === username);
    if (existing) {
      Object.assign(existing, { name, salt: Buffer.from(salt).toString('base64'), passwordHash, isAdmin: true });
    } else {
      accounts.push({ id: randomUUID(), email, username, name, salt: Buffer.from(salt).toString('base64'), passwordHash, provider: 'password', providerSub: '', isAdmin: true, createdAt: new Date().toISOString() });
    }
    await writeJsonFile(USERS_FILE, accounts);
    const csrf = randomUUID();
    res.setHeader('Set-Cookie', [
      cookie('admin_session', signAdminSession(), req, 60 * 60 * 12, true),
      cookie('admin_csrf', csrf, req, 60 * 60 * 12),
    ]);
    return json(res, 200, { ok: true, csrf });
  }

  if (route === 'POST /api/admin/logout') {
    res.setHeader('Set-Cookie', [cookie('admin_session', '', req, 0, true), cookie('admin_csrf', '', req, 0)]);
    return json(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/api/admin/')) {
    const admin = verifyAdminSession(parseCookies(req.headers.cookie).admin_session);
    if (!admin) return json(res, 401, { error: 'Inicia sesión como administrador.' });
    if (req.method !== 'GET') {
      const body = await readJson(req, route === 'POST /api/admin/upload' ? 5_500_000 : 1_000_000);
      if (!body.csrf || body.csrf !== parseCookies(req.headers.cookie).admin_csrf) {
        return json(res, 403, { error: 'La sesión expiró. Vuelve a iniciar sesión.' });
      }
      req.adminBody = body;
    }

    if (route === 'GET /api/admin/products') return adminListProducts(res, url);
    if (route === 'GET /api/admin/orders') return adminListOrders(res, url);
    if (route === 'POST /api/admin/orders/status') return adminUpdateOrderStatus(res, req.adminBody);
    if (route === 'POST /api/admin/products') return adminSaveProduct(res, req.adminBody);
    if (route === 'DELETE /api/admin/products') return adminDeleteProduct(res, req.adminBody);
    if (route === 'POST /api/admin/upload') return adminUploadImage(req, res, req.adminBody);
    return json(res, 404, { error: 'Ruta de administración no encontrada.' });
  }

  if (route === 'GET /api/auth/google/config') {
    return json(res, 200, { clientId: GOOGLE_CLIENT_ID });
  }

  if (route === 'GET /api/auth/providers') {
    return json(res, 200, { google: GOOGLE_CLIENT_ID, apple: env.APPLE_CLIENT_ID || '', microsoft: env.MICROSOFT_CLIENT_ID || '' });
  }

  if (route === 'GET /api/auth/google/csrf') {
    const token = randomUUID();
    res.setHeader('Set-Cookie', cookie('google_csrf', token, req, 10 * 60));
    return json(res, 200, { csrf: token });
  }

  if (route === 'POST /api/auth/google') {
    if (!allowRequest(res, 'google-auth', 10, 60_000)) return;
    const body = await readJson(req);
    const cookies = parseCookies(req.headers.cookie);
    if (!body.csrf || body.csrf !== cookies.google_csrf) {
      return json(res, 403, { error: 'La sesión expiró. Recarga e inténtalo de nuevo.' });
    }
    try {
      const ticket = await googleAuth.verifyIdToken({ idToken: body.credential, audience: GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        return json(res, 401, { error: 'Google no pudo verificar este correo.' });
      }
      const user = { sub: payload.sub, email: payload.email, name: payload.name || payload.email, picture: payload.picture || '' };
      res.setHeader('Set-Cookie', [
        cookie('google_session', signSession(user), req, 60 * 60 * 24 * 7, true),
        cookie('google_csrf', '', req, 0),
      ]);
      return json(res, 200, { ok: true, user });
    } catch (error) {
      console.warn('No se pudo validar el inicio de Google:', error.message);
      return json(res, 401, { error: 'No se pudo validar tu cuenta de Google. Inténtalo de nuevo.' });
    }
  }

  if (route === 'POST /api/auth/register') return accountAuth(req, res, 'register');
  if (route === 'POST /api/auth/login') return accountAuth(req, res, 'login');
  if (route === 'POST /api/auth/oidc') return providerAuth(req, res);

  if (route === 'GET /api/auth/me') {
    const cookies = parseCookies(req.headers.cookie);
    return json(res, 200, { user: verifySession(cookies.account_session || cookies.google_session) });
  }

  if (route === 'POST /api/auth/logout') {
    res.setHeader('Set-Cookie', [cookie('account_session', '', req, 0, true), cookie('google_session', '', req, 0, true)]);
    return json(res, 200, { ok: true });
  }

  if (route === 'GET /api/config') {
    return json(res, 200, {
      store: STORE,
      currency: 'COP',
      paymentReady: Boolean(MP_TOKEN),
      mode: MP_TOKEN ? 'real' : 'demo',
    });
  }

  if (route === 'GET /api/catalog') return catalogResponse(res, url);

  if (route === 'POST /api/checkout') {
    if (!allowRequest(res, 'checkout', 20, 60_000)) return;
    const body = await readJson(req);
    return checkout(res, body);
  }

  if (route === 'POST /api/webhook') return webhook(req, res, url);

  if (route === 'POST /api/lead') {
    if (!allowRequest(res, 'lead', 10, 60_000)) return;
    const body = await readJson(req);
    return saveLead(res, body);
  }

  if (route === 'GET /api/order') {
    if (!allowRequest(res, 'order', 30, 60_000)) return;
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: 'Falta el id del pedido' });
    const order = (await readJsonFile(ORDERS_FILE, [])).find((o) => o.id === id);
    if (!order) return json(res, 404, { error: 'Pedido no encontrado' });
    return json(res, 200, publicOrder(order));
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

async function accountAuth(req, res, mode) {
  if (!allowRequest(res, `account-${mode}`, 12, 60_000)) return;
  const body = await readJson(req, 20_000);
  const cookies = parseCookies(req.headers.cookie);
  if (!body.csrf || body.csrf !== cookies.google_csrf) return json(res, 403, { error: 'La sesión expiró. Recarga e inténtalo de nuevo.' });
  const identifier = String(mode === 'register' ? body.email || '' : body.identifier || body.email || '').trim().toLowerCase();
  const email = mode === 'register' ? identifier : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ? identifier : `${identifier}@usuario.invalid`);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return json(res, 400, { error: 'Escribe un correo electrónico válido.' });
  if (password.length < 10 || password.length > 128) return json(res, 400, { error: 'La contraseña debe tener entre 10 y 128 caracteres.' });

  if (mode === 'login' && !email && !/^[a-z0-9._-]{3,30}$/.test(identifier)) return json(res, 400, { error: 'Escribe un correo o usuario válido.' });
  if (mode === 'register' && !/^[a-z0-9._-]{3,30}$/.test(username)) return json(res, 400, { error: 'El usuario debe tener entre 3 y 30 caracteres.' });
  const accounts = await readJsonFile(USERS_FILE, []);
  let account = mode === 'register'
    ? accounts.find((item) => item.email === email || item.username === username)
    : accounts.find((item) => item.email === identifier || item.username === identifier);
  if (mode === 'register') {
    const name = clean(body.name, 100);
    if (!name) return json(res, 400, { error: 'Escribe tu nombre para crear la cuenta.' });
    if (account) return json(res, 409, { error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePasswordHash(password, salt);
    account = { id: randomUUID(), email, username, name, salt: Buffer.from(salt).toString('base64'), passwordHash, provider: 'password', providerSub: '', createdAt: new Date().toISOString() };
    accounts.push(account);
    await writeJsonFile(USERS_FILE, accounts);
  } else {
    if (!account?.passwordHash || !await verifyPassword(password, account.salt, account.passwordHash)) {
      return json(res, 401, { error: 'Correo o contraseña incorrectos.' });
    }
  }

  const user = { sub: `account:${account.id}`, email: account.email, name: account.name, picture: account.picture || '' };
  res.setHeader('Set-Cookie', cookie('account_session', signSession(user), req, 60 * 60 * 24 * 7, true));
  return json(res, 200, { ok: true, user });
}

async function providerAuth(req, res) {
  if (!allowRequest(res, 'provider-auth', 12, 60_000)) return;
  const body = await readJson(req, 20_000);
  const cookies = parseCookies(req.headers.cookie);
  if (!body.csrf || body.csrf !== cookies.google_csrf) return json(res, 403, { error: 'La sesión expiró. Recarga e inténtalo de nuevo.' });
  try {
    const user = await verifyExternalAccount(String(body.provider || '').toLowerCase(), body.credential);
    const accounts = await readJsonFile(USERS_FILE, []);
    let account = accounts.find((item) => item.provider === user.provider && item.providerSub === user.sub);
    if (!account) {
      account = accounts.find((item) => item.email === user.email);
      if (account) return json(res, 409, { error: 'Ya existe una cuenta con ese correo. Inicia sesión con el método que usaste al crearla.' });
      account = { id: randomUUID(), email: user.email, name: user.name, picture: user.picture, salt: '', passwordHash: '', provider: user.provider, providerSub: user.sub, createdAt: new Date().toISOString() };
      accounts.push(account);
      await writeJsonFile(USERS_FILE, accounts);
    }
    const sessionUser = { sub: `account:${account.id}`, email: account.email, name: account.name || user.name, picture: account.picture || user.picture || '' };
    res.setHeader('Set-Cookie', cookie('account_session', signSession(sessionUser), req, 60 * 60 * 24 * 7, true));
    return json(res, 200, { ok: true, user: sessionUser });
  } catch (error) {
    return json(res, 401, { error: error.message || 'No se pudo verificar la cuenta del proveedor.' });
  }
}

async function verifyExternalAccount(provider, token) {
  if (provider === 'google') {
    const ticket = await googleAuth.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new Error('Google no pudo verificar este correo.');
    return { provider, sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email, picture: payload.picture || '' };
  }
  const config = provider === 'apple'
    ? { clientId: env.APPLE_CLIENT_ID, issuer: 'https://appleid.apple.com', jwks: 'https://appleid.apple.com/auth/keys' }
    : provider === 'microsoft'
      ? { clientId: env.MICROSOFT_CLIENT_ID, issuer: '', jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys' }
      : null;
  if (!config) throw new Error('Proveedor de acceso no compatible.');
  if (!config.clientId) throw new Error(`Falta configurar ${provider === 'apple' ? 'APPLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID'} en el servidor.`);
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Credencial del proveedor inválida.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Firma del proveedor no válida.');
  const response = await fetch(config.jwks);
  if (!response.ok) throw new Error('No se pudieron verificar los servidores del proveedor.');
  const { keys = [] } = await response.json();
  const jwk = keys.find((key) => key.kid === header.kid && key.alg === 'RS256');
  if (!jwk) throw new Error('La firma del proveedor expiró. Intenta de nuevo.');
  const valid = verifyJwtSignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud.includes(config.clientId) : claims.aud === config.clientId;
  const issuerTenant = String(claims.iss || '').split('/')[3] || '';
  const issuerValid = provider === 'apple'
    ? claims.iss === config.issuer
    : /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i.test(claims.iss || '') && Boolean(claims.tid) && issuerTenant.toLowerCase() === String(claims.tid).toLowerCase();
  const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
  if (!valid || !aud || !issuerValid || claims.exp <= now || claims.iat > now + 60 || !claims.sub || !email || (provider === 'apple' && ![true, 'true'].includes(claims.email_verified))) {
    throw new Error('No se pudo verificar tu cuenta. Revisa el proveedor e inténtalo de nuevo.');
  }
  return { provider, sub: claims.sub, email, name: claims.name || email, picture: '' };
}

async function derivePasswordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 }, key, 256);
  return Buffer.from(bits).toString('base64');
}

async function verifyPassword(password, saltValue, expectedValue) {
  const actual = Buffer.from(await derivePasswordHash(password, Buffer.from(saltValue, 'base64')), 'base64');
  const expected = Buffer.from(expectedValue, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cookie(name, value, req, maxAge, httpOnly = false) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}${secure}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    try { return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]; }
    catch { return ['', '']; }
  }).filter(([key]) => key));
}

function signSession(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', GOOGLE_SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(value = '') {
  const [payload, signature] = String(value).split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', GOOGLE_SESSION_SECRET).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return user.exp > Date.now() ? { sub: user.sub, email: user.email, name: user.name, picture: user.picture } : null;
  } catch { return null; }
}

async function initializeDataDirectory() {
  await mkdir(UPLOADS_DIR, { recursive: true });
  try { await readFile(CATALOG_FILE); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (CATALOG_FILE !== BUNDLED_CATALOG_FILE) {
      const bundled = await readFile(BUNDLED_CATALOG_FILE, 'utf8');
      await writeFile(CATALOG_FILE, bundled, 'utf8');
    }
  }
}

async function adminSetupRequired() {
  if (ADMIN_PASSWORD) return false;
  const accounts = await readJsonFile(USERS_FILE, []);
  return !accounts.some((account) => account.isAdmin);
}

function signAdminSession() {
  const payload = Buffer.from(JSON.stringify({ admin: true, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', GOOGLE_SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAdminSession(value = '') {
  const [payload, signature] = String(value).split('.');
  if (!payload || !signature) return false;
  const expected = createHmac('sha256', GOOGLE_SESSION_SECRET).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.admin === true && session.exp > Date.now();
  } catch { return false; }
}

async function adminListProducts(res, url) {
  const catalog = await readJsonFile(CATALOG_FILE, { products: [], categories: [] });
  const q = normalizeText(url.searchParams.get('q') || '').trim();
  const id = url.searchParams.get('id');
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const all = catalog.products || [];
  const category = url.searchParams.get('category') || '';
  const stock = url.searchParams.get('stock') || '';
  const filtered = all.filter((product) => {
    if (id && product.id !== id) return false;
    if (q && !normalizeText(`${product.name} ${product.brand || ''} ${product.id} ${(product.categories || []).map((c) => c.name).join(' ')}`).includes(q)) return false;
    if (category && !(product.categories || []).some((item) => item.name === category)) return false;
    const units = Number(product.stock || 0);
    if (stock === 'available' && units <= 0) return false;
    if (stock === 'low' && (units <= 0 || units > 3)) return false;
    if (stock === 'out' && units > 0) return false;
    if (stock === 'no-image' && product.image) return false;
    return true;
  });
  const summary = {
    total: all.length,
    available: all.filter((product) => Number(product.stock || 0) > 0).length,
    lowStock: all.filter((product) => Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 3).length,
    outOfStock: all.filter((product) => Number(product.stock || 0) <= 0).length,
    noImage: all.filter((product) => !product.image).length,
  };
  return json(res, 200, { products: filtered.slice(offset, offset + limit).map(withImageKit), total: filtered.length, offset, limit, categories: catalog.categories || [], summary });
}

async function adminListOrders(res, url) {
  const all = (await readJsonFile(ORDERS_FILE, [])).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const query = normalizeText(url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || '';
  const filtered = all.filter((order) => {
    if (status && order.status !== status) return false;
    const customer = order.customer || {};
    return !query || normalizeText(`${order.id} ${customer.name} ${customer.email} ${customer.city} ${customer.phone}`).includes(query);
  });
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
  return json(res, 200, {
    orders: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit,
    summary: { total: all.length, paid: all.filter((order) => order.status === 'pagado').length, pending: all.filter((order) => order.status === 'pendiente').length },
  });
}

async function adminUpdateOrderStatus(res, body) {
  const allowed = new Set(['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado']);
  const id = String(body.id || '');
  const fulfillmentStatus = String(body.fulfillmentStatus || '');
  if (!id || !allowed.has(fulfillmentStatus)) return json(res, 400, { error: 'Selecciona un estado de entrega válido.' });
  await updateOrder(id, (order) => ({ ...order, fulfillmentStatus, fulfillmentUpdatedAt: new Date().toISOString() }));
  const order = (await readJsonFile(ORDERS_FILE, [])).find((item) => item.id === id);
  if (!order) return json(res, 404, { error: 'No se encontró el pedido.' });
  return json(res, 200, { ok: true, order });
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

async function adminSaveProduct(res, body) {
  const name = clean(body.name, 180);
  const category = clean(body.category, 100);
  const cost = Number(body.cost);
  const hasCost = Number.isFinite(cost) && cost > 0;
  const priced = hasCost ? priceForCost(cost) : null;
  const price = priced ? priced.contado : Number(body.price);
  const offerCredit = body.offerCredit !== false;
  const creditPrice = priced ? priced.credito : (offerCredit ? Number(body.creditPrice || price) : price);
  const stock = Math.max(0, Math.floor(Number(body.stock) || 0));
  if (!name || !category || !Number.isFinite(price) || price <= 0 || (offerCredit && (!Number.isFinite(creditPrice) || creditPrice <= 0))) {
    return json(res, 400, { error: 'Nombre, categoría y precio válido son obligatorios.' });
  }
  const catalog = await readJsonFile(CATALOG_FILE, { products: [], categories: [] });
  const existingIndex = body.id ? catalog.products.findIndex((p) => p.id === body.id) : -1;
  if (body.id && existingIndex < 0) return json(res, 404, { error: 'No se encontró el producto.' });
  const previous = existingIndex >= 0 ? catalog.products[existingIndex] : {};
  const slug = clean(body.slug, 180) || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160);
  const image = clean(body.image, 600);
  const contadoVariant = previous.variants?.find((variant) => /contado/i.test(variant.label))
    || previous.variants?.find((variant) => /precio único/i.test(variant.label))
    || previous.variants?.[0];
  const creditoVariant = previous.variants?.find((variant) => /cr[eé]dito/i.test(variant.label));
  const contadoSku = contadoVariant?.sku || `admin-${randomUUID().slice(0, 12)}-contado`;
  const variants = [
    { sku: contadoSku, label: 'CONTADO', price, available: stock > 0 },
    ...(offerCredit ? [{ sku: creditoVariant?.sku || `${contadoSku}-credito`, label: 'CRÉDITO', price: creditPrice, available: stock > 0 }] : []),
  ];
  if (variants[1]) {
    variants[1].sku = previous.variants?.find((variant) => /credito/i.test(variant.sku))?.sku || variants[1].sku;
    variants[1].label = 'CR\u00c9DITO';
  }
  const sku = contadoSku;
  const product = {
    ...previous,
    id: previous.id || `admin-${randomUUID()}`,
    slug,
    name,
    brand: clean(body.brand, 100),
    description: clean(body.description, 5000),
    price,
    cost: hasCost ? cost : (Number(previous.cost) || undefined),
    maxPrice: offerCredit ? creditPrice : price,
    compareAt: price,
    image,
    images: image ? [image] : [],
    categories: [{ name: category, icon: catalog.categories.find((c) => c.name === category)?.icon || '📦' }],
    variants: previous.variants?.length
      ? previous.variants.map((variant, index) => ({ ...variant, ...(index === 0 ? { price } : {}), available: stock > 0 }))
      : [{ sku, label: 'Precio único', price, available: stock > 0 }],
    available: stock > 0,
    stock,
    specs: previous.specs || {},
    tags: previous.tags || [],
    source: previous.source || 'panel-admin',
  };
  product.variants = variants;
  if (existingIndex >= 0) catalog.products[existingIndex] = product;
  else catalog.products.unshift(product);
  await writeCatalog(catalog);
  return json(res, 200, { ok: true, product, total: catalog.products.length });
}

async function adminDeleteProduct(res, body) {
  const catalog = await readJsonFile(CATALOG_FILE, { products: [], categories: [] });
  const index = catalog.products.findIndex((p) => p.id === body.id);
  if (index < 0) return json(res, 404, { error: 'No se encontró el producto.' });
  catalog.products.splice(index, 1);
  await writeCatalog(catalog);
  return json(res, 200, { ok: true, total: catalog.products.length });
}

async function adminUploadImage(req, res, body) {
  const match = String(body.dataUrl || '').match(/^data:image\/(webp|png|jpeg);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return json(res, 400, { error: 'Formato de imagen no compatible. Usa JPG, PNG o WebP.' });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) return json(res, 413, { error: 'La imagen debe pesar menos de 4 MB.' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  if (env.IMAGEKIT_PRIVATE_KEY) {
    const fileName = `producto-${randomUUID()}.${ext}`;
    const form = new FormData();
    form.set('file', new Blob([buffer], { type: `image/${match[1]}` }), fileName);
    form.set('fileName', fileName);
    form.set('folder', env.IMAGEKIT_FOLDER || '/Latiendadealex');
    form.set('useUniqueFileName', 'true');
    const authorization = Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString('base64');
    let response;
    try {
      response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
        method: 'POST', headers: { Authorization: `Basic ${authorization}` }, body: form,
      });
    } catch (error) {
      console.error('ImageKit upload failed:', error.message);
      return json(res, 502, { error: 'No se pudo conectar con ImageKit. Intenta de nuevo.' });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) {
      console.error('ImageKit upload:', response.status, result.message || result);
      return json(res, 502, { error: result.message || 'ImageKit no pudo guardar la imagen.' });
    }
    return json(res, 200, { image: result.url });
  }

  const file = `${randomUUID()}.${ext}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(join(UPLOADS_DIR, file), buffer, { flag: 'wx' });
  return json(res, 200, { image: `/uploads/products/${file}` });
}

async function writeCatalog(catalog) {
  catalog.generatedAt = new Date().toISOString();
  catalog.counts ||= {};
  catalog.counts = {
    ...catalog.counts,
    products: catalog.products.length,
    withDescription: catalog.products.filter((product) => product.description).length,
    withImage: catalog.products.filter((product) => product.image).length,
    available: catalog.products.filter((product) => product.available).length,
  };
  const categories = new Map();
  for (const product of catalog.products) {
    for (const category of product.categories || []) {
      if (!category.name) continue;
      const entry = categories.get(category.name) || { ...category, products: 0 };
      entry.products++;
      categories.set(category.name, entry);
    }
  }
  catalog.categories = [...categories.values()];
  const temporary = `${CATALOG_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(catalog), 'utf8');
  await rename(temporary, CATALOG_FILE);
  catalogCache = { data: null, at: 0 };
}

async function catalogResponse(res, url) {
  const fresh = Date.now() - catalogCache.at < 60_000;
  if (!fresh || !catalogCache.data) {
    catalogCache = { data: await readJsonFile(CATALOG_FILE, { products: [], categories: [] }), at: Date.now() };
  }

  const q = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const brand = url.searchParams.get('brand') || '';
  const minPrice = Number(url.searchParams.get('minPrice')) || 0;
  const maxPrice = Number(url.searchParams.get('maxPrice')) || Infinity;
  const onlyStock = url.searchParams.get('stock') === '1';
  const freeShipping = url.searchParams.get('shipping') === '1';
  const onlyOffers = url.searchParams.get('offers') === '1';
  const sort = url.searchParams.get('sort') || 'relevancia';
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  // Sin "limit" se devuelve el catalogo entero: la pagina lo pagina en el
  // navegador y con el tope de 48 solo se veian 48 de los 1945 productos.
  const limitePedido = url.searchParams.get('limit');
  const limit = limitePedido ? Math.min(Math.max(1, Number(limitePedido) || 48), 200) : Infinity;

  let products = catalogCache.data.products || [];
  let filtered = [...products];

  // Filtros en el servidor
  if (category) {
    const requestedCategory = normalizeText(category).trim();
    const exactCategoryExists = products.some((p) => (p.categories || []).some((c) => normalizeText(c.name).trim() === requestedCategory));
    filtered = filtered.filter((p) =>
      (p.categories || []).some((c) => {
        const productCategory = normalizeText(c.name).trim();
        return productCategory === requestedCategory || (!exactCategoryExists && productCategory.startsWith(requestedCategory));
      }),
    );
  }
  if (brand) {
    filtered = filtered.filter((p) => p.brand === brand);
  }
  if (minPrice > 0) {
    filtered = filtered.filter((p) => p.price >= minPrice);
  }
  if (maxPrice < Infinity) {
    filtered = filtered.filter((p) => p.price <= maxPrice);
  }
  if (onlyStock) {
    filtered = filtered.filter((p) => p.available);
  }
  if (freeShipping) {
    filtered = filtered.filter((p) => p.price >= STORE.freeShippingFrom);
  }
  if (onlyOffers) {
    filtered = filtered.filter((p) => Number(p.compareAt) > Number(p.price));
  }

  // Búsqueda mejorada con normalización de tildes
  if (q) {
    const normalizedQuery = normalizeText(q);
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    filtered = filtered.filter((p) => {
      const haystack = normalizeText(`${p.name} ${p.brand || ''} ${(p.categories || []).map((c) => c.name).join(' ')} ${p.description || ''}`);
      return queryTerms.every((term) => haystack.includes(term));
    });

    // Ordenar por relevancia si hay búsqueda
    if (queryTerms.length > 0) {
      filtered.sort((a, b) => {
        const aName = (a.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const bName = (b.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const aIndex = aName.indexOf(normalizedQuery);
        const bIndex = bName.indexOf(normalizedQuery);
        if (aIndex !== bIndex) return aIndex - bIndex;
        return Number(b.available) - Number(a.available);
      });
    }
  }

  // Ordenamiento
  if (sort === 'precio-asc') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (sort === 'precio-desc') {
    filtered.sort((a, b) => b.price - a.price);
  } else if (sort === 'nombre') {
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  } else if (sort === 'ventas') {
    filtered.sort((a, b) => (b.sales || 0) - (a.sales || 0));
  } else if (sort === 'novedad') {
    filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else {
    // relevancia: disponibles primero, luego por ventas
    filtered.sort((a, b) => Number(b.available) - Number(a.available) || (b.sales || 0) - (a.sales || 0));
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit).map(withImageKit);

  return json(res, 200, {
    ...catalogCache.data,
    products: paginated,
    pagination: {
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    },
  });
}

function withImageKit(product) {
  const endpoint = String(env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/eayqxn9lnz').replace(/\/+$/, '');
  const folder = `/${String(env.IMAGEKIT_FOLDER || '/Latiendadealex').replace(/^\/+|\/+$/g, '')}`;
  const mapImage = (image) => {
    if (!image || /^https?:\/\//i.test(image) || !image.startsWith('/assets/img/productos-webp/')) return image;
    const filename = image.split('?')[0].split('/').pop();
    return `${endpoint}${folder}/${encodeURIComponent(filename)}`;
  };
  return { ...product, image: mapImage(product.image), images: Array.isArray(product.images) ? product.images.map(mapImage) : product.images };
}

async function checkout(res, raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (items.length === 0) return json(res, 400, { error: 'El carrito esta vacio' });

  const catalog = await readJsonFile(CATALOG_FILE, { products: [] });
  const byId = new Map((catalog.products || []).map((p) => [p.id, p]));

  const lines = [];
  for (const item of items.slice(0, 50)) {
    const product = byId.get(String(item.id || ''));
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
    if (!product) return json(res, 400, { error: `Producto no disponible: ${item.id}` });
    const variant = (product.variants || []).find((v) => v.sku === item.sku) || (product.variants || [])[0];
    if (!variant || !variant.available) return json(res, 400, { error: `${product.name} no esta disponible` });
    lines.push({
      product,
      variant,
      qty,
      unitPrice: variant.price || product.price,
    });
  }

  const customer = {
    name: clean(raw?.customer?.name, 120) || 'Cliente',
    email: clean(raw?.customer?.email, 160),
    phone: clean(raw?.customer?.phone, 40),
    city: clean(raw?.customer?.city, 120),
    address: clean(raw?.customer?.address, 200),
    notes: clean(raw?.customer?.notes, 400),
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) {
    return json(res, 400, { error: 'Correo electronico invalido' });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const freeShipping = STORE.freeShippingFrom > 0 && subtotal >= STORE.freeShippingFrom;
  const shipping = freeShipping || subtotal === 0 ? 0 : STORE.shippingFlat;
  const total = subtotal + shipping;

  const order = {
    id: `ALX-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    status: 'pendiente',
    customer,
    lines: lines.map((l) => ({
      id: l.product.id,
      name: l.product.name,
      variant: l.variant.label,
      sku: l.variant.sku,
      qty: l.qty,
      unitPrice: l.unitPrice,
      total: l.unitPrice * l.qty,
      image: l.product.image,
    })),
    subtotal,
    shipping,
    total,
    currency: 'COP',
    payment: null,
  };

  if (!MP_TOKEN) {
    order.status = 'demo';
    await appendOrder(order);
    return json(res, 200, { demo: true, orderId: order.id, order: publicOrder(order) });
  }

  const preference = await createPreference(order);
  if (!preference?.init_point) {
    return json(res, 502, { error: 'Mercado Pago no respondio. Intenta de nuevo.' });
  }

  order.payment = {
    provider: 'mercadopago',
    preferenceId: preference.id,
    initPoint: preference.init_point,
    sandbox: preference.sandbox_init_point,
  };
  await appendOrder(order);

  // En pruebas se usa sandbox_init_point; en produccion init_point.
  // Dejarlo siempre en sandbox rompe la venta real.
  const useSandbox = env.MP_SANDBOX !== 'false';
  return json(res, 200, {
    orderId: order.id,
    checkoutUrl: useSandbox
      ? preference.sandbox_init_point || preference.init_point
      : preference.init_point,
    total,
  });
}

async function createPreference(order) {
  const base = env.PUBLIC_URL || `http://localhost:${PORT}`;

  const body = {
    items: order.lines.map((l) => ({
      title: l.name.slice(0, 60),
      description: String(l.variant || '').slice(0, 60),
      quantity: l.qty,
      unit_price: l.unitPrice,
      currency_id: 'COP',
    })),
    payer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: splitPhone(order.customer.phone),
      address: order.customer.address
        ? {
            street_name: order.customer.address,
            city: order.customer.city || undefined,
          }
        : undefined,
    },
    // cost debe ser Number: un string como 'free' produce
    // "invalid type for field shipments.cost".
    shipments: {
      cost: order.shipping,
      mode: 'not_specified',
    },
    payment_methods: {
      installments: Number(env.MP_INSTALLMENTS || 12),
    },
    external_reference: order.id,
    notification_url: `${base}/api/webhook`,
    statement_descriptor: String(env.STORE_NAME || 'TIENDA DE ALEX')
      .replace(/[^\w\s]/g, '')
      .trim()
      .toUpperCase()
      .slice(0, 22),
    back_urls: {
      success: `${base}/gracias.html`,
      pending: `${base}/gracias.html`,
      failure: `${base}/carrito.html`,
    },
    auto_return: 'approved',
    metadata: { orderId: order.id },
  };

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': order.id,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Mercado Pago:', response.status, detail);
    return null;
  }
  return response.json();
}

/**
 * Mercado Pago espera { area_code, number }. Si el numero no se puede parsear
 * como movil colombiano se devuelve undefined: es opcional y un objeto mal
 * formado hace fallar toda la preferencia.
 */
function splitPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('57') && digits.length > 10) digits = digits.slice(2);
  if (digits.length !== 10) return undefined;
  return { area_code: digits.slice(0, 3), number: digits.slice(3) };
}

async function webhook(req, res, url) {
  // Validar ANTES de responder: Mercado Pago exige 401 cuando la firma no
  // cuadra, y solo considera la notificacion si la respuesta es 200.
  if (MP_WEBHOOK_SECRET && !verifySignature(req, url)) {
    console.warn('Webhook con firma invalida, se responde 401');
    req.resume();
    return json(res, 401, { error: 'Firma invalida' });
  }

  const raw = await readBody(req);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: true }));

  try {
    const payload = JSON.parse(raw || '{}');
    const paymentId = payload?.data?.id || url.searchParams.get('data_id') || url.searchParams.get('id');
    if (!paymentId) return;

    if (!MP_TOKEN) {
      console.warn('Llego un webhook pero no hay MP_ACCESS_TOKEN: no se puede confirmar el pago');
      return;
    }

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!response.ok) return;
    const payment = await response.json();
    const orderId = payment?.external_reference || payment?.metadata?.orderId;
    if (!orderId) return;

    await updateOrder(orderId, (order) => {
      const approved = payment.status === 'approved';
      order.payment = {
        provider: 'mercadopago',
        paymentId: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        paidAt: approved ? new Date().toISOString() : null,
      };
      if (approved) order.status = 'pagado';
      else if (payment.status === 'rejected' || payment.status === 'cancelled') order.status = 'fallido';
      return order;
    });
    console.log(`Pedido ${orderId}: ${payment.status}`);
  } catch (err) {
    console.error('Webhook:', err.message);
  }
}

/**
 * Manifiesto segun la documentacion de Mercado Pago:
 *   id:[data.id];request-id:[x-request-id];ts:[ts];
 * Cada par presente incluye su ';' final. Los pares sin valor se omiten.
 * data.id se lee de la query y va en minusculas.
 */
function verifySignature(req, url) {
  const header = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'] || '';
  if (!header) return false;

  const parts = {};
  for (const piece of String(header).split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  if (!parts.ts || !parts.v1) return false;

  const dataId = (url.searchParams.get('data.id') || '').toLowerCase();
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;

  const expected = createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function saveLead(res, body) {
  const lead = {
    id: randomUUID(),
    at: new Date().toISOString(),
    name: clean(body?.name, 120),
    email: clean(body?.email, 160),
    phone: clean(body?.phone, 40),
    message: clean(body?.message, 600),
    source: clean(body?.source, 60) || 'web',
  };
  if (!lead.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
    return json(res, 400, { error: 'Correo electronico invalido' });
  }
  await appendFile(LEADS_FILE, lead);
  return json(res, 200, { ok: true, id: lead.id });
}

const publicOrder = (order) => ({
  id: order.id,
  status: order.status,
  total: order.total,
  subtotal: order.subtotal,
  shipping: order.shipping,
  createdAt: order.createdAt,
  customer: { name: order.customer.name, email: order.customer.email, city: order.customer.city },
  lines: order.lines.map(({ image, ...rest }) => rest),
  paymentStatus: order.payment?.status || null,
});

async function appendOrder(order) {
  const orders = await readJsonFile(ORDERS_FILE, []);
  orders.push(order);
  await writeJsonFile(ORDERS_FILE, orders);
}

async function updateOrder(id, mutate) {
  writeQueue = writeQueue
    .then(async () => {
      const orders = await readJsonFile(ORDERS_FILE, []);
      const index = orders.findIndex((o) => o.id === id);
      if (index === -1) return;
      orders[index] = mutate(orders[index]);
      await writeJsonFile(ORDERS_FILE, orders);
    })
    .catch((err) => console.error('No se pudo actualizar el pedido:', err.message));
  return writeQueue;
}

const appendFile = (file, item) => {
  writeQueue = writeQueue
    .then(async () => {
      const list = await readJsonFile(file, []);
      list.push(item);
      await writeJsonFile(file, list);
    })
    .catch((err) => console.error(`No se pudo escribir ${basename(file)}:`, err.message));
  return writeQueue;
};

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Convierte la ruta de la URL en un archivo dentro de public/ sin permitir
 * salir del directorio. Trabaja con '/' en la URL y sep del sistema en disco,
 * por eso no se usa normalize() (en Windows convierte '/' en '\').
 */
function resolveFile(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = decoded.split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..');
  if (segments.some((s) => s.includes(':'))) return null;

  const target = segments.join(sep) || 'index.html';
  const full = join(PUBLIC_DIR, target);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + sep)) return null;
  return full;
}

function allowRequest(res, key, limit, windowMs) {
  const now = Date.now();
  const clientKey = `${res.req?.socket?.remoteAddress || 'local'}:${key}`;
  const list = (hits.get(clientKey) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    json(res, 429, { error: 'Demasiados intentos. Espera un momento.' });
    return false;
  }
  list.push(now);
  hits.set(clientKey, list);
  return true;
}

const clean = (value, max = 200) => String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req, maxBytes = 1_000_000) {
  try {
    return JSON.parse((await readBody(req, maxBytes)) || '{}');
  } catch {
    return {};
  }
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

// El catalogo completo son 1,2 MB de JSON y se pide en cada carga de pagina:
// sin comprimir es una pesa. gzip lo deja en una cuarta parte.
function sendMaybeGzipped(req, res, status, type, body, headers = {}) {
  const acepta = String(req.headers['accept-encoding'] || '').includes('gzip');
  const comprimir = acepta && /^(application\/json|text\/|application\/javascript)/.test(type) && body.length > 1024;
  if (!comprimir) return send(res, status, type, body, headers);
  const gz = gzipSync(body);
  send(res, status, type, gz, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length, Vary: 'Accept-Encoding' });
}

const json = (res, status, data) =>
  sendMaybeGzipped(res.req, res, status, 'application/json; charset=utf-8', JSON.stringify(data));

async function loadEnv() {
  const out = { ...process.env };
  try {
    // readFile utf8 puede traer BOM, y en Windows el .env suele usar CRLF:
    // sin quitar el \r la clave secreta quedaba contaminada y el HMAC
    // del webhook nunca coincidia.
    const text = (await readFile(join(ROOT, '.env'), 'utf8')).replace(/^\uFEFF/, '');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      let value = match[2].trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();

      if (out[match[1]] === undefined) out[match[1]] = value;
    }
  } catch {
    /* sin .env: se usan variables de entorno */
  }
  return out;
}
