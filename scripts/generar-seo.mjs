/**
 * robots.txt y sitemap.xml para la carpeta publicada.
 *
 *   node scripts/generar-seo.mjs --salida dist --dominio https://www.reinmobiliariasas.com [--inmuebles simi-data/inmuebles.json]
 *   node scripts/generar-seo.mjs --salida sitio --dominio https://… --no-indexar     (demo de pruebas)
 *
 * El sitemap lista las páginas públicas y la ficha de cada inmueble (de la
 * copia de SIMI), para que Google las encuentre rápido. La demo de pruebas
 * pide no indexar nada, para no competir con el dominio oficial.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const valor = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const salida = path.resolve(valor('--salida') ?? 'dist');
const dominio = (valor('--dominio') ?? 'https://www.reinmobiliariasas.com').replace(/\/$/, '');
const indexar = !args.includes('--no-indexar');
const archivoInmuebles = valor('--inmuebles');

fs.mkdirSync(salida, { recursive: true });

if (!indexar) {
  fs.writeFileSync(path.join(salida, 'robots.txt'), '# Sitio de pruebas: no se indexa (el oficial es www.reinmobiliariasas.com).\nUser-agent: *\nDisallow: /\n');
  fs.rmSync(path.join(salida, 'sitemap.xml'), { force: true });
  console.log('robots.txt de pruebas (no indexar).');
  process.exit(0);
}

fs.writeFileSync(
  path.join(salida, 'robots.txt'),
  [
    'User-agent: *',
    'Allow: /',
    '# Áreas privadas y páginas sin valor para buscadores',
    'Disallow: /panel-interno',
    'Disallow: /favoritos',
    'Disallow: /gracias',
    'Disallow: /manual',
    '',
    `Sitemap: ${dominio}/sitemap.xml`,
    '',
  ].join('\n'),
);

const hoy = new Date().toISOString().slice(0, 10);
const paginas = [
  ['/', 'daily', '1.0'],
  ['/inmuebles', 'daily', '0.9'],
  ['/inmuebles?operation=arriendo', 'daily', '0.8'],
  ['/inmuebles?operation=venta', 'daily', '0.8'],
  ['/servicios/arriendos', 'monthly', '0.8'],
  ['/servicios/asesoria', 'monthly', '0.8'],
  ['/mantenimientos', 'monthly', '0.5'],
  ['/politica-privacidad', 'yearly', '0.2'],
  ['/terminos-y-condiciones', 'yearly', '0.2'],
].map(([ruta, frecuencia, prioridad]) => ({ ruta, frecuencia, prioridad }));

let inmuebles = 0;
if (archivoInmuebles && fs.existsSync(archivoInmuebles)) {
  const { items } = JSON.parse(fs.readFileSync(archivoInmuebles, 'utf8'));
  for (const i of items) paginas.push({ ruta: `/inmuebles/${encodeURIComponent(i.id)}`, frecuencia: 'weekly', prioridad: '0.7' });
  inmuebles = items.length;
}

const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
fs.writeFileSync(
  path.join(salida, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paginas
    .map((p) => `  <url><loc>${xml(dominio + p.ruta)}</loc><lastmod>${hoy}</lastmod><changefreq>${p.frecuencia}</changefreq><priority>${p.prioridad}</priority></url>`)
    .join('\n')}\n</urlset>\n`,
);
console.log(`robots.txt y sitemap.xml: ${paginas.length} direcciones (${inmuebles} inmuebles).`);
