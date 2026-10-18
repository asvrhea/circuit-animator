import { createMask, type Mask, type RGB, type RGBAImage } from './types';

export interface HSV {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

export interface HsvTolerance {
  /** max hue difference in degrees */
  h: number;
  /** max chroma (s·v) difference (0..1) */
  s: number;
  /** max value difference (0..1) */
  v: number;
}

/** Below this chroma hue is meaningless, so it is ignored when matching. */
const GREY_CHROMA = 0.12;

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export const hueDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Map a single 0..1 UI slider to an HSV tolerance box. */
export function toleranceFromSlider(t: number): HsvTolerance {
  const k = Math.min(1, Math.max(0, t));
  return { h: 6 + 34 * k, s: 0.12 + 0.5 * k, v: 0.12 + 0.5 * k };
}

/**
 * Compare in the HSV cone: chroma (s·v) instead of raw saturation, because
 * saturation is unstable for dark pixels (near-black reads as s≈1). Hue is
 * only checked when both colours have enough chroma for it to mean anything.
 */
export function matchesHsv(px: HSV, target: HSV, tol: HsvTolerance): boolean {
  if (Math.abs(px.v - target.v) > tol.v) return false;
  const cp = px.s * px.v, ct = target.s * target.v;
  if (Math.abs(cp - ct) > tol.s) return false;
  if (ct < GREY_CHROMA || cp < GREY_CHROMA / 2) return true;
  return hueDiff(px.h, target.h) <= tol.h;
}

/** 1 where the pixel lies inside the HSV tolerance box around `target`. */
export function colorMask(img: RGBAImage, target: RGB, tol: HsvTolerance): Mask {
  const out = createMask(img.width, img.height);
  const t = rgbToHsv(target.r, target.g, target.b);
  const d = img.data;
  for (let i = 0, p = 0; p < out.data.length; p++, i += 4) {
    if (d[i + 3] < 128) continue;
    if (matchesHsv(rgbToHsv(d[i], d[i + 1], d[i + 2]), t, tol)) out.data[p] = 1;
  }
  return out;
}

/**
 * Eyedropper: return the most distinctive (colourful or dark) pixel within
 * `radius` of (x, y). A drawn route usually stands out that way, so this
 * forgives clicks that land on the anti-aliased edge of a thin line.
 */
export function sampleColor(img: RGBAImage, x: number, y: number, radius = 3): RGB {
  const cx = Math.round(x), cy = Math.round(y);
  let best: RGB = { r: 0, g: 0, b: 0 };
  let bestScore = -1;
  for (let yy = cy - radius; yy <= cy + radius; yy++) {
    if (yy < 0 || yy >= img.height) continue;
    for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (xx < 0 || xx >= img.width) continue;
      const i = (yy * img.width + xx) * 4;
      const hsv = rgbToHsv(img.data[i], img.data[i + 1], img.data[i + 2]);
      // Map backgrounds are pale and grey; routes are colourful or dark.
      const score = Math.max(hsv.s * hsv.v, 1 - hsv.v);
      if (score > bestScore) {
        bestScore = score;
        best = { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
      }
    }
  }
  return best;
}
