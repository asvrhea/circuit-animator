import { HALF_WIDTH } from './track';

/**
 * Go-kart style soft barrier at the track edge. Beyond WALL_D the car is
 * pushed back by a spring-damper (underdamped, so it bounces a little, like
 * jelly) and its speed is scrubbed while it leans on the wall. Penetration is
 * capped so it can never get through, and nothing stops it dead.
 */

/** Lateral offset of the car centre where the wall starts (the car's side touches the edge), m. */
export const WALL_D = HALF_WIDTH - 1.1;
/** Deepest the wall can be squashed, m. */
export const WALL_MAX_PEN = 2.6;

const K = 420; // spring, 1/s²
const C = 17; // damper, 1/s (ζ ≈ 0.4: a visible bounce)
const SCRUB = 1.8; // speed lost per second while in contact (rate)

export interface Lateral {
  /** offset from the centre line, m (right of travel positive) */
  d: number;
  /** sideways speed, m/s */
  vd: number;
}

/**
 * One step of the wall on a lateral offset/velocity. Returns the speed
 * multiplier for the whole velocity (1 when not touching), or 1 and no change
 * away from the wall. Mutates `l`.
 */
export function wallStep(l: Lateral, dt: number): number {
  const side = l.d >= 0 ? 1 : -1;
  const pen = Math.abs(l.d) - WALL_D;
  if (pen <= 0) return 1;
  let out = l.vd * side; // speed into the wall (+) or away (−)
  out += (-K * pen - C * out) * dt;
  let nd = Math.abs(l.d) + out * dt;
  if (nd > WALL_D + WALL_MAX_PEN) {
    nd = WALL_D + WALL_MAX_PEN;
    out = Math.min(out, 0);
  }
  l.d = nd * side;
  l.vd = out * side;
  return Math.exp(-SCRUB * dt);
}
