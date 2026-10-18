import { describe, expect, it } from 'vitest';
import { geoToTrack, parseGeoFile, parseGpx, parseKml } from '../../src/io/geo';
import { calibrate, newDoc, parseDoc, serializeDoc, syncLength, withLength } from '../../src/io/trackFile';

/** Square of ~1.1 km sides near the equator. */
const square = [
  [106.8, -6.1], [106.81, -6.1], [106.81, -6.11], [106.8, -6.11], [106.8, -6.1],
];

const kml = `<?xml version="1.0"?><kml><Document>
<Placemark><Point><coordinates>1,2,0</coordinates></Point></Placemark>
<Placemark><LineString><coordinates>
  ${square.map(([lon, lat]) => `${lon},${lat},0`).join('\n  ')}
</coordinates></LineString></Placemark></Document></kml>`;

const gpx = `<gpx version="1.1"><trk><trkseg>
${square.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"><ele>5</ele></trkpt>`).join('\n')}
</trkseg></trk></gpx>`;

describe('KML / GPX', () => {
  it('parses the longest KML line', () => {
    const p = parseKml(kml);
    expect(p.length).toBe(5);
    expect(p[1]).toEqual({ lon: 106.81, lat: -6.1 });
  });

  it('parses GPX track points', () => {
    expect(parseGpx(gpx).length).toBe(5);
    expect(parseGeoFile('x.gpx', gpx)[2]).toEqual({ lon: 106.81, lat: -6.11 });
    expect(parseGeoFile('x.kml', kml).length).toBe(5);
  });

  it('builds a track with real length and fitted controls', () => {
    const t = geoToTrack(parseKml(kml));
    expect(t.controls.length).toBe(4); // closing duplicate dropped
    expect(t.lengthKm).toBeGreaterThan(4.3);
    expect(t.lengthKm).toBeLessThan(4.5);
    for (const p of t.controls) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
    }
    // north is up: lat -6.10 is above lat -6.11
    expect(t.controls[0].y).toBeLessThan(t.controls[2].y);
  });

  it('thins dense input to the control cap', () => {
    const dense = Array.from({ length: 2000 }, (_, i) => {
      const a = (i / 2000) * Math.PI * 2;
      return { lon: 106.8 + 0.01 * Math.cos(a), lat: -6.1 + 0.01 * Math.sin(a) };
    });
    expect(geoToTrack(dense, 1000, 120).controls.length).toBeLessThanOrEqual(120);
  });
});

describe('track JSON', () => {
  it('round-trips', () => {
    const doc = newDoc('image', 800, 600, [{ x: 1, y: 2 }, { x: 3.14159, y: 4 }, { x: 5, y: 6 }], 4.2);
    const back = parseDoc(serializeDoc(doc));
    expect(back.controls[1]).toEqual({ x: 3.14, y: 4 });
    expect(back.lengthKm).toBe(4.2);
    expect(back.sectors).toEqual(doc.sectors);
  });

  it('keeps scale and crs through JSON', () => {
    const doc = { ...newDoc('map', 10, 10, [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]), mpu: 0.99, crs: 'mercator' as const };
    const back = parseDoc(serializeDoc(doc));
    expect(back.mpu).toBe(0.99);
    expect(back.crs).toBe('mercator');
    expect(back.source).toBe('map');
  });

  it('calibrates from two points and keeps the length in sync', () => {
    const doc = newDoc('image', 100, 100, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    // 200 px apart = 1000 m -> 5 m/px; a 600 px lap is 3 km
    const cal = calibrate(doc, { x: 0, y: 0 }, { x: 200, y: 0 }, 1000, 600);
    expect(cal.mpu).toBe(5);
    expect(cal.lengthKm).toBe(3);
    expect(syncLength(cal, 800).lengthKm).toBe(4);
    expect(calibrate(doc, { x: 0, y: 0 }, { x: 0, y: 0 }, 1000, 600)).toBe(doc);
  });

  it('typing a length fixes the scale', () => {
    const doc = withLength(newDoc('image', 100, 100, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]), 4.6, 590);
    expect(doc.mpu).toBeCloseTo(4600 / 590);
    expect(syncLength(doc, 590).lengthKm).toBe(4.6);
    expect(syncLength(doc, 295).lengthKm).toBe(2.3);
  });

  it('rejects junk and repairs bad sectors', () => {
    expect(() => parseDoc('nope')).toThrow();
    expect(() => parseDoc('{"version":1,"controls":[]}')).toThrow();
    const d = parseDoc('{"version":1,"controls":[[0,0],[1,0],[1,1]],"sectors":[0.8,0.2]}');
    expect(d.sectors[0]).toBeLessThan(d.sectors[1]);
  });
});
