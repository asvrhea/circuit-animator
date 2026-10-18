import { describe, expect, it } from 'vitest';
import { add, cross, dist, lerp, normalize, vec } from '../../src/geom/vec2';

describe('vec2', () => {
  it('does basic arithmetic', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 });
    expect(cross(vec(1, 0), vec(0, 1))).toBe(1);
    expect(dist(vec(0, 0), vec(3, 4))).toBe(5);
    expect(lerp(vec(0, 0), vec(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
  });

  it('normalizes and handles zero length', () => {
    expect(normalize(vec(0, 5))).toEqual({ x: 0, y: 1 });
    expect(normalize(vec(0, 0))).toEqual({ x: 0, y: 0 });
  });
});
