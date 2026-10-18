import { describe, expect, it } from 'vitest';
import { polylineLength } from '../../src/geom/polyline';
import { orderLoop } from '../../src/vision/loop';
import { skeletonize } from '../../src/vision/skeleton';
import { circle, distToClosed, lemniscate, maskOf } from '../helpers/synth';

const W = 200, H = 200;
const ring = circle(100, 100, 60);
const ringLen = 2 * Math.PI * 60;

describe('orderLoop', () => {
  it('orders a plain ring into one closed loop', () => {
    const r = orderLoop(skeletonize(maskOf(W, H, [{ pts: ring, closed: true, thickness: 5 }])))!;
    expect(r.closed).toBe(true);
    expect(r.length / ringLen).toBeGreaterThan(0.95);
    expect(r.length / ringLen).toBeLessThan(1.12);
    for (const p of r.points) expect(distToClosed(p, ring)).toBeLessThan(2);
  });

  it('prunes a spur', () => {
    const spur = { pts: [{ x: 160, y: 100 }, { x: 190, y: 100 }], closed: false, thickness: 5 };
    const r = orderLoop(skeletonize(maskOf(W, H, [{ pts: ring, closed: true, thickness: 5 }, spur])))!;
    expect(r.closed).toBe(true);
    expect(r.length / ringLen).toBeLessThan(1.12);
    expect(Math.max(...r.points.map((p) => p.x))).toBeLessThan(165);
  });

  it('picks the longest cycle when a chord creates branches', () => {
    const chord = { pts: [{ x: 40, y: 100 }, { x: 160, y: 100 }], closed: false, thickness: 5 };
    const r = orderLoop(skeletonize(maskOf(W, H, [{ pts: ring, closed: true, thickness: 5 }, chord])))!;
    expect(r.closed).toBe(true);
    expect(r.length / ringLen).toBeGreaterThan(0.95);
    expect(r.length / ringLen).toBeLessThan(1.12);
  });

  it('joins the ends of an open line', () => {
    const arc = circle(100, 100, 60, 270, 0, Math.PI * 1.5);
    const r = orderLoop(skeletonize(maskOf(W, H, [{ pts: arc, closed: false, thickness: 5 }])))!;
    expect(r.closed).toBe(false);
    // chord between arc ends = 60 * sqrt(2)
    expect(r.gap).toBeGreaterThan(75);
    expect(r.gap).toBeLessThan(95);
  });

  it('walks straight through a figure-eight crossing', () => {
    const fig = lemniscate(100, 100, 85);
    const figLen = polylineLength(fig, true);
    const r = orderLoop(skeletonize(maskOf(W, H, [{ pts: fig, closed: true, thickness: 5 }])))!;
    expect(r.closed).toBe(true);
    expect(r.length / figLen).toBeGreaterThan(0.93);
    expect(r.length / figLen).toBeLessThan(1.12);
    // both lobes are visited
    expect(Math.min(...r.points.map((p) => p.x))).toBeLessThan(25);
    expect(Math.max(...r.points.map((p) => p.x))).toBeGreaterThan(175);
  });

  it('returns null for an empty skeleton', () => {
    expect(orderLoop(maskOf(10, 10, []))).toBeNull();
  });
});
