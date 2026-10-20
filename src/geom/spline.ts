import type { Vec2 } from './vec2';

const EPS = 1e-4;

/** Append `samples` points of the centripetal Catmull–Rom span p1→p2 (p1 included, p2 not). */
function span(out: Vec2[], p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, samples: number, alpha: number): void {
  const knot = (a: Vec2, b: Vec2): number => Math.max(EPS, Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  for (let s = 0; s < samples; s++) {
    const t = t1 + ((t2 - t1) * s) / samples;
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

/**
 * Closed centripetal Catmull–Rom spline through `ctrl`, `samplesPerSegment`
 * points per span. Centripetal (alpha = 0.5) avoids cusps and self-loops on
 * unevenly spaced control points. Output starts exactly at ctrl[0].
 */
export function catmullRomClosed(ctrl: Vec2[], samplesPerSegment: number, alpha = 0.5): Vec2[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.map((p) => ({ ...p }));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    span(out, ctrl[(i - 1 + n) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n], samplesPerSegment, alpha);
  }
  return out;
}

/**
 * Open centripetal Catmull–Rom spline from ctrl[0] to ctrl[n-1] (both
 * included). The missing outer neighbours are mirrored so the ends run
 * straight out of the first and last spans.
 */
export function catmullRomOpen(ctrl: Vec2[], samplesPerSegment: number, alpha = 0.5): Vec2[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.map((p) => ({ ...p }));
  const mirror = (a: Vec2, b: Vec2): Vec2 => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y });
  const at = (i: number): Vec2 => (i < 0 ? mirror(ctrl[0], ctrl[1]) : i >= n ? mirror(ctrl[n - 1], ctrl[n - 2]) : ctrl[i]);
  const out: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) span(out, at(i - 1), at(i), at(i + 1), at(i + 2), samplesPerSegment, alpha);
  out.push({ ...ctrl[n - 1] });
  return out;
}
