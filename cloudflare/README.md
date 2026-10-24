# Publicar La Tienda de Alex en Cloudflare Pages

El servidor `server/index.js` sirve para desarrollo local. Cloudflare Pages ejecuta las funciones de `functions/`; D1 guarda los productos, pedidos y solicitudes, e ImageKit entrega y recibe las imágenes:

- **D1 (`DB`)**: los 2.069 productos del catálogo como registros JSON, sus metadatos, pedidos y solicitudes.
- **ImageKit**: imágenes existentes en la carpeta `/Latiendadealex` y fotos subidas desde `/admin.html`. El catálogo conserva los nombres de archivo y las funciones construyen sus URLs públicas.

No se escriben datos permanentes en el disco local de Cloudflare.

## Preparar el proyecto

1. Sube el proyecto a GitHub y crea un proyecto de **Cloudflare Pages conectado a Git**. Usa la raíz del repositorio, deja vacío el comando de compilación y define `public` como directorio de salida. La integración Git es necesaria porque este proyecto usa Pages Functions; la carga directa desde el panel de Cloudflare no compila la carpeta `functions`.
   `.gitignore` excluye `public/assets/img/productos-webp/` para que no se añadan las fotos al repositorio. Si ya las habías confirmado en Git, primero confirma que ImageKit recibió todos los nombres originales y después quítalas del índice sin borrarlas del equipo con `git rm --cached -r public/assets/img/productos-webp`.
2. En Cloudflare, crea una base D1. Las imágenes se guardan en tu Media Library de ImageKit.
3. En el proyecto Pages, abre **Settings → Functions → Bindings** y vincula la base D1 con el nombre exacto `DB`.
4. Ejecuta las migraciones y carga inicial desde la raíz del proyecto, reemplazando `NOMBRE_D1` por el nombre real de tu base:

   ```powershell
   npx wrangler d1 execute NOMBRE_D1 --remote --file=cloudflare/migrations/0001_schema.sql
   npx wrangler d1 execute NOMBRE_D1 --remote --file=cloudflare/migrations/0002_accounts.sql
   npx wrangler d1 execute NOMBRE_D1 --remote --file=cloudflare/migrations/0003_account_usernames.sql
   node scripts/export-cloudflare-seed.mjs
   npx wrangler d1 execute NOMBRE_D1 --remote --file=cloudflare/seed.sql
   ```

   La carga inicial importa el catálogo actual. Vuelve a generarla solo si quieres sobrescribir D1 con el JSON que tengas en `data/catalog.json`.
5. En **Settings → Variables and Secrets**, configura para producción:
   - `GOOGLE_SESSION_SECRET` (recomendable): una cadena aleatoria larga para firmar sesiones. Si no la configuras, la primera vez se genera una y se guarda en D1, así el panel sigue funcionando en los siguientes despliegues.
   - `ADMIN_PASSWORD` (opcional): contraseña de respaldo para el panel. Si no la defines, al abrir `admin.html` por primera vez crearás una cuenta de administrador que queda guardada en D1 y sigue funcionando aunque vuelvas a publicar el sitio.
   - `GOOGLE_CLIENT_ID`: el ID de cliente de Google de la tienda.
   - `APPLE_CLIENT_ID`: Service ID de Apple Developer para activar el acceso con Apple.
   - `MICROSOFT_CLIENT_ID`: Application (client) ID de Microsoft Entra para activar ese acceso.
   - `PUBLIC_URL`: la URL pública del sitio, incluyendo `https://`.
   - `IMAGEKIT_URL_ENDPOINT`: `https://ik.imagekit.io/eayqxn9lnz` (ya está como valor predeterminado en el código).
   - `IMAGEKIT_FOLDER`: `/Latiendadealex` (la carpeta del enlace que compartiste).
   - `IMAGEKIT_PRIVATE_KEY`: la clave privada de ImageKit como **Secret**. Se usa solo desde Pages Functions para subir imágenes; nunca la pongas en JavaScript ni la envíes por el chat.
   - `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` si vas a cobrar con Mercado Pago.
   - Opcionales: `STORE_NAME`, `STORE_WHATSAPP` (predeterminado: `573124885850`), `STORE_EMAIL`, `STORE_ADDRESS`, `FREE_SHIPPING_FROM`, `SHIPPING_FLAT`, `MP_SANDBOX`, `MP_INSTALLMENTS`.
6. Autoriza el dominio público en Google Identity Services y registra `https://TU-DOMINIO/continuar-google.html` como URL de retorno en Apple y Microsoft cuando configures esos proveedores. Para desarrollo local, usa también `http://localhost:3000/continuar-google.html`. Configura el webhook de Mercado Pago para apuntar a `https://TU-DOMINIO/api/webhook`.
7. Vuelve a desplegar Pages para que las funciones reciban los enlaces y variables.

El panel queda en `https://TU-DOMINIO/admin.html`. La primera vez crea tu cuenta de administrador (queda en D1, no en el código) y entra con ella; D1 conserva el catálogo y las cuentas, e ImageKit conserva las fotos después de nuevos despliegues. Al subir una foto, el navegador le quita el fondo y la centra sobre la plantilla antes de guardarla.

## Regla de precios

Los precios se calculan a partir del **Costo** (lo que pagas). En el panel escribes el costo y el precio de **contado** y de **crédito** se calculan solos (esos dos campos son de solo lectura). La misma regla está en `server/index.js`, `functions/api/[[path]].js`, `public/assets/js/admin.js` y `scripts/apply-pricing.mjs`; si la cambias, actualiza las cuatro copias.

| Costo (pesos) | Contado | Crédito |
| --- | --- | --- |
| Menos de 200.000 | ×2 | ×2 |
| 200.000 – 499.999 | +35% | +40% |
| 500.000 – 1.499.999 | +30% | +40% |
| 1.500.000 o más | +20% | +30% |

El resultado se redondea a la centena.

Para recalcular todo el catálogo con esta regla (por ejemplo, tras cambiar los tramos), ejecuta:

```
npm run pricing
```

Recotiza `data/catalog.json` usando el costo guardado de cada producto (si aún no tiene, toma su precio de contado actual) y deja un respaldo en `data/catalog.before-pricing.json`. Después hay que llevar los precios nuevos a producción: D1 no lee `data/catalog.json`, así que regenera el seed y vuelve a importarlo.

```
npm run cloudflare:seed
npx wrangler d1 execute NOMBRE_D1 --remote --file=cloudflare/seed.sql
```

## Desarrollo local de Pages

Usa Wrangler con un enlace D1 local. Define las variables locales en `.dev.vars` (no la subas a Git); no reutilices secretos reales en datos de prueba.

La API de Pages está en `functions/api/[[path]].js`. ImageKit guarda las fotos nuevas y entrega las que ya están en `/Latiendadealex`.
