import { polylineLength } from '../geom/polyline';
import type { Vec2 } from '../geom/vec2';
import { curvatureClosed, segmentLengths } from './curvature';
import { buildLap, sampleAtTime, sectorTimes, type LapProfile } from './lap';
import { speedProfileClosed, speedProfileFromStart, type CarParams } from './speed';

/**
 * Race timeline: intro (track draw-in) → standing-start lap → flying laps →
 * outro (cool-down after the flag). Pure, so the player and the exporter can
 * render any time deterministically.
 */

export interface RaceSetup {
  /** closed, evenly sampled path; point 0 is the start/finish line */
  path: Vec2[];
  lengthKm: number;
  car: CarParams;
  laps: number;
  sectors: [number, number];
  intro?: number;
  outro?: number;
}

export interface Race {
  path: Vec2[];
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
}

const COOL_DOWN_DECEL = 7;

export function buildRace(s: RaceSetup): Race {
  const pxLen = polylineLength(s.path, true);
  const mpu = (s.lengthKm * 1000) / Math.max(pxLen, 1e-9);
  const kappa = curvatureClosed(s.path).map((k) => k / mpu);
  const seg = segmentLengths(s.path).map((d) => d * mpu);
  const flyingV = speedProfileClosed(kappa, seg, s.car);
  const flying = buildLap(seg, flyingV);
  const first = buildLap(seg, speedProfileFromStart(flyingV, kappa, seg, s.car, 0));
  const laps = Math.max(1, Math.round(s.laps));
  const lapStart = [0];
  for (let k = 0; k < laps; k++) lapStart.push(lapStart[k] + (k === 0 ? first.lapTime : flying.lapTime));
  const intro = s.intro ?? 3;
  const outro = s.outro ?? 4;
  let top = 0, min = Infinity;
  for (const v of flyingV) [top, min] = [Math.max(top, v), Math.min(min, v)];
  return {
    path: s.path, mpu, laps, sectors: s.sectors, intro, outro, first, flying, lapStart,
    total: intro + lapStart[laps] + outro, topSpeed: top, minSpeed: min,
  };
}

/** Segment index + fraction for a distance along the lap. */
function locate(lap: LapProfile, d: number): { index: number; frac: number } {
  const dd = ((d % lap.length) + lap.length) % lap.length;
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
      index: 0, frac: 0, sector: 0, sectorSplits: [], lapTimes: [], finished: false,
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
    };
  }

  // Cool-down after the flag: constant deceleration from the line speed.
  const tau = t - finish;
  const last = lapProfile(r, r.laps);
  const v0 = last.speed[last.n];
  const stopT = v0 / COOL_DOWN_DECEL;
  const tt = Math.min(tau, stopT);
  const d = v0 * tt - 0.5 * COOL_DOWN_DECEL * tt * tt;
  const loc = locate(r.flying, d);
  return {
    phase: 'outro', introP: 1, lap: r.laps, lapTime: last.lapTime, dist: d % r.flying.length,
    speed: Math.max(0, v0 - COOL_DOWN_DECEL * tt), accel: tau < stopT ? -COOL_DOWN_DECEL : 0,
    index: loc.index, frac: loc.frac, sector: 2, sectorSplits: splitsUpTo(r, r.laps, last.lapTime),
    lapTimes: lapTimes(r.laps), finished: true,
  };
}

/** Position and heading (radians, screen coords) on the path. */
export function poseAt(path: Vec2[], index: number, frac: number): { p: Vec2; heading: number } {
  const n = path.length;
  const a = path[index % n], b = path[(index + 1) % n];
  const p = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  // heading from a wider window so it doesn't twitch between samples
  const h0 = path[(index - 1 + n) % n], h1 = path[(index + 2) % n];
  return { p, heading: Math.atan2(h1.y - h0.y, h1.x - h0.x) };
}

/** m:ss.mmm */
export function formatLapTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
