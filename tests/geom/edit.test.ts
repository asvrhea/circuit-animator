import { describe, expect, it } from 'vitest';
import {
  distanceToPath, fractionAt, insertControl, nearestIndex, removeControl, reverseControls, reverseSectors, setSector, setStart,
} from '../../src/geom/edit';
import { resampleClosed } from '../../src/geom/resample';

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('edit ops', () => {
  it('finds nearest control within range', () => {
    expect(nearestIndex(sq, { x: 9, y: 1 }, 3)).toBe(1);
    expect(nearestIndex(sq, { x: 5, y: 5 }, 3)).toBe(-1);
  });

  it('inserts on the nearest edge', () => {
    const { controls, index } = insertControl(sq, { x: 10.5, y: 5 });
    expect(index).toBe(2);
    expect(controls[2]).toEqual({ x: 10.5, y: 5 });
    expect(controls.length).toBe(5);
  });

  it('will not delete below the minimum', () => {
    expect(removeControl(sq, 0)).toBe(sq);
    expect(removeControl([...sq, { x: -1, y: 5 }], 4).length).toBe(4);
  });

  it('reverses direction keeping the start', () => {
    expect(reverseControls(sq).map((p) => p.x + ',' + p.y)).toEqual(['0,0', '0,10', '10,10', '10,0']);
    expect(reverseSectors([0.2, 0.5])).toEqual([0.5, 0.8]);
  });

  it('moves the start by snapping or inserting', () => {
    expect(setStart(sq, { x: 10, y: 9 }, 2)[0]).toEqual({ x: 10, y: 10 });
    const s = setStart(sq, { x: 5, y: 0 }, 2);
    expect(s[0]).toEqual({ x: 5, y: 0 });
    expect(s[1]).toEqual({ x: 10, y: 0 });
    expect(s.length).toBe(5);
  });

  it('measures lap fraction along an evenly sampled path', () => {
    const path = resampleClosed(sq, 40);
    expect(fractionAt(path, { x: 10, y: 0 })).toBeCloseTo(0.25);
    expect(distanceToPath(path, { x: 5, y: -2 }).dist).toBeCloseTo(2);
  });

  it('clamps sector splits to stay ordered', () => {
    expect(setSector([0.3, 0.6], 0, 0.9)).toEqual([0.58, 0.6]);
    expect(setSector([0.3, 0.6], 1, 0.1)[1]).toBeCloseTo(0.32);
    expect(setSector([0.3, 0.6], 1, 0.7)).toEqual([0.3, 0.7]);
  });
});
