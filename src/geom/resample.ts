import { dist, lerp, type Vec2 } from './vec2';

/** Resample a closed polyline to `n` points evenly spaced by arc length. */
export function resampleClosed(pts: Vec2[], n: number): Vec2[] {
  const m = pts.length;
  if (m === 0 || n <= 0) return [];
  if (m === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));

  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) cum[i + 1] = cum[i] + dist(pts[i], pts[(i + 1) % m]);
  const total = cum[m];
  if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));

  const out: Vec2[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * total) / n;
    while (seg < m - 1 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    out.push(lerp(pts[seg], pts[(seg + 1) % m], t));
  }
  return out;
}
