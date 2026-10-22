import type { GameTrack } from './track';

/**
 * Rally-style pace notes read from the path geometry: every corner gets a
 * direction, a severity from 1 (hairpin) to 6 (flat-out kink) and the
 * distance at which it starts.
 */
export interface PaceNote {
  dir: 'left' | 'right';
  /** 1 = hairpin … 6 = flat-out kink */
  severity: number;
  /** where the corner starts / peaks / ends, m along the lap */
  entryS: number;
  apexS: number;
  exitS: number;
  /** tightest radius, m */
  radius: number;
  /** total turn, radians */
  angle: number;
}

export interface NoteAhead {
  note: PaceNote;
  index: number;
  /** metres to the corner entry (0 once inside it, until the apex) */
  dist: number;
}

/** Curves tighter than this radius (m) count as corners. */
const CORNER_RADIUS = 260;
const MIN_ANGLE = 0.12;
const MERGE_GAP = 3; // points

export function severityOf(radius: number): number {
  return radius <= 20 ? 1 : radius <= 35 ? 2 : radius <= 60 ? 3 : radius <= 100 ? 4 : radius <= 160 ? 5 : 6;
}

export const noteLabel = (n: PaceNote): string => `${n.dir === 'left' ? 'LEFT' : 'RIGHT'} ${n.severity}`;

export function buildPaceNotes(t: GameTrack): PaceNote[] {
  const n = t.n;
  // signed turn between consecutive tangents: > 0 turns right in screen coordinates (y down)
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = t.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    turn[i] = Math.atan2(t.tx[i] * t.ty[j] - t.ty[i] * t.tx[j], t.tx[i] * t.tx[j] + t.ty[i] * t.ty[j]);
  }
  const active = (i: number) => t.kappa[i] > 1 / CORNER_RADIUS && Math.abs(turn[i]) > 1e-9;
  const sign = (i: number) => (turn[i] >= 0 ? 1 : -1);

  // start at a point that is not inside a corner so groups never wrap
  let start = 0;
  if (t.closed) {
    let best = Infinity;
    for (let i = 0; i < n; i++) if (t.kappa[i] < best) [best, start] = [t.kappa[i], i];
  }
  const groups: number[][] = [];
  let cur: number[] = [];
  let gap = 0;
  for (let k = 0; k < n; k++) {
    const i = t.closed ? (start + k) % n : k;
    if (active(i) && (!cur.length || sign(i) === sign(cur[cur.length - 1]))) {
      cur.push(i);
      gap = 0;
    } else if (cur.length && !active(i) && ++gap <= MERGE_GAP) {
      cur.push(i); // a short dip inside one corner
    } else {
      if (cur.length) groups.push(cur);
      cur = active(i) ? [i] : [];
      gap = 0;
    }
  }
  if (cur.length) groups.push(cur);

  const notes: PaceNote[] = [];
  for (const g of groups) {
    while (g.length && !active(g[g.length - 1])) g.pop();
    if (!g.length) continue;
    let angle = 0, apex = g[0];
    for (const i of g) {
      angle += turn[i];
      if (t.kappa[i] > t.kappa[apex]) apex = i;
    }
    if (Math.abs(angle) < MIN_ANGLE) continue;
    const radius = 1 / Math.max(t.kappa[apex], 1e-9);
    notes.push({
      dir: angle > 0 ? 'right' : 'left',
      severity: severityOf(radius),
      entryS: t.s[g[0]],
      apexS: t.s[apex],
      exitS: t.s[g[g.length - 1]],
      radius,
      angle: Math.abs(angle),
    });
  }
  return notes.sort((a, b) => a.entryS - b.entryS);
}

/** The next `max` corners within `lookahead` metres of position s. */
export function upcomingNotes(t: GameTrack, notes: PaceNote[], s: number, lookahead = 450, max = 2): NoteAhead[] {
  const L = t.length;
  const out: NoteAhead[] = [];
  notes.forEach((note, index) => {
    let dist: number;
    if (t.closed) {
      const toApex = (((note.apexS - s) % L) + L) % L;
      const toEntry = (((note.entryS - s) % L) + L) % L;
      // inside the corner, before the apex: entry is behind us
      dist = toEntry > toApex ? 0 : toEntry;
    } else {
      if (s > note.apexS) return;
      dist = Math.max(0, note.entryS - s);
    }
    if (dist <= lookahead) out.push({ note, index, dist });
  });
  return out.sort((a, b) => a.dist - b.dist).slice(0, max);
}
