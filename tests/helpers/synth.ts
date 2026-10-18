import { pointSegmentDistance } from '../../src/geom/polyline';
import type { Vec2 } from '../../src/geom/vec2';
import { createMask, type Mask, type RGB, type RGBAImage } from '../../src/vision/types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map-like background: pale beige with per-pixel noise. */
export function noiseImage(w: number, h: number, seed = 1): RGBAImage {
  const rnd = mulberry32(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * 30;
    data[i] = 232 + n;
    data[i + 1] = 228 + n + (rnd() - 0.5) * 10;
    data[i + 2] = 218 + n;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

function rasterSegments(
  w: number, h: number, pts: Vec2[], closed: boolean, thickness: number,
  plot: (p: number) => void,
): void {
  const r = thickness / 2;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (pointSegmentDistance({ x, y }, a, b) <= r) plot(y * w + x);
  }
}

export function drawPolyline(img: RGBAImage, pts: Vec2[], closed: boolean, thickness: number, c: RGB, jitter = 0, seed = 7): void {
  const rnd = mulberry32(seed);
  rasterSegments(img.width, img.height, pts, closed, thickness, (p) => {
    const j = (rnd() - 0.5) * jitter;
    img.data[p * 4] = c.r + j;
    img.data[p * 4 + 1] = c.g + j;
    img.data[p * 4 + 2] = c.b + j;
  });
}

export function drawMask(m: Mask, pts: Vec2[], closed: boolean, thickness: number): void {
  rasterSegments(m.width, m.height, pts, closed, thickness, (p) => (m.data[p] = 1));
}

export function maskOf(w: number, h: number, shapes: { pts: Vec2[]; closed: boolean; thickness: number }[]): Mask {
  const m = createMask(w, h);
  for (const s of shapes) drawMask(m, s.pts, s.closed, s.thickness);
  return m;
}

export function circle(cx: number, cy: number, r: number, n = 360, from = 0, to = Math.PI * 2): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const t = from + ((to - from) * i) / n;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/** Wobbly circuit-like closed curve. */
export function circuitShape(cx: number, cy: number, R: number, n = 600): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const r = R * (1 + 0.22 * Math.sin(3 * t) + 0.08 * Math.cos(5 * t + 1));
    return { x: cx + r * Math.cos(t) * 1.3, y: cy + r * Math.sin(t) };
  });
}

/** Figure-eight (lemniscate of Bernoulli). */
export function lemniscate(cx: number, cy: number, a: number, n = 800): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    return { x: cx + (a * Math.cos(t)) / d, y: cy + (a * Math.sin(t) * Math.cos(t)) / d };
  });
}

export const ROUTE_BLUE: RGB = { r: 26, g: 115, b: 232 };

/**
 * A blue circuit drawn on noise, with a small break in the line, a white road
 * crossing over it, and a stray blue blob (like a map label) elsewhere.
 */
export function synthScreenshot(seed = 3): { img: RGBAImage; truth: Vec2[] } {
  const w = 420, h = 320;
  const img = noiseImage(w, h, seed);
  const truth = circuitShape(210, 160, 95);
  // Break the line: skip ~4px of arc near index 100.
  const gapStart = 100, gapLen = 4;
  const drawn = [...truth.slice(gapStart + gapLen), ...truth.slice(0, gapStart + 1)];
  drawPolyline(img, drawn, false, 5, ROUTE_BLUE, 16, seed);
  // Road crossing over the route.
  drawPolyline(img, [{ x: 0, y: 40 }, { x: w, y: 300 }], false, 5, { r: 255, g: 255, b: 255 });
  // Stray label-like blob in the route colour.
  drawPolyline(img, [{ x: 20, y: 290 }, { x: 34, y: 290 }], false, 4, ROUTE_BLUE);
  return { img, truth };
}

/** Distance from p to the nearest point on closed polyline `poly`. */
export function distToClosed(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}
