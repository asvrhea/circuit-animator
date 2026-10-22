import type { CarParams } from '../sim/speed';
import { SURFACE_GRIP } from '../sim/surface';
import { stepAi, type Driving, type Other } from './ai';
import { newCar, speedOf, stepCar, type CarState, type Controls, type Env } from './car';
import { collide } from './collide';
import { DRIVERS, PLAYER_DRIVER, type Driver } from './drivers';
import { HALF_WIDTH, poseAtS, project, surfaceAtS, type GameTrack } from './track';
import { WALL_D, WALL_MAX_PEN, wallStep } from './wall';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY_PACE: Record<Difficulty, number> = { easy: 0.72, normal: 0.82, hard: 0.92 };
export const MIN_OPPONENTS = 5;
export const MAX_OPPONENTS = 9;

export interface GameSetup {
  track: GameTrack;
  car: CarParams;
  /** circuit laps (a stage is always one run) */
  laps: number;
  /** AI cars; ignored (0) on a stage */
  opponents: number;
  difficulty: Difficulty;
  seed?: number;
}

export interface Racer {
  id: number;
  driver: Driver;
  isPlayer: boolean;
  car: CarState;
  /** AI driving state; null for the player */
  ai: Driving | null;
  /** distance from the line, m: negative on the grid, grows past `laps * length` at the flag */
  dist: number;
  /** position on the lap at the last update (for unwrapping) */
  prevS: number;
  hint: number;
  /** sideways offset and speed along the road */
  d: number;
  speed: number;
  offTrack: boolean;
  gravel: boolean;
  /** laps completed */
  lapsDone: number;
  /** race time at which the current lap started (null until the car crosses the line) */
  lapStartT: number | null;
  lapTimes: number[];
  bestLap: number | null;
  /** cumulative time into the current lap at each sector boundary passed */
  sectorCum: number[];
  /** sector durations of the last completed or current lap */
  finished: boolean;
  finishTime: number | null;
  /** race time at which the car reached each BIN of distance */
  cross: number[];
}

export type Phase = 'grid' | 'race' | 'finished';

export interface Game {
  setup: GameSetup;
  track: GameTrack;
  /** index 0 is the player */
  racers: Racer[];
  player: Racer;
  /** seconds since the session started */
  t: number;
  /** time of lights out */
  goTime: number;
  /** race clock: negative on the grid */
  raceTime: number;
  phase: Phase;
  /** race distance, m */
  totalDist: number;
  laps: number;
  /** racers by position */
  order: Racer[];
  /** race time at which the player finished */
  playerFinishT: number | null;
  results: Results | null;
}

export interface ResultRow {
  pos: number;
  name: string;
  code: string;
  color: string;
  isPlayer: boolean;
  /** total race time, s */
  time: number;
  /** gap to the winner, s */
  gap: number;
  bestLap: number | null;
  fastest: boolean;
  lapTimes: number[];
}

export interface Results {
  rows: ResultRow[];
  /** player's stage splits (sector durations) on a stage */
  splits: number[];
  closed: boolean;
}

const BIN = 20;
const PAD = 400;
const GRID_FIRST = 8;
const GRID_ROW = 7.5;
/** Fixed physics step: the same at any frame rate. */
export const PHYS_DT = 1 / 240;
const STEP = PHYS_DT;
/** Past this the car is on the grass (the wall normally keeps it well inside). */
const OFF_TRACK_D = HALF_WIDTH + 4;

/** Small deterministic PRNG so grids and starts are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrapHalf = (x: number, L: number) => x - L * Math.round(x / L);

const blankRacer = (id: number, driver: Driver, isPlayer: boolean, car: CarState): Racer => ({
  id, driver, isPlayer, car, ai: null, dist: 0, prevS: 0, hint: -1, d: 0, speed: 0, offTrack: false, gravel: false,
  lapsDone: 0, lapStartT: null, lapTimes: [], bestLap: null, sectorCum: [], finished: false, finishTime: null, cross: [],
});

export function createGame(setup: GameSetup): Game {
  const { track } = setup;
  const rand = rng(setup.seed ?? 1234);
  const closed = track.closed;
  const opponents = closed ? Math.max(0, Math.min(MAX_OPPONENTS, Math.round(setup.opponents))) : 0;
  const laps = closed ? Math.max(1, Math.round(setup.laps)) : 1;
  const base = DIFFICULTY_PACE[setup.difficulty];

  const slot = (k: number) => ({ dist: -(GRID_FIRST + GRID_ROW * k), d: k % 2 ? 2.3 : -2.3 });
  const racers: Racer[] = [];

  // player: last on the grid of a circuit, on the line of a stage
  const ps = closed ? slot(opponents) : { dist: 0, d: 0 };
  const pp = poseAtS(track, closed ? track.length + ps.dist : 0, ps.d);
  const player = blankRacer(0, PLAYER_DRIVER, true, newCar(pp.x, pp.y, pp.heading));
  player.dist = ps.dist;
  racers.push(player);

  // quickest AI on pole; skill spread 0.92..1
  const skills = Array.from({ length: opponents }, () => 0.92 + rand() * 0.08).sort((a, b) => b - a);
  const pool = DRIVERS.slice().sort(() => rand() - 0.5);
  for (let k = 0; k < opponents; k++) {
    const g = slot(k);
    const pose = poseAtS(track, track.length + g.dist, g.d);
    const r = blankRacer(k + 1, pool[k % pool.length], false, newCar(pose.x, pose.y, pose.heading));
    r.dist = g.dist;
    r.d = g.d;
    r.ai = { s: (track.length + g.dist) % track.length, d: g.d, v: 0, vd: 0, pace: base * skills[k], lane: g.d * 0.8 + (rand() - 0.5) * 1.2 };
    racers.push(r);
  }
  for (const r of racers) {
    const pr = project(track, r.car.x, r.car.y);
    r.prevS = r.isPlayer ? pr.s : r.ai!.s;
    r.hint = pr.index;
    if (!closed || r.isPlayer) r.d = pr.d;
  }
  if (!closed) player.lapStartT = 0;
  for (const r of racers) markBins(r, r.dist, r.dist, 0, 0);

  const goTime = 5 + 0.7 + rand() * 1.3;
  const g: Game = {
    setup, track, racers, player, t: 0, goTime, raceTime: -goTime, phase: 'grid',
    totalDist: laps * track.length, laps, order: racers.slice(), playerFinishT: null, results: null,
  };
  rank(g);
  return g;
}

/** Lights lit at session time t (0..5), then all out at goTime. */
export const lightsLit = (g: Game): number => (g.t >= g.goTime ? 0 : Math.min(5, Math.floor(g.t) + 1));

export function envFor(surface: 'tarmac' | 'gravel', d: number): Env {
  const grip = SURFACE_GRIP[surface];
  const off = Math.abs(d) > OFF_TRACK_D;
  return { lat: grip.lat * (off ? 0.55 : 1), long: grip.long * (off ? 0.5 : 1), offTrack: off };
}

function markBins(r: Racer, from: number, to: number, tFrom: number, tTo: number): void {
  const k0 = Math.floor((from + PAD) / BIN), k1 = Math.floor((to + PAD) / BIN);
  if (r.cross.length === 0) r.cross[k0] = tFrom;
  for (let k = Math.max(k0 + 1, 0); k <= k1; k++) {
    const dist = k * BIN - PAD;
    const f = to > from ? (dist - from) / (to - from) : 1;
    r.cross[k] = tFrom + (tTo - tFrom) * f;
  }
}

/** Time at which the racer was at `dist`, between two updates. */
const timeAt = (from: number, to: number, tFrom: number, tTo: number, dist: number) =>
  to > from ? tFrom + (tTo - tFrom) * ((dist - from) / (to - from)) : tTo;

function advanceRace(g: Game, r: Racer, from: number, tFrom: number): void {
  const L = g.track.length, tTo = g.raceTime;
  markBins(r, from, r.dist, tFrom, tTo);
  if (r.finished) return;

  // first crossing of the line starts lap 1 (the grid is behind it)
  if (r.lapStartT === null && r.dist >= 0) r.lapStartT = timeAt(from, r.dist, tFrom, tTo, 0);

  const closed = g.track.closed;
  const lapIdx = r.lapsDone;
  // sector boundaries of the current lap
  if (r.lapStartT !== null) {
    const b = [g.track.sectors[0], g.track.sectors[1]];
    for (let k = r.sectorCum.length; k < 2; k++) {
      const at = lapIdx * L + b[k] * L;
      if (from < at && r.dist >= at) r.sectorCum.push(timeAt(from, r.dist, tFrom, tTo, at) - r.lapStartT);
      else break;
    }
  }

  // lap / finish line
  while (!r.finished && r.dist >= (r.lapsDone + 1) * L - (closed ? 0 : 0.2)) {
    const at = (r.lapsDone + 1) * L;
    const tc = timeAt(from, r.dist, tFrom, tTo, Math.min(at, r.dist));
    const start = r.lapStartT ?? 0;
    const lt = tc - start;
    r.lapTimes.push(lt);
    r.bestLap = r.bestLap === null ? lt : Math.min(r.bestLap, lt);
    r.lapsDone++;
    r.lapStartT = tc;
    if (r.lapsDone >= g.laps) {
      r.finished = true;
      r.finishTime = tc;
      if (r.isPlayer) {
        r.sectorCum = [r.sectorCum[0] ?? lt, r.sectorCum[1] ?? lt, lt];
        g.playerFinishT = tc;
        g.phase = 'finished';
      }
    } else r.sectorCum = [];
  }
}

function rank(g: Game): void {
  g.order = g.racers.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime! - b.finishTime!;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.dist - a.dist;
  });
}

/** Seconds `behind` is behind `ahead` (null if unknown) and whole laps down. */
export function gapBetween(behind: Racer, ahead: Racer, L: number): { seconds: number | null; laps: number } {
  const laps = Math.floor((ahead.dist - behind.dist) / L + 1e-9);
  if (laps >= 1) return { seconds: null, laps };
  const k = Math.max(0, Math.floor((behind.dist + PAD) / BIN));
  const a = ahead.cross[k], b = behind.cross[k];
  return { seconds: a === undefined || b === undefined ? null : Math.max(0, b - a), laps: 0 };
}

const otherFor = (g: Game, me: Racer, o: Racer): Other => ({
  gap: g.track.closed ? wrapHalf((o.ai ? o.ai.s : o.prevS) - (me.ai ? me.ai.s : me.prevS), g.track.length) : 0,
  d: o.d,
  v: o.speed,
});

function tick(g: Game, ctl: Controls, h: number): void {
  const { track } = g;
  const tPrev = g.raceTime;
  g.t += h;
  g.raceTime = g.t - g.goTime;
  if (g.raceTime < 0) return;
  if (g.phase === 'grid') g.phase = 'race';

  // ---- player
  const p = g.player;
  const pc: Controls = p.finished ? { throttle: 0, brake: p.speed > 0.5 ? 1 : 0, steer: 0 } : ctl;
  stepCar(p.car, pc, g.setup.car, envFor(p.gravel ? 'gravel' : 'tarmac', p.d), h);

  // ---- AI
  const before = new Map<Racer, number>();
  for (const r of g.racers) {
    if (!r.ai) continue;
    before.set(r, r.ai.s);
    const a = r.ai;
    if (r.finished) {
      a.pace = Math.min(a.pace, 0.55);
      a.lane = a.lane >= 0 ? 4.8 : -4.8;
    }
    const others = g.racers.filter((o) => o !== r && !(o.isPlayer && o.finished)).map((o) => otherFor(g, r, o));
    stepAi(a, track, g.setup.car, others, h);
    const lat = { d: a.d, vd: a.vd };
    a.v *= wallStep(lat, h);
    a.d = lat.d;
    a.vd = lat.vd;
    const pose = poseAtS(track, a.s, a.d);
    r.car.x = pose.x;
    r.car.y = pose.y;
    r.car.heading = pose.heading + Math.atan2(a.vd, Math.max(a.v, 5));
    r.car.vx = pose.tx * a.v - pose.ty * a.vd;
    r.car.vy = pose.ty * a.v + pose.tx * a.vd;
  }

  // ---- contact
  const hit = new Set<Racer>();
  for (let i = 0; i < g.racers.length; i++) {
    for (let j = i + 1; j < g.racers.length; j++) {
      const a = g.racers[i], b = g.racers[j];
      if ((a.isPlayer && a.finished) || (b.isPlayer && b.finished)) continue;
      if (collide(a.car, b.car)) {
        hit.add(a);
        hit.add(b);
      }
    }
  }
  for (const r of hit) {
    if (!r.ai) continue;
    const a = r.ai;
    const pose = poseAtS(track, a.s, a.d);
    const nx = -pose.ty, ny = pose.tx;
    const dx = r.car.x - pose.x, dy = r.car.y - pose.y;
    a.s += dx * pose.tx + dy * pose.ty;
    a.d = Math.max(-(WALL_D + WALL_MAX_PEN), Math.min(WALL_D + WALL_MAX_PEN, a.d + dx * nx + dy * ny));
    a.v = Math.max(0, r.car.vx * pose.tx + r.car.vy * pose.ty);
    a.vd = r.car.vx * nx + r.car.vy * ny;
    if (track.closed) a.s = ((a.s % track.length) + track.length) % track.length;
  }

  // ---- progress
  for (const r of g.racers) {
    let s: number;
    if (r.ai) s = r.ai.s;
    else {
      const pr = project(track, r.car.x, r.car.y, r.hint);
      r.hint = pr.index;
      r.d = pr.d;
      r.gravel = pr.surface === 'gravel';
      r.offTrack = Math.abs(pr.d) > OFF_TRACK_D;
      s = pr.s;
      // soft wall at the track edge
      const nx = -track.ty[pr.index], ny = track.tx[pr.index];
      const lat = { d: pr.d, vd: r.car.vx * nx + r.car.vy * ny };
      const vd0 = lat.vd;
      const f = wallStep(lat, h);
      if (lat.d !== pr.d) {
        r.car.x += nx * (lat.d - pr.d);
        r.car.y += ny * (lat.d - pr.d);
        r.car.vx += nx * (lat.vd - vd0);
        r.car.vy += ny * (lat.vd - vd0);
        r.car.vx *= f;
        r.car.vy *= f;
        r.d = lat.d;
        // the barrier lines the car up with the road, like a kart sliding along a tyre wall
        const road = Math.atan2(track.ty[pr.index], track.tx[pr.index]);
        const dir = r.car.vx * track.tx[pr.index] + r.car.vy * track.ty[pr.index] >= 0 ? 0 : Math.PI;
        let dh = road + dir - r.car.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        r.car.heading += dh * Math.min(1, 2.5 * h);
      }
    }
    const delta = track.closed ? wrapHalf(s - r.prevS, track.length) : s - r.prevS;
    const from = r.dist;
    r.dist += delta;
    r.prevS = s;
    const idx = r.ai ? Math.min(track.n - 1, Math.floor((s / track.length) * track.n)) : r.hint;
    r.speed = r.car.vx * track.tx[idx] + r.car.vy * track.ty[idx];
    if (r.ai) {
      r.d = r.ai.d;
      r.gravel = surfaceAtS(track, s) === 'gravel';
    }
    advanceRace(g, r, from, tPrev);
  }
  rank(g);
}

/** Advance the game by dt seconds with the player's controls. */
export function stepGame(g: Game, ctl: Controls, dt: number): void {
  const n = Math.max(1, Math.ceil(dt / STEP));
  for (let i = 0; i < n; i++) tick(g, ctl, dt / n);
}

/** Total race time of the player's flag, or null. */
export const playerTime = (g: Game): number | null => g.player.finishTime;

const NONE: Controls = { throttle: 0, brake: 0, steer: 0 };

/**
 * Run the race out until every car has taken the flag (the player has
 * stopped by now), then build the classification.
 */
export function finalizeResults(g: Game): Results {
  if (g.results) return g.results;
  let guard = 0;
  while (g.racers.some((r) => !r.finished) && guard++ < 60 * 600) tick(g, NONE, 1 / 30);
  const rows: ResultRow[] = g.order.map((r, i) => ({
    pos: i + 1,
    name: r.driver.name,
    code: r.driver.code,
    color: r.driver.color,
    isPlayer: r.isPlayer,
    time: r.finishTime ?? Infinity,
    gap: 0,
    bestLap: r.bestLap,
    fastest: false,
    lapTimes: r.lapTimes.slice(),
  }));
  const win = rows[0]?.time ?? 0;
  let fast = Infinity;
  for (const r of rows) {
    r.gap = r.time - win;
    if (r.bestLap !== null) fast = Math.min(fast, r.bestLap);
  }
  if (g.track.closed) for (const r of rows) r.fastest = r.bestLap !== null && r.bestLap <= fast + 1e-9;
  const c = g.player.sectorCum;
  const splits = c.length === 3 ? [c[0], c[1] - c[0], c[2] - c[1]] : [];
  g.results = { rows, splits, closed: g.track.closed };
  return g.results;
}

export const playerSpeed = (g: Game): number => speedOf(g.player.car);

/**
 * Advance by real time with a fixed physics step (accumulator): the sim runs
 * the same at 30, 60 or 144 fps. Returns the leftover time to pass back in.
 */
export function advance(g: Game, ctl: Controls, acc: number, dt: number): number {
  acc += Math.min(Math.max(dt, 0), 0.1);
  while (acc >= PHYS_DT) {
    tick(g, ctl, PHYS_DT);
    acc -= PHYS_DT;
  }
  return acc;
}
