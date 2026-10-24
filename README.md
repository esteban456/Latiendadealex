# La Tienda de Alex

Tienda online propia en HTML, CSS y JavaScript, con catálogo extraído del sitio
anterior, carrito en el navegador y pago con **Mercado Pago (Checkout Pro)**.
Sin WordPress ni Wix. La versión local usa Node.js; para publicar en Cloudflare
usa Pages Functions y D1 para la API, con ImageKit para las imágenes.

---

## 1. Requisitos

- **Node.js 20 o superior** (probado en 22) para desarrollo local y herramientas
  del catálogo. Instala las dependencias con `npm install`.
- Opcional: variables de entorno de Mercado Pago para cobrar de verdad.

En Windows, `npm` puede estar bloqueado por la política de ejecución. Usa
`npm.cmd` en ese caso.

## 2. Arrancar

```bash
node server/index.js       # o: npm run dev
```

Abre <http://localhost:3000>.

Sin credenciales de Mercado Pago el sitio arranca en **modo demo**: el carrito
funciona y el checkout devuelve un pedido simulado, sin cobrar nada.

| Variable | Para qué sirve |
| --- | --- |
| `PORT` | Puerto del servidor. Por defecto `3000`. |
| `PUBLIC_URL` | URL pública de la tienda. **Obligatoria en producción**: Mercado Pago la usa para los retornos y el webhook, y no acepta `http`. |
| `MP_ACCESS_TOKEN` | Token de acceso de Mercado Pago. Vacío = modo demo. |
| `MP_WEBHOOK_SECRET` | Clave secreta de *Tus integraciones → Webhooks*. Vacío = no se valida la firma. |
| `MP_SANDBOX` | `true` (por defecto) manda al checkout de pruebas. **Ponlo en `false` cuando la cuenta ya cobre de verdad**, si no los clientes reales verán el sandbox y no podrán pagar. |
| `MP_INSTALLMENTS` | Máximo de cuotas ofrecidas. Por defecto `12`. |
| `STORE_NAME` | Nombre de la tienda. |
| `STORE_WHATSAPP` | Número de WhatsApp con código de país, solo dígitos (`573124885850`). |
| `STORE_EMAIL` / `STORE_ADDRESS` | Datos de contacto. |
| `FREE_SHIPPING_FROM` | Desde qué subtotal el envío es gratis. Por defecto `300000`. |
| `SHIPPING_FLAT` | Costo de envío fijo. Por defecto `25000`. |
| `ADMIN_PASSWORD` | Contraseña del panel privado `/admin.html`. En Cloudflare, guárdala como Secret. |
| `GOOGLE_SESSION_SECRET` | Secreto para firmar sesiones de usuario y administrador. En Cloudflare, guárdalo como Secret. |

Copia `.env.example` a `.env` y rellénalo. El servidor también lee variables
del entorno, que tienen prioridad sobre el archivo.

## 3. Páginas

| Ruta | Qué hace |
| --- | --- |
| `index.html` | Portada: destacadas, ofertas, categorías. |
| `catalogo.html` | Catálogo completo con búsqueda, filtro por categoría, orden y paginación. |
| `producto.html?slug=...` | Detalle, galería, variantes y productos relacionados. |
| `carrito.html` | Carrito y formulario de datos del cliente. |
| `gracias.html?order=...` | Confirmación del pedido. |

## 4. API

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/config` | Datos de la tienda, moneda, umbrales de envío y si el pago está listo. |
| `GET /api/catalog` | Catálogo completo. Admite `q`, `category` y `limit`. |
| `POST /api/checkout` | Crea el pedido. Body: `{ items: [{ id, sku, qty }], customer: { name, email, phone, city, address, notes } }`. En modo real devuelve `checkoutUrl` de Mercado Pago. |
| `POST /api/lead` | Guarda una solicitud del formulario de contacto. |
| `GET /api/order?id=...` | Estado de un pedido. |
| `POST /api/webhook` | Notificaciones de Mercado Pago. |

Hay límite de peticiones por IP: 20/minuto en el checkout, 10/minuto en los
leads y 30/minuto en la consulta de pedidos.

## 5. Mercado Pago

1. Crea la aplicación en el [panel de Mercado Pago](https://www.mercadopago.com.co/developers/panel/app).
2. Copia el **Access Token** a `MP_ACCESS_TOKEN`.
3. En *Tus integraciones → Webhooks*, apunta la URL de notificaciones a
   `https://TU-DOMAIN/api/webhook` y elige los eventos de pago.
4. Copia la **clave secreta** a `MP_WEBHOOK_SECRET`.
5. Prueba con usuarios de test y `MP_SANDBOX=true`; antes de cobrar de verdad,
   pon `MP_SANDBOX=false`.

La firma del webhook se valida con HMAC-SHA256 sobre el manifiesto
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y comparación en tiempo
constante. Una firma inválida recibe `401`; una válida, `200` y el pedido se
marca como pagado al confirmar el pago contra la API.

## 6. Catálogo

`data/catalog.json` es el catálogo local: 2.069 productos y 26 categorías.

```bash
node scripts/scrape.mjs                      # catálogo completo
node scripts/scrape.mjs --limit 40           # prueba rápida
node scripts/scrape.mjs --out data/otro.json # otro destino
node scripts/enrich.mjs                      # re-sanea el catálogo existente
node scripts/resolve-images.mjs             # rescata la URL buena de cada producto
node scripts/recover-catalog.mjs             # reconstruye el catálogo si se trunca
node scripts/use-webp.mjs data/catalog.json  # apunta las fotos a productos-webp
```

Ojo con `enrich.mjs` y `use-webp.mjs`: los dos escriben **atómicamente** (a un
`.tmp` y luego renombran), porque una versión anterior de `enrich.mjs` escribía
directo y dejó `data/catalog.json` truncado a la mitad de un campo. Si vuelve a
pasar, `recover-catalog.mjs` lo reconstruye desde el archivo truncado y
`data/search-index.json`.

El sitio anterior no tenía una taxonomía real: sus 151 "colecciones" son
landing pages de marketing con dos productos cada una. `scripts/lib/enrich.mjs`
define 22 categorías propias y las deduce del nombre del producto, por lo que
los nombres sin pistas como `ANGEL`, `GT` o `COMBO NOVA` quedan en *Otros
productos* (unos 282, 14,5 % del total). Conviene revisarlos a mano.

Las imágenes **ya están descargadas y convertidas a WebP**: 5.422 archivos en
`public/assets/img/productos-webp/` (unos 167 MB), que son los 2.711 originales
más su minatura `-400`. Las 2.266 imágenes distintas que referencia el catálogo
apuntan ahí, así que la tienda **no depende del CDN del sitio anterior**.

Las miniaturas pesan 17 KB frente a 45 KB de la imagen completa, así que las
tarjetas de los listados cargan la `-400` y el detalle del producto la completa
(un 64 % menos por producto). Los originales PNG/JPEG siguen en
`public/assets/img/productos/` (unos 864 MB) y ya no se usan: se pueden borrar
cuando ya no se necesiten.

El sitio anterior servía las imágenes desde `d1b50uin55dq3m.cloudfront.net` y
**corta el acceso a una IP tras unas 1.200 peticiones seguidas**: a partir de
ahí responde 403 a todo, incluso a imágenes que ya se habían descargado.
`mirror-images.mjs` lo detecta, para y guarda el progreso en
`data/mirror.json`; al volver a ejecutarlo continúa donde se quedó, sin
repetir lo ya bajado.

```bash
node scripts/resolve-images.mjs   # rescata la URL buena de cada producto
node scripts/mirror-images.mjs    # descarga (reanudable)
node scripts/mirror-images.mjs --dry-run     # ver qué se bajaría
node scripts/mirror-images.mjs --keep-remote # baja sin cambiar el catálogo
```

`resolve-images.mjs` lee la página de cada producto y se queda con la foto
grande. Hace falta porque **muchas URLs del sitio no llevan extensión**
(`.../filters:quality(80)/af2c811d-…`): si se filtran buscando `.png` o
`.webp`, el único resultado posible es el logo del sitio y todos los productos
acaban con la misma imagen.

## 7. Despliegue en Cloudflare

La tienda usa Pages para los archivos de `public/` y Pages Functions para la
API. El catálogo, los pedidos y los leads se guardan en D1; las imágenes que
subas desde el panel se guardan en ImageKit. El servidor Node queda para desarrollo
local. Sigue los pasos de [cloudflare/README.md](cloudflare/README.md), incluida
la importación inicial de `cloudflare/seed.sql`.

Antes de publicar, cambia en las páginas los textos provisionales
(`Desde 2018`, `12 cuotas`, garantías, condiciones de envío) por los datos
reales del negocio, y revisa que `PUBLIC_URL` apunte al dominio definitivo.

## 8. Comprobaciones

```bash
npm.cmd run check
```

Las páginas se pintan con JavaScript, así que que devuelvan `200` no prueba que
la navegación funcione. Este script la simula contra el catálogo real: comprueba
que cada `producto.html?slug=` resuelve a un único producto, que cada
`catalogo.html?c=` lista productos y que el contador de la categoría cuadra, que
la búsqueda encuentra resultados, que todo dato del catálogo llega escapado al
HTML, que ningún enlace interno apunta a un archivo inexistente y que **cada foto
referenciada existe en disco junto con su miniatura de tarjeta**.

## 9. Estructura

```
server/index.js            servidor local Node y API
functions/api/[[path]].js  API compatible con Cloudflare Pages Functions
cloudflare/migrations/     esquema para D1
cloudflare/seed.sql        carga inicial del catálogo para D1
cloudflare/README.md       configuración de Cloudflare Pages, D1 e ImageKit
public/                    páginas, CSS y JS del navegador
  assets/js/core.js        configuración, catálogo, carrito y tarjetas
data/catalog.json          catálogo local (2.069 productos)
data/orders.json           pedidos
data/leads.json            leads del formulario
public/assets/img/productos-webp/  fotos en WebP, con miniatura -400
scripts/scrape.mjs         extracción del catálogo
scripts/lib/enrich.mjs     marcas, limpieza de nombres y taxonomía
scripts/mirror-images.mjs  descarga de imágenes
scripts/resolve-images.mjs rescata la URL buena de cada producto
scripts/recover-catalog.mjs reconstruye el catálogo si el archivo se trunca
scripts/use-webp.mjs       apunta las rutas de imagen a productos-webp
scripts/check-links.mjs    comprobaciones de navegación, escapado e imágenes
```
