import { describe, expect, it } from 'vitest';
import { fractionAt, insertionIndex, reverseControls } from '../../src/geom/edit';
import { polylineLength } from '../../src/geom/polyline';
import { resampleOpen } from '../../src/geom/resample';
import { catmullRomOpen } from '../../src/geom/spline';
import { pathFromControls } from '../../src/geom/track';
import { dist, type Vec2 } from '../../src/geom/vec2';
import { geoToTrack } from '../../src/io/geo';
import { isOpen, newDoc, parseDoc, serializeDoc, setDiscipline } from '../../src/io/trackFile';
import { curvatureOpen, segmentLengthsOpen } from '../../src/sim/curvature';
import { buildRace, poseAt, raceState } from '../../src/sim/race';
import { brakeDecel, CAR_PRESETS, cornerLimit, driveAccel, speedProfileClosed, speedProfileOpen } from '../../src/sim/speed';
import {
  addRange, gripProfile, normalizeRanges, removeRange, reverseRanges, SURFACE_GRIP, surfaceAt,
} from '../../src/sim/surface';
import { sampleColor, toleranceFromSlider } from '../../src/vision/color';
import { extractTrack } from '../../src/vision/extract';
import { circle, drawPolyline, noiseImage, ROUTE_BLUE } from '../helpers/synth';
import { curvatureClosed, segmentLengths } from '../../src/sim/curvature';

const rally = CAR_PRESETS.rally.car;

/** S-shaped stage in metres: straight, left hander, straight, right hander, straight. */
function stage(): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = 0; x <= 400; x += 20) pts.push({ x, y: 0 });
  for (let a = 5; a <= 90; a += 5) {
    const r = (a * Math.PI) / 180;
    pts.push({ x: 400 + 60 * Math.sin(r), y: 60 - 60 * Math.cos(r) });
  }
  for (let y = 80; y <= 400; y += 20) pts.push({ x: 460, y });
  for (let a = 5; a <= 90; a += 5) {
    const r = (a * Math.PI) / 180;
    pts.push({ x: 520 - 60 * Math.cos(r), y: 400 + 60 * Math.sin(r) });
  }
  for (let x = 540; x <= 900; x += 20) pts.push({ x, y: 460 });
  return resampleOpen(pts, 800);
}

describe('open paths', () => {
  it('open spline starts and ends on the end controls and passes through the rest', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 8 }];
    const out = catmullRomOpen(ctrl, 10);
    expect(out[0]).toEqual(ctrl[0]);
    expect(out[out.length - 1]).toEqual(ctrl[3]);
    expect(out.length).toBe(3 * 10 + 1);
    expect(out[10].x).toBeCloseTo(10);
    expect(out[20].y).toBeCloseTo(0);
  });

  it('open resampling keeps both ends and even spacing', () => {
    const r = resampleOpen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 21);
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[20].x).toBeCloseTo(10);
    expect(r[20].y).toBeCloseTo(10);
    for (let i = 0; i < 20; i++) expect(dist(r[i], r[i + 1])).toBeCloseTo(1, 6);
  });

  it('builds open paths from controls', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }, { x: 300, y: 50 }];
    const p = pathFromControls(ctrl, 200, false);
    expect(p.length).toBe(200);
    expect(p[0]).toEqual(ctrl[0]);
    expect(dist(p[199], ctrl[3])).toBeLessThan(1e-9);
  });

  it('measures curvature on an open arc without wrapping', () => {
    const arc = circle(0, 0, 100, 181, 0, Math.PI).slice(0, 181);
    const k = curvatureOpen(arc, 2, 0);
    expect(k[0]).toBe(0);
    expect(k[180]).toBe(0);
    expect(k[90]).toBeCloseTo(1 / 100, 4);
    expect(segmentLengthsOpen(arc).length).toBe(180);
  });

  it('edit helpers respect the open ends', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }];
    // near the start of the stage but before it: extends the stage, not a finish→start link
    expect(insertionIndex(ctrl, { x: -50, y: 0 }, false)).toBe(-1);
    expect(insertionIndex(ctrl, { x: 350, y: 0 }, false)).toBe(3);
    expect(insertionIndex(ctrl, { x: 150, y: 10 }, false)).toBe(1);
    expect(reverseControls(ctrl, false)[0]).toEqual(ctrl[3]);
    const path = pathFromControls(ctrl, 101, false);
    expect(fractionAt(path, { x: 300, y: 0 }, false)).toBeCloseTo(1);
    expect(fractionAt(path, { x: 150, y: 5 }, false)).toBeCloseTo(0.5, 1);
  });
});

describe('surfaces', () => {
  it('merges, cuts and reverses gravel ranges', () => {
    expect(normalizeRanges([[0.5, 0.6], [0.1, 0.2], [0.55, 0.7]])).toEqual([[0.1, 0.2], [0.5, 0.7]]);
    expect(addRange([[0.1, 0.2]], 0.3, 0.15)).toEqual([[0.1, 0.3]]);
    expect(removeRange([[0, 1]], 0.4, 0.6)).toEqual([[0, 0.4], [0.6, 1]]);
    expect(removeRange([[0.1, 0.2]], 0.5, 0.6)).toEqual([[0.1, 0.2]]);
    expect(reverseRanges([[0, 0.25]])).toEqual([[0.75, 1]]);
    expect(surfaceAt([[0.4, 0.6]], 0.5)).toBe('gravel');
    expect(surfaceAt([[0.4, 0.6]], 0.7)).toBe('tarmac');
  });

  it('builds per-point grip', () => {
    const g = gripProfile(11, [[0.5, 1]], false);
    expect(g.lat[0]).toBe(1);
    expect(g.lat[10]).toBe(SURFACE_GRIP.gravel.lat);
    expect(g.long[5]).toBe(SURFACE_GRIP.gravel.long);
  });

  it('gravel lowers corner speed by the square root of the grip', () => {
    const k = new Float64Array([1 / 50]);
    const tar = cornerLimit(k, rally)[0];
    const grv = cornerLimit(k, rally, { lat: [SURFACE_GRIP.gravel.lat], long: [SURFACE_GRIP.gravel.long] })[0];
    expect(grv / tar).toBeCloseTo(Math.sqrt(SURFACE_GRIP.gravel.lat), 6);
  });

  it('a gravel circuit laps slower than the same circuit on tarmac', () => {
    const path = circle(0, 0, 150, 600);
    const kappa = curvatureClosed(path), seg = segmentLengths(path);
    const tar = speedProfileClosed(kappa, seg, rally);
    const grv = speedProfileClosed(kappa, seg, rally, gripProfile(600, [[0, 1]], true));
    expect(grv[0]).toBeLessThan(tar[0] * 0.9);
  });
});

describe('rally stage speed profile', () => {
  const path = stage();
  const kappa = curvatureOpen(path);
  const seg = segmentLengthsOpen(path);
  const grip = gripProfile(path.length, [[0, 1]], false);
  const v = speedProfileOpen(kappa, seg, rally, grip, 0);

  it('starts from rest and slows for both corners', () => {
    expect(v[0]).toBe(0);
    const straight = Math.max(...v.slice(250, 360));
    const corner = Math.min(...v.slice(200, 600));
    expect(corner).toBeLessThan(straight * 0.75);
  });

  it('stays within acceleration and braking limits on gravel', () => {
    for (let i = 0; i + 1 < v.length; i++) {
      const dv2 = v[i + 1] ** 2 - v[i] ** 2;
      const [lat, long] = [grip.lat[i], grip.long[i]];
      if (dv2 > 0) expect(dv2).toBeLessThanOrEqual(2 * driveAccel(rally, v[i], kappa[i], lat, long) * seg[i] + 1e-6);
      else expect(-dv2).toBeLessThanOrEqual(2 * brakeDecel(rally, v[i + 1], kappa[i], lat, long) * seg[i] + 1e-6);
    }
  });

  it('crosses the finish at speed (flying finish)', () => {
    expect(v[v.length - 1]).toBeGreaterThan(20);
  });
});

describe('rally race timeline', () => {
  const path = stage();
  const len = polylineLength(path, false);
  const race = buildRace({ path, closed: false, lengthKm: len / 1000, car: rally, laps: 3, sectors: [1 / 3, 2 / 3], gravel: [[0, 0.5]] });

  it('is a single run regardless of laps', () => {
    expect(race.laps).toBe(1);
    expect(race.closed).toBe(false);
    expect(race.flying.length).toBeCloseTo(len, 6);
    expect(race.total).toBeCloseTo(race.intro + race.first.lapTime + race.outro);
  });

  it('reports surface and splits along the stage', () => {
    const early = raceState(race, race.intro + 3);
    expect(early.surface).toBe('gravel');
    const late = raceState(race, race.intro + race.first.lapTime - 1);
    expect(late.surface).toBe('tarmac');
    expect(late.sectorSplits.length).toBe(2);
  });

  it('runs on past the finish during the cool-down', () => {
    const end = raceState(race, race.total - 0.01);
    expect(end.finished).toBe(true);
    expect(end.dist).toBeGreaterThan(race.flying.length);
    const p = poseAt(path, end.index, end.frac, false).p;
    expect(p.x).toBeGreaterThan(path[path.length - 1].x); // past the finish, same direction
  });
});

describe('track file disciplines', () => {
  const base = newDoc('map', 10, 10, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }]);

  it('defaults to formula and round-trips discipline + gravel', () => {
    expect(isOpen(base)).toBe(false);
    const mix = { ...setDiscipline(base, 'mix'), gravel: [[0.2, 0.4]] as [number, number][] };
    const back = parseDoc(serializeDoc(mix));
    expect(back.discipline).toBe('mix');
    expect(back.gravel).toEqual([[0.2, 0.4]]);
  });

  it('switching to rally opens the track and makes it gravel', () => {
    const r = setDiscipline(base, 'rally');
    expect(isOpen(r)).toBe(true);
    expect(r.gravel).toEqual([[0, 1]]);
    expect(setDiscipline(r, 'formula').gravel).toEqual([]);
    expect(setDiscipline(r, 'mix').gravel).toEqual([]);
  });

  it('ignores junk gravel in files', () => {
    const d = parseDoc('{"version":1,"controls":[[0,0],[1,0],[1,1]],"discipline":"rally","gravel":[[0.9,0.1],"x",[2,3]]}');
    expect(d.discipline).toBe('rally');
    expect(d.gravel).toEqual([[0.1, 0.9]]);
  });
});

describe('open-line detection', () => {
  it('KML/GPX with far-apart ends becomes a stage', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lon: 106.8 + i * 0.0005, lat: -6.1 + Math.sin(i / 5) * 0.0005 }));
    const t = geoToTrack(line);
    expect(t.open).toBe(true);
    expect(t.lengthKm).toBeGreaterThan(2.6);
    expect(t.lengthKm).toBeLessThan(3);
  });

  it('a closed loop stays a circuit', () => {
    const loop = Array.from({ length: 60 }, (_, i) => ({ lon: 106.8 + 0.01 * Math.cos(i / 9.5), lat: -6.1 + 0.01 * Math.sin(i / 9.5) }));
    expect(geoToTrack(loop).open).toBe(false);
  });

  it('a drawn line with two ends is read as a stage from a screenshot', () => {
    const img = noiseImage(300, 200, 9);
    const route = Array.from({ length: 60 }, (_, i) => ({ x: 20 + i * 4.3, y: 100 + 50 * Math.sin(i / 9) }));
    drawPolyline(img, route, false, 5, ROUTE_BLUE, 10);
    const res = extractTrack(img, { target: sampleColor(img, route[30].x, route[30].y), tolerance: toleranceFromSlider(0.3), seed: route[30] });
    expect(res.open).toBe(true);
    const ends = [res.path[0], res.path[res.path.length - 1]];
    const near = (p: Vec2, q: Vec2) => dist(p, q) < 10;
    expect(ends.some((e) => near(e, route[0])) && ends.some((e) => near(e, route[59]))).toBe(true);
  });
});
