/** Pure formatting and geometry helpers (no DOM). */
import { splitAtAntimeridian } from './antimeridian';
import type { StacItem } from './types';

const EARTH_RADIUS_KM = 6371.0088;
const MERC = 20037508.342789244;

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Keep the start and the (distinctive) end of long product ids. */
export function shortId(id: string, max = 36): string {
  if (id.length <= max) return id;
  return `${id.slice(0, max - 13)}…${id.slice(-12)}`;
}

/** "2024-07-12T10:30:41.024Z" -> "2024-07-12 10:30Z"; unparseable input is returned unchanged. */
export function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/** An item's time: `datetime`, else its start/end range, else an em dash. */
export function formatItemDate(item: StacItem): string {
  const p = item.properties ?? {};
  if (typeof p.datetime === 'string') return formatIso(p.datetime);
  const start =
    typeof p.start_datetime === 'string' ? p.start_datetime.slice(0, 10) : '';
  const end =
    typeof p.end_datetime === 'string' ? p.end_datetime.slice(0, 10) : '';
  if (start || end) return `${start || '…'} – ${end || '…'}`;
  return '—';
}

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function cloudCover(item: StacItem): number | undefined {
  const v = item.properties?.['eo:cloud_cover'];
  return typeof v === 'number' ? v : undefined;
}

export type Bbox = [number, number, number, number];

export function geometryBbox(
  geom: GeoJSON.Geometry | null | undefined
): Bbox | null {
  if (!geom) return null;
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  if (geom.type === 'GeometryCollection')
    geom.geometries.forEach(g => visit((g as GeoJSON.Polygon).coordinates));
  else visit((geom as GeoJSON.Polygon).coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function unionBbox(boxes: Array<Bbox | null>): Bbox | null {
  const valid = boxes.filter((b): b is Bbox => b !== null);
  if (!valid.length) return null;
  return [
    Math.min(...valid.map(b => b[0])),
    Math.min(...valid.map(b => b[1])),
    Math.max(...valid.map(b => b[2])),
    Math.max(...valid.map(b => b[3]))
  ];
}

/** Exact area of a lon/lat box on a sphere. */
export function boxAreaKm2([w, s, e, n]: Bbox): number {
  const rad = Math.PI / 180;
  return (
    EARTH_RADIUS_KM ** 2 *
    Math.abs((e - w) * rad) *
    Math.abs(Math.sin(n * rad) - Math.sin(s * rad))
  );
}

/**
 * Area of a (Multi)Polygon on a sphere, holes subtracted — the ring formula
 * used by turf/area (Chamberlain & Duquette, JPL 07-03). Exact for boxes.
 */
export function geometryAreaKm2(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number {
  const rad = Math.PI / 180;
  const ringArea = (ring: number[][]): number => {
    let total = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      total += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
    }
    return Math.abs((total * EARTH_RADIUS_KM ** 2) / 2);
  };
  const polygonArea = (rings: number[][][]) =>
    rings.reduce(
      (sum, ring, i) => sum + (i === 0 ? ringArea(ring) : -ringArea(ring)),
      0
    );
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.reduce((sum, p) => sum + polygonArea(p), 0);
}

export function formatBbox(b: Bbox): string {
  return b.map(v => v.toFixed(3)).join(', ');
}

export function formatArea(km2: number): string {
  return km2 < 10
    ? `${km2.toFixed(2)} km²`
    : `${Math.round(km2).toLocaleString('en')} km²`;
}

/** <input type=date> value -> ISO instant at the start or end of that UTC day. */
export function dateInputToIso(
  value: string,
  endOfDay: boolean
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return `${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
}

export function isoToDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** lon/lat bbox -> EPSG:3857 extent, padded by `pad` of its size on each side. */
export function bboxTo3857([w, s, e, n]: Bbox, pad = 0.1): Bbox {
  const x = (lon: number) => (lon * MERC) / 180;
  const y = (lat: number) => {
    const c = Math.max(-85, Math.min(85, lat));
    return (
      (Math.log(Math.tan(((90 + c) * Math.PI) / 360)) / (Math.PI / 180)) *
      (MERC / 180)
    );
  };
  const [x0, y0, x1, y1] = [x(w), y(s), x(e), y(n)];
  // A minimum pad keeps a single point / tiny box from zooming in absurdly far.
  const dx = pad ? Math.max((x1 - x0) * pad, 1000) : 0;
  const dy = pad ? Math.max((y1 - y0) * pad, 1000) : 0;
  return [x0 - dx, y0 - dy, x1 + dx, y1 + dy];
}

/** Map features for items that have a geometry (null geometries are skipped). */
export function itemFeatures(items: StacItem[]): GeoJSON.Feature[] {
  return items
    .filter(i => i.geometry)
    .map(i => ({
      type: 'Feature' as const,
      id: i.id,
      geometry: splitAtAntimeridian(i.geometry as GeoJSON.Geometry),
      properties: { id: i.id }
    }));
}

export function selfHref(item: StacItem): string | undefined {
  return item.links?.find(l => l.rel === 'self')?.href;
}
