import { driveAccel, brakeDecel, type CarParams } from '../sim/speed';
import { SURFACE_GRIP } from '../sim/surface';
import { HALF_WIDTH, sampleAt, surfaceAtS, type GameTrack } from './track';

/**
 * An AI car drives on rails in track coordinates (s along the road, d
 * sideways): it follows the speed profile scaled by its skill, drifts to
 * its own lane, and picks a free lane or backs off when a slower car is in
 * the way.
 */
export interface Driving {
  /** distance along the lap, m (wrapped on a circuit) */
  s: number;
  /** lateral offset, m (right of travel) */
  d: number;
  /** speed along the road, m/s */
  v: number;
  /** sideways speed, m/s */
  vd: number;
  /** fraction of the speed profile this driver reaches */
  pace: number;
  /** preferred lateral offset, m */
  lane: number;
}

/** What an AI car sees of another car. */
export interface Other {
  /** distance ahead (+) or behind (−) along the road, m (wrap-aware) */
  gap: number;
  d: number;
  v: number;
}

const LOOK_AHEAD = 38;
const MARGIN = HALF_WIDTH - 1.7;
const LANE_WIDTH = 3;
const MAX_LATERAL = 2.6;

export function stepAi(a: Driving, track: GameTrack, car: CarParams, others: Other[], dt: number): void {
  let target = sampleAt(track, track.profile, a.s + a.v * 0.5) * a.pace;
  let dTarget = a.lane;

  // nearest car ahead that overlaps our lane
  let block: Other | null = null;
  for (const o of others) {
    if (o.gap > 0 && o.gap < LOOK_AHEAD && Math.abs(o.d - a.d) < LANE_WIDTH + 0.4 && (!block || o.gap < block.gap)) block = o;
  }
  if (block) {
    const options = [block.d + 3.4, block.d - 3.4]
      .map((x) => Math.max(-MARGIN, Math.min(MARGIN, x)))
      .filter((x) => Math.abs(x - block!.d) >= 2.6)
      .filter((x) => !others.some((o) => Math.abs(o.gap) < 7 && Math.abs(o.d - x) < 2.6));
    if (options.length) {
      options.sort((p, q) => Math.abs(p - a.d) - Math.abs(q - a.d));
      dTarget = options[0];
      // commit to the pass, but never drive into the back of it while still alongside the lane
      if (block.gap < 8 && Math.abs(a.d - block.d) < 2.4) target = Math.min(target, block.v + 1.5);
    } else {
      // nowhere to go: follow
      target = Math.min(target, block.v + Math.max(0, (block.gap - 9) * 0.6));
    }
  }

  // lateral: smooth drift to the target lane
  const vdWant = Math.max(-MAX_LATERAL, Math.min(MAX_LATERAL, (dTarget - a.d) * 1.2));
  a.vd += Math.max(-6 * dt, Math.min(6 * dt, vdWant - a.vd));
  a.d += a.vd * dt;

  // longitudinal: the profile already contains every braking zone, so just chase it within the car's limits
  const kappa = sampleAt(track, track.kappa, a.s);
  const g = SURFACE_GRIP[surfaceAtS(track, a.s)];
  if (target > a.v) a.v = Math.min(target, a.v + driveAccel(car, a.v, kappa, g.lat, g.long) * dt);
  else a.v = Math.max(target, a.v - brakeDecel(car, a.v, kappa, g.lat, g.long) * dt);
  a.v = Math.max(0, a.v);
  a.s += a.v * dt;
  if (track.closed) a.s %= track.length;
}
