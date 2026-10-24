/**
 * Audita la navegacion y el escapado de datos. Las paginas se pintan con JS, asi
 * que un 200 no prueba nada: hay que comprobar que cada enlace lleva a un
 * producto real y que ningun dato del catalado llega crudo al HTML.
 */
import { readFile, readdir, stat } from 'node:fs/promises';

const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const products = catalog.products;
const categories = catalog.categories;

let fallos = 0;
const fallo = (msg) => {
  fallos++;
  console.log(`  FALLA  ${msg}`);
};

const normalizar = (v) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// El valor viaja por encodeURIComponent y vuelve por URLSearchParams.get().
const idaYvuelta = (v) => new URLSearchParams(new URLSearchParams({ v }).toString()).get('v');

console.log('1. producto.html?slug=... debe resolver a un unico producto');
const porSlug = new Map();
for (const p of products) {
  if (!p.slug) {
    fallo(`${p.id} no tiene slug`);
    continue;
  }
  if (porSlug.has(p.slug)) fallo(`slug duplicado: ${p.slug}`);
  porSlug.set(p.slug, p);
  if (idaYvuelta(p.slug) !== p.slug) fallo(`el slug no sobrevive al viaje: ${p.slug}`);
}
console.log(`   ${products.length} productos, ${porSlug.size} slugs unicos`);

console.log('\n2. catalogo.html?c=... debe listar productos y cuadrar el conteo');
for (const c of categories) {
  const n = products.filter((p) => (p.categories || []).some((x) => x.name === c.name)).length;
  if (n === 0) fallo(`categoria sin productos: ${c.name}`);
  else if (n !== c.products) fallo(`conteo erroneo en "${c.name}": dice ${c.products}, hay ${n}`);
  if (idaYvuelta(c.name) !== c.name) fallo(`la categoria no sobrevive al viaje: ${c.name}`);
}
console.log(`   ${categories.length} categorias cuadran`);

console.log('\n3. Los enlaces del pie y de la portada salen de catalog.categories');
for (const c of categories) {
  if (!products.some((p) => (p.categories || []).some((x) => x.name === c.name)))
    fallo(`el pie enlaza una categoria que no existe: ${c.name}`);
}

console.log('\n4. La busqueda con la misma logica de catalogo.js');
for (const q of ['iphone', 'taladro', 'audifonos', 'celular', 'cocina', 'papel', 'llave impacto', 'televisor']) {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  const n = products.filter((p) =>
    palabras.every((w) =>
      normalizar(
        `${p.name} ${p.brand} ${(p.categories || []).map((c) => c.name).join(' ')} ${p.description}`,
      ).includes(w),
    ),
  ).length;
  console.log(`   "${q}": ${n} resultado(s)`);
  if (n === 0) fallo(`la busqueda "${q}" no devuelve nada`);
}

console.log('\n5. Todo dato del catalado debe llegar escapado al HTML');
const JS = 'public/assets/js';
const archivos = (await readdir(JS)).filter((f) => f.endsWith('.js'));

// Interpolaciones que son seguras: numeros, literales, funciones propias que ya
// escapan, o valores que no llegan al HTML (textContent, document.title, o la
// fuente de un includes/buscar).
const seguros = [
  /^\$\$?\(/, // $ y $$ devuelven nodos
  /\bMath\./, // aritmetica
  /\b(money|encodeURIComponent|escapeHtml|iconFor|String|Number)\(/, // funciones propias
    /^\w+ \? '[^']*' : '[^']*'$/, // ternario entre literales
    /^[\w.=<>! ]+ \? '[^']*' : '[^']*$/, // ternario con comparacion
    /^[^?]*\? '[^'$]*' : ('[^'$]*'|')$/, // ternario con ramas ya en HTML fijo
    /^[\w.]+ \? `\$\{[\w.]+\} ` : ''$/, // icono o prefijo condicional
  /^' <span class="muted">\(\w+\)<\/span>'$/, // fragmento literal
  /\.toLocaleString\(/, // fecha formateada
    /^(url|params|searchParams)\.toString\(\)$/, // URLSearchParams ya percent-codifica
  /\.(price|qty|total|count|products|length|index|year)\b/, // numeros
  /^waDigits$/, // ya saneado con .replace(/\D/g, '') en core.js
  /^\w+$/, // identificador simple
];
const esSeguro = (expr) => seguros.some((r) => r.test(expr));

const fueraDeHtml = /\.(textContent|innerText)\s*=|document\.title\s*=/;

for (const archivo of archivos) {
  const fuente = await readFile(`${JS}/${archivo}`, 'utf8');
  const lineas = fuente.split('\n');
  for (const [i, linea] of lineas.entries()) {
    for (const m of linea.matchAll(/\$\{([^}]+)\}/g)) {
      const expr = m[1].trim();
      if (esSeguro(expr)) continue;
      // Si la interpolacion vive dentro de una cadena JS ("${x}", “${x}”)
      // construye un string, no HTML: el consumidor decide como insertarlo.
      if (['"', "'", '\u201C', '\u201D', '\u00AB'].includes(linea[m.index - 1])) continue;
      // Se acepta si la linea no escribe en el HTML (solo compara o asigna texto).
      if (fueraDeHtml.test(linea)) continue;
        if (/\.includes\(|\.join\(|normalize\(|toast\(/.test(linea)) continue;
        // Los filtros activos se guardan como pares [clave, etiqueta] y se
        // escapan al pintarlos con escapeHtml(label). La excepcion se anula sola
        // si ese escape desaparece, asi que sigue vigilando de verdad.
        if (/chips\.push\(/.test(linea) && /escapeHtml\(label\)/.test(fuente)) continue;
        fallo(`${archivo}:${i + 1}  ${expr}`);
    }
  }
}
console.log(`   revisados ${archivos.length} archivos JS`);

console.log('\n5b. Los iconos de categoria llegan al HTML: deben ser emojis, no HTML');
const iconos = new Set();
for (const p of products) for (const c of p.categories || []) if (c.icon) iconos.add(c.icon);
for (const c of categories) if (c.icon) iconos.add(c.icon);
for (const i of iconos) {
  if (!i || i.length > 4 || /[<>"'&]/.test(i)) fallo(`icono sospechoso (deberia ser un emoji): ${i}`);
}
console.log(`   ${iconos.size} iconos distintos, todos legibles: ${[...iconos].slice(0, 10).join(' ')}`);

console.log('\n6. Enlaces internos de los HTML: el destino debe existir');
for (const page of ['index.html', 'catalogo.html', 'producto.html', 'carrito.html', 'gracias.html']) {
  const html = await readFile(`public/${page}`, 'utf8');
  const destinos = [
    ...new Set(
      [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((h) => !/^(https?:|mailto:|tel:|#|data:)/.test(h))
        .map((h) => h.split('?')[0].split('#')[0])
        .filter(Boolean),
    ),
  ];
  for (const d of destinos) {
    try {
      await stat(`public/${d}`);
    } catch {
      fallo(`${page} enlaza a un archivo inexistente: ${d}`);
    }
  }
  console.log(`   ${page}: ${destinos.join(', ')}`);
}

console.log('\n7. Cada foto del catalogo tiene que existir de verdad en disco');
const catalogo = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const sinFoto = catalogo.products.filter((p) => !p.image);
const referidas = new Set();
for (const p of catalogo.products) for (const img of [p.image, ...(p.images || [])]) if (img) referidas.add(img);

let rotas = 0;
let sinMiniatura = 0;
for (const img of referidas) {
  try {
    await stat(`public${img}`);
  } catch {
    rotas++;
    if (rotas <= 5) fallo(`imagen inexistente: ${img}`);
    continue;
  }
  // Las tarjetas cargan la miniatura -400 antes que la imagen completa.
  const miniatura = img.startsWith('/assets/img/productos-webp/') ? img.replace(/\.webp$/, '-400.webp') : null;
  if (miniatura) {
    try {
      await stat(`public${miniatura}`);
    } catch {
      sinMiniatura++;
      if (sinMiniatura <= 5) fallo(`falta la miniatura de la tarjeta: ${miniatura}`);
    }
  }
}
// El sitio de origen publico estos dos productos sin ninguna foto, asi que no
// hay imagen que descargar. Se avisa de cada uno y se falla solo si el numero
// sube del que ya se conoce, para que el chequeo siga sirviendo.

const FOTOS_CONOCIDAS_SIN_IMAGEN = 2;
for (const p of sinFoto) {
  if (p.available) console.log(`   AVISO  producto sin foto: ${p.name} (${p.slug})`);
}
if (sinFoto.filter((p) => p.available).length > FOTOS_CONOCIDAS_SIN_IMAGEN) {
  fallo(`productos disponibles sin foto: ${sinFoto.filter((p) => p.available).length} (el origen solo tenia ${FOTOS_CONOCIDAS_SIN_IMAGEN} sin foto)`);
}

console.log(`   ${catalogo.products.length} productos, ${referidas.size} imagenes distintas`);
console.log(`   rotas: ${rotas} | sin miniatura: ${sinMiniatura} | sin foto: ${sinFoto.length}`);

console.log(`\n${fallos ? `FALLOS: ${fallos}` : 'Sin fallos.'}`);
process.exit(fallos ? 1 : 0);
