import { resampleClosed } from './resample';
import { catmullRomClosed } from './spline';
import type { Vec2 } from './vec2';

export const DEFAULT_SAMPLES = 500;

/** Smooth closed path through editable control points, evenly resampled. */
export function pathFromControls(ctrl: Vec2[], samples = DEFAULT_SAMPLES): Vec2[] {
  if (ctrl.length < 3) return ctrl.map((p) => ({ ...p }));
  const perSeg = Math.max(8, Math.ceil((samples * 4) / ctrl.length));
  return resampleClosed(catmullRomClosed(ctrl, perSeg), samples);
}
