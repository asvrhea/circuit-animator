import { pointSegmentDistance } from './polyline';
import { dist, type Vec2 } from './vec2';

/** Ramer–Douglas–Peucker on an open polyline (endpoints always kept). */
export function rdp(pts: Vec2[], epsilon: number): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(pts[i], pts[a], pts[b]);
      if (d > maxD) [maxD, idx] = [d, i];
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}

/**
 * RDP on a closed polyline: split at point 0 and the point farthest from it,
 * simplify both halves, and stitch them back together.
 */
export function rdpClosed(pts: Vec2[], epsilon: number): Vec2[] {
  const n = pts.length;
  if (n < 4) return pts.map((p) => ({ ...p }));
  let far = 0, farD = -1;
  for (let i = 1; i < n; i++) {
    const d = dist(pts[0], pts[i]);
    if (d > farD) [far, farD] = [i, d];
  }
  const first = rdp(pts.slice(0, far + 1), epsilon);
  const second = rdp([...pts.slice(far), pts[0]], epsilon);
  return [...first, ...second.slice(1, -1)];
}
