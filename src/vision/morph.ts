import { createMask, type Mask } from './types';

/**
 * Chamfer (3-4) distance, in px, from every pixel to the nearest pixel whose
 * mask value equals `target`. Two raster passes, independent of radius, and
 * close to Euclidean, so dilation/erosion behave like a disk structuring
 * element (a square one barely bridges gaps in diagonal lines).
 */
export function chamferDistance(m: Mask, target: 0 | 1): Float32Array {
  const { width: w, height: h, data } = m;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let p = 0; p < d.length; p++) d[p] = data[p] === target ? 0 : INF;

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = d[p];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[p - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[p - w] + 3);
        if (x > 0) v = Math.min(v, d[p - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[p - w + 1] + 4);
      }
      d[p] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = d[p];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[p + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[p + w] + 3);
        if (x < w - 1) v = Math.min(v, d[p + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[p + w - 1] + 4);
      }
      d[p] = v;
    }
  for (let p = 0; p < d.length; p++) d[p] /= 3;
  return d;
}

function threshold(m: Mask, d: Float32Array, keep: (v: number) => boolean): Mask {
  const out = createMask(m.width, m.height);
  for (let p = 0; p < d.length; p++) if (keep(d[p])) out.data[p] = 1;
  return out;
}

export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  return threshold(m, chamferDistance(m, 1), (v) => v <= r);
}

/** Pixels outside the image are not background, so the border is not eaten. */
export function erode(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  return threshold(m, chamferDistance(m, 0), (v) => v > r);
}

/** Morphological close: bridges gaps of roughly r (round ends) to 2r (square cuts) pixels. */
export const close = (m: Mask, r: number): Mask => erode(dilate(m, r), r);
