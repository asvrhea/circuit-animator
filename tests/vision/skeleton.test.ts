import { describe, expect, it } from 'vitest';
import { skeletonize } from '../../src/vision/skeleton';
import { countOn, type Mask } from '../../src/vision/types';
import { circle, maskOf } from '../helpers/synth';

/** Count of 3x3 blocks fully set — any means the line is not 1px thin. */
function solidBlocks(m: Mask): number {
  let n = 0;
  for (let y = 1; y < m.height - 1; y++)
    for (let x = 1; x < m.width - 1; x++) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!m.data[(y + dy) * m.width + x + dx]) all = false;
      if (all) n++;
    }
  return n;
}

describe('skeletonize', () => {
  it('thins a thick bar to a 1px line of about the same length', () => {
    const m = maskOf(80, 30, [{ pts: [{ x: 10, y: 15 }, { x: 70, y: 15 }], closed: false, thickness: 7 }]);
    const s = skeletonize(m);
    expect(solidBlocks(s)).toBe(0);
    expect(countOn(s)).toBeGreaterThan(50);
    expect(countOn(s)).toBeLessThan(70);
  });

  it('thins a thick ring to a ring', () => {
    const m = maskOf(140, 140, [{ pts: circle(70, 70, 50), closed: true, thickness: 6 }]);
    const s = skeletonize(m);
    expect(solidBlocks(s)).toBe(0);
    const n = countOn(s);
    // 8-connected circle of r=50 has roughly 2*pi*50/1.1 pixels
    expect(n).toBeGreaterThan(250);
    expect(n).toBeLessThan(330);
  });
});
