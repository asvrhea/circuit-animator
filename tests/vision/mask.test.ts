import { describe, expect, it } from 'vitest';
import { colorMask, hueDiff, rgbToHsv, sampleColor, toleranceFromSlider } from '../../src/vision/color';
import { largestComponent } from '../../src/vision/components';
import { close, dilate, erode } from '../../src/vision/morph';
import { countOn, createMask } from '../../src/vision/types';
import { drawPolyline, maskOf, noiseImage, ROUTE_BLUE } from '../helpers/synth';

describe('color', () => {
  it('converts RGB to HSV', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240);
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
  });

  it('wraps hue difference', () => {
    expect(hueDiff(350, 10)).toBe(20);
    expect(hueDiff(10, 190)).toBe(180);
  });

  it('masks the route colour and not the map', () => {
    const img = noiseImage(60, 40);
    drawPolyline(img, [{ x: 5, y: 20 }, { x: 55, y: 20 }], false, 4, ROUTE_BLUE, 20);
    const m = colorMask(img, ROUTE_BLUE, toleranceFromSlider(0.3));
    expect(m.data[20 * 60 + 30]).toBe(1);
    expect(m.data[5 * 60 + 30]).toBe(0);
    expect(countOn(m)).toBeGreaterThan(150);
    expect(countOn(m)).toBeLessThan(300);
  });

  it('eyedropper finds the line near a sloppy click', () => {
    const img = noiseImage(40, 40);
    drawPolyline(img, [{ x: 5, y: 20 }, { x: 35, y: 20 }], false, 2, ROUTE_BLUE);
    expect(sampleColor(img, 20, 22, 3)).toEqual(ROUTE_BLUE);
  });
});

describe('morphology', () => {
  it('dilate/erode are inverse-ish on a solid block', () => {
    const m = maskOf(30, 30, [{ pts: [{ x: 10, y: 15 }, { x: 20, y: 15 }], closed: false, thickness: 6 }]);
    expect(countOn(erode(dilate(m, 2), 2))).toBeGreaterThanOrEqual(countOn(m));
    expect(countOn(dilate(m, 1))).toBeGreaterThan(countOn(m));
  });

  it('close bridges a small gap', () => {
    const m = maskOf(60, 20, [
      { pts: [{ x: 2, y: 10 }, { x: 25, y: 10 }], closed: false, thickness: 4 },
      { pts: [{ x: 34, y: 10 }, { x: 57, y: 10 }], closed: false, thickness: 4 },
    ]);
    expect(largestComponent(m).count).toBe(2);
    // 4px gap between round caps
    expect(largestComponent(close(m, 2)).count).toBe(2);
    expect(largestComponent(close(m, 4)).count).toBe(1);
  });
});

describe('components', () => {
  it('keeps the largest 8-connected component', () => {
    const m = createMask(20, 20);
    for (let x = 0; x < 10; x++) m.data[2 * 20 + x] = 1;
    m.data[15 * 20 + 15] = 1;
    m.data[16 * 20 + 16] = 1; // diagonal neighbour joins
    const r = largestComponent(m);
    expect(r.count).toBe(2);
    expect(r.size).toBe(10);
    expect(r.mask.data[15 * 20 + 15]).toBe(0);
  });
});
