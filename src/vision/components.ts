import { createMask, type Mask } from './types';

export interface ComponentResult {
  mask: Mask;
  /** pixels in the kept component */
  size: number;
  /** number of 8-connected components found */
  count: number;
}

/** Keep only the largest 8-connected component. */
export function largestComponent(m: Mask): ComponentResult {
  const { width: w, height: h } = m;
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let count = 0, bestLabel = 0, bestSize = 0;

  for (let start = 0; start < m.data.length; start++) {
    if (!m.data[start] || labels[start]) continue;
    const label = ++count;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (m.data[q] && !labels[q]) {
            labels[q] = label;
            queue[tail++] = q;
          }
        }
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      bestLabel = label;
    }
  }

  const mask = createMask(w, h);
  if (bestLabel) for (let p = 0; p < labels.length; p++) if (labels[p] === bestLabel) mask.data[p] = 1;
  return { mask, size: bestSize, count };
}
