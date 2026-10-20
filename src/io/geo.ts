import { haversine, projectScreen, type LonLat } from '../geom/projection';
import { rdp, rdpClosed } from '../geom/simplify';
import type { Vec2 } from '../geom/vec2';

/**
 * KML / GPX parsing with plain regexes, so it runs in Node tests without a DOM.
 * Google My Maps exports are simple enough for this.
 */

const num = (s: string | undefined): number => (s === undefined ? NaN : Number(s));
const valid = (p: LonLat): boolean => Number.isFinite(p.lon) && Number.isFinite(p.lat);

/** All <coordinates> blocks; returns the one with the most points. */
export function parseKml(text: string): LonLat[] {
  let best: LonLat[] = [];
  for (const m of text.matchAll(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi)) {
    const pts = m[1]
      .trim()
      .split(/\s+/)
      .map((t) => {
        const [lon, lat] = t.split(',');
        return { lon: num(lon), lat: num(lat) };
      })
      .filter(valid);
    if (pts.length > best.length) best = pts;
  }
  return best;
}

/** Track points if present, else route points. */
export function parseGpx(text: string): LonLat[] {
  const read = (tag: string): LonLat[] =>
    [...text.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))]
      .map((m) => ({
        lat: num(/\blat\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1]),
        lon: num(/\blon\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1]),
      }))
      .filter(valid);
  const trk = read('trkpt');
  return trk.length ? trk : read('rtept');
}

export function parseGeoFile(name: string, text: string): LonLat[] {
  return /\.gpx$/i.test(name) || /<gpx[\s>]/i.test(text) ? parseGpx(text) : parseKml(text);
}

export interface GeoTrack {
  /** control points in map units (Web Mercator metres, y down) */
  controls: Vec2[];
  /** real lap length from the coordinates */
  lengthKm: number;
  /** ground metres per map unit at the track */
  mpu: number;
  /** bounding box size in map units */
  width: number;
  height: number;
  /** true when the line's ends are far apart: a point-to-point rally stage */
  open: boolean;
}

/** Ends further apart than this share of the route (and 50 m) make it a point-to-point stage. */
const OPEN_GAP_SHARE = 0.05;

/**
 * Project lon/lat into map units, drop a duplicated closing point, and thin
 * to at most `maxControls` editable points. A line whose ends are far apart
 * is kept open (rally stage) instead of being closed into a circuit.
 */
export function geoToTrack(pts: LonLat[], maxControls = 120): GeoTrack {
  let ll = pts.slice();
  // a line that comes back to its first point is a circuit, whatever its shape
  const returnsToStart = ll.length > 2 && haversine(ll[0], ll[ll.length - 1]) < 1;
  if (returnsToStart) ll = ll.slice(0, -1);
  if (ll.length < 3) throw new Error('The file needs at least 3 points on one line.');

  let openM = 0;
  for (let i = 0; i + 1 < ll.length; i++) openM += haversine(ll[i], ll[i + 1]);
  const gapM = haversine(ll[0], ll[ll.length - 1]);
  const open = !returnsToStart && gapM > Math.max(50, OPEN_GAP_SHARE * openM);
  const lengthM = open ? openM : openM + gapM;

  const units = projectScreen(ll);
  const xs = units.map((p) => p.x), ys = units.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const lat = ll.reduce((s, p) => s + p.lat, 0) / ll.length;
  const mpu = Math.cos((lat * Math.PI) / 180);

  // ~2 m: the spline through the kept points stays visually exact, and dense
  // GPS sampling becomes a comfortable number of editable points.
  const simplify = open ? rdp : rdpClosed;
  let controls = simplify(units, 2 / mpu);
  for (let eps = 3 / mpu; controls.length > maxControls; eps *= 1.6) controls = simplify(units, eps);
  return { controls, lengthKm: lengthM / 1000, mpu, width: w || 1, height: h || 1, open };
}
