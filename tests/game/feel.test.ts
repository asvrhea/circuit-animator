import { describe, expect, it } from 'vitest';
import { newCar, stepCarFixed, type CarState, type Controls } from '../../src/game/car';
import { buildPaceNotes, noteLabel, severityOf, upcomingNotes } from '../../src/game/pacenotes';
import { advance, createGame, PHYS_DT, stepGame } from '../../src/game/race';
import { buildGameTrack, type GameTrack } from '../../src/game/track';
import { WALL_D, WALL_MAX_PEN, wallStep } from '../../src/game/wall';
import { resampleClosed, resampleOpen } from '../../src/geom/resample';
import { CAR_PRESETS } from '../../src/sim/speed';

const car = CAR_PRESETS.formula.car;
const NO: Controls = { throttle: 0, brake: 0, steer: 0 };
const ENV = { lat: 1, long: 1, offTrack: false };

/** Stadium: straights joined by semicircles of radius r, clockwise on screen. */
function stadium(r: number, straight: number, closed = true): GameTrack {
  const pts = [];
  for (let x = 0; x < straight; x += 5) pts.push({ x, y: -r });
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += 5 / r) pts.push({ x: straight + r * Math.cos(a), y: r * Math.sin(a) });
  for (let x = straight; x > 0; x -= 5) pts.push({ x, y: r });
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 5 / r) pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const path = closed ? resampleClosed(pts, 400) : resampleOpen(pts.slice(0, Math.floor(pts.length * 0.6)), 300);
  const len = closed ? 2 * straight + 2 * Math.PI * r : 1000;
  return buildGameTrack({ path, closed, lengthKm: len / 1000, gravel: [], sectors: [1 / 3, 2 / 3], car });
}

describe('soft wall', () => {
  it('does nothing away from the edge', () => {
    const l = { d: 2, vd: 5 };
    expect(wallStep(l, 1 / 240)).toBe(1);
    expect(l).toEqual({ d: 2, vd: 5 });
  });

  it('bounces a fast hit back in, never past the max depth, and scrubs speed', () => {
    const l = { d: WALL_D - 0.01, vd: 30 };
    let deepest = 0, scrub = 1, bounced = false;
    for (let i = 0; i < 240 * 2; i++) {
      if (l.d > WALL_D) {
        scrub *= wallStep(l, 1 / 240);
        deepest = Math.max(deepest, l.d - WALL_D);
      } else l.d += l.vd / 240; // free flight
      if (l.vd < -0.5) bounced = true;
    }
    expect(deepest).toBeLessThanOrEqual(WALL_MAX_PEN + 1e-9);
    expect(deepest).toBeGreaterThan(0.3);
    expect(bounced).toBe(true);
    expect(l.vd).toBeLessThan(0); // leaves heading inward
    expect(scrub).toBeLessThan(1);
  });

  it('is symmetric on the left side', () => {
    const l = { d: -(WALL_D + 0.5), vd: -10 };
    wallStep(l, 1 / 240);
    expect(l.vd).toBeGreaterThan(-10);
    expect(l.d).toBeLessThan(0);
  });

  it('keeps a car that is driven into the edge on the road, moving and not stuck', () => {
    const track = stadium(60, 300);
    const g = createGame({ track, car, laps: 1, opponents: 0, difficulty: 'normal', seed: 3 });
    // let go of the wheel on the long straight, steering gently away from the bend so it understeers off
    let maxD = 0, backwards = false;
    for (let i = 0; i < 40 * 30; i++) {
      stepGame(g, { throttle: 1, brake: 0, steer: g.raceTime > 3 ? 0.12 : 0 }, 1 / 30);
      maxD = Math.max(maxD, Math.abs(g.player.d));
      if (g.raceTime > 3 && g.player.speed < -0.5) backwards = true;
    }
    expect(maxD).toBeGreaterThan(WALL_D - 0.2); // it did reach the wall
    expect(maxD).toBeLessThanOrEqual(WALL_D + WALL_MAX_PEN + 0.4);
    expect(backwards).toBe(false);
    expect(Math.abs(g.player.speed)).toBeGreaterThan(1); // still rolling along the barrier, not stuck
  });

  it('keeps AI cars inside the barrier too', () => {
    const g = createGame({ track: stadium(60, 300), car, laps: 1, opponents: 6, difficulty: 'normal', seed: 5 });
    let maxD = 0;
    for (let i = 0; i < 90 * 30; i++) {
      stepGame(g, NO, 1 / 30);
      for (const r of g.racers) if (r.ai) maxD = Math.max(maxD, Math.abs(r.ai.d));
    }
    expect(maxD).toBeLessThanOrEqual(WALL_D + WALL_MAX_PEN + 1e-6);
  });
});

describe('steering feel', () => {
  const run = (c: CarState, ctl: Controls, secs: number) => {
    for (let i = 0; i < secs * 60; i++) stepCarFixed(c, ctl, car, ENV, 1 / 60);
  };

  it('reaches full lock in about a tenth of a second', () => {
    const c = newCar(0, 0, 0);
    c.vx = 20;
    run(c, { throttle: 0.3, brake: 0, steer: 1 }, 0.11);
    expect(c.steer).toBeGreaterThan(0.99);
  });

  it('starts turning at once at medium speed', () => {
    const c = newCar(0, 0, 0);
    c.vx = 30;
    run(c, { throttle: 0.3, brake: 0, steer: 1 }, 0.15);
    expect(c.heading).toBeGreaterThan(0.1);
  });

  it('barely slides in a gentle turn within the grip limit', () => {
    const c = newCar(0, 0, 0);
    c.vx = 30;
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepCarFixed(c, { throttle: 0.3, brake: 0, steer: 0.3 }, car, ENV, 1 / 60);
      peak = Math.max(peak, Math.abs(-Math.sin(c.heading) * c.vx + Math.cos(c.heading) * c.vy));
    }
    expect(peak).toBeLessThan(0.8);
  });

  it('plays the same at 30 and 144 fps (fixed physics step)', () => {
    const play = (fps: number) => {
      const g = createGame({ track: stadium(60, 300), car, laps: 1, opponents: 0, difficulty: 'normal', seed: 9 });
      let acc = 0;
      const frames = Math.round(14 * fps);
      for (let i = 0; i < frames; i++) acc = advance(g, { throttle: 1, brake: 0, steer: i > 10 * fps ? 0.2 : 0 }, acc, 1 / fps);
      return g.player.car;
    };
    const a = play(30), b = play(144);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.heading - b.heading)).toBeLessThan(0.02);
    expect(PHYS_DT).toBeLessThan(1 / 200);
  });
});

describe('pace notes', () => {
  it('rates radius from hairpin to kink', () => {
    expect([15, 30, 50, 90, 140, 220].map(severityOf)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('finds both ends of a stadium as right-handers with the right severity', () => {
    const notes = buildPaceNotes(stadium(45, 400));
    expect(notes).toHaveLength(2);
    for (const n of notes) {
      expect(n.dir).toBe('right'); // clockwise on screen
      expect(n.severity).toBe(3);
      expect(n.angle).toBeGreaterThan(2.5);
    }
    expect(noteLabel(notes[0])).toBe('RIGHT 3');
  });

  it('turns the other way when the track is driven the other way', () => {
    const t = stadium(45, 400);
    const rev = buildGameTrack({
      path: t.path.map((p) => ({ x: p.x / t.mpu, y: p.y / t.mpu })).reverse(),
      closed: true, lengthKm: t.length / 1000, gravel: [], sectors: [0.3, 0.6], car,
    });
    const notes = buildPaceNotes(rev);
    expect(notes.length).toBe(2);
    expect(notes.every((n) => n.dir === 'left')).toBe(true);
  });

  it('announces the next corner with a shrinking distance, then moves on after the apex', () => {
    const t = stadium(45, 400);
    const notes = buildPaceNotes(t);
    const first = notes[0];
    const far = upcomingNotes(t, notes, first.entryS - 300, 450, 2);
    expect(far[0].note).toBe(first);
    expect(far[0].dist).toBeCloseTo(300, -1);
    expect(upcomingNotes(t, notes, first.entryS - 100)[0].dist).toBeCloseTo(100, -1);
    expect(upcomingNotes(t, notes, first.entryS - 400, 200)).toHaveLength(0);
    const inside = upcomingNotes(t, notes, first.entryS + 10)[0];
    expect(inside.note).toBe(first);
    expect(inside.dist).toBe(0);
    expect(upcomingNotes(t, notes, first.apexS + 15, 700)[0].note).toBe(notes[1]);
  });

  it('wraps around the start line on a circuit', () => {
    const t = stadium(45, 400);
    const notes = buildPaceNotes(t);
    const last = notes[notes.length - 1];
    const ahead = upcomingNotes(t, notes, last.exitS + 20, 700, 2);
    expect(ahead[0].note).toBe(notes[0]);
    expect(ahead[0].dist).toBeGreaterThan(0);
  });

  it('works on an open stage and drops corners already passed', () => {
    const t = stadium(45, 400, false);
    const notes = buildPaceNotes(t);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(upcomingNotes(t, notes, 0, 5000, 5).map((a) => a.index)).toEqual(notes.map((_, i) => i));
    expect(upcomingNotes(t, notes, t.length, 5000, 5)).toHaveLength(0);
  });

  it('gives a straight no notes', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i * 10, y: 0 }));
    const t = buildGameTrack({ path: pts, closed: false, lengthKm: 1, gravel: [], sectors: [0.3, 0.6], car });
    expect(buildPaceNotes(t)).toHaveLength(0);
  });
});
