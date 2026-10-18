import { smoothClosed } from '../geom/polyline';
import { rdpClosed } from '../geom/simplify';
import { DEFAULT_SAMPLES, pathFromControls } from '../geom/track';
import type { Vec2 } from '../geom/vec2';
import { colorMask, type HsvTolerance } from './color';
import { largestComponent, type ComponentResult } from './components';
import { orderLoop, type LoopResult } from './loop';
import { close } from './morph';
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

export interface ExtractResult {
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
    const comp = largestComponent(close(raw, r));
    if (comp.size < MIN_COMPONENT_PX) continue;
    const skeleton = skeletonize(comp.mask);
    const loop = orderLoop(skeleton);
    if (!loop || loop.points.length < 8) continue;
    const gapRatio = (l: LoopResult) => (l.closed ? 0 : l.gap / l.length);
    if (!best || gapRatio(loop) < gapRatio(best.loop)) best = { comp, skeleton, loop };
    if (loop.closed) break;
  }
  if (!best) throw new ExtractError('Could not trace a loop from the picked colour. Try manual trace.');
  const { comp, skeleton, loop } = best;

  const smoothed = smoothClosed(loop.points, 2);
  const controls = rdpClosed(smoothed, eps);
  const path = pathFromControls(controls, samples);

  // Share of the raw colour that ended up inside the kept component.
  let rawInComp = 0;
  for (let p = 0; p < raw.data.length; p++) rawInComp += raw.data[p] & comp.mask.data[p];

  return {
    controls,
    path,
    confidence: scoreConfidence(rawInComp / rawCount, loop.loopPixels / Math.max(1, loop.skeletonPixels), loop.closed ? 0 : loop.gap / loop.length),
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
