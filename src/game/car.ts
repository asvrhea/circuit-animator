import { brakeDecel, driveAccel, type CarParams } from '../sim/speed';

/**
 * Arcade car in metres and seconds. Screen axes (y down), so heading grows
 * clockwise and steer +1 turns right.
 *
 * The body has a heading; velocity is kept in the world frame. Each step the
 * velocity is split into forward and sideways parts: steering turns the
 * heading (kinematic bicycle, but never faster than the tyres can follow),
 * and the tyres pull the sideways part back to zero with a force capped by
 * grip. Over the cap the car slides: it keeps going where it was pointed.
 */
export interface CarState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  /** smoothed steering, -1..1 */
  steer: number;
  /** yaw rate, rad/s */
  yaw: number;
}

export interface Controls {
  /** 0..1 */
  throttle: number;
  /** 0..1; reverses once stopped */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
}

export interface Env {
  /** cornering grip multiplier (surface and off-track already folded in) */
  lat: number;
  /** drive / braking grip multiplier */
  long: number;
  offTrack: boolean;
}

export const NO_CONTROLS: Controls = { throttle: 0, brake: 0, steer: 0 };

/** Collision circle radius and visual size, m. */
export const CAR_RADIUS = 2.2;
export const CAR_LENGTH = 5;
export const CAR_WIDTH = 2;

const WHEELBASE = 3.2;
const MAX_STEER_TAN = Math.tan(0.5);
const REVERSE_MAX = 9;
const OFF_TRACK = { lat: 0.55, long: 0.5, drag: 6, vMax: 0.45 };

export const newCar = (x: number, y: number, heading: number): CarState => ({ x, y, heading, vx: 0, vy: 0, steer: 0, yaw: 0 });

export const forwardSpeed = (c: CarState): number => c.vx * Math.cos(c.heading) + c.vy * Math.sin(c.heading);
export const speedOf = (c: CarState): number => Math.hypot(c.vx, c.vy);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function stepCar(c: CarState, ctl: Controls, car: CarParams, env: Env, dt: number): void {
  const fx = Math.cos(c.heading), fy = Math.sin(c.heading);
  const lx = -fy, ly = fx;
  let vf = c.vx * fx + c.vy * fy;
  let vl = c.vx * lx + c.vy * ly;

  // keyboard steering ramps in quickly and returns to centre faster
  const want = clamp(ctl.steer, -1, 1);
  const rate = (Math.abs(want) > Math.abs(c.steer) && want * c.steer >= 0 ? 4.5 : 7) * dt;
  c.steer += clamp(want - c.steer, -rate, rate);

  const latLimit = car.aLat * env.lat;
  const longLimit = env.long;

  // ---- longitudinal
  let a = 0;
  const braking = ctl.brake > 0 && vf > 0.5;
  const reversing = ctl.brake > 0 && vf <= 0.5;
  if (braking) a = -brakeDecel(car, vf, 0, env.lat, longLimit) * ctl.brake;
  else if (reversing) a = vf > -REVERSE_MAX ? -0.35 * car.aAccel * longLimit * ctl.brake : 0;
  else if (ctl.throttle > 0) {
    const slip = 1 - Math.min(0.6, Math.abs(vl) / (Math.abs(vf) + 3));
    if (vf < -0.5) a = brakeDecel(car, 0, 0, env.lat, longLimit) * ctl.throttle; // throttle while rolling backwards stops the car
    else a = driveAccel(car, Math.max(vf, 0), 0, env.lat, longLimit) * ctl.throttle * slip;
  }
  if (!braking && !(ctl.throttle > 0 && vf >= -0.5)) {
    // coasting: engine braking and drag
    const coast = 1 + 0.0004 * vf * vf;
    a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, coast);
  }
  let latBudget = latLimit;
  // friction circle: hard braking / accelerating leaves less for cornering
  const used = clamp(Math.abs(a) / Math.max(1e-6, car.aBrake * longLimit), 0, 1);
  latBudget *= Math.sqrt(Math.max(0.2, 1 - 0.6 * used * used));

  if (env.offTrack) {
    a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, OFF_TRACK.drag * (1 + Math.abs(vf) / 30));
    const cap = car.vMax * OFF_TRACK.vMax;
    if (vf > cap) a -= (vf - cap) * 2.5;
  }

  const vfBefore = vf;
  vf += a * dt;
  // braking never flips the direction of travel by itself: stop first, reverse on the next frame
  if (braking && vfBefore > 0 && vf < 0) vf = 0;

  // ---- yaw
  const speed = Math.abs(vf);
  const wGeom = (speed * MAX_STEER_TAN) / WHEELBASE;
  const wGrip = (1.15 * latBudget) / Math.max(speed, 1);
  const wTarget = c.steer * Math.min(wGeom, wGrip) * (vf >= 0 ? 1 : -1);
  c.yaw += clamp(wTarget - c.yaw, -14 * dt, 14 * dt);
  c.heading += c.yaw * dt;

  // ---- tyres pull the sideways velocity back, up to the grip limit
  const dv = clamp(-vl * Math.min(1, 12 * dt), -latBudget * dt, latBudget * dt);
  vl += dv;

  // rebuild the world velocity in the (pre-rotation) body frame; the heading change shows up as slip next step
  c.vx = fx * vf + lx * vl;
  c.vy = fy * vf + ly * vl;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
}

/** Fixed sub-steps keep the integration stable at any frame rate. */
export function stepCarFixed(c: CarState, ctl: Controls, car: CarParams, env: Env, dt: number, max = 1 / 120): void {
  const n = Math.max(1, Math.ceil(dt / max));
  for (let i = 0; i < n; i++) stepCar(c, ctl, car, env, dt / n);
}
