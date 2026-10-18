import { haversine, projectScreen, type LonLat } from '../geom/projection';
import { rdpClosed } from '../geom/simplify';
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
  /** control points in a box of `size` x `size` px (plus margin) */
  controls: Vec2[];
  size: number;
  /** real lap length from the coordinates */
  lengthKm: number;
}

/**
 * Project lon/lat to a square pixel space, drop a duplicated closing point,
 * and thin to at most `maxControls` editable points.
 */
export function geoToTrack(pts: LonLat[], size = 1000, maxControls = 120): GeoTrack {
  let ll = pts.slice();
  if (ll.length > 2 && haversine(ll[0], ll[ll.length - 1]) < 1) ll = ll.slice(0, -1);
  if (ll.length < 3) throw new Error('The file needs at least 3 points on one line.');

  let lengthM = 0;
  for (let i = 0; i < ll.length; i++) lengthM += haversine(ll[i], ll[(i + 1) % ll.length]);

  const m = projectScreen(ll);
  const xs = m.map((p) => p.x), ys = m.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const margin = size * 0.08;
  const k = (size - 2 * margin) / span;
  const px = m.map((p) => ({ x: margin + (p.x - minX) * k, y: margin + (p.y - minY) * k }));

  // 2px in a 1000px box: the spline through the kept points stays visually exact,
  // and dense GPS sampling becomes a comfortable number of editable points.
  let controls = rdpClosed(px, 2);
  for (let eps = 3; controls.length > maxControls; eps *= 1.6) controls = rdpClosed(px, eps);
  return { controls, size, lengthKm: lengthM / 1000 };
}
