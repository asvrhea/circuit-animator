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

/** Curvature of an open path: the window is clamped at the ends instead of wrapping. */
export function curvatureOpen(path: Vec2[], k = 2, smooth = 2): Float64Array {
  const n = path.length;
  const raw = new Float64Array(n);
  if (n < 3) return raw;
  for (let i = 0; i < n; i++) {
    const kk = Math.max(1, Math.min(k, i, n - 1 - i));
    if (i - kk < 0 || i + kk > n - 1) continue; // endpoints: no turn measured
    const a = path[i - kk], b = path[i], c = path[i + kk];
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
    const lo = Math.max(0, i - smooth), hi = Math.min(n - 1, i + smooth);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += raw[j];
    out[i] = s / (hi - lo + 1);
  }
  return out;
}

/** Segment lengths of an open path: seg[i] = |p[i+1] - p[i]|, n - 1 entries. */
export function segmentLengthsOpen(path: Vec2[]): Float64Array {
  const seg = new Float64Array(Math.max(0, path.length - 1));
  for (let i = 0; i < seg.length; i++) seg[i] = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  return seg;
}
