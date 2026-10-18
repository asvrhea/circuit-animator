/**
 * Quasi-steady-state speed profile on a closed lap.
 *
 *   v_corner = min(vMax, sqrt(aLat / κ))
 *
 * then a forward pass caps acceleration and a backward pass caps braking.
 * Longitudinal grip shrinks with the lateral grip already in use (friction
 * circle), and drive force fades towards top speed (drag), so the car
 * brakes before corners, is slow through them, and builds speed out of them.
 */

export interface CarParams {
  /** top speed, m/s */
  vMax: number;
  /** peak lateral acceleration, m/s² */
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

export type CarPreset = 'formula' | 'gt' | 'road';

export const CAR_PRESETS: Record<CarPreset, { label: string; car: CarParams }> = {
  formula: { label: 'Formula', car: { vMax: kmh(330), aLat: 4.0 * G, aAccel: 1.4 * G, aBrake: 4.5 * G, vMin: kmh(45) } },
  gt: { label: 'GT', car: { vMax: kmh(290), aLat: 1.8 * G, aAccel: 0.8 * G, aBrake: 1.6 * G, vMin: kmh(35) } },
  road: { label: 'Road car', car: { vMax: kmh(230), aLat: 0.95 * G, aAccel: 0.45 * G, aBrake: 1.0 * G, vMin: kmh(25) } },
};

/** Share of a longitudinal limit left over after cornering load (friction circle). */
function gripLeft(v: number, kappa: number, aLat: number, floor: number): number {
  const u = (v * v * kappa) / aLat;
  return Math.max(floor, Math.sqrt(Math.max(0, 1 - u * u)));
}

/** Drive acceleration available at speed v on curvature κ. */
export function driveAccel(car: CarParams, v: number, kappa: number): number {
  const drag = Math.max(0.04, 1 - (v / car.vMax) ** 2);
  return car.aAccel * drag * gripLeft(v, kappa, car.aLat, 0.2);
}

export function brakeDecel(car: CarParams, v: number, kappa: number): number {
  return car.aBrake * gripLeft(v, kappa, car.aLat, 0.3);
}

/** Cornering limit at each point. */
export function cornerLimit(kappa: Float64Array, car: CarParams): Float64Array {
  const out = new Float64Array(kappa.length);
  for (let i = 0; i < kappa.length; i++) {
    const v = kappa[i] > 1e-9 ? Math.sqrt(car.aLat / kappa[i]) : Infinity;
    out[i] = Math.max(car.vMin, Math.min(car.vMax, v));
  }
  return out;
}

/** Highest v1 reachable from v0 over distance ds while accelerating. */
const accelStep = (car: CarParams, v0: number, k: number, ds: number) =>
  Math.sqrt(v0 * v0 + 2 * driveAccel(car, v0, k) * ds);

/**
 * Flying-lap profile on a closed loop. kappa[i] in 1/m at point i,
 * seg[i] = metres from point i to point i+1 (wrapping).
 */
export function speedProfileClosed(kappa: Float64Array, seg: Float64Array, car: CarParams): Float64Array {
  const n = kappa.length;
  const lim = cornerLimit(kappa, car);
  const v = new Float64Array(n);
  if (!n) return v;

  // Start both passes at the slowest corner: its speed is fixed by grip alone,
  // so one lap around from there is exact for a closed loop.
  let m = 0;
  for (let i = 1; i < n; i++) if (lim[i] < lim[m]) m = i;

  v[m] = lim[m];
  for (let k = 1; k < n; k++) {
    const i = (m + k) % n, p = (i - 1 + n) % n;
    v[i] = Math.min(lim[i], accelStep(car, v[p], kappa[p], seg[p]));
  }
  for (let k = 1; k < n; k++) {
    const i = (m - k + n) % n, nx = (i + 1) % n;
    v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * brakeDecel(car, v[nx], kappa[i]) * seg[i]));
  }
  return v;
}

/**
 * Standing-start lap: accelerate from `v0` at point 0, never exceeding the
 * flying-lap profile (which already contains every braking zone). Returns
 * n + 1 speeds: index n is the speed back at the line.
 */
export function speedProfileFromStart(flying: Float64Array, kappa: Float64Array, seg: Float64Array, car: CarParams, v0 = 0): Float64Array {
  const n = flying.length;
  const v = new Float64Array(n + 1);
  v[0] = Math.min(v0, flying[0]);
  for (let i = 1; i <= n; i++) {
    const p = i - 1;
    v[i] = Math.min(flying[i % n], accelStep(car, v[p], kappa[p], seg[p]));
  }
  return v;
}
