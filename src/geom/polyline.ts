import { dist, type Vec2 } from './vec2';

export function polylineLength(pts: Vec2[], closed: boolean): number {
  let L = 0;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) L += dist(pts[i], pts[i + 1]);
  if (closed && n > 1) L += dist(pts[n - 1], pts[0]);
  return L;
}

/** Distance from p to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Moving-average smoothing on a closed polyline (window 2r+1). */
export function smoothClosed(pts: Vec2[], r: number): Vec2[] {
  const n = pts.length;
  if (r <= 0 || n < 3) return pts.map((p) => ({ ...p }));
  const out: Vec2[] = [];
  const k = 2 * r + 1;
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    for (let j = -r; j <= r; j++) {
      const q = pts[(((i + j) % n) + n) % n];
      sx += q.x;
      sy += q.y;
    }
    out.push({ x: sx / k, y: sy / k });
  }
  return out;
}

/** Moving-average smoothing on an open polyline; the window shrinks at the ends so they stay put. */
export function smoothOpen(pts: Vec2[], r: number): Vec2[] {
  const n = pts.length;
  if (r <= 0 || n < 3) return pts.map((p) => ({ ...p }));
  return pts.map((_, i) => {
    const k = Math.min(r, i, n - 1 - i);
    let sx = 0, sy = 0;
    for (let j = -k; j <= k; j++) {
      sx += pts[i + j].x;
      sy += pts[i + j].y;
    }
    return { x: sx / (2 * k + 1), y: sy / (2 * k + 1) };
  });
}
