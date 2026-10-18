import { dist, dot, normalize, sub, type Vec2 } from '../geom/vec2';
import type { Mask } from './types';

/**
 * Turn a 1px skeleton into one ordered closed loop.
 *
 * 1. Build a topology graph: nodes are endpoints and junction clusters, edges
 *    are the pixel chains between them (junction-free rings get a pseudo node).
 * 2. Prune spurs by taking the 2-core (repeatedly drop degree-1 nodes).
 * 3. If the core is Eulerian (e.g. a figure-eight with a crossing), walk it
 *    going straight through each junction. Otherwise take the longest simple
 *    cycle.
 * 4. If there is no cycle at all (open line), take the longest path and let
 *    the caller treat it as closed by joining its ends.
 */

export interface LoopResult {
  /** ordered pixel-centre points; the loop closes from last back to first */
  points: Vec2[];
  /** true if a real cycle was found, false if an open path was joined */
  closed: boolean;
  /** distance between the ends of an open path (0 when closed) */
  gap: number;
  /** polyline length including the closing segment */
  length: number;
  /** skeleton pixels used by the loop vs. total skeleton pixels */
  loopPixels: number;
  skeletonPixels: number;
}

interface GNode {
  x: number;
  y: number;
}

interface GEdge {
  a: number;
  b: number;
  /** interior pixel centres in a -> b order */
  pts: Vec2[];
  len: number;
}

interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  inc: number[][];
  skeletonPixels: number;
}

interface Step {
  e: number;
  fwd: boolean;
}

/** Self-loops shorter than this are junction artefacts, not track. */
const MIN_SELF_LOOP_PIXELS = 6;
/** How far along an edge to look when measuring its direction at a junction. */
const DIR_LOOKAHEAD = 8;
/** Junction nodes closer than this (along the skeleton) are merged into one. */
const JUNCTION_MERGE_PX = 10;
/** DFS budget for longest-cycle search. */
const CYCLE_BUDGET = 200_000;

// ---------------------------------------------------------------- graph build

export function buildGraph(skel: Mask): Graph {
  const { width: w, height: h, data } = skel;
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;

  /** 4-neighbours, plus diagonals not already reachable via a shared 4-neighbour. */
  const neighbours = (p: number): number[] => {
    const x = p % w, y = (p / w) | 0;
    const out: number[] = [];
    if (on(x + 1, y)) out.push(p + 1);
    if (on(x - 1, y)) out.push(p - 1);
    if (on(x, y + 1)) out.push(p + w);
    if (on(x, y - 1)) out.push(p - w);
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) out.push(p + dy * w + dx);
    }
    return out;
  };

  const pixels: number[] = [];
  for (let p = 0; p < data.length; p++) if (data[p]) pixels.push(p);

  const deg = new Uint8Array(w * h);
  for (const p of pixels) deg[p] = neighbours(p).length;

  const nodeOf = new Int32Array(w * h).fill(-1);
  const nodes: GNode[] = [];
  const nodePixels: number[][] = [];
  const addNode = (members: number[]): number => {
    const id = nodes.length;
    let sx = 0, sy = 0;
    for (const p of members) {
      nodeOf[p] = id;
      sx += p % w;
      sy += (p / w) | 0;
    }
    nodes.push({ x: sx / members.length, y: sy / members.length });
    nodePixels.push(members);
    return id;
  };

  // Junction clusters: 8-connected groups of degree>=3 pixels become one node.
  const junctions = new Set<number>();
  for (const p of pixels) {
    if (deg[p] < 3 || nodeOf[p] >= 0) continue;
    const members = [p];
    nodeOf[p] = -2;
    for (let i = 0; i < members.length; i++) {
      const q = members[i];
      const x = q % w, y = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!on(x + dx, y + dy)) continue;
          const r = (y + dy) * w + x + dx;
          if (deg[r] >= 3 && nodeOf[r] === -1) {
            nodeOf[r] = -2;
            members.push(r);
          }
        }
    }
    junctions.add(addNode(members));
  }
  for (const p of pixels) if (deg[p] === 1) addNode([p]);

  const edges: GEdge[] = [];
  const visited = new Uint8Array(w * h);
  const toVec = (p: number): Vec2 => ({ x: p % w, y: (p / w) | 0 });

  const pushEdge = (a: number, b: number, pts: Vec2[]): void => {
    if (a === b && pts.length < MIN_SELF_LOOP_PIXELS) return;
    let len = 0;
    let prev: Vec2 = nodes[a];
    for (const q of pts) {
      len += dist(prev, q);
      prev = q;
    }
    len += dist(prev, nodes[b]);
    edges.push({ a, b, pts, len });
  };

  const trace = (from: number, prevPx: number, firstPx: number): void => {
    const pts: Vec2[] = [];
    let prev = prevPx, cur = firstPx;
    for (;;) {
      if (nodeOf[cur] >= 0) return pushEdge(from, nodeOf[cur], pts);
      if (visited[cur]) return; // malformed chain; drop it
      visited[cur] = 1;
      pts.push(toVec(cur));
      const next = neighbours(cur).find((q) => q !== prev);
      if (next === undefined) return;
      prev = cur;
      cur = next;
    }
  };

  const directSeen = new Set<string>();
  const nodeCountBeforeRings = nodes.length;
  for (let n = 0; n < nodeCountBeforeRings; n++) {
    for (const p of nodePixels[n]) {
      for (const q of neighbours(p)) {
        const m = nodeOf[q];
        if (m >= 0) {
          if (m === n) continue;
          const key = n < m ? `${n}-${m}` : `${m}-${n}`;
          if (!directSeen.has(key)) {
            directSeen.add(key);
            pushEdge(n, m, []);
          }
        } else if (!visited[q]) trace(n, p, q);
      }
    }
  }

  // Rings with no junctions or endpoints: pin a pseudo node and walk around.
  for (const p of pixels) {
    if (deg[p] !== 2 || nodeOf[p] >= 0 || visited[p]) continue;
    const n = addNode([p]);
    trace(n, p, neighbours(p)[0]);
  }

  // A thick crossing often thins into two degree-3 junctions joined by a short
  // edge. Contract those so a figure-eight crossing becomes one degree-4 node.
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (const e of edges) {
    if (e.a !== e.b && junctions.has(e.a) && junctions.has(e.b) && e.len <= JUNCTION_MERGE_PX) parent[find(e.a)] = find(e.b);
  }
  const weight = nodes.map(() => 0);
  const acc = nodes.map(() => ({ x: 0, y: 0 }));
  nodes.forEach((nd, i) => {
    const r = find(i), k = nodePixels[i].length;
    acc[r].x += nd.x * k;
    acc[r].y += nd.y * k;
    weight[r] += k;
  });
  nodes.forEach((nd, i) => {
    const r = find(i);
    nd.x = acc[r].x / weight[r];
    nd.y = acc[r].y / weight[r];
  });
  const merged: GEdge[] = [];
  for (const e of edges) {
    const a = find(e.a), b = find(e.b);
    if (a === b && e.a !== e.b) continue; // contracted
    if (a === b && e.pts.length < MIN_SELF_LOOP_PIXELS) continue;
    merged.push({ ...e, a, b });
  }
  edges.length = 0;
  edges.push(...merged);

  const inc: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    inc[e.a].push(i);
    if (e.b !== e.a) inc[e.b].push(i);
  });
  return { nodes, edges, inc, skeletonPixels: pixels.length };
}

// ---------------------------------------------------------------- helpers

const other = (e: GEdge, n: number): number => (e.a === n ? e.b : e.a);

function edgeDegree(g: Graph, n: number, alive: boolean[]): number {
  let d = 0;
  for (const i of g.inc[n]) if (alive[i]) d += g.edges[i].a === g.edges[i].b ? 2 : 1;
  return d;
}

/** Remove degree-1 nodes until none remain (spur pruning). */
function twoCore(g: Graph): boolean[] {
  const alive = g.edges.map(() => true);
  const deg = g.nodes.map((_, n) => edgeDegree(g, n, alive));
  const queue: number[] = [];
  deg.forEach((d, n) => d === 1 && queue.push(n));
  while (queue.length) {
    const n = queue.pop()!;
    for (const i of g.inc[n]) {
      if (!alive[i]) continue;
      alive[i] = false;
      const m = other(g.edges[i], n);
      deg[n]--;
      if (m !== n && --deg[m] === 1) queue.push(m);
    }
  }
  return alive;
}

/** Edge ids of the connected piece (over `alive` edges) with the greatest total length. */
function heaviestComponent(g: Graph, alive: boolean[]): number[] {
  const parent = g.nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  g.edges.forEach((e, i) => {
    if (alive[i]) parent[find(e.a)] = find(e.b);
  });
  const weight = new Map<number, number>();
  g.edges.forEach((e, i) => {
    if (alive[i]) weight.set(find(e.a), (weight.get(find(e.a)) ?? 0) + e.len);
  });
  let best = -1, bestW = -1;
  for (const [root, wt] of weight) if (wt > bestW) [best, bestW] = [root, wt];
  return g.edges.map((_, i) => i).filter((i) => alive[i] && find(g.edges[i].a) === best);
}

const stepPoints = (e: GEdge, fwd: boolean): Vec2[] => (fwd ? e.pts : [...e.pts].reverse());
const stepFrom = (e: GEdge, fwd: boolean): number => (fwd ? e.a : e.b);
const stepTo = (e: GEdge, fwd: boolean): number => (fwd ? e.b : e.a);

function outDir(g: Graph, s: Step): Vec2 {
  const e = g.edges[s.e];
  const seq = stepPoints(e, s.fwd);
  const from = g.nodes[stepFrom(e, s.fwd)];
  const target = seq.length ? seq[Math.min(DIR_LOOKAHEAD, seq.length - 1)] : g.nodes[stepTo(e, s.fwd)];
  return normalize(sub(target, from));
}

function inDir(g: Graph, s: Step): Vec2 {
  const e = g.edges[s.e];
  const seq = stepPoints(e, s.fwd);
  const to = g.nodes[stepTo(e, s.fwd)];
  const src = seq.length ? seq[Math.max(0, seq.length - 1 - DIR_LOOKAHEAD)] : g.nodes[stepFrom(e, s.fwd)];
  return normalize(sub(to, src));
}

function stepsToPolyline(g: Graph, steps: Step[]): Vec2[] {
  const out: Vec2[] = [];
  for (const s of steps) {
    const e = g.edges[s.e];
    out.push({ ...g.nodes[stepFrom(e, s.fwd)] });
    out.push(...stepPoints(e, s.fwd));
  }
  return out;
}

// ---------------------------------------------------------------- cycle search

/**
 * Greedy Euler circuit that always leaves a junction along the straightest
 * unused edge. Returns null if it fails to use every edge.
 */
function straightEulerCircuit(g: Graph, edgeIds: number[]): Step[] | null {
  const inSet = new Set(edgeIds);
  const used = new Set<number>();
  const first = g.edges[edgeIds[0]];
  const start = first.a;
  const steps: Step[] = [{ e: edgeIds[0], fwd: true }];
  used.add(edgeIds[0]);
  let cur = first.b;

  while (used.size < edgeIds.length) {
    const incoming = inDir(g, steps[steps.length - 1]);
    let best: Step | null = null, bestScore = -Infinity;
    for (const i of g.inc[cur]) {
      if (!inSet.has(i) || used.has(i)) continue;
      const e = g.edges[i];
      const options: Step[] = [];
      if (e.a === cur) options.push({ e: i, fwd: true });
      if (e.b === cur) options.push({ e: i, fwd: false });
      for (const o of options) {
        const score = dot(incoming, outDir(g, o));
        if (score > bestScore) [best, bestScore] = [o, score];
      }
    }
    if (!best) return null;
    steps.push(best);
    used.add(best.e);
    cur = stepTo(g.edges[best.e], best.fwd);
  }
  return cur === start ? steps : null;
}

/** Longest simple cycle (by length) within `edgeIds`, via bounded DFS. */
function longestCycle(g: Graph, edgeIds: number[]): Step[] | null {
  const inSet = new Set(edgeIds);
  let best: Step[] | null = null, bestLen = -1;

  for (const i of edgeIds) {
    const e = g.edges[i];
    if (e.a === e.b && e.len > bestLen) [best, bestLen] = [[{ e: i, fwd: true }], e.len];
  }

  const nodeIds = [...new Set(edgeIds.flatMap((i) => [g.edges[i].a, g.edges[i].b]))].sort((a, b) => a - b);
  const onPath = new Uint8Array(g.nodes.length);
  const path: Step[] = [];
  let budget = CYCLE_BUDGET;

  const dfs = (start: number, n: number, len: number): void => {
    if (--budget < 0) return;
    for (const i of g.inc[n]) {
      if (!inSet.has(i)) continue;
      const e = g.edges[i];
      if (e.a === e.b) continue;
      const m = other(e, n);
      const step: Step = { e: i, fwd: e.a === n };
      if (m === start) {
        if (path.length >= 1 && path[path.length - 1].e !== i && len + e.len > bestLen) {
          best = [...path, step];
          bestLen = len + e.len;
        }
      } else if (m > start && !onPath[m]) {
        onPath[m] = 1;
        path.push(step);
        dfs(start, m, len + e.len);
        path.pop();
        onPath[m] = 0;
      }
    }
  };

  for (const s of nodeIds) {
    onPath[s] = 1;
    dfs(s, s, 0);
    onPath[s] = 0;
    if (budget < 0) break;
  }
  return best;
}

/** Longest path in an acyclic component via double sweep. */
function longestPath(g: Graph, edgeIds: number[]): Step[] {
  const inSet = new Set(edgeIds);
  const sweep = (src: number): { far: number; steps: Map<number, Step | null> } => {
    const d = new Map<number, number>([[src, 0]]);
    const via = new Map<number, Step | null>([[src, null]]);
    const stack = [src];
    let far = src;
    while (stack.length) {
      const n = stack.pop()!;
      for (const i of g.inc[n]) {
        if (!inSet.has(i)) continue;
        const e = g.edges[i];
        const m = other(e, n);
        if (d.has(m)) continue;
        d.set(m, d.get(n)! + e.len);
        via.set(m, { e: i, fwd: e.a === n });
        if (d.get(m)! > d.get(far)!) far = m;
        stack.push(m);
      }
    }
    return { far, steps: via };
  };
  const a = sweep(g.edges[edgeIds[0]].a).far;
  const { far: b, steps } = sweep(a);
  const out: Step[] = [];
  for (let n = b; steps.get(n); ) {
    const s = steps.get(n)!;
    out.push(s);
    n = stepFrom(g.edges[s.e], s.fwd);
  }
  return out.reverse();
}

// ---------------------------------------------------------------- entry point

function polyLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 0; i < pts.length; i++) L += dist(pts[i], pts[(i + 1) % pts.length]);
  return L;
}

export function orderLoop(skel: Mask): LoopResult | null {
  const g = buildGraph(skel);
  if (!g.edges.length) return null;

  const core = twoCore(g);
  const coreEdges = heaviestComponent(g, core);
  let steps: Step[] | null = null;
  let closed = true;

  if (coreEdges.length) {
    const allEven = coreEdges
      .flatMap((i) => [g.edges[i].a, g.edges[i].b])
      .every((n) => edgeDegree(g, n, core) % 2 === 0);
    if (allEven) steps = straightEulerCircuit(g, coreEdges);
    steps ??= longestCycle(g, coreEdges);
  }
  if (!steps) {
    closed = false;
    const all = heaviestComponent(g, g.edges.map(() => true));
    steps = longestPath(g, all);
    if (!steps.length) return null;
  }

  const points = stepsToPolyline(g, steps);
  if (!closed) points.push({ ...g.nodes[stepTo(g.edges[steps[steps.length - 1].e], steps[steps.length - 1].fwd)] });
  let loopPixels = 0;
  for (const s of steps) loopPixels += g.edges[s.e].pts.length;

  return {
    points,
    closed,
    gap: closed ? 0 : dist(points[0], points[points.length - 1]),
    length: polyLength(points),
    loopPixels,
    skeletonPixels: g.skeletonPixels,
  };
}
