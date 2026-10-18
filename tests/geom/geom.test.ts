import { describe, expect, it } from 'vitest';
import { polylineLength, smoothClosed } from '../../src/geom/polyline';
import { resampleClosed } from '../../src/geom/resample';
import { rdp, rdpClosed } from '../../src/geom/simplify';
import { catmullRomClosed } from '../../src/geom/spline';
import { pathFromControls } from '../../src/geom/track';
import { dist } from '../../src/geom/vec2';
import { circle } from '../helpers/synth';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('simplify', () => {
  it('drops collinear points', () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
    expect(rdp(line, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('keeps the corners of a dense closed square', () => {
    const dense = resampleClosed(square, 80);
    const s = rdpClosed(dense, 0.5);
    expect(s.length).toBe(4);
  });
});

describe('resample', () => {
  it('produces evenly spaced points', () => {
    const pts = resampleClosed(square, 40);
    expect(pts.length).toBe(40);
    for (let i = 0; i < 40; i++) expect(dist(pts[i], pts[(i + 1) % 40])).toBeCloseTo(1, 6);
  });

  it('preserves length of a smooth curve', () => {
    const c = circle(0, 0, 50, 720);
    expect(polylineLength(resampleClosed(c, 500), true)).toBeCloseTo(polylineLength(c, true), 0);
  });
});

describe('spline', () => {
  it('passes through every control point', () => {
    const out = catmullRomClosed(square, 10);
    expect(out.length).toBe(40);
    for (let i = 0; i < 4; i++) {
      expect(out[i * 10].x).toBeCloseTo(square[i].x);
      expect(out[i * 10].y).toBeCloseTo(square[i].y);
    }
  });

  it('approximates a circle from few control points', () => {
    const path = pathFromControls(circle(0, 0, 100, 12), 500);
    expect(path.length).toBe(500);
    for (const p of path) expect(Math.hypot(p.x, p.y)).toBeGreaterThan(97);
  });

  it('moving average keeps a circle centred', () => {
    const s = smoothClosed(circle(0, 0, 10, 100), 2);
    const cx = s.reduce((a, p) => a + p.x, 0) / s.length;
    expect(Math.abs(cx)).toBeLessThan(1e-9);
  });
});
