import { describe, expect, it } from 'vitest';
import { haversine, inverseMercator, mercator } from '../../src/geom/projection';

describe('Web Mercator', () => {
  it('maps the origin and the antimeridian', () => {
    expect(mercator({ lon: 0, lat: 0 }).x).toBe(0);
    expect(mercator({ lon: 0, lat: 0 }).y).toBeCloseTo(0, 6);
    expect(mercator({ lon: 180, lat: 0 }).x).toBeCloseTo(20037508.34, 1);
  });

  it('matches a known EPSG:3857 value', () => {
    // lon 10, lat 50 -> (1113194.91, 6446275.84)
    const m = mercator({ lon: 10, lat: 50 });
    expect(m.x).toBeCloseTo(1113194.91, 1);
    expect(m.y).toBeCloseTo(6446275.84, 1);
  });

  it('round-trips', () => {
    const p = { lon: 106.84, lat: -6.15 };
    const q = inverseMercator(mercator(p));
    expect(q.lon).toBeCloseTo(p.lon, 9);
    expect(q.lat).toBeCloseTo(p.lat, 9);
  });

  it('preserves shape locally (conformal)', () => {
    const a = mercator({ lon: 106.84, lat: -6.15 });
    const b = mercator({ lon: 106.85, lat: -6.15 });
    const c = mercator({ lon: 106.84, lat: -6.14 });
    // equal degrees: lon step is cos(lat) shorter on the ground, and Mercator keeps that ratio
    expect(Math.abs(b.x - a.x) / Math.abs(c.y - a.y)).toBeCloseTo(Math.cos((6.145 * Math.PI) / 180), 4);
  });
});

describe('haversine', () => {
  it('measures one degree of latitude', () => {
    expect(haversine({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(111195, -1);
  });
});
