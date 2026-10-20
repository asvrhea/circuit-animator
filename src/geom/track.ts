import { resampleClosed, resampleOpen } from './resample';
import { catmullRomClosed, catmullRomOpen } from './spline';
import type { Vec2 } from './vec2';

export const DEFAULT_SAMPLES = 500;

/**
 * Smooth path through editable control points, evenly resampled. Closed for
 * circuits; open (start and finish at the two ends) for rally stages.
 */
export function pathFromControls(ctrl: Vec2[], samples = DEFAULT_SAMPLES, closed = true): Vec2[] {
  if (ctrl.length < 3) return ctrl.map((p) => ({ ...p }));
  const perSeg = Math.max(8, Math.ceil((samples * 4) / ctrl.length));
  return closed
    ? resampleClosed(catmullRomClosed(ctrl, perSeg), samples)
    : resampleOpen(catmullRomOpen(ctrl, perSeg), samples);
}
