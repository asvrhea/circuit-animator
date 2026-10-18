import type { Vec2 } from './vec2';

export interface LonLat {
  lon: number;
  lat: number;
}

const R = 6378137; // WGS84 equatorial radius, as used by Web Mercator
const MAX_LAT = 85.05112878;

/** Web Mercator (EPSG:3857) in metres, y pointing north. */
export function mercator({ lon, lat }: LonLat): Vec2 {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return { x: (R * lon * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + phi / 2)) };
}

export function inverseMercator({ x, y }: Vec2): LonLat {
  return { lon: ((x / R) * 180) / Math.PI, lat: ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI };
}

/** Great-circle distance in metres. */
export function haversine(a: LonLat, b: LonLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Project to screen-style coordinates (y down) in Mercator metres. */
export const projectScreen = (pts: LonLat[]): Vec2[] =>
  pts.map((p) => {
    const m = mercator(p);
    return { x: m.x, y: -m.y };
  });
