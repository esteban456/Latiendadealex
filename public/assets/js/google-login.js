import { initMobileAppNavigation } from './core.js?v=20261016-catalogo';
const statusNode = document.querySelector('#login-status');
const googleButton = document.querySelector('#google-button');
const accountForm = document.querySelector('#account-form');
const state = { csrf: '', mode: 'login', providers: {} };

document.querySelector('#year').textContent = new Date().getFullYear();
initMobileAppNavigation();
document.querySelector('label[for="account-email"]').textContent = 'Correo o Usuario';
const identifierInput = document.querySelector('#account-email');
identifierInput.type = 'text';
identifierInput.autocomplete = 'username';
identifierInput.placeholder = 'Escribe tu correo o usuario';
const usernameField = document.createElement('div');
usernameField.className = 'field';
usernameField.id = 'username-field';
usernameField.hidden = true;
usernameField.innerHTML = '<label for="account-username">Usuario</label><input id="account-username" name="username" autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9._-]{3,30}">';
document.querySelector('#account-submit').before(usernameField);

function showStatus(message, kind = '') {
  statusNode.textContent = message;
  statusNode.className = `login-status ${kind}`;
}

async function request(path, body) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, csrf: state.csrf }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo completar el acceso.');
  return data;
}

function setMode(mode) {
  state.mode = mode;
  const registering = mode === 'register';
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#name-field').hidden = !registering;
  document.querySelector('#username-field').hidden = !registering;
  document.querySelector('#confirm-field').hidden = !registering;
  document.querySelector('#account-name').required = registering;
  document.querySelector('#account-username').required = registering;
  document.querySelector('#account-confirm').required = registering;
  document.querySelector('#account-password').autocomplete = registering ? 'new-password' : 'current-password';
  document.querySelector('#login-title').textContent = registering ? 'Crea tu cuenta' : 'Bienvenido';
  document.querySelector('#account-submit').textContent = registering ? 'Crear cuenta' : 'Iniciar sesión';
  showStatus('');
}

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));

accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#account-password').value;
  const identifier = document.querySelector('#account-email').value.trim();
  const body = { password };
  if (state.mode === 'register') {
    body.email = identifier;
    body.username = document.querySelector('#account-username').value.trim();
    body.name = document.querySelector('#account-name').value.trim();
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(body.username)) return showStatus('El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.', 'error');
    if (password.length < 10) return showStatus('Usa una contraseña de al menos 10 caracteres.', 'error');
    if (password !== document.querySelector('#account-confirm').value) return showStatus('Las contraseñas no coinciden.', 'error');
  } else body.identifier = identifier;
  const submit = document.querySelector('#account-submit');
  submit.disabled = true;
  submit.textContent = state.mode === 'register' ? 'Creando cuenta…' : 'Ingresando…';
  showStatus('Un momento…');
  try {
    const result = await request(`/api/auth/${state.mode}`, body);
    showStatus(`¡Hola, ${result.user.name}!`, 'success');
    setTimeout(() => { window.location.href = 'index.html?login=account'; }, 650);
  } catch (error) {
    showStatus(error.message, 'error');
    submit.disabled = false;
    submit.textContent = state.mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión';
  }
});

function loadScript(src, test) {
  if (test()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el acceso del proveedor.'));
    document.head.append(script);
  });
}

async function socialLogin(provider, credential) {
  showStatus('Verificando tu cuenta…');
  try {
    const result = await request('/api/auth/oidc', { provider, credential });
    showStatus(`¡Bienvenido, ${result.user.name}!`, 'success');
    setTimeout(() => { window.location.href = 'index.html?login=' + encodeURIComponent(provider); }, 650);
  } catch (error) { showStatus(error.message, 'error'); }
}

async function startGoogleLogin() {
  try {
    await loadScript('https://accounts.google.com/gsi/client', () => Boolean(window.google?.accounts?.id));
    let attempts = 0;
    const waitForGoogle = () => {
      if (window.google?.accounts?.id) {
        google.accounts.id.initialize({ client_id: state.providers.google, callback: (response) => socialLogin('google', response.credential) });
        google.accounts.id.renderButton(googleButton, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 280, locale: 'es' });
      } else if (attempts++ < 40) setTimeout(waitForGoogle, 150);
      else showStatus('No se pudo cargar Google. Revisa tu conexión e inténtalo de nuevo.', 'error');
    };
    waitForGoogle();
  } catch (error) { showStatus(error.message, 'error'); }
}

async function continueWithApple() {
  if (!state.providers.apple) return showStatus('Apple aún necesita configurarse con un Service ID de Apple Developer.', 'error');
  try {
    await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js', () => Boolean(window.AppleID?.auth));
    AppleID.auth.init({ clientId: state.providers.apple, scope: 'name email', redirectURI: window.location.origin + window.location.pathname, usePopup: true });
    const result = await AppleID.auth.signIn();
    await socialLogin('apple', result.authorization.id_token);
  } catch (error) { showStatus(error.message || 'No se pudo iniciar con Apple.', 'error'); }
}

async function continueWithMicrosoft() {
  if (!state.providers.microsoft) return showStatus('Microsoft aún necesita configurarse con un Client ID de Azure.', 'error');
  try {
    await loadScript('https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js', () => Boolean(window.msal?.PublicClientApplication));
    const client = new msal.PublicClientApplication({ auth: { clientId: state.providers.microsoft, authority: 'https://login.microsoftonline.com/common', redirectUri: window.location.origin + window.location.pathname } });
    await client.initialize();
    const result = await client.loginPopup({ scopes: ['openid', 'profile', 'email'] });
    await socialLogin('microsoft', result.idToken);
  } catch (error) { showStatus(error.message || 'No se pudo iniciar con Microsoft.', 'error'); }
}

document.querySelector('[data-provider="apple"]').addEventListener('click', continueWithApple);
document.querySelector('[data-provider="microsoft"]').addEventListener('click', continueWithMicrosoft);

async function initializeAccountPage() {
  try {
    const [providersResponse, csrfResponse] = await Promise.all([
      fetch('/api/auth/providers'),
      fetch('/api/auth/google/csrf', { credentials: 'same-origin' }),
    ]);
    if (!providersResponse.ok || !csrfResponse.ok) throw new Error('No pudimos preparar el acceso. Recarga la página.');
    [state.providers, { csrf: state.csrf }] = await Promise.all([providersResponse.json(), csrfResponse.json()]);
    startGoogleLogin();
  } catch (error) { showStatus(error.message || 'No se pudo preparar el acceso.', 'error'); }
}

initializeAccountPage();
