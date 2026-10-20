/**
 * Quasi-steady-state speed profile on a closed lap or an open stage.
 *
 *   v_corner = min(vMax, sqrt(aLat · grip / κ))
 *
 * then a forward pass caps acceleration and a backward pass caps braking.
 * Longitudinal grip shrinks with the lateral grip already in use (friction
 * circle), and drive force fades towards top speed (drag), so the car
 * brakes before corners, is slow through them, and builds speed out of them.
 * Optional per-point grip multipliers model surfaces (gravel vs tarmac).
 */

export interface CarParams {
  /** top speed, m/s */
  vMax: number;
  /** peak lateral acceleration on tarmac, m/s² */
  aLat: number;
  /** peak drive acceleration at low speed, m/s² */
  aAccel: number;
  /** peak braking deceleration, m/s² */
  aBrake: number;
  /** floor so noisy kinks never stop the car, m/s */
  vMin: number;
}

const G = 9.81;
const kmh = (v: number) => v / 3.6;

export type CarPreset = 'formula' | 'gt' | 'road' | 'rally';

export const CAR_PRESETS: Record<CarPreset, { label: string; car: CarParams }> = {
  formula: { label: 'Formula', car: { vMax: kmh(330), aLat: 4.0 * G, aAccel: 1.4 * G, aBrake: 4.5 * G, vMin: kmh(45) } },
  gt: { label: 'GT', car: { vMax: kmh(290), aLat: 1.8 * G, aAccel: 0.8 * G, aBrake: 1.6 * G, vMin: kmh(35) } },
  road: { label: 'Road car', car: { vMax: kmh(230), aLat: 0.95 * G, aAccel: 0.45 * G, aBrake: 1.0 * G, vMin: kmh(25) } },
  // tarmac figures; gravel stretches scale them down (see sim/surface.ts)
  rally: { label: 'Rally car', car: { vMax: kmh(200), aLat: 1.5 * G, aAccel: 0.75 * G, aBrake: 1.4 * G, vMin: kmh(20) } },
};

/** Per-point grip multipliers (see sim/surface.ts); omitted = tarmac everywhere. */
export interface GripScale {
  lat: ArrayLike<number>;
  long: ArrayLike<number>;
}

const latAt = (g: GripScale | undefined, i: number) => (g ? g.lat[i] : 1);
const longAt = (g: GripScale | undefined, i: number) => (g ? g.long[i] : 1);

/** Share of a longitudinal limit left over after cornering load (friction circle). */
function gripLeft(v: number, kappa: number, aLat: number, floor: number): number {
  const u = (v * v * kappa) / aLat;
  return Math.max(floor, Math.sqrt(Math.max(0, 1 - u * u)));
}

/** Drive acceleration available at speed v on curvature κ (grip multipliers for the surface). */
export function driveAccel(car: CarParams, v: number, kappa: number, latG = 1, longG = 1): number {
  const drag = Math.max(0.04, 1 - (v / car.vMax) ** 2);
  return car.aAccel * longG * drag * gripLeft(v, kappa, car.aLat * latG, 0.2);
}

export function brakeDecel(car: CarParams, v: number, kappa: number, latG = 1, longG = 1): number {
  return car.aBrake * longG * gripLeft(v, kappa, car.aLat * latG, 0.3);
}

/** Cornering limit at each point. */
export function cornerLimit(kappa: Float64Array, car: CarParams, grip?: GripScale): Float64Array {
  const out = new Float64Array(kappa.length);
  for (let i = 0; i < kappa.length; i++) {
    const v = kappa[i] > 1e-9 ? Math.sqrt((car.aLat * latAt(grip, i)) / kappa[i]) : Infinity;
    out[i] = Math.max(car.vMin, Math.min(car.vMax, v));
  }
  return out;
}

/** Highest speed reachable at point i+1 from v0 at point i. */
const accelStep = (car: CarParams, v0: number, kappa: Float64Array, seg: Float64Array, grip: GripScale | undefined, i: number) =>
  Math.sqrt(v0 * v0 + 2 * driveAccel(car, v0, kappa[i], latAt(grip, i), longAt(grip, i)) * seg[i]);

/** Highest speed allowed at point i so the car can still slow to v1 at point i+1. */
const brakeStep = (car: CarParams, v1: number, kappa: Float64Array, seg: Float64Array, grip: GripScale | undefined, i: number) =>
  Math.sqrt(v1 * v1 + 2 * brakeDecel(car, v1, kappa[i], latAt(grip, i), longAt(grip, i)) * seg[i]);

/**
 * Flying-lap profile on a closed loop. kappa[i] in 1/m at point i,
 * seg[i] = metres from point i to point i+1 (wrapping).
 */
export function speedProfileClosed(kappa: Float64Array, seg: Float64Array, car: CarParams, grip?: GripScale): Float64Array {
  const n = kappa.length;
  const lim = cornerLimit(kappa, car, grip);
  const v = new Float64Array(n);
  if (!n) return v;

  // Start both passes at the slowest corner: its speed is fixed by grip alone,
  // so one lap around from there is exact for a closed loop.
  let m = 0;
  for (let i = 1; i < n; i++) if (lim[i] < lim[m]) m = i;

  v[m] = lim[m];
  for (let k = 1; k < n; k++) {
    const i = (m + k) % n, p = (i - 1 + n) % n;
    v[i] = Math.min(lim[i], accelStep(car, v[p], kappa, seg, grip, p));
  }
  for (let k = 1; k < n; k++) {
    const i = (m - k + n) % n, nx = (i + 1) % n;
    v[i] = Math.min(v[i], brakeStep(car, v[nx], kappa, seg, grip, i));
  }
  return v;
}

/**
 * Standing-start lap: accelerate from `v0` at point 0, never exceeding the
 * flying-lap profile (which already contains every braking zone). Returns
 * n + 1 speeds: index n is the speed back at the line.
 */
export function speedProfileFromStart(
  flying: Float64Array, kappa: Float64Array, seg: Float64Array, car: CarParams, v0 = 0, grip?: GripScale,
): Float64Array {
  const n = flying.length;
  const v = new Float64Array(n + 1);
  v[0] = Math.min(v0, flying[0]);
  for (let i = 1; i <= n; i++) v[i] = Math.min(flying[i % n], accelStep(car, v[i - 1], kappa, seg, grip, i - 1));
  return v;
}

/**
 * Point-to-point run (rally stage): standing start at point 0, flying finish
 * at the last point. kappa has n points, seg has n − 1 segments; returns n speeds.
 */
export function speedProfileOpen(kappa: Float64Array, seg: Float64Array, car: CarParams, grip?: GripScale, v0 = 0): Float64Array {
  const n = kappa.length;
  const lim = cornerLimit(kappa, car, grip);
  const v = new Float64Array(n);
  if (!n) return v;
  v[0] = Math.min(v0, lim[0]);
  for (let i = 1; i < n; i++) v[i] = Math.min(lim[i], accelStep(car, v[i - 1], kappa, seg, grip, i - 1));
  for (let i = n - 2; i >= 1; i--) v[i] = Math.min(v[i], brakeStep(car, v[i + 1], kappa, seg, grip, i));
  return v;
}
