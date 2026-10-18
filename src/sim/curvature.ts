import type { Vec2 } from '../geom/vec2';

/**
 * Unsigned curvature (1 / path units) at each point of a closed, evenly
 * sampled path. Uses the circle through p[i-k], p[i], p[i+k] (Menger
 * curvature) so sampling noise on a near-straight doesn't read as a corner,
 * then a small moving average.
 */
export function curvatureClosed(path: Vec2[], k = 2, smooth = 2): Float64Array {
  const n = path.length;
  const raw = new Float64Array(n);
  if (n < 3) return raw;
  const kk = Math.max(1, Math.min(k, Math.floor((n - 1) / 2)));
  for (let i = 0; i < n; i++) {
    const a = path[(i - kk + n) % n], b = path[i], c = path[(i + kk) % n];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const den = ab * bc * ca;
    raw[i] = den > 1e-12 ? (2 * area2) / den : 0;
  }
  if (smooth <= 0) return raw;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -smooth; j <= smooth; j++) s += raw[(i + j + n) % n];
    out[i] = s / (2 * smooth + 1);
  }
  return out;
}

/** Segment lengths of a closed path: seg[i] = |p[i+1] - p[i]| (wrapping). */
export function segmentLengths(path: Vec2[]): Float64Array {
  const n = path.length;
  const seg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = path[i], b = path[(i + 1) % n];
    seg[i] = Math.hypot(b.x - a.x, b.y - a.y);
  }
  return seg;
}
