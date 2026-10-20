import { polylineLength } from '../geom/polyline';
import type { Vec2 } from '../geom/vec2';
import { curvatureClosed, curvatureOpen, segmentLengths, segmentLengthsOpen } from './curvature';
import { buildLap, sampleAtTime, sectorTimes, type LapProfile } from './lap';
import { speedProfileClosed, speedProfileFromStart, speedProfileOpen, type CarParams } from './speed';
import { gripProfile, surfaceAt, type Ranges, type Surface } from './surface';

/**
 * Race timeline: intro (track draw-in) → standing-start lap → flying laps →
 * outro (cool-down after the flag). A rally stage (open path) is one timed
 * run from start to finish instead. Pure, so the player and the exporter can
 * render any time deterministically.
 */

export interface RaceSetup {
  /** evenly sampled path; point 0 is the start (and finish line when closed) */
  path: Vec2[];
  /** false = point-to-point rally stage ending at the last point (default true) */
  closed?: boolean;
  /** gravel stretches as fractions of the track length (default none: all tarmac) */
  gravel?: Ranges;
  lengthKm: number;
  car: CarParams;
  laps: number;
  sectors: [number, number];
  intro?: number;
  outro?: number;
}

export interface Race {
  path: Vec2[];
  closed: boolean;
  gravel: Ranges;
  /** metres per path unit (image px) */
  mpu: number;
  laps: number;
  sectors: [number, number];
  intro: number;
  outro: number;
  first: LapProfile;
  flying: LapProfile;
  /** race time (since lights out) at which each lap starts; lapStart[laps] = finish */
  lapStart: number[];
  total: number;
  topSpeed: number;
  minSpeed: number;
}

export type Phase = 'intro' | 'race' | 'outro';

export interface RaceState {
  phase: Phase;
  /** 0..1 progress of the intro */
  introP: number;
  /** current lap (1-based, capped at laps) */
  lap: number;
  /** time into the current lap */
  lapTime: number;
  /** distance from the line within the lap, m */
  dist: number;
  speed: number;
  accel: number;
  /** path segment index and fraction for position lookup */
  index: number;
  frac: number;
  /** 0, 1, 2 */
  sector: number;
  /** sector times completed so far in the current lap (or the final lap during the outro) */
  sectorSplits: number[];
  /** completed lap times so far */
  lapTimes: number[];
  finished: boolean;
  /** surface under the car */
  surface: Surface;
}

const COOL_DOWN_DECEL = 7;

export function buildRace(s: RaceSetup): Race {
  const closed = s.closed ?? true;
  const gravel = s.gravel ?? [];
  const pxLen = polylineLength(s.path, closed);
  const mpu = (s.lengthKm * 1000) / Math.max(pxLen, 1e-9);
  const kappa = (closed ? curvatureClosed(s.path) : curvatureOpen(s.path)).map((k) => k / mpu);
  const seg = (closed ? segmentLengths(s.path) : segmentLengthsOpen(s.path)).map((d) => d * mpu);
  const grip = gravel.length ? gripProfile(s.path.length, gravel, closed) : undefined;
  let flyingV: Float64Array, flying: LapProfile, first: LapProfile;
  if (closed) {
    flyingV = speedProfileClosed(kappa, seg, s.car, grip);
    flying = buildLap(seg, flyingV);
    first = buildLap(seg, speedProfileFromStart(flyingV, kappa, seg, s.car, 0, grip));
  } else {
    // one run: standing start, flying finish
    flyingV = speedProfileOpen(kappa, seg, s.car, grip, 0);
    first = flying = buildLap(seg, flyingV);
  }
  const laps = closed ? Math.max(1, Math.round(s.laps)) : 1;
  const lapStart = [0];
  for (let k = 0; k < laps; k++) lapStart.push(lapStart[k] + (k === 0 ? first.lapTime : flying.lapTime));
  const intro = s.intro ?? 3;
  const outro = s.outro ?? 4;
  let top = 0, min = Infinity;
  // the standing start is not a "slowest corner"
  for (let i = closed ? 0 : 1; i < flyingV.length; i++) [top, min] = [Math.max(top, flyingV[i]), Math.min(min, flyingV[i])];
  return {
    path: s.path, closed, gravel, mpu, laps, sectors: s.sectors, intro, outro, first, flying, lapStart,
    total: intro + lapStart[laps] + outro, topSpeed: top, minSpeed: min,
  };
}

/**
 * Segment index + fraction for a distance along the lap. Closed laps wrap;
 * past the end of an open stage the last segment is extended (frac > 1).
 */
function locate(lap: LapProfile, d: number, closed = true): { index: number; frac: number } {
  if (!closed && d >= lap.length) {
    const i = lap.n - 1, ds = lap.dist[i + 1] - lap.dist[i];
    return { index: i, frac: ds > 0 ? (d - lap.dist[i]) / ds : 1 };
  }
  const dd = closed ? ((d % lap.length) + lap.length) % lap.length : Math.max(0, d);
  let lo = 0, hi = lap.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lap.dist[mid] <= dd) lo = mid;
    else hi = mid - 1;
  }
  const ds = lap.dist[lo + 1] - lap.dist[lo];
  return { index: lo, frac: ds > 0 ? (dd - lap.dist[lo]) / ds : 0 };
}

const lapProfile = (r: Race, lap: number): LapProfile => (lap === 1 ? r.first : r.flying);

function splitsUpTo(r: Race, lap: number, t: number): number[] {
  const st = sectorTimes(lapProfile(r, lap), r.sectors);
  return [st[0], st[1] - st[0], st[2] - st[1]].filter((_, k) => st[k] <= t + 1e-9);
}

export function raceState(r: Race, time: number): RaceState {
  const lapTimes = (upTo: number) => Array.from({ length: upTo }, (_, k) => lapProfile(r, k + 1).lapTime);

  if (time < r.intro) {
    return {
      phase: 'intro', introP: Math.max(0, time / r.intro), lap: 1, lapTime: 0, dist: 0, speed: 0, accel: 0,
      index: 0, frac: 0, sector: 0, sectorSplits: [], lapTimes: [], finished: false, surface: surfaceAt(r.gravel, 0),
    };
  }

  const t = time - r.intro;
  const finish = r.lapStart[r.laps];
  if (t < finish) {
    let lap = 1;
    while (lap < r.laps && t >= r.lapStart[lap]) lap++;
    const lt = t - r.lapStart[lap - 1];
    const prof = lapProfile(r, lap);
    const s = sampleAtTime(prof, lt);
    const f = s.dist / prof.length;
    return {
      phase: 'race', introP: 1, lap, lapTime: lt, dist: s.dist, speed: s.speed, accel: s.accel,
      index: Math.min(s.index, prof.n - 1), frac: s.frac,
      sector: f < r.sectors[0] ? 0 : f < r.sectors[1] ? 1 : 2,
      sectorSplits: splitsUpTo(r, lap, lt), lapTimes: lapTimes(lap - 1), finished: false,
      surface: surfaceAt(r.gravel, f),
    };
  }

  // Cool-down after the flag: constant deceleration from the line speed.
  const tau = t - finish;
  const last = lapProfile(r, r.laps);
  const v0 = last.speed[last.n];
  const stopT = v0 / COOL_DOWN_DECEL;
  const tt = Math.min(tau, stopT);
  const run = v0 * tt - 0.5 * COOL_DOWN_DECEL * tt * tt;
  const d = r.closed ? run : r.flying.length + run;
  const loc = locate(r.flying, d, r.closed);
  const dist = r.closed ? d % r.flying.length : d;
  return {
    phase: 'outro', introP: 1, lap: r.laps, lapTime: last.lapTime, dist,
    speed: Math.max(0, v0 - COOL_DOWN_DECEL * tt), accel: tau < stopT ? -COOL_DOWN_DECEL : 0,
    index: loc.index, frac: loc.frac, sector: 2, sectorSplits: splitsUpTo(r, r.laps, last.lapTime),
    lapTimes: lapTimes(r.laps), finished: true,
    surface: surfaceAt(r.gravel, r.closed ? (dist / r.flying.length) % 1 : 1),
  };
}

/**
 * Position and heading (radians, screen coords) on the path. On an open path
 * indices clamp at the ends, and frac > 1 extrapolates past the finish.
 */
export function poseAt(path: Vec2[], index: number, frac: number, closed = true): { p: Vec2; heading: number } {
  const n = path.length;
  const at = (i: number) => (closed ? path[((i % n) + n) % n] : path[Math.max(0, Math.min(n - 1, i))]);
  const a = at(index), b = at(index + 1);
  const p = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  // heading from a wider window so it doesn't twitch between samples
  const h0 = at(index - 1), h1 = at(index + 2);
  return { p, heading: Math.atan2(h1.y - h0.y, h1.x - h0.x) };
}

/** m:ss.mmm */
export function formatLapTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
