/**
 * Lógica compartida de SIMI: cómo se le pide a la API y cómo se normaliza cada
 * inmueble. La usan el proxy de desarrollo (dev-proxy.mjs) y la actualización
 * automática de la demo en GitHub (simi-snapshot.mjs). Es la misma
 * normalización de simi-proxy.php: si cambias una, cambia la otra.
 *
 * Este archivo no tiene ninguna clave: el token llega desde config.php (local)
 * o desde un secreto de GitHub (variables de entorno).
 */
import fs from 'node:fs';
import path from 'node:path';

export const PAGE_SIZE = 12;
export const SIMI_CIUDAD_BOGOTA = 11001;

export const GESTION_TO_OPERATION = { 1: 'arriendo', 2: 'arriendo_venta', 5: 'venta' };
export const OPERATION_TO_GESTION = { arriendo: '1', venta: '5' };
export const TIPO_TO_SLUG = {
  1: 'apartamento', 2: 'casa', 4: 'oficina', 5: 'local', 6: 'bodega', 7: 'lote',
  8: 'finca', 10: 'edificio', 11: 'apartaestudio', 20: 'casa_comercial', 22: 'casa_residencial',
};
export const SLUG_TO_TIPO = Object.fromEntries(Object.entries(TIPO_TO_SLUG).map(([k, v]) => [v, k]));
export const ESTADO_TO_STATUS = { 2: 'disponible' };
export const CACHE_TTL = { list: 120, featured: 300, detail: 300, types: 86400, zones: 86400, neighborhoods: 86400 };


/** Lee simi_base_url / simi_token / simi_inmobiliaria_id de config.php (fuera de git). */
export function leerConfigPhp(dir) {
  const configSrc = fs.readFileSync(path.join(dir, 'config.php'), 'utf8');
  const readKey = (key) => {
    const m = configSrc.match(new RegExp(`['"]${key}['"]\\s*=>\\s*(?:['"]([^'"]*)['"]|(\\d+))`));
    return m ? (m[1] ?? m[2]) : undefined;
  };
  return { baseUrl: readKey('simi_base_url'), token: readKey('simi_token'), inmobiliariaId: readKey('simi_inmobiliaria_id') };
}

// --- helpers ----------------------------------------------------------------
export class HttpError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

/** Cliente de la API de SIMI con la configuración dada. */
export function crearClienteSimi(config, { timeoutMs = 15000 } = {}) {
  const authHeader = 'Basic ' + Buffer.from(`Authorization:${config.token}`).toString('base64');

async function simiFetch(p) {
  const url = config.baseUrl.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '');
  const res = await fetch(url, { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let decoded;
  try { decoded = JSON.parse(text); } catch { return { bad: 'parse' }; }
  if (decoded === null || typeof decoded !== 'object') return { bad: 'parse' };
  if (decoded.Error !== undefined && decoded.Error !== '0') return { bad: 'simi', detail: decoded.mensaje ?? null };
  return { data: decoded };
}

async function simiGet(p) {
  let r;
  try { r = await simiFetch(p); } catch (e) { throw new HttpError(502, 'No se pudo contactar la API de SIMI.', { detail: String(e.message) }); }
  if (r.bad === 'parse') throw new HttpError(502, 'La API de SIMI devolvió una respuesta no interpretable.');
  if (r.bad === 'simi') throw new HttpError(502, 'SIMI reportó un error interno procesando la solicitud.', { detail: r.detail });
  return r.data;
}

async function simiGetSafe(p) {
  try { const r = await simiFetch(p); return r.data ?? null; } catch { return null; }
}

  return { simiGet, simiGetSafe, inmobiliariaId: config.inmobiliariaId };
}

export const cleanImageUrl = (url) => (url ? url.replace(/(=s\d+)(?:=s\d+)+$/, '$1') : null);
export const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const clean = String(v).replace(/[,$ ]/g, '');
  return clean !== '' && !isNaN(Number(clean)) ? Number(clean) : null;
};
export const str = (v) => String(v ?? '').trim();
export const int = (v) => parseInt(v ?? 0, 10) || 0;
export const num = (v) => parseFloat(v ?? 0) || 0;

export function normalizeProperty(raw, isDetail) {
  const gestion = String(raw.idGestion ?? raw.IdGestion ?? raw.id_gestion ?? '');
  const tipo = String(raw.idTipoInmueble ?? raw.IdTpInm ?? raw.id_tipo_inmueble ?? '');
  const estado = String(raw.idEstado ?? raw.idEstadoInmueble ?? '');
  const operation = GESTION_TO_OPERATION[gestion] ?? null;
  const isVenta = operation === 'venta' || operation === 'arriendo_venta';
  const price = toNumber(isVenta ? (raw.ValorVenta ?? raw.Venta) : (raw.ValorCanon ?? raw.Canon));

  const images = isDetail && Array.isArray(raw.fotos)
    ? raw.fotos.map((f) => ({ url: cleanImageUrl(f.foto ?? '') ?? '', position: int(f.posi) }))
    : [];
  const cover = images[0]?.url ?? cleanImageUrl(raw.foto1 ?? null);

  let advisor = null;
  if (isDetail && raw.asesor?.[0]) {
    const a = raw.asesor[0];
    advisor = { name: a.ntercero ?? '', phone: a.celular || (a.fijo ?? ''), email: a.correo ?? '' };
  }
  let portals = null;
  if (isDetail && Array.isArray(raw.portales?.data) && raw.portales.data.length) {
    portals = raw.portales.data.map((p) => ({ name: p.nombrePortal ?? '', status: p.codigoPortal ?? '', url: p.urlPortal ?? null }));
  }
  let features = null;
  if (isDetail) {
    const pick = (g) => (Array.isArray(g) ? g.map((c) => str(c.Descripcion)).filter(Boolean) : []);
    features = {
      internal: pick(raw.caracteristicasInternas),
      external: pick(raw.caracteristicasExternas),
      surroundings: pick(raw.caracteristicasAlrededores),
    };
  }
  const lat = raw.latitud, lng = raw.longitud;

  return {
    id: String(raw.Codigo_Inmueble ?? raw.idInm ?? ''),
    operation,
    propertyType: TIPO_TO_SLUG[tipo] ?? null,
    typeLabel: str(raw.Tipo_Inmueble ?? raw.tpinmu),
    price,
    pricePeriod: isVenta ? null : 'mes',
    bedrooms: int(raw.Alcobas ?? raw.alcobas),
    bathrooms: int(raw.banios ?? raw.banos),
    parking: int(raw.garaje),
    areaBuilt: num(raw.AreaConstruida),
    areaLot: raw.AreaLote !== undefined && raw.AreaLote !== null ? num(raw.AreaLote) : null,
    stratum: raw.Estrato !== undefined && raw.Estrato !== null ? int(raw.Estrato) : null,
    city: str(raw.Ciudad ?? raw.nciudad ?? raw.ciudad),
    zone: str(raw.Zona ?? raw.NombreZ ?? raw.zona),
    neighborhood: str(raw.Barrio ?? raw.NombreB ?? raw.barrio),
    locality: isDetail ? str(raw.nlocalidad) : null,
    address: isDetail ? (raw.Direccion ?? null) : null,
    coordinates: lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null,
    coverImage: cover,
    images,
    description: raw.descripcionlarga ?? null,
    status: ESTADO_TO_STATUS[estado] ?? 'desconocido',
    isNew: false,
    advisor,
    portals,
    features,
  };
}

export const extractItems = (raw) =>
  Object.values(raw).filter((v) => v && typeof v === 'object' && v.Codigo_Inmueble !== undefined).map((v) => normalizeProperty(v, false));

export const buildSimiPath = (endpoint, params) =>
  [endpoint, ...Object.entries(params).flatMap(([k, v]) => [k, String(v)])].join('/') + '/';
