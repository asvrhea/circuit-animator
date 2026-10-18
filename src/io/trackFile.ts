import type { Vec2 } from '../geom/vec2';

export type TrackSource = 'image' | 'geo' | 'manual';

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
}

export const DEFAULT_SECTORS: [number, number] = [1 / 3, 2 / 3];

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
  const source: TrackSource = o.source === 'geo' || o.source === 'manual' ? o.source : 'image';
  return {
    version: 1,
    name: typeof o.name === 'string' ? o.name.slice(0, 80) : 'Circuit',
    source,
    width: isNum(o.width) && o.width > 0 ? o.width : 1000,
    height: isNum(o.height) && o.height > 0 ? o.height : 1000,
    controls,
    sectors,
    lengthKm: isNum(o.lengthKm) && o.lengthKm > 0 ? o.lengthKm : 5,
  };
}
