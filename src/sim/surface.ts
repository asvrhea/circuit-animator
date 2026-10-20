/**
 * Road surfaces. Gravel stretches are stored as ranges of track-length
 * fraction [from, to] (0..1, from < to, sorted, non-overlapping); everything
 * else is tarmac. Grip multipliers scale the car's cornering and
 * longitudinal limits per point of the path.
 */

export type Surface = 'tarmac' | 'gravel';
export type Ranges = [number, number][];

export const SURFACE_GRIP: Record<Surface, { lat: number; long: number }> = {
  tarmac: { lat: 1, long: 1 },
  // loose surface: roughly 0.9–1.0 g cornering for a rally car instead of ~1.5 g
  gravel: { lat: 0.62, long: 0.68 },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Sort, clamp and merge touching/overlapping ranges; drop empty ones. */
export function normalizeRanges(r: Ranges): Ranges {
  const sorted = r
    .map(([a, b]) => [clamp01(Math.min(a, b)), clamp01(Math.max(a, b))] as [number, number])
    .filter(([a, b]) => b - a > 1e-6)
    .sort((x, y) => x[0] - y[0]);
  const out: Ranges = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const addRange = (r: Ranges, a: number, b: number): Ranges => normalizeRanges([...r, [a, b]]);

export function removeRange(r: Ranges, a: number, b: number): Ranges {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const out: Ranges = [];
  for (const [x, y] of normalizeRanges(r)) {
    if (y <= lo || x >= hi) out.push([x, y]);
    else {
      if (x < lo) out.push([x, lo]);
      if (y > hi) out.push([hi, y]);
    }
  }
  return normalizeRanges(out);
}

export const surfaceAt = (r: Ranges, f: number): Surface => (r.some(([a, b]) => f >= a && f <= b) ? 'gravel' : 'tarmac');

/** Reversing the driving direction mirrors the fractions. */
export const reverseRanges = (r: Ranges): Ranges => normalizeRanges(r.map(([a, b]) => [1 - b, 1 - a]));

export interface Grip {
  lat: Float64Array;
  long: Float64Array;
}

/** Per-point grip for a path of n points (closed: point i is at i/n; open: i/(n-1)). */
export function gripProfile(n: number, gravel: Ranges, closed: boolean): Grip {
  const lat = new Float64Array(n), long = new Float64Array(n);
  const denom = closed ? n : Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const g = SURFACE_GRIP[surfaceAt(gravel, i / denom)];
    lat[i] = g.lat;
    long[i] = g.long;
  }
  return { lat, long };
}
