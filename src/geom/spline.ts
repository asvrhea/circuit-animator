import type { Vec2 } from './vec2';

const EPS = 1e-4;

/**
 * Closed centripetal Catmull–Rom spline through `ctrl`, `samplesPerSegment`
 * points per span. Centripetal (alpha = 0.5) avoids cusps and self-loops on
 * unevenly spaced control points. Output starts exactly at ctrl[0].
 */
export function catmullRomClosed(ctrl: Vec2[], samplesPerSegment: number, alpha = 0.5): Vec2[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.map((p) => ({ ...p }));
  const out: Vec2[] = [];
  const knot = (a: Vec2, b: Vec2): number => Math.max(EPS, Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha));

  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const a1x = ((t1 - t) * p0.x + (t - t0) * p1.x) / (t1 - t0);
      const a1y = ((t1 - t) * p0.y + (t - t0) * p1.y) / (t1 - t0);
      const a2x = ((t2 - t) * p1.x + (t - t1) * p2.x) / (t2 - t1);
      const a2y = ((t2 - t) * p1.y + (t - t1) * p2.y) / (t2 - t1);
      const a3x = ((t3 - t) * p2.x + (t - t2) * p3.x) / (t3 - t2);
      const a3y = ((t3 - t) * p2.y + (t - t2) * p3.y) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
      out.push({
        x: ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1),
        y: ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1),
      });
    }
  }
  return out;
}
