/**
 * Copia de los inmuebles de SIMI en archivos JSON, para la demo publicada en
 * GitHub Pages (que no puede correr el proxy PHP).
 *
 *   node api-proxy/simi-snapshot.mjs <carpeta-de-salida>
 *
 * En GitHub Actions el token llega por los secretos SIMI_BASE_URL, SIMI_TOKEN
 * y SIMI_INMOBILIARIA_ID; en este Mac, de config.php. Nunca se escribe el
 * token en los archivos de salida ni en la consola.
 *
 * Salida (la misma forma que devuelve el proxy, para que la página no cambie):
 *   inmuebles.json        todos los inmuebles publicados (tarjetas)
 *   destacados.json       los destacados de la portada
 *   detalle/<codigo>.json la ficha completa de cada inmueble (fotos, descripción)
 *   tipos.json, zonas.json, barrios.json, barrios-<zona>.json
 *   meta.json             fecha y hora de la copia
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSimiPath, crearClienteSimi, extractItems, int, leerConfigPhp, normalizeProperty, SIMI_CIUDAD_BOGOTA, TIPO_TO_SLUG } from './simi-core.mjs';

const salida = path.resolve(process.argv[2] ?? 'simi-data');
const LOTE = Number(process.env.SIMI_LOTE) || 24; // inmuebles por consulta a SIMI
const EN_PARALELO = 4; // fichas que se piden a la vez (SIMI es lento con más)

const config = process.env.SIMI_TOKEN
  ? { baseUrl: process.env.SIMI_BASE_URL, token: process.env.SIMI_TOKEN, inmobiliariaId: process.env.SIMI_INMOBILIARIA_ID }
  : leerConfigPhp(path.dirname(fileURLToPath(import.meta.url)));
if (!config.baseUrl || !config.token || !config.inmobiliariaId) {
  console.error('Faltan SIMI_BASE_URL, SIMI_TOKEN o SIMI_INMOBILIARIA_ID.');
  process.exit(1);
}
// La copia no tiene apuro: se espera más que en la página (SIMI a veces tarda).
const { simiGet, simiGetSafe } = crearClienteSimi(config, { timeoutMs: 60_000 });

const escribir = (archivo, datos) => {
  const destino = path.join(salida, archivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(datos));
};

const filtroTodos = (pagina, total) =>
  buildSimiPath('v21/filtroInmueble', {
    limite: pagina, total, departamento: 0, ciudad: 0, zona: 0, barrio: 0, tipoInm: 0, tipOper: 0,
    areamin: 0, areamax: 0, valmin: 0, valmax: 0, order: 'desc', campo: 'fecha',
    banios: 0, alcobas: 0, garajes: 0, sede: 0,
  });

async function enLotes(lista, n, fn) {
  const resultados = [];
  for (let i = 0; i < lista.length; i += n) resultados.push(...(await Promise.all(lista.slice(i, i + n).map(fn))));
  return resultados;
}

const inicio = Date.now();

// 1. Todos los inmuebles, de a LOTE.
const primera = await simiGet(filtroTodos(1, LOTE));
const total = int(primera.totalInmuebles);
const paginas = Math.max(1, Math.ceil(total / LOTE));
let inmuebles = extractItems(primera);
for (let p = 2; p <= paginas; p++) inmuebles.push(...extractItems(await simiGet(filtroTodos(p, LOTE))));
// Sin repetidos (SIMI a veces repite un inmueble entre páginas).
inmuebles = [...new Map(inmuebles.map((i) => [i.id, i])).values()];

// 2. La ficha de cada uno. Si una falla, el inmueble sigue en la lista sin ficha.
let fichas = 0;
await enLotes(inmuebles, EN_PARALELO, async (i) => {
  const raw = await simiGetSafe('v2/inmueble/codInmueble/' + encodeURIComponent(i.id));
  if (!raw) return;
  escribir(`detalle/${i.id}.json`, normalizeProperty(raw, true));
  fichas++;
});

// 3. Destacados (si SIMI no los tiene, los 6 más recientes, igual que el proxy).
const destacadosRaw = await simiGetSafe(buildSimiPath('v21/inmueblesDestacados', { limite: 1, cantidad: 24, sede: 0 }));
const destacados = destacadosRaw ? extractItems(destacadosRaw) : inmuebles.slice(0, 24);

// 4. Tipos, zonas y barrios (para los filtros).
const tiposRaw = await simiGet('v2/tipoInmuebles/unique/' + config.inmobiliariaId);
const tipos = [];
for (const t of Object.values(tiposRaw)) {
  const slug = TIPO_TO_SLUG[String(t?.idTipoInm ?? '')];
  if (slug) tipos.push({ slug, name: t.Nombre ?? slug, count: int(t.totalInmuebles) });
}
const zonas = ((await simiGet('zonas/idCiudad/' + SIMI_CIUDAD_BOGOTA)).zonas ?? []).map((z) => ({ id: int(z.id), name: z.nomZona }));
const barrios = Object.values(await simiGet(`v2/barrios/idCiudad/${SIMI_CIUDAD_BOGOTA}`)).map((b) => ({ id: int(b.id), name: b.nombre }));
await enLotes(zonas, EN_PARALELO, async (z) => {
  const raw = await simiGetSafe(`v2/barrios/idCiudad/${SIMI_CIUDAD_BOGOTA}/idZona/${z.id}`);
  escribir(`barrios-${z.id}.json`, { items: raw ? Object.values(raw).map((b) => ({ id: int(b.id), name: b.nombre })) : [] });
});

escribir('inmuebles.json', { items: inmuebles });
escribir('destacados.json', { items: destacados });
escribir('tipos.json', { items: tipos });
escribir('zonas.json', { items: zonas });
escribir('barrios.json', { items: barrios });
escribir('meta.json', { generado_en: new Date().toISOString(), inmuebles: inmuebles.length, fichas });

console.log(`Copia de SIMI lista: ${inmuebles.length} inmuebles, ${fichas} fichas, ${zonas.length} zonas, en ${Math.round((Date.now() - inicio) / 1000)} s.`);
