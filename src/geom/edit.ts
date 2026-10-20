import { pointSegmentDistance } from './polyline';
import { dist, type Vec2 } from './vec2';

/** Editing operations on a closed control polygon. All return new arrays. */

export const MIN_CONTROLS = 4;

/** Index of the nearest point within maxDist, or -1. */
export function nearestIndex(pts: Vec2[], p: Vec2, maxDist = Infinity): number {
  let best = -1, bestD = maxDist;
  pts.forEach((q, i) => {
    const d = dist(p, q);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** Distance from p to the polyline (closed by default), and the nearest vertex index. */
export function distanceToPath(path: Vec2[], p: Vec2, closed = true): { dist: number; index: number } {
  let best = Infinity, index = 0;
  for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
    const d = pointSegmentDistance(p, path[i], path[(i + 1) % path.length]);
    if (d < best) [best, index] = [d, i];
  }
  const a = path[index], b = path[(index + 1) % path.length];
  return { dist: best, index: dist(p, a) <= dist(p, b) ? index : (index + 1) % path.length };
}

/**
 * Index i such that inserting p between ctrl[i] and ctrl[i+1] adds the least
 * length. On an open stage there is no finish→start segment; a point beyond
 * either end extends the stage there (returns -1 for before the start).
 */
export function insertionIndex(ctrl: Vec2[], p: Vec2, closed = true): number {
  let best = 0, bestCost = Infinity;
  if (!closed) {
    // extending past an end costs the full distance to that end
    const head = dist(p, ctrl[0]), tail = dist(p, ctrl[ctrl.length - 1]);
    [best, bestCost] = head < tail ? [-1, head] : [ctrl.length - 1, tail];
  }
  for (let i = 0; i < (closed ? ctrl.length : ctrl.length - 1); i++) {
    const a = ctrl[i], b = ctrl[(i + 1) % ctrl.length];
    const cost = dist(a, p) + dist(p, b) - dist(a, b);
    if (cost < bestCost) [best, bestCost] = [i, cost];
  }
  return best;
}

export function insertControl(ctrl: Vec2[], p: Vec2, closed = true): { controls: Vec2[]; index: number } {
  const i = insertionIndex(ctrl, p, closed) + 1;
  return { controls: [...ctrl.slice(0, i), { ...p }, ...ctrl.slice(i)], index: i };
}

export function removeControl(ctrl: Vec2[], i: number): Vec2[] {
  if (ctrl.length <= MIN_CONTROLS) return ctrl;
  return ctrl.filter((_, k) => k !== i);
}

export function moveControl(ctrl: Vec2[], i: number, p: Vec2): Vec2[] {
  return ctrl.map((q, k) => (k === i ? { ...p } : q));
}

/** Reverse driving direction: circuits keep their start point; stages swap start and finish. */
export function reverseControls(ctrl: Vec2[], closed = true): Vec2[] {
  return closed ? [ctrl[0], ...ctrl.slice(1).reverse()] : [...ctrl].reverse();
}

/**
 * Make the point nearest `p` the start: snap to an existing control within
 * `snap`, otherwise insert one, then rotate it to index 0.
 */
export function setStart(ctrl: Vec2[], p: Vec2, snap: number): Vec2[] {
  let i = nearestIndex(ctrl, p, snap);
  let c = ctrl;
  if (i < 0) ({ controls: c, index: i } = insertControl(ctrl, p));
  return [...c.slice(i), ...c.slice(0, i)];
}

/** Lap fraction (0..1) of the path point nearest p; the path is evenly resampled from start. */
export const fractionAt = (path: Vec2[], p: Vec2, closed = true): number =>
  distanceToPath(path, p, closed).index / (closed ? path.length : Math.max(1, path.length - 1));

/** Place one sector split, clamped so 0 < s1 < s2 < 1 with a minimum gap. */
export function setSector(sectors: [number, number], which: 0 | 1, f: number, gap = 0.02): [number, number] {
  const [lo, hi] = which === 0 ? [gap, sectors[1] - gap] : [sectors[0] + gap, 1 - gap];
  const s: [number, number] = [...sectors];
  s[which] = Math.min(hi, Math.max(lo, f));
  return s;
}

export const reverseSectors = ([a, b]: [number, number]): [number, number] => [1 - b, 1 - a];

// ------------------------------------------------------------ straighten

/** Snap to the control within `snap` of p, else insert one there. */
export function controlAt(ctrl: Vec2[], p: Vec2, snap: number): { controls: Vec2[]; index: number } {
  const i = nearestIndex(ctrl, p, snap);
  return i >= 0 ? { controls: ctrl, index: i } : insertControl(ctrl, p);
}

/** Control-polygon length from a to b in driving order. */
function arcLength(ctrl: Vec2[], a: number, b: number): number {
  const n = ctrl.length;
  let L = 0;
  for (let k = a; k !== b; k = (k + 1) % n) L += dist(ctrl[k], ctrl[(k + 1) % n]);
  return L;
}

/** Fraction of the a→b span at each end that blends into the neighbouring corners. */
const STRAIGHT_BLEND = 0.12;

/**
 * Make the track a straight line from control a to control b (driving order).
 * Controls strictly between them are replaced by two helpers on segment ab, so
 * the Catmull–Rom span between the helpers has four collinear control points
 * and is exactly straight; the short end spans blend into the corners at a and b.
 * If the start (index 0) lay inside the stretch it is projected onto the line
 * and stays the start. Returns `ctrl` unchanged if nothing would remain outside.
 */
export function straighten(ctrl: Vec2[], a: number, b: number): Vec2[] {
  const n = ctrl.length;
  const span = (b - a + n) % n;
  if (span === 0 || span === n - 1) return ctrl; // same point, or nothing left outside the stretch
  const A = ctrl[a], B = ctrl[b];
  const ab = { x: B.x - A.x, y: B.y - A.y };
  const L2 = ab.x * ab.x + ab.y * ab.y;
  if (L2 === 0) return ctrl;
  const at = (t: number): Vec2 => ({ x: A.x + ab.x * t, y: A.y + ab.y * t });

  const inner: { p: Vec2; start: boolean }[] = [
    { p: at(STRAIGHT_BLEND), start: false },
    { p: at(1 - STRAIGHT_BLEND), start: false },
  ];
  const startInside = a !== 0 && (n - a) % n < span; // index 0 strictly between a and b
  if (startInside) {
    const S = ctrl[0];
    const t = ((S.x - A.x) * ab.x + (S.y - A.y) * ab.y) / L2;
    const tc = Math.min(1 - 2 * STRAIGHT_BLEND, Math.max(2 * STRAIGHT_BLEND, t));
    inner.splice(1, 0, { p: at(tc), start: true });
  }
  // a, helpers, b, then the untouched rest of the loop back to a
  const loop: { p: Vec2; start: boolean }[] = [{ p: A, start: a === 0 }, ...inner];
  for (let k = b; k !== a; k = (k + 1) % n) loop.push({ p: ctrl[k], start: k === 0 });
  const s = loop.findIndex((q) => q.start);
  return [...loop.slice(s), ...loop.slice(0, s)].map((q) => q.p);
}

/** Straighten the shorter of the two stretches between controls i and j. */
export function straightenBetween(ctrl: Vec2[], i: number, j: number): Vec2[] {
  return arcLength(ctrl, i, j) <= arcLength(ctrl, j, i) ? straighten(ctrl, i, j) : straighten(ctrl, j, i);
}

// ------------------------------------------------------------ corners

export interface Corner {
  /** control indices of the corner in driving order: entry, curved ones, exit */
  indices: number[];
  /** point the corner scales about: where the entry and exit straights meet */
  vertex: Vec2;
  /** largest scale for the curved controls: they stay on the vertex side of the entry–exit chord */
  maxScale: number;
  /** largest scale that keeps entry/exit before their neighbouring controls */
  edgeMaxScale: number;
}

export const CORNER_MIN_SCALE = 0.25;
const CORNER_MAX_SCALE = 3;
/** turning angle (rad) above which a control counts as part of the curve */
const CURVE_TURN = 0.2;

/** Signed turning angle at control k. */
function turnAt(ctrl: Vec2[], k: number): number {
  const n = ctrl.length;
  const p = ctrl[(k - 1 + n) % n], c = ctrl[k], q = ctrl[(k + 1) % n];
  const ux = c.x - p.x, uy = c.y - p.y, vx = q.x - c.x, vy = q.y - c.y;
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/** Index of the path sample with peak curvature within `window` samples of index i. */
export function apexIndex(curv: ArrayLike<number>, i: number, window: number): number {
  const n = curv.length;
  let best = i, bestK = -1;
  for (let d = -window; d <= window; d++) {
    const k = (((i + d) % n) + n) % n;
    if (curv[k] > bestK) [best, bestK] = [k, curv[k]];
  }
  return best;
}

/**
 * The corner around control i: grow outwards while neighbours keep turning the
 * same way (but not across a segment much longer than the shorter one at the apex: that
 * is a straight leading to the next corner), then add one control each side as
 * the entry and exit. The vertex is where the lines entry→curve and curve→exit
 * intersect; for hairpins (near-parallel lines) it falls back to the midpoint
 * of entry and exit.
 */
export function findCorner(ctrl: Vec2[], i: number): Corner | null {
  const n = ctrl.length;
  const w = (k: number) => ((k % n) + n) % n;
  const sign = Math.sign(turnAt(ctrl, w(i - 1)) + turnAt(ctrl, i) + turnAt(ctrl, w(i + 1)));
  if (sign === 0) return null;
  const maxSeg = 2 * Math.min(dist(ctrl[w(i - 1)], ctrl[i]), dist(ctrl[i], ctrl[w(i + 1)]));
  const joins = (k: number, from: number) =>
    turnAt(ctrl, w(k)) * sign > CURVE_TURN && dist(ctrl[w(k)], ctrl[w(from)]) <= maxSeg;
  let lo = i, hi = i;
  const cap = n - 3; // leave at least one control outside entry..exit
  while (hi - lo + 1 < cap && joins(lo - 1, lo)) lo--;
  while (hi - lo + 1 < cap && joins(hi + 1, hi)) hi++;
  const entry = w(lo - 1), exit = w(hi + 1);
  const indices: number[] = [];
  for (let k = lo - 1; k <= hi + 1; k++) indices.push(w(k));

  const E = ctrl[entry], X = ctrl[exit], Ep = ctrl[w(lo - 2)], Xn = ctrl[w(hi + 2)];
  const L = ctrl[w(lo)], H = ctrl[w(hi)];
  const din = { x: L.x - E.x, y: L.y - E.y }, dout = { x: X.x - H.x, y: X.y - H.y };
  const den = din.x * dout.y - din.y * dout.x;
  const gap = dist(E, X);
  let vertex = { x: (E.x + X.x) / 2, y: (E.y + X.y) / 2 };
  if (Math.abs(den) > 1e-9) {
    // E + t·din = X − u·dout
    const rx = X.x - E.x, ry = X.y - E.y;
    const t = (rx * dout.y - ry * dout.x) / den;
    const u = (din.x * ry - din.y * rx) / den;
    const V = { x: E.x + din.x * t, y: E.y + din.y * t };
    const ahead = t > 0 && u > 0 && dist(E, V) < 3 * gap && dist(X, V) < 3 * gap;
    if (ahead) vertex = V;
  }

  // opening pushes entry/exit outwards along their rays; stop short of the next control out
  let edgeMaxScale = CORNER_MAX_SCALE;
  for (const [P, Q] of [[E, Ep], [X, Xn]] as const) {
    const r = dist(P, vertex);
    if (r > 1e-9) edgeMaxScale = Math.min(edgeMaxScale, (0.8 * dist(Q, vertex)) / r);
  }
  edgeMaxScale = Math.max(1, edgeMaxScale);

  // curved controls may open further, but stay on the vertex side of the entry–exit chord
  let maxScale = edgeMaxScale;
  const cl = Math.hypot(X.x - E.x, X.y - E.y);
  const side = (q: Vec2) => ((X.x - E.x) * (q.y - E.y) - (X.y - E.y) * (q.x - E.x)) / cl;
  const hv = cl > 1e-9 ? side(vertex) : 0;
  if (Math.abs(hv) > 1e-9) {
    maxScale = CORNER_MAX_SCALE;
    for (let k = lo; k <= hi; k++) {
      const drop = 1 - side(ctrl[w(k)]) / hv; // 0 at the vertex, 1 on the chord
      if (drop > 1e-9) maxScale = Math.min(maxScale, 0.9 / drop);
    }
    maxScale = Math.max(edgeMaxScale, maxScale);
  }
  return { indices, vertex, maxScale, edgeMaxScale };
}

/**
 * Scale a corner about its vertex: s < 1 tightens (smaller radius, entry and
 * exit slide towards the vertex along the straights), s > 1 opens it. Entry and
 * exit stop at `edgeMaxScale`; the curved controls between them carry on to `maxScale`.
 */
export function scaleCorner(ctrl: Vec2[], corner: Corner, s: number): Vec2[] {
  const V = corner.vertex;
  const kIn = cornerScale(corner, s), kEnd = Math.min(corner.edgeMaxScale, kIn);
  const m = corner.indices.length - 1;
  const out = ctrl.slice();
  corner.indices.forEach((i, j) => {
    // any opening beyond the entry/exit limit tapers off towards the ends, so no kink forms there
    const k = kEnd + (kIn - kEnd) * Math.sin((Math.PI * j) / m);
    out[i] = { x: V.x + (ctrl[i].x - V.x) * k, y: V.y + (ctrl[i].y - V.y) * k };
  });
  return out;
}

/** The scale scaleCorner applies to the curved controls (clamped). */
export const cornerScale = (corner: Corner, s: number): number => Math.min(corner.maxScale, Math.max(CORNER_MIN_SCALE, s));

/** Slider value in [-1, 1] (open … tight) to a corner scale. */
export const tightnessToScale = (t: number): number => Math.pow(2.5, -t);
