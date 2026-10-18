import type { Vec2 } from '../geom/vec2';

export type TrackSource = 'image' | 'geo' | 'manual' | 'map';

/** Everything needed to rebuild a track. Coordinates live in a width x height space. */
export interface TrackDoc {
  version: 1;
  name: string;
  source: TrackSource;
  width: number;
  height: number;
  /** closed loop; controls[0] is the start/finish, order is driving direction */
  controls: Vec2[];
  /** sector split points as fractions of lap length, 0 < s1 < s2 < 1 */
  sectors: [number, number];
  lengthKm: number;
  /**
   * Metres per coordinate unit, once known (calibration, typed lap length, or
   * map coordinates). While set, editing the shape keeps lengthKm in sync.
   */
  mpu?: number;
  /** 'mercator': coordinates are Web Mercator metres (x east, y = −north), so a basemap can be drawn. */
  crs?: 'mercator';
}

export const DEFAULT_SECTORS: [number, number] = [1 / 3, 2 / 3];

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Lap length implied by the scale for a path of `pathUnits` length (no-op without a scale). */
export function syncLength(doc: TrackDoc, pathUnits: number): TrackDoc {
  if (!doc.mpu || pathUnits <= 0) return doc;
  const lengthKm = round3((pathUnits * doc.mpu) / 1000);
  return lengthKm === doc.lengthKm || lengthKm <= 0 ? doc : { ...doc, lengthKm };
}

/** Typing a lap length fixes the scale from then on. */
export function withLength(doc: TrackDoc, lengthKm: number, pathUnits: number): TrackDoc {
  return { ...doc, lengthKm, mpu: pathUnits > 0 ? (lengthKm * 1000) / pathUnits : doc.mpu };
}

/** Two image points a known real distance apart set the scale. */
export function calibrate(doc: TrackDoc, a: Vec2, b: Vec2, metres: number, pathUnits: number): TrackDoc {
  const units = Math.hypot(b.x - a.x, b.y - a.y);
  if (units <= 0 || !(metres > 0)) return doc;
  return syncLength({ ...doc, mpu: metres / units }, pathUnits);
}

export function newDoc(source: TrackSource, width: number, height: number, controls: Vec2[], lengthKm = 5): TrackDoc {
  return { version: 1, name: 'Circuit', source, width, height, controls, sectors: [...DEFAULT_SECTORS], lengthKm };
}

export function serializeDoc(doc: TrackDoc): string {
  const round = (v: number) => Math.round(v * 100) / 100;
  return JSON.stringify(
    { ...doc, controls: doc.controls.map((p) => [round(p.x), round(p.y)]) },
    null,
    1,
  );
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parse and validate; throws with a readable message on bad input. */
export function parseDoc(text: string): TrackDoc {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (!o || o.version !== 1) throw new Error('Unsupported track file version.');
  const ctrl = o.controls;
  if (!Array.isArray(ctrl) || ctrl.length < 3) throw new Error('Track file has no control points.');
  const controls = ctrl.map((c) => {
    if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1])) throw new Error('Bad control point in track file.');
    return { x: c[0], y: c[1] };
  });
  const s = o.sectors;
  const sectors: [number, number] =
    Array.isArray(s) && isNum(s[0]) && isNum(s[1]) && 0 < s[0] && s[0] < s[1] && s[1] < 1 ? [s[0], s[1]] : [...DEFAULT_SECTORS];
  const source: TrackSource = o.source === 'geo' || o.source === 'manual' || o.source === 'map' ? o.source : 'image';
  const doc: TrackDoc = {
    version: 1,
    name: typeof o.name === 'string' ? o.name.slice(0, 80) : 'Circuit',
    source,
    width: isNum(o.width) && o.width > 0 ? o.width : 1000,
    height: isNum(o.height) && o.height > 0 ? o.height : 1000,
    controls,
    sectors,
    lengthKm: isNum(o.lengthKm) && o.lengthKm > 0 ? o.lengthKm : 5,
  };
  if (isNum(o.mpu) && o.mpu > 0) doc.mpu = o.mpu;
  if (o.crs === 'mercator') doc.crs = 'mercator';
  return doc;
}
