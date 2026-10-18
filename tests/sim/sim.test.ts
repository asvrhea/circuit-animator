import { describe, expect, it } from 'vitest';
import { resampleClosed } from '../../src/geom/resample';
import type { Vec2 } from '../../src/geom/vec2';
import { curvatureClosed, segmentLengths } from '../../src/sim/curvature';
import { buildLap, sampleAtTime, sectorTimes, timeAtDist } from '../../src/sim/lap';
import { buildRace, formatLapTime, raceState } from '../../src/sim/race';
import {
  brakeDecel, CAR_PRESETS, cornerLimit, driveAccel, speedProfileClosed, speedProfileFromStart, type CarParams,
} from '../../src/sim/speed';
import { circle } from '../helpers/synth';

const car: CarParams = CAR_PRESETS.formula.car;

/** Stadium: two 1000 m straights joined by R=50 m hairpins (metres = units). */
function stadium(n = 2000): Vec2[] {
  const pts: Vec2[] = [];
  const R = 50, L = 1000;
  for (let i = 0; i <= 50; i++) pts.push({ x: (L * i) / 50, y: 0 });
  for (let i = 1; i < 60; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 60;
    pts.push({ x: L + R * Math.cos(a), y: R + R * Math.sin(a) });
  }
  for (let i = 0; i <= 50; i++) pts.push({ x: L - (L * i) / 50, y: 2 * R });
  for (let i = 1; i < 60; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 60;
    pts.push({ x: R * Math.cos(a), y: R + R * Math.sin(a) });
  }
  return resampleClosed(pts, n);
}

describe('curvature', () => {
  it('is 1/R on a circle', () => {
    const k = curvatureClosed(circle(0, 0, 200, 500));
    for (const v of k) expect(v).toBeCloseTo(1 / 200, 5);
  });

  it('is ~0 on straights and ~1/R in hairpins', () => {
    const path = stadium();
    const k = curvatureClosed(path);
    expect(k[200]).toBeLessThan(1e-6); // middle of first straight
    expect(Math.max(...k)).toBeCloseTo(1 / 50, 2);
  });
});

describe('speed profile', () => {
  it('limits cornering speed by lateral grip', () => {
    const lim = cornerLimit(new Float64Array([0, 1 / 100]), car);
    expect(lim[0]).toBe(car.vMax);
    expect(lim[1]).toBeCloseTo(Math.sqrt(car.aLat * 100));
  });

  it('runs a constant-radius circle at the grip limit', () => {
    const path = circle(0, 0, 300, 600);
    const v = speedProfileClosed(curvatureClosed(path), segmentLengths(path), car);
    for (const x of v) expect(x).toBeCloseTo(Math.min(car.vMax, Math.sqrt(car.aLat * 300)), 3);
  });

  const path = stadium();
  const kappa = curvatureClosed(path);
  const seg = segmentLengths(path);
  const v = speedProfileClosed(kappa, seg, car);

  it('slows visibly for corners', () => {
    const straight = Math.max(...v.slice(0, 860)); // first 1000 m straight
    const hairpin = Math.min(...v);
    expect(hairpin).toBeLessThan(Math.sqrt(car.aLat * 50) * 1.02);
    expect(straight).toBeGreaterThan(hairpin * 1.6);
  });

  it('never exceeds the acceleration or braking limits', () => {
    const n = v.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dv2 = v[j] * v[j] - v[i] * v[i];
      if (dv2 > 0) expect(dv2).toBeLessThanOrEqual(2 * driveAccel(car, v[i], kappa[i]) * seg[i] + 1e-6);
      else expect(-dv2).toBeLessThanOrEqual(2 * brakeDecel(car, v[j], kappa[i]) * seg[i] + 1e-6);
    }
  });

  it('brakes before the corner rather than inside it', () => {
    // speed falls in the last metres of the straight before the first hairpin
    const entry = path.findIndex((_, i) => i > 100 && kappa[i] > 0.5 / 50);
    expect(v[entry - 40]).toBeGreaterThan(v[entry] * 1.3);
  });

  it('standing start begins at 0 and joins the flying lap', () => {
    const s = speedProfileFromStart(v, kappa, seg, car, 0);
    expect(s[0]).toBe(0);
    expect(s[50]).toBeLessThan(v[50]);
    expect(s[s.length - 1]).toBeCloseTo(v[0], 6);
  });
});

describe('lap timing', () => {
  it('integrates a constant-speed lap', () => {
    const seg = new Float64Array(100).fill(10);
    const lap = buildLap(seg, new Float64Array(100).fill(50));
    expect(lap.length).toBe(1000);
    expect(lap.lapTime).toBeCloseTo(20);
    const s = sampleAtTime(lap, 7);
    expect(s.dist).toBeCloseTo(350);
    expect(timeAtDist(lap, 350)).toBeCloseTo(7);
    expect(sectorTimes(lap, [0.25, 0.5])).toEqual([5, 10, 20].map((x) => expect.closeTo(x, 9)) as never);
  });

  it('handles a standing start smoothly', () => {
    const seg = new Float64Array([10, 10]);
    const lap = buildLap(seg, new Float64Array([0, 10, 20]));
    // constant accel 0->10 over 10 m takes 2 s
    expect(lap.time[1]).toBeCloseTo(2);
    expect(sampleAtTime(lap, 1).dist).toBeCloseTo(2.5);
    expect(timeAtDist(lap, 2.5)).toBeCloseTo(1);
  });
});

describe('race timeline', () => {
  const race = buildRace({ path: stadium(1000), lengthKm: 2.314, car, laps: 3, sectors: [1 / 3, 2 / 3] });

  it('scales the path to the given length', () => {
    expect(race.flying.length).toBeCloseTo(2314, 0);
  });

  it('first lap is slower than flying laps', () => {
    expect(race.first.lapTime).toBeGreaterThan(race.flying.lapTime);
    expect(race.total).toBeCloseTo(race.intro + race.first.lapTime + 2 * race.flying.lapTime + race.outro);
  });

  it('walks through intro, laps and outro', () => {
    expect(raceState(race, 1).phase).toBe('intro');
    const mid = raceState(race, race.intro + race.first.lapTime + 1);
    expect(mid.phase).toBe('race');
    expect(mid.lap).toBe(2);
    expect(mid.lapTimes).toEqual([race.first.lapTime]);
    const end = raceState(race, race.total - 0.01);
    expect(end.phase).toBe('outro');
    expect(end.finished).toBe(true);
    expect(end.lapTimes.length).toBe(3);
    expect(end.sectorSplits.length).toBe(3);
  });

  it('reports sectors as the lap progresses', () => {
    const st = sectorTimes(race.flying, race.sectors);
    const t0 = race.intro + race.lapStart[1];
    expect(raceState(race, t0 + st[0] / 2).sector).toBe(0);
    expect(raceState(race, t0 + (st[0] + st[1]) / 2).sectorSplits.length).toBe(1);
    expect(raceState(race, t0 + (st[1] + st[2]) / 2).sector).toBe(2);
  });

  it('formats lap times', () => {
    expect(formatLapTime(83.4567)).toBe('1:23.457');
    expect(formatLapTime(5.2)).toBe('0:05.200');
  });
});
