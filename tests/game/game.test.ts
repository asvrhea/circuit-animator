import { describe, expect, it } from 'vitest';
import { stepAi } from '../../src/game/ai';
import { newCar, speedOf, stepCarFixed, type CarState, type Controls } from '../../src/game/car';
import { collide } from '../../src/game/collide';
import { DRIVERS } from '../../src/game/drivers';
import { createGame, finalizeResults, gapBetween, lightsLit, stepGame, type Game } from '../../src/game/race';
import { buildGameTrack, HALF_WIDTH, poseAtS, project, sampleAt, surfaceAtS, type GameTrack } from '../../src/game/track';
import { resampleClosed, resampleOpen } from '../../src/geom/resample';
import { CAR_PRESETS } from '../../src/sim/speed';

const car = CAR_PRESETS.formula.car;
const rally = CAR_PRESETS.rally.car;

/** Rounded rectangle-ish oval, 3 km. */
function oval(closed = true, gravel: [number, number][] = [], c = car): GameTrack {
  const pts = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    pts.push({ x: 600 * Math.cos(a), y: 300 * Math.sin(a) });
  }
  const path = closed ? resampleClosed(pts, 600) : resampleOpen(pts.slice(0, 250), 600);
  return buildGameTrack({ path, closed, lengthKm: closed ? 3 : 1.5, gravel, sectors: [1 / 3, 2 / 3], car: c });
}

const run = (c: CarState, ctl: Controls, secs: number, env = { lat: 1, long: 1, offTrack: false }, cp = car) => {
  for (let i = 0; i < secs * 60; i++) stepCarFixed(c, ctl, cp, env, 1 / 60);
};

describe('track', () => {
  const t = oval();
  it('measures the requested length', () => expect(t.length).toBeCloseTo(3000, -1));
  it('projects poses back to the same s and d', () => {
    for (const [s, d] of [[10, 0], [900, 3], [1700.5, -4], [2990, 1]]) {
      const p = poseAtS(t, s, d);
      const pr = project(t, p.x, p.y);
      expect(pr.s).toBeCloseTo(s, 0);
      expect(pr.d).toBeCloseTo(d, 0);
      const hinted = project(t, p.x, p.y, pr.index - 5);
      expect(hinted.s).toBeCloseTo(pr.s, 3);
    }
  });
  it('positive d is the right-hand side of travel', () => {
    const a = poseAtS(t, 100, 0), b = poseAtS(t, 100, 3);
    // right of (tx,ty) in screen coords is (-ty, tx)
    expect((b.x - a.x) * -a.ty + (b.y - a.y) * a.tx).toBeCloseTo(3, 3);
  });
  it('speed profile is capped by the car and slower in corners', () => {
    expect(Math.max(...t.profile)).toBeLessThanOrEqual(car.vMax + 1e-6);
    expect(Math.min(...t.profile)).toBeLessThan(Math.max(...t.profile));
    expect(sampleAt(t, t.profile, 5)).toBeGreaterThan(10);
  });
  it('reports gravel stretches', () => {
    const g = oval(true, [[0.2, 0.4]], rally);
    expect(surfaceAtS(g, 0.3 * g.length)).toBe('gravel');
    expect(surfaceAtS(g, 0.5 * g.length)).toBe('tarmac');
  });
});

describe('car physics', () => {
  it('accelerates, brakes to a stop, then reverses', () => {
    const c = newCar(0, 0, 0);
    run(c, { throttle: 1, brake: 0, steer: 0 }, 5);
    expect(speedOf(c)).toBeGreaterThan(30);
    expect(c.x).toBeGreaterThan(50);
    run(c, { throttle: 0, brake: 1, steer: 0 }, 6);
    expect(c.vx).toBeLessThan(0); // reversing
    expect(c.vx).toBeGreaterThan(-10);
    expect(Math.abs(c.vy)).toBeLessThan(0.1);
  });
  it('does not turn while standing still and turns right with steer > 0', () => {
    const c = newCar(0, 0, 0);
    run(c, { throttle: 0, brake: 0, steer: 1 }, 1);
    expect(c.heading).toBeCloseTo(0, 5);
    run(c, { throttle: 1, brake: 0, steer: 0 }, 2);
    run(c, { throttle: 0.3, brake: 0, steer: 1 }, 1.5);
    expect(c.heading).toBeGreaterThan(0.2);
  });
  it('steering gets less sharp with speed', () => {
    const slow = newCar(0, 0, 0), fast = newCar(0, 0, 0);
    slow.vx = 10;
    fast.vx = 80;
    run(slow, { throttle: 0.2, brake: 0, steer: 1 }, 0.5);
    run(fast, { throttle: 1, brake: 0, steer: 1 }, 0.5);
    expect(slow.heading).toBeGreaterThan(fast.heading * 2);
  });
  it('understeers and slides when the grip limit is exceeded', () => {
    const grippy = newCar(0, 0, 0), loose = newCar(0, 0, 0);
    grippy.vx = loose.vx = 50;
    const turn = (c: CarState, g: number) => {
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        stepCarFixed(c, { throttle: 0.5, brake: 0, steer: 1 }, rally, { lat: g, long: g, offTrack: false }, 1 / 60);
        peak = Math.max(peak, Math.abs(-Math.sin(c.heading) * c.vx + Math.cos(c.heading) * c.vy));
      }
      return peak;
    };
    const slipLoose = turn(loose, 0.3);
    turn(grippy, 1);
    expect(slipLoose).toBeGreaterThan(0.5); // sideways speed: sliding
    expect(loose.heading).toBeLessThan(grippy.heading); // and turning less
  });
  it('is much slower off the track', () => {
    const on = newCar(0, 0, 0), off = newCar(0, 0, 0);
    run(on, { throttle: 1, brake: 0, steer: 0 }, 8);
    run(off, { throttle: 1, brake: 0, steer: 0 }, 8, { lat: 0.55, long: 0.5, offTrack: true });
    expect(speedOf(off)).toBeLessThan(speedOf(on) * 0.5);
  });
  it('slows on gravel', () => {
    const t = new Array(2).fill(0).map(() => newCar(0, 0, 0));
    run(t[0], { throttle: 1, brake: 0, steer: 0 }, 4, { lat: 1, long: 1, offTrack: false }, rally);
    run(t[1], { throttle: 1, brake: 0, steer: 0 }, 4, { lat: 0.62, long: 0.68, offTrack: false }, rally);
    expect(speedOf(t[1])).toBeLessThan(speedOf(t[0]));
  });
});

describe('collisions', () => {
  it('separates overlapping circles and swaps closing speed', () => {
    const a = { x: 0, y: 0, vx: 10, vy: 0 }, b = { x: 3, y: 0, vx: 0, vy: 0 };
    expect(collide(a, b)).toBe(true);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(4.4 - 1e-9);
    expect(b.vx).toBeGreaterThan(a.vx);
  });
  it('ignores cars that are apart', () => {
    expect(collide({ x: 0, y: 0, vx: 0, vy: 0 }, { x: 10, y: 0, vx: 0, vy: 0 })).toBe(false);
  });
});

describe('ai driver', () => {
  it('backs off or goes round a slower car ahead', () => {
    const t = oval();
    const a = { s: 100, d: 0, v: 50, vd: 0, pace: 1, lane: 0 };
    for (let i = 0; i < 180; i++) stepAi(a, t, car, [{ gap: 15, d: 0, v: 20 }], 1 / 60);
    expect(Math.abs(a.d) > 1.5 || a.v < 35).toBe(true);
  });
});

const NO = { throttle: 0, brake: 0, steer: 0 };

function sim(g: Game, secs: number, ctl: Controls | ((g: Game) => Controls) = NO) {
  for (let i = 0; i < secs * 30; i++) stepGame(g, typeof ctl === 'function' ? ctl(g) : ctl, 1 / 30);
}

/** Crude driver: steer at a point ahead, hold a fraction of the profile speed. */
function pilot(frac: number) {
  return (g: Game): Controls => {
    const p = g.player, t = g.track;
    const look = 12 + Math.abs(p.speed) * 0.6;
    const target = poseAtS(t, p.prevS + look, 0);
    const want = Math.atan2(target.y - p.car.y, target.x - p.car.x);
    let e = want - p.car.heading;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    const v = sampleAt(t, t.profile, p.prevS + 20) * frac;
    return { throttle: p.speed < v ? 1 : 0, brake: p.speed > v * 1.15 ? 1 : 0, steer: Math.max(-1, Math.min(1, e * 2.5)) };
  };
}

describe('circuit race', () => {
  const mk = (extra: Partial<Parameters<typeof createGame>[0]> = {}) =>
    createGame({ track: oval(), car, laps: 2, opponents: 6, difficulty: 'normal', seed: 7, ...extra });

  it('holds the grid for the lights, then releases', () => {
    const g = mk();
    expect(g.racers).toHaveLength(7);
    expect(g.player.dist).toBeLessThan(g.racers[1].dist); // player at the back
    expect(lightsLit(g)).toBe(1);
    sim(g, 4.5);
    expect(lightsLit(g)).toBe(5);
    expect(g.phase).toBe('grid');
    expect(g.racers.every((r) => speedOf(r.car) === 0)).toBe(true);
    sim(g, 4);
    expect(g.phase).toBe('race');
    expect(g.racers[1].speed).toBeGreaterThan(5);
  });

  it('runs a full race: everyone finishes, classified by finishing time, laps counted', () => {
    const g = mk();
    sim(g, 400, pilot(0.5));
    const res = finalizeResults(g);
    expect(res.rows).toHaveLength(7);
    for (let i = 1; i < res.rows.length; i++) expect(res.rows[i].time).toBeGreaterThanOrEqual(res.rows[i - 1].time);
    expect(res.rows[0].gap).toBe(0);
    const ai = g.racers.filter((r) => !r.isPlayer);
    for (const r of ai) {
      expect(r.lapTimes).toHaveLength(2);
      // a lap at ~82-100% of the profile pace, so a bit slower than the ideal lap
      const ideal = t0().length / (t0().profile.reduce((a, b) => a + b, 0) / t0().n);
      expect(r.lapTimes[1]).toBeGreaterThan(ideal * 0.95);
      expect(r.lapTimes[1]).toBeLessThan(ideal * 1.6);
    }
    expect(res.rows.filter((r) => r.fastest)).toHaveLength(1);
  });

  it('keeps AI cars from stacking up', () => {
    const g = mk({ opponents: 9 });
    let worst = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      stepGame(g, NO, 1 / 30);
      if (g.phase === 'grid') continue;
      for (let a = 1; a < g.racers.length; a++)
        for (let b = a + 1; b < g.racers.length; b++) {
          const A = g.racers[a].car, B = g.racers[b].car;
          worst = Math.min(worst, Math.hypot(A.x - B.x, A.y - B.y));
        }
    }
    expect(worst).toBeGreaterThan(3.5); // circles of 2.2 m may touch but never sink into each other
  });

  it('a pilot can drive a lap on the road', () => {
    const g = mk({ opponents: 5, laps: 1 });
    let offFrames = 0, frames = 0;
    sim(g, 8);
    for (let i = 0; i < 300 * 30 && !g.player.finished; i++) {
      stepGame(g, pilot(0.45)(g), 1 / 30);
      frames++;
      if (g.player.offTrack) offFrames++;
    }
    expect(g.player.finished).toBe(true);
    expect(offFrames / frames).toBeLessThan(0.15);
  });

  it('gaps are non-negative times between ordered cars', () => {
    const g = mk();
    sim(g, 60);
    const [a, b] = g.order;
    const gap = gapBetween(b, a, g.track.length);
    expect(gap.seconds === null || gap.seconds >= 0).toBe(true);
  });

  it('clamps opponents and is deterministic for a seed', () => {
    expect(mk({ opponents: 50 }).racers).toHaveLength(10);
    const a = mk(), b = mk();
    expect(a.racers.map((r) => r.driver.code)).toEqual(b.racers.map((r) => r.driver.code));
  });
});

let cache: GameTrack | null = null;
const t0 = () => (cache ??= oval());

describe('rally stage', () => {
  const stage = oval(false, [[0, 1]], rally);
  it('has no competitors and starts the clock at the line', () => {
    const g = createGame({ track: stage, car: rally, laps: 5, opponents: 8, difficulty: 'hard', seed: 1 });
    expect(g.racers).toHaveLength(1);
    expect(g.laps).toBe(1);
    sim(g, 12, NO);
    expect(g.phase).toBe('race');
    expect(g.player.finished).toBe(false);
  });
  it('is a solo time trial that finishes with splits', () => {
    const g = createGame({ track: stage, car: rally, laps: 1, opponents: 0, difficulty: 'normal' });
    sim(g, 700, pilot(0.5));
    expect(g.player.finished).toBe(true);
    const res = finalizeResults(g);
    expect(res.closed).toBe(false);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].time).toBeGreaterThan(30);
    expect(res.splits).toHaveLength(3);
    expect(res.splits.reduce((a, b) => a + b, 0)).toBeCloseTo(res.rows[0].time, 1);
    expect(HALF_WIDTH).toBe(6);
  });
});

describe('fictional drivers', () => {
  it('has unique codes and colours, and none of the banned real codes', () => {
    expect(new Set(DRIVERS.map((d) => d.code)).size).toBe(DRIVERS.length);
    expect(new Set(DRIVERS.map((d) => d.color)).size).toBe(DRIVERS.length);
    const real = ['HAM', 'VER', 'LEC', 'NOR', 'ALO', 'SAI', 'RUS', 'PIA', 'GAS', 'OCO', 'STR', 'ALB', 'TSU', 'HUL', 'MAG', 'BOT', 'ZHO', 'RIC', 'PER', 'SAR', 'HAR', 'LIN'];
    for (const d of DRIVERS) {
      expect(real).not.toContain(d.code);
      expect(d.code).toMatch(/^[A-Z]{3}$/);
    }
    expect(DRIVERS.length).toBeGreaterThanOrEqual(9);
  });
});
