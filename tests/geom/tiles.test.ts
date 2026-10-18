import { describe, expect, it } from 'vitest';
import {
  fromUnits, groundMetresPerUnit, tileRect, tilesFor, tileSpan, toUnits, WORLD, wrapX, zoomForScale,
} from '../../src/geom/tiles';

describe('map tiles', () => {
  it('puts lon/lat on the slippy-map grid', () => {
    // compare with the standard OSM slippy-map formula
    const lon = 106.846, lat = -6.147, z = 15, n = 2 ** z;
    const rad = (lat * Math.PI) / 180;
    const xt = Math.floor(((lon + 180) / 360) * n);
    const yt = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
    const p = toUnits({ lon, lat });
    const t = tileSpan(z);
    expect([xt, yt]).toEqual([26109, 16944]);
    expect(Math.floor((p.x + WORLD / 2) / t)).toBe(xt);
    expect(Math.floor((p.y + WORLD / 2) / t)).toBe(yt);
  });

  it('round-trips units and lon/lat', () => {
    const ll = fromUnits(toUnits({ lon: 106.846, lat: -6.147 }));
    expect(ll.lon).toBeCloseTo(106.846, 9);
    expect(ll.lat).toBeCloseTo(-6.147, 9);
  });

  it('north is up (smaller y)', () => {
    expect(toUnits({ lon: 0, lat: 10 }).y).toBeLessThan(toUnits({ lon: 0, lat: 0 }).y);
  });

  it('converts map units to ground metres', () => {
    expect(groundMetresPerUnit(toUnits({ lon: 0, lat: 0 }))).toBeCloseTo(1);
    expect(groundMetresPerUnit(toUnits({ lon: 0, lat: 60 }))).toBeCloseTo(0.5);
  });

  it('chooses zoom so tiles are ~1:1 on screen', () => {
    // at z, one tile (256 px) spans WORLD / 2^z units
    expect(zoomForScale(256 / tileSpan(16))).toBe(16);
    expect(zoomForScale(256 / tileSpan(16), 2)).toBe(17);
    expect(zoomForScale(1e-9)).toBe(0);
    expect(zoomForScale(1e3)).toBe(19);
  });

  it('lists covering tiles and their rects', () => {
    const r = tileRect({ z: 1, x: 1, y: 0 });
    expect(r).toEqual({ x: 0, y: -WORLD / 2, w: WORLD / 2, h: WORLD / 2 });
    expect(tilesFor({ x: -10, y: -10, w: 20, h: 20 }, 1).length).toBe(4);
    expect(tilesFor({ x: -WORLD, y: -WORLD, w: 2 * WORLD, h: 2 * WORLD }, 10, 50).length).toBe(50);
    expect(wrapX(-1, 2)).toBe(3);
  });
});
