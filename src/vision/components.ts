import type { Vec2 } from '../geom/vec2';
import { createMask, type Mask } from './types';

export interface ComponentResult {
  mask: Mask;
  /** pixels in the kept component */
  size: number;
  /** number of 8-connected components found */
  count: number;
}

export interface Labels {
  /** 0 = background, 1..count = component id */
  labels: Int32Array;
  /** sizes[id] = pixel count (index 0 unused) */
  sizes: number[];
}

/** 8-connected component labelling. */
export function labelComponents(m: Mask): Labels {
  const { width: w, height: h } = m;
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const sizes = [0];

  for (let start = 0; start < m.data.length; start++) {
    if (!m.data[start] || labels[start]) continue;
    const label = sizes.length;
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
    sizes.push(tail);
  }
  return { labels, sizes };
}

function keepLabel(m: Mask, { labels, sizes }: Labels, label: number): ComponentResult {
  const mask = createMask(m.width, m.height);
  if (label) for (let p = 0; p < labels.length; p++) if (labels[p] === label) mask.data[p] = 1;
  return { mask, size: sizes[label] ?? 0, count: sizes.length - 1 };
}

/** Keep only the largest 8-connected component. */
export function largestComponent(m: Mask): ComponentResult {
  const lab = labelComponents(m);
  let best = 0;
  for (let i = 1; i < lab.sizes.length; i++) if (lab.sizes[i] > lab.sizes[best] || !best) best = i;
  return keepLabel(m, lab, best);
}

/**
 * Keep the component under (or nearest to, within `radius`) the seed point —
 * the user's eyedropper click. Falls back to the largest component.
 */
export function componentAt(m: Mask, seed: Vec2, radius = 12): ComponentResult {
  const lab = labelComponents(m);
  const { width: w, height: h } = m;
  const sx = Math.round(seed.x), sy = Math.round(seed.y);
  let best = 0, bestD = Infinity;
  for (let y = Math.max(0, sy - radius); y <= Math.min(h - 1, sy + radius); y++)
    for (let x = Math.max(0, sx - radius); x <= Math.min(w - 1, sx + radius); x++) {
      const l = lab.labels[y * w + x];
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (l && d < bestD) [best, bestD] = [l, d];
    }
  return best ? keepLabel(m, lab, best) : largestComponent(m);
}
