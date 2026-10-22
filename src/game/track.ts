import { polylineLength } from '../geom/polyline';
import type { Vec2 } from '../geom/vec2';
import { curvatureClosed, curvatureOpen, segmentLengths, segmentLengthsOpen } from '../sim/curvature';
import { speedProfileClosed, speedProfileOpen, type CarParams } from '../sim/speed';
import { gripProfile, surfaceAt, type Ranges, type Surface } from '../sim/surface';

/** Half the drivable width, m. Beyond it the car is on grass. */
export const HALF_WIDTH = 6;

/** The track in metres, with everything the game needs per point. */
export interface GameTrack {
  /** metres per source path unit */
  mpu: number;
  /** path in metres (evenly sampled) */
  path: Vec2[];
  closed: boolean;
  n: number;
  /** cumulative distance at each point, m */
  s: Float64Array;
  length: number;
  /** unit tangent per point */
  tx: Float64Array;
  ty: Float64Array;
  kappa: Float64Array;
  gravel: Ranges;
  /** best-effort speed per point (flying lap on a circuit, standing start to flying finish on a stage), m/s */
  profile: Float64Array;
  sectors: [number, number];
}

export interface TrackInput {
  /** evenly sampled path in source units */
  path: Vec2[];
  closed: boolean;
  lengthKm: number;
  gravel: Ranges;
  sectors: [number, number];
  car: CarParams;
}

export function buildGameTrack(inp: TrackInput): GameTrack {
  const { closed, gravel, car } = inp;
  const mpu = (inp.lengthKm * 1000) / Math.max(polylineLength(inp.path, closed), 1e-9);
  const path = inp.path.map((p) => ({ x: p.x * mpu, y: p.y * mpu }));
  const n = path.length;
  const kappa = closed ? curvatureClosed(path) : curvatureOpen(path);
  const seg = closed ? segmentLengths(path) : segmentLengthsOpen(path);
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + seg[i - 1];
  const length = closed ? s[n - 1] + seg[n - 1] : s[n - 1];
  const tx = new Float64Array(n), ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    tx[i] = (b.x - a.x) / l;
    ty[i] = (b.y - a.y) / l;
  }
  const grip = gravel.length ? gripProfile(n, gravel, closed) : undefined;
  const profile = closed ? speedProfileClosed(kappa, seg, car, grip) : speedProfileOpen(kappa, seg, car, grip, 0);
  return { mpu, path, closed, n, s, length, tx, ty, kappa, gravel, profile, sectors: inp.sectors };
}

function indexAt(t: GameTrack, s: number): { i: number; f: number } {
  const L = t.length;
  const ss = t.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
  let lo = 0, hi = t.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.s[mid] <= ss) lo = mid;
    else hi = mid - 1;
  }
  if (!t.closed && lo >= t.n - 1) return { i: t.n - 2, f: 1 };
  const next = t.closed && lo === t.n - 1 ? L : t.s[lo + 1];
  const ds = next - t.s[lo];
  return { i: lo, f: ds > 0 ? (ss - t.s[lo]) / ds : 0 };
}

const nextIndex = (t: GameTrack, i: number) => (t.closed ? (i + 1) % t.n : Math.min(t.n - 1, i + 1));

/** Pose on the track at distance s (wraps on a circuit, clamps on a stage), with lateral offset d (right of travel). */
export function poseAtS(t: GameTrack, s: number, d = 0): { x: number; y: number; heading: number; tx: number; ty: number } {
  const { i, f } = indexAt(t, s);
  const j = nextIndex(t, i);
  let tx = t.tx[i] + (t.tx[j] - t.tx[i]) * f, ty = t.ty[i] + (t.ty[j] - t.ty[i]) * f;
  const l = Math.hypot(tx, ty) || 1;
  tx /= l;
  ty /= l;
  const x = t.path[i].x + (t.path[j].x - t.path[i].x) * f - ty * d;
  const y = t.path[i].y + (t.path[j].y - t.path[i].y) * f + tx * d;
  return { x, y, heading: Math.atan2(ty, tx), tx, ty };
}

/** Interpolated value of a per-point array at distance s. */
export function sampleAt(t: GameTrack, arr: ArrayLike<number>, s: number): number {
  const { i, f } = indexAt(t, s);
  const j = nextIndex(t, i);
  return arr[i] + (arr[j] - arr[i]) * f;
}

export const surfaceAtS = (t: GameTrack, s: number): Surface => {
  if (!t.gravel.length) return 'tarmac';
  const L = t.length;
  return surfaceAt(t.gravel, t.closed ? (((s % L) + L) % L) / L : Math.max(0, Math.min(1, s / L)));
};

export interface Projection {
  /** arc length along the track (0..length) */
  s: number;
  /** signed lateral offset: positive = right of travel */
  d: number;
  /** segment index */
  index: number;
  surface: Surface;
}

function scan(t: GameTrack, x: number, y: number, hint: number, window: number): { i: number; u: number; dist: number } {
  const n = t.n;
  const segs = t.closed ? n : n - 1;
  let best = { i: 0, u: 0, dist: Infinity };
  const check = (i: number) => {
    const a = t.path[i], b = t.path[nextIndex(t, i)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    const dist = Math.hypot(x - (a.x + dx * u), y - (a.y + dy * u));
    if (dist < best.dist) best = { i, u, dist };
  };
  if (hint < 0) for (let i = 0; i < segs; i++) check(i);
  else
    for (let k = -window; k <= window; k++) {
      const i = t.closed ? (((hint + k) % n) + n) % n : hint + k;
      if (i >= 0 && i < segs) check(i);
    }
  return best;
}

/**
 * Nearest point on the track. With a `hint` index only a window around it is
 * searched (cheap, and never jumps to a neighbouring stretch of road); falls
 * back to a full scan if the window finds nothing close.
 */
export function project(t: GameTrack, x: number, y: number, hint = -1, window = 40): Projection {
  let best = scan(t, x, y, hint, window);
  if (hint < 0 || best.dist > 50) {
    const full = scan(t, x, y, -1, 0);
    if (full.dist < best.dist) best = full;
  }
  const L = t.length;
  const i = best.i, j = nextIndex(t, i);
  const segLen = t.closed && i === t.n - 1 ? L - t.s[i] : t.s[j] - t.s[i];
  const s = t.s[i] + best.u * segLen;
  const a = t.path[i], b = t.path[j];
  const px = a.x + (b.x - a.x) * best.u, py = a.y + (b.y - a.y) * best.u;
  let tx = t.tx[i] + (t.tx[j] - t.tx[i]) * best.u, ty = t.ty[i] + (t.ty[j] - t.ty[i]) * best.u;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const d = (x - px) * -ty + (y - py) * tx;
  return { s, d, index: i, surface: surfaceAtS(t, s) };
}
