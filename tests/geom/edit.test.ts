import { describe, expect, it } from 'vitest';
import {
  apexIndex, controlAt, CORNER_MIN_SCALE, findCorner, MIN_CONTROLS, scaleCorner, straighten, straightenBetween, tightnessToScale,
  distanceToPath, fractionAt, insertControl, nearestIndex, removeControl, reverseControls, reverseSectors, setSector, setStart,
} from '../../src/geom/edit';
import { resampleClosed } from '../../src/geom/resample';
import { catmullRomClosed } from '../../src/geom/spline';
import { pathFromControls } from '../../src/geom/track';
import type { Vec2 } from '../../src/geom/vec2';
import { curvatureClosed } from '../../src/sim/curvature';

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('edit ops', () => {
  it('finds nearest control within range', () => {
    expect(nearestIndex(sq, { x: 9, y: 1 }, 3)).toBe(1);
    expect(nearestIndex(sq, { x: 5, y: 5 }, 3)).toBe(-1);
  });

  it('inserts on the nearest edge', () => {
    const { controls, index } = insertControl(sq, { x: 10.5, y: 5 });
    expect(index).toBe(2);
    expect(controls[2]).toEqual({ x: 10.5, y: 5 });
    expect(controls.length).toBe(5);
  });

  it('will not delete below the minimum', () => {
    expect(removeControl(sq, 0)).toBe(sq);
    expect(removeControl([...sq, { x: -1, y: 5 }], 4).length).toBe(4);
  });

  it('reverses direction keeping the start', () => {
    expect(reverseControls(sq).map((p) => p.x + ',' + p.y)).toEqual(['0,0', '0,10', '10,10', '10,0']);
    expect(reverseSectors([0.2, 0.5])).toEqual([0.5, 0.8]);
  });

  it('moves the start by snapping or inserting', () => {
    expect(setStart(sq, { x: 10, y: 9 }, 2)[0]).toEqual({ x: 10, y: 10 });
    const s = setStart(sq, { x: 5, y: 0 }, 2);
    expect(s[0]).toEqual({ x: 5, y: 0 });
    expect(s[1]).toEqual({ x: 10, y: 0 });
    expect(s.length).toBe(5);
  });

  it('measures lap fraction along an evenly sampled path', () => {
    const path = resampleClosed(sq, 40);
    expect(fractionAt(path, { x: 10, y: 0 })).toBeCloseTo(0.25);
    expect(distanceToPath(path, { x: 5, y: -2 }).dist).toBeCloseTo(2);
  });

  it('clamps sector splits to stay ordered', () => {
    expect(setSector([0.3, 0.6], 0, 0.9)).toEqual([0.58, 0.6]);
    expect(setSector([0.3, 0.6], 1, 0.1)[1]).toBeCloseTo(0.32);
    expect(setSector([0.3, 0.6], 1, 0.7)).toEqual([0.3, 0.7]);
  });
});

/** 100×100 square whose corners are rounded by three-point arcs of radius 20. */
function roundedSquare(): Vec2[] {
  const out: Vec2[] = [];
  const corners = [
    { c: { x: 80, y: 20 }, a0: -90 }, { c: { x: 80, y: 80 }, a0: 0 },
    { c: { x: 20, y: 80 }, a0: 90 }, { c: { x: 20, y: 20 }, a0: 180 },
  ];
  for (const { c, a0 } of corners) {
    for (const da of [0, 45, 90]) {
      const a = ((a0 + da) * Math.PI) / 180;
      out.push({ x: c.x + 20 * Math.cos(a), y: c.y + 20 * Math.sin(a) });
    }
    const end = out[out.length - 1], dir = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }][corners.findIndex((q) => q.c === c)];
    out.push({ x: end.x + 30 * dir.x, y: end.y + 30 * dir.y });
  }
  return out; // 16 points, start (80,0), driving +x then +y …
}

const offLine = (p: Vec2, a: Vec2, b: Vec2) =>
  Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);

const circle = (n: number, r = 100): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) }));

describe('straighten', () => {
  it('replaces the stretch with an exactly straight span', () => {
    const c = circle(12);
    const s = straighten(c, 2, 6);
    expect(s.length).toBe(12 - 3 + 2);
    expect(s[0]).toEqual(c[0]);
    expect(s[2]).toEqual(c[2]);
    expect(s[5]).toEqual(c[6]);
    // spline span between the two helpers (controls 3 → 4) lies on line c2–c6
    const spline = catmullRomClosed(s, 20);
    for (let k = 3 * 20; k <= 4 * 20; k++) expect(offLine(spline[k], c[2], c[6])).toBeLessThan(1e-6);
  });

  it('keeps the start when it lies inside the stretch', () => {
    const c = circle(12);
    const s = straighten(c, 10, 2);
    expect(s.length).toBe(12 - 3 + 3);
    expect(offLine(s[0], c[10], c[2])).toBeLessThan(1e-9);
    expect(s[0].x).toBeCloseTo(c[10].x); // projection of (100,0) onto the chord x = 50
    const i10 = s.findIndex((p) => p === c[10]), i2 = s.findIndex((p) => p === c[2]);
    expect([i10, i2]).toEqual([s.length - 2, 2]);
  });

  it('refuses degenerate stretches and picks the shorter side', () => {
    const c = circle(6);
    expect(straighten(c, 3, 3)).toBe(c);
    expect(straighten(c, 3, 2)).toBe(c);
    expect(straightenBetween(c, 4, 1).length).toBe(6 - 2 + 2);
    expect(straightenBetween(circle(8), 1, 2).length).toBe(10); // adjacent: only helpers added
    expect(straightenBetween(circle(8), 6, 1)).toEqual(straighten(circle(8), 6, 1));
  });

  it('never drops below the minimum point count', () => {
    const s = straighten(sq, 0, 2);
    expect(s.length).toBeGreaterThanOrEqual(MIN_CONTROLS);
  });

  it('snaps to an existing control or inserts one', () => {
    expect(controlAt(sq, { x: 9, y: 1 }, 3)).toEqual({ controls: sq, index: 1 });
    expect(controlAt(sq, { x: 5, y: 0 }, 3).index).toBe(1);
    expect(controlAt(sq, { x: 5, y: 0 }, 3).controls.length).toBe(5);
  });
});

describe('corner tightness', () => {
  /** peak curvature of the first corner (path inside x > 55, y < 45) */
  const peak = (ctrl: Vec2[]) => {
    const path = pathFromControls(ctrl), k = curvatureClosed(path);
    return Math.max(...path.map((p, i) => (p.x > 55 && p.y < 45 ? k[i] : 0)));
  };

  it('finds the corner around its apex and its vertex', () => {
    const c = roundedSquare();
    const k = findCorner(c, 1)!; // (94.1, 5.9), apex of the first corner
    expect(k.indices).toEqual([15, 0, 1, 2, 3]);
    expect(k.vertex.x).toBeCloseTo(100);
    expect(k.vertex.y).toBeCloseTo(0);
    expect(k.edgeMaxScale).toBeCloseTo((0.8 * 80) / 50);
    expect(k.maxScale).toBeCloseTo(0.9 / 0.4); // (80,0) and (100,20) sit 60% of the way from vertex to chord
  });

  it('opens the curve past the entry/exit limit', () => {
    const c = roundedSquare();
    const k = findCorner(c, 1)!;
    const open = scaleCorner(c, k, 2);
    expect(open[15].x).toBeCloseTo(100 - 50 * k.edgeMaxScale); // entry stops short of (20,0)
    expect(open[1].x).toBeCloseTo(100 - (100 - c[1].x) * 2); // apex gets the full scale
    expect(open[0].x).toBeGreaterThan(100 - 20 * 2); // tapering towards the entry
    expect(open[0].x).toBeLessThan(100 - 20 * k.edgeMaxScale);
    expect(peak(open)).toBeLessThan(peak(scaleCorner(c, k, k.edgeMaxScale)));
  });

  it('tightening raises peak curvature, opening lowers it, straights stay put', () => {
    const c = roundedSquare();
    const k = findCorner(c, 1)!;
    const tight = scaleCorner(c, k, 0.5), open = scaleCorner(c, k, 1.25);
    expect(peak(tight)).toBeGreaterThan(peak(c) * 1.5);
    expect(peak(open)).toBeLessThan(peak(c));
    // entry still on y = 0, exit still on x = 100
    expect(tight[15].y).toBeCloseTo(0);
    expect(tight[15].x).toBeCloseTo(75);
    expect(tight[3].x).toBeCloseTo(100);
    // other corners untouched
    expect(tight.slice(4, 15)).toEqual(c.slice(4, 15));
  });

  it('clamps the scale', () => {
    const c = roundedSquare();
    const k = findCorner(c, 1)!;
    expect(scaleCorner(c, k, 10)).toEqual(scaleCorner(c, k, k.maxScale));
    expect(scaleCorner(c, k, 0)).toEqual(scaleCorner(c, k, CORNER_MIN_SCALE));
    expect(tightnessToScale(0)).toBe(1);
    expect(tightnessToScale(1)).toBeLessThan(1);
  });

  it('does not run on across a straight into the next corner', () => {
    // two right-handers joined by a 200-long straight whose ends still turn a little
    const c = [[200, 200], [500, 200], [800, 200], [870, 230], [900, 300], [900, 500], [880, 580], [800, 620], [500, 650], [200, 650]]
      .map(([x, y]) => ({ x, y }));
    expect(findCorner(c, 3)!.indices).toEqual([1, 2, 3, 4, 5]);
  });

  it('a single-point corner scales about that point', () => {
    const c = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const k = findCorner(c, 2)!;
    expect(k.indices).toEqual([1, 2, 3]);
    expect(k.vertex).toEqual({ x: 100, y: 0 });
    expect(scaleCorner(c, k, 0.5).slice(1, 4)).toEqual([{ x: 75, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 25 }]);
  });

  it('falls back to the entry/exit midpoint for hairpins', () => {
    // long thin loop: two parallel straights joined by tight ends
    const c = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 210, y: 5 }, { x: 200, y: 10 }, { x: 100, y: 10 }, { x: 0, y: 10 }, { x: -10, y: 5 },
    ];
    const k = findCorner(c, 3)!;
    expect(k.indices).toEqual([1, 2, 3, 4, 5]);
    expect(k.vertex).toEqual({ x: 100, y: 5 });
  });

  it('finds the curvature peak near a tap', () => {
    const curv = [0, 1, 5, 2, 0, 0, 9, 0];
    expect(apexIndex(curv, 3, 2)).toBe(2);
    expect(apexIndex(curv, 0, 2)).toBe(6); // wraps
  });
});
