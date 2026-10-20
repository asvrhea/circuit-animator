import { smoothClosed, smoothOpen } from '../geom/polyline';
import { rdp, rdpClosed } from '../geom/simplify';
import { DEFAULT_SAMPLES, pathFromControls } from '../geom/track';
import type { Vec2 } from '../geom/vec2';
import { colorMask, type HsvTolerance } from './color';
import { componentAt, largestComponent, type ComponentResult } from './components';
import { orderLoop, type LoopResult } from './loop';
import { chamferDistance, close } from './morph';
import { skeletonize } from './skeleton';
import { countOn, type Mask, type RGB, type RGBAImage } from './types';

export interface ExtractOptions {
  target: RGB;
  tolerance: HsvTolerance;
  /** morphological close radius in px (bridges gaps ~2r wide) */
  closeRadius?: number;
  /** RDP tolerance in px for control points */
  simplifyEpsilon?: number;
  samples?: number;
  /** eyedropper click (image px); the component under it is kept instead of the largest */
  seed?: Vec2;
}

export type ConfidenceLabel = 'high' | 'medium' | 'low';

export interface Confidence {
  score: number;
  label: ConfidenceLabel;
  /** share of colour-matched pixels that belong to the kept component */
  componentShare: number;
  /** share of skeleton pixels used by the final loop (low = many branches) */
  skeletonUse: number;
  /** 1 for a true cycle, falling towards 0 as the joined gap grows */
  closure: number;
  hints: string[];
}

/** An open line whose ends are further apart than this share of its length is a rally stage. */
const OPEN_STAGE_GAP = 0.08;

export interface ExtractResult {
  /** the line has two clear ends: treat it as a point-to-point stage (controls[0] = start) */
  open: boolean;
  /** editable control points (image px) */
  controls: Vec2[];
  /** smooth, evenly resampled closed path (image px) */
  path: Vec2[];
  confidence: Confidence;
  mask: Mask;
  skeleton: Mask;
}

export class ExtractError extends Error {}

const MIN_COMPONENT_PX = 150;

export function extractTrack(img: RGBAImage, opts: ExtractOptions): ExtractResult {
  const closeRadius = opts.closeRadius ?? 3;
  const eps = opts.simplifyEpsilon ?? 1.5;
  const samples = opts.samples ?? DEFAULT_SAMPLES;

  const raw = colorMask(img, opts.target, opts.tolerance);
  const rawCount = countOn(raw);
  if (rawCount === 0) throw new ExtractError('No pixels match the picked colour. Raise the tolerance or pick again.');

  // If the line comes out open (a label or road broke it), retry with a wider
  // close. Kept small by default so nearby parallel straights don't merge.
  let best: { comp: ComponentResult; skeleton: Mask; loop: LoopResult } | null = null;
  for (const r of [closeRadius, closeRadius * 2, closeRadius * 3]) {
    const closedMask = close(raw, r);
    const comp = opts.seed ? componentAt(closedMask, opts.seed) : largestComponent(closedMask);
    if (comp.size < MIN_COMPONENT_PX) continue;
    const skeleton = skeletonize(comp.mask);
    const loop = orderLoop(skeleton, { halfWidth: chamferDistance(comp.mask, 0) });
    if (!loop || loop.points.length < 8) continue;
    const gapRatio = (l: LoopResult) => (l.closed ? 0 : l.gap / l.length);
    if (!best || gapRatio(loop) < gapRatio(best.loop)) best = { comp, skeleton, loop };
    if (loop.closed) break;
  }
  if (!best) throw new ExtractError('Could not trace a loop from the picked colour. Try manual trace.');
  const { comp, skeleton, loop } = best;

  // A clearly open line is a stage; a small leftover gap is a circuit with a break, joined up.
  const open = !loop.closed && loop.gap / loop.length > OPEN_STAGE_GAP;
  const controls = open ? rdp(smoothOpen(loop.points, 2), eps) : rdpClosed(smoothClosed(loop.points, 2), eps);
  const path = pathFromControls(controls, samples, !open);

  // Of the matching colour around the track (its bbox + margin), how much is the track itself.
  const { width: w } = raw;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < comp.mask.data.length; p++) {
    if (!comp.mask.data[p]) continue;
    const x = p % w, y = (p / w) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const M = 10;
  let rawNear = 0, rawInComp = 0;
  for (let y = Math.max(0, y0 - M); y <= Math.min(raw.height - 1, y1 + M); y++)
    for (let x = Math.max(0, x0 - M); x <= Math.min(w - 1, x1 + M); x++) {
      const p = y * w + x;
      rawNear += raw.data[p];
      rawInComp += raw.data[p] & comp.mask.data[p];
    }

  const confidence = scoreConfidence(
    rawInComp / Math.max(1, rawNear), loop.loopPixels / Math.max(1, loop.skeletonPixels), loop.closed || open ? 0 : loop.gap / loop.length,
  );
  if (open) confidence.hints.push('The line has two ends, so it was read as a point-to-point rally stage.');
  return {
    open,
    controls,
    path,
    confidence,
    mask: comp.mask,
    skeleton,
  };
}

export function scoreConfidence(componentShare: number, skeletonUse: number, gapRatio: number): Confidence {
  const closure = Math.max(0, 1 - gapRatio / 0.1);
  const score = 0.35 * componentShare + 0.35 * Math.min(1, skeletonUse) + 0.3 * closure;
  const hints: string[] = [];
  if (componentShare < 0.7) hints.push('Other map features share this colour; try a lower tolerance.');
  if (skeletonUse < 0.75) hints.push('The line has branches; check the chosen loop and edit if needed.');
  if (closure < 1) hints.push('The line was open; its ends were joined with a straight segment.');
  const label: ConfidenceLabel = score >= 0.8 ? 'high' : score >= 0.55 ? 'medium' : 'low';
  return { score, label, componentShare, skeletonUse, closure, hints };
}
