import { pointSegmentDistance } from './polyline';
import { dist, type Vec2 } from './vec2';

/** Editing operations on a closed control polygon. All return new arrays. */

export const MIN_CONTROLS = 4;

/** Index of the nearest point within maxDist, or -1. */
export function nearestIndex(pts: Vec2[], p: Vec2, maxDist = Infinity): number {
  let best = -1, bestD = maxDist;
  pts.forEach((q, i) => {
    const d = dist(p, q);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** Distance from p to the closed polyline, and the nearest vertex index. */
export function distanceToPath(path: Vec2[], p: Vec2): { dist: number; index: number } {
  let best = Infinity, index = 0;
  for (let i = 0; i < path.length; i++) {
    const d = pointSegmentDistance(p, path[i], path[(i + 1) % path.length]);
    if (d < best) [best, index] = [d, i];
  }
  const a = path[index], b = path[(index + 1) % path.length];
  return { dist: best, index: dist(p, a) <= dist(p, b) ? index : (index + 1) % path.length };
}

/** Index i such that inserting p between ctrl[i] and ctrl[i+1] adds the least length. */
export function insertionIndex(ctrl: Vec2[], p: Vec2): number {
  let best = 0, bestCost = Infinity;
  for (let i = 0; i < ctrl.length; i++) {
    const a = ctrl[i], b = ctrl[(i + 1) % ctrl.length];
    const cost = dist(a, p) + dist(p, b) - dist(a, b);
    if (cost < bestCost) [best, bestCost] = [i, cost];
  }
  return best;
}

export function insertControl(ctrl: Vec2[], p: Vec2): { controls: Vec2[]; index: number } {
  const i = insertionIndex(ctrl, p) + 1;
  return { controls: [...ctrl.slice(0, i), { ...p }, ...ctrl.slice(i)], index: i };
}

export function removeControl(ctrl: Vec2[], i: number): Vec2[] {
  if (ctrl.length <= MIN_CONTROLS) return ctrl;
  return ctrl.filter((_, k) => k !== i);
}

export function moveControl(ctrl: Vec2[], i: number, p: Vec2): Vec2[] {
  return ctrl.map((q, k) => (k === i ? { ...p } : q));
}

/** Reverse driving direction while keeping the same start point. */
export function reverseControls(ctrl: Vec2[]): Vec2[] {
  return [ctrl[0], ...ctrl.slice(1).reverse()];
}

/**
 * Make the point nearest `p` the start: snap to an existing control within
 * `snap`, otherwise insert one, then rotate it to index 0.
 */
export function setStart(ctrl: Vec2[], p: Vec2, snap: number): Vec2[] {
  let i = nearestIndex(ctrl, p, snap);
  let c = ctrl;
  if (i < 0) ({ controls: c, index: i } = insertControl(ctrl, p));
  return [...c.slice(i), ...c.slice(0, i)];
}

/** Lap fraction (0..1) of the path point nearest p; the path is evenly resampled from start. */
export const fractionAt = (path: Vec2[], p: Vec2): number => distanceToPath(path, p).index / path.length;

/** Place one sector split, clamped so 0 < s1 < s2 < 1 with a minimum gap. */
export function setSector(sectors: [number, number], which: 0 | 1, f: number, gap = 0.02): [number, number] {
  const [lo, hi] = which === 0 ? [gap, sectors[1] - gap] : [sectors[0] + gap, 1 - gap];
  const s: [number, number] = [...sectors];
  s[which] = Math.min(hi, Math.max(lo, f));
  return s;
}

export const reverseSectors = ([a, b]: [number, number]): [number, number] => [1 - b, 1 - a];
