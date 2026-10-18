import { describe, expect, it } from 'vitest';
import { polylineLength } from '../../src/geom/polyline';
import { sampleColor, toleranceFromSlider } from '../../src/vision/color';
import { ExtractError, extractTrack, scoreConfidence } from '../../src/vision/extract';
import { distToClosed, noiseImage, ROUTE_BLUE, synthScreenshot } from '../helpers/synth';

describe('extractTrack (synthetic screenshot)', () => {
  const { img, truth } = synthScreenshot();
  const target = sampleColor(img, truth[0].x, truth[0].y);
  const res = extractTrack(img, { target, tolerance: toleranceFromSlider(0.35) });

  it('recovers the drawn loop through a gap and a crossing road', () => {
    expect(res.path.length).toBe(500);
    const d = res.path.map((p) => distToClosed(p, truth));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    expect(mean).toBeLessThan(1.5);
    expect(Math.max(...d)).toBeLessThan(4);
    const ratio = polylineLength(res.path, true) / polylineLength(truth, true);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });

  it('reports high confidence and few control points', () => {
    expect(res.confidence.label).toBe('high');
    expect(res.confidence.closure).toBe(1);
    expect(res.controls.length).toBeGreaterThan(10);
    expect(res.controls.length).toBeLessThan(150);
  });

  it('throws a friendly error when nothing matches', () => {
    expect(() => extractTrack(noiseImage(50, 50), { target: ROUTE_BLUE, tolerance: toleranceFromSlider(0) })).toThrow(ExtractError);
  });
});

describe('scoreConfidence', () => {
  it('drops with branches and open gaps', () => {
    expect(scoreConfidence(1, 1, 0).label).toBe('high');
    expect(scoreConfidence(0.5, 0.5, 0.2).label).toBe('low');
  });
});
