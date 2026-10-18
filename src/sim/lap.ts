/**
 * Lap timing: integrate a speed profile into time, and look up position and
 * speed at any time. Each segment is treated as constant acceleration, so a
 * standing start is smooth instead of jumping.
 */

export interface LapProfile {
  /** number of segments */
  n: number;
  /** cumulative distance (m) at points 0..n */
  dist: Float64Array;
  /** cumulative time (s) at points 0..n */
  time: Float64Array;
  /** speed (m/s) at points 0..n */
  speed: Float64Array;
  length: number;
  lapTime: number;
}

/** `speed` may have n or n+1 entries; with n it is treated as a closed loop. */
export function buildLap(seg: Float64Array, speed: Float64Array): LapProfile {
  const n = seg.length;
  const dist = new Float64Array(n + 1);
  const time = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) v[i] = speed[i < speed.length ? i : i % n];
  for (let i = 0; i < n; i++) {
    dist[i + 1] = dist[i] + seg[i];
    const avg = (v[i] + v[i + 1]) / 2;
    time[i + 1] = time[i] + (avg > 1e-6 ? seg[i] / avg : 0);
  }
  return { n, dist, time, speed: v, length: dist[n], lapTime: time[n] };
}

export interface LapSample {
  /** distance from the line, m */
  dist: number;
  speed: number;
  /** longitudinal acceleration, m/s² (+ throttle, − brake) */
  accel: number;
  /** segment index and fraction along it, for position lookup */
  index: number;
  frac: number;
}

/** First i with arr[i] > x, in [1, arr.length-1]. */
function upper(arr: Float64Array, x: number): number {
  let lo = 1, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** State at time t (clamped to the lap). */
export function sampleAtTime(lap: LapProfile, t: number): LapSample {
  const tt = Math.max(0, Math.min(lap.lapTime, t));
  const i = upper(lap.time, tt) - 1;
  const ds = lap.dist[i + 1] - lap.dist[i];
  const dt = lap.time[i + 1] - lap.time[i];
  const v0 = lap.speed[i], v1 = lap.speed[i + 1];
  const a = dt > 0 ? (v1 - v0) / dt : 0;
  const tau = Math.min(dt, tt - lap.time[i]);
  const d = Math.min(ds, v0 * tau + 0.5 * a * tau * tau);
  return { dist: lap.dist[i] + d, speed: v0 + a * tau, accel: a, index: i, frac: ds > 0 ? d / ds : 0 };
}

/** Time at which distance d (m) is reached. */
export function timeAtDist(lap: LapProfile, d: number): number {
  const dd = Math.max(0, Math.min(lap.length, d));
  const i = upper(lap.dist, dd) - 1;
  const ds = lap.dist[i + 1] - lap.dist[i];
  const dt = lap.time[i + 1] - lap.time[i];
  if (ds <= 0 || dt <= 0) return lap.time[i];
  const v0 = lap.speed[i], v1 = lap.speed[i + 1];
  const a = (v1 - v0) / dt;
  const x = dd - lap.dist[i];
  // solve x = v0 τ + a τ²/2
  const tau = Math.abs(a) < 1e-9 ? x / Math.max(v0, 1e-9) : (-v0 + Math.sqrt(Math.max(0, v0 * v0 + 2 * a * x))) / a;
  return lap.time[i] + Math.min(dt, Math.max(0, tau));
}

/** Cumulative sector end times for split fractions [s1, s2] (plus the full lap). */
export function sectorTimes(lap: LapProfile, splits: [number, number]): [number, number, number] {
  return [timeAtDist(lap, splits[0] * lap.length), timeAtDist(lap, splits[1] * lap.length), lap.lapTime];
}
