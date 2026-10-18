// Cases found on a real phone screenshot: black hand-drawn line, black
// letterbox borders, digits touching the line, and a collapsed hairpin.
import { describe, expect, it } from 'vitest';
import { polylineLength } from '../../src/geom/polyline';
import { colorMask, sampleColor, toleranceFromSlider } from '../../src/vision/color';
import { extractTrack } from '../../src/vision/extract';
import { orderLoop } from '../../src/vision/loop';
import { chamferDistance } from '../../src/vision/morph';
import { skeletonize } from '../../src/vision/skeleton';
import { countOn } from '../../src/vision/types';
import { circle, drawPolyline, maskOf, noiseImage } from '../helpers/synth';

const BLACK = { r: 0, g: 3, b: 6 };

describe('dark route colours', () => {
  it('matches near-black despite unstable HSV saturation', () => {
    const img = noiseImage(60, 40);
    drawPolyline(img, [{ x: 5, y: 20 }, { x: 55, y: 20 }], false, 4, { r: 10, g: 12, b: 8 }, 10);
    const m = colorMask(img, BLACK, toleranceFromSlider(0.2));
    expect(countOn(m)).toBeGreaterThan(180);
    expect(m.data[5 * 60 + 30]).toBe(0);
  });

  it('eyedropper prefers the dark line over pale map', () => {
    const img = noiseImage(40, 40);
    drawPolyline(img, [{ x: 5, y: 20 }, { x: 35, y: 20 }], false, 2, BLACK);
    expect(sampleColor(img, 20, 23, 3)).toEqual(BLACK);
  });
});

describe('seeded extraction', () => {
  it('keeps the clicked line, not a bigger black letterbox frame', () => {
    const w = 300, h = 220;
    const img = noiseImage(w, h, 5);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < 20 || x >= w - 20 || y < 15) {
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      }
    }
    const ring = circle(150, 120, 60);
    drawPolyline(img, ring, true, 4, BLACK, 8);
    const seed = { x: 210, y: 120 };
    const res = extractTrack(img, { target: sampleColor(img, seed.x, seed.y), tolerance: toleranceFromSlider(0.2), seed });
    const L = polylineLength(res.path, true);
    expect(L / (2 * Math.PI * 60)).toBeGreaterThan(0.95);
    expect(L / (2 * Math.PI * 60)).toBeLessThan(1.05);
  });
});

describe('loop ordering on hand-drawn shapes', () => {
  const ring = circle(100, 100, 60);
  const ringLen = 2 * Math.PI * 60;

  it('ignores a small digit-like loop touching the line', () => {
    const digit = circle(169, 100, 9, 60);
    const r = orderLoop(skeletonize(maskOf(200, 200, [
      { pts: ring, closed: true, thickness: 5 },
      { pts: digit, closed: true, thickness: 3 },
    ])))!;
    expect(r.closed).toBe(true);
    expect(r.length / ringLen).toBeLessThan(1.12);
    expect(Math.max(...r.points.map((p) => p.x))).toBeLessThan(166);
  });

  it('recovers a hairpin whose two legs merged into one thick stroke', () => {
    const m = maskOf(200, 220, [
      { pts: ring, closed: true, thickness: 5 },
      { pts: [{ x: 100, y: 40 }, { x: 100, y: 5 }], closed: false, thickness: 10 },
    ]);
    const skel = skeletonize(m);
    const plain = orderLoop(skel)!;
    const withHw = orderLoop(skel, { halfWidth: chamferDistance(m, 0) })!;
    expect(Math.min(...plain.points.map((p) => p.y))).toBeGreaterThan(36);
    expect(Math.min(...withHw.points.map((p) => p.y))).toBeLessThan(12);
    // out and back: roughly ring + 2 x 30px
    expect(withHw.length - plain.length).toBeGreaterThan(45);
  });

  it('does not turn a thin stray stroke into a hairpin', () => {
    const m = maskOf(200, 220, [
      { pts: ring, closed: true, thickness: 5 },
      { pts: [{ x: 100, y: 40 }, { x: 100, y: 5 }], closed: false, thickness: 4 },
    ]);
    const r = orderLoop(skeletonize(m), { halfWidth: chamferDistance(m, 0) })!;
    expect(Math.min(...r.points.map((p) => p.y))).toBeGreaterThan(36);
  });
});
