import type { Mask } from './types';

/**
 * Zhang–Suen thinning. Returns a new mask with 1px-wide, 8-connected lines.
 * Only pixels still set are re-examined each pass, so cost tracks the line area
 * rather than the full image.
 */
export function skeletonize(src: Mask): Mask {
  const { width: w, height: h } = src;
  const img = src.data.slice();
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x];

  let active: number[] = [];
  for (let p = 0; p < img.length; p++) if (img[p]) active.push(p);

  const toClear: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (const p of active) {
        if (!img[p]) continue;
        const x = p % w, y = (p / w) | 0;
        // P2..P9 clockwise from north
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) +
          (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2));
        if (a !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        toClear.push(p);
      }
      if (toClear.length) {
        changed = true;
        for (const p of toClear) img[p] = 0;
      }
    }
    active = active.filter((p) => img[p]);
  }
  return { width: w, height: h, data: img };
}
