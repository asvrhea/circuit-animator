import { normalize, sub, type Vec2 } from '../geom/vec2';
import type { Ranges } from '../sim/surface';
import { THEME } from './theme';
import type { View } from './view';

export interface EditorScene {
  image: CanvasImageSource | null;
  /** draws a map background (already handles its own transform) */
  basemap: ((ctx: Ctx) => void) | null;
  /** world-space size of the image or blank canvas */
  width: number;
  height: number;
  path: Vec2[];
  controls: Vec2[];
  sectors: [number, number];
  showControls: boolean;
  /** index of hovered / dragged control, or -1 */
  hot: number;
  trace: Vec2[];
  /** calibration points A, B (also the first end of a straighten) */
  measure: Vec2[];
  /** control indices to ring, e.g. the corner being adjusted */
  selected: number[];
  /** false = open point-to-point stage (rally) */
  closed: boolean;
  /** gravel stretches as [from, to] fractions of track length */
  gravel: Ranges;
  /** pending A/B picks for the surface tool */
  surfaceMarks: Vec2[];
}

type Ctx = CanvasRenderingContext2D;

export function drawEditor(ctx: Ctx, w: number, h: number, view: View, s: EditorScene): void {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (s.basemap) {
    s.basemap(ctx);
    ctx.fillStyle = 'rgba(11,13,16,0.38)';
    ctx.fillRect(0, 0, w, h);
  } else if (s.image) {
    const tl = view.toScreen({ x: 0, y: 0 });
    ctx.globalAlpha = 0.42;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.image, tl.x, tl.y, s.width * view.scale, s.height * view.scale);
    ctx.globalAlpha = 1;
  } else {
    drawGrid(ctx, w, h, view);
  }
  ctx.restore();

  if (s.path.length > 2) drawTrack(ctx, view, s.path, s.sectors, 4, s.closed, s.gravel);
  if (s.trace.length) drawTrace(ctx, view, s.trace, s.closed);
  if (s.showControls && s.selected.length) drawSelected(ctx, view, s.selected.map((i) => s.controls[i]).filter(Boolean));
  if (s.showControls) drawControls(ctx, view, s.controls, s.hot, s.closed);
  if (s.measure.length) drawMeasure(ctx, view, s.measure);
  if (s.surfaceMarks.length) drawMeasure(ctx, view, s.surfaceMarks, '#ffc400', false);
}

function drawMeasure(ctx: Ctx, view: View, pts: Vec2[], color: string = THEME.accent, line = true): void {
  const sp = pts.map((p) => view.toScreen(p));
  if (line && sp.length === 2) {
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sp[0].x, sp[0].y);
    ctx.lineTo(sp[1].x, sp[1].y);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  sp.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color === THEME.accent ? '#fff' : '#000';
    ctx.font = `800 10px ${THEME.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i ? 'B' : 'A', p.x, p.y + 0.5);
  });
}

function drawGrid(ctx: Ctx, w: number, h: number, view: View): void {
  const step = 50 * view.scale;
  if (step < 8) return;
  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = ((view.ox % step) + step) % step; x < w; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = ((view.oy % step) + step) % step; y < h; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

function strokeRange(ctx: Ctx, pts: Vec2[], from: number, to: number): void {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[from % n].x, pts[from % n].y);
  for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i % n].x, pts[i % n].y);
  ctx.stroke();
}

export function drawTrack(
  ctx: Ctx,
  view: View,
  path: Vec2[],
  sectors: [number, number],
  width = 4,
  closed = true,
  gravel: Ranges = [],
): void {
  const pts = path.map((p) => view.toScreen(p));
  const n = pts.length;
  const span = closed ? n : n - 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = THEME.casing;
  ctx.lineWidth = width + 5;
  strokeRange(ctx, pts, 0, span);

  const cuts = [0, Math.round(sectors[0] * span), Math.round(sectors[1] * span), span];
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = THEME.sectors[k];
    ctx.lineWidth = width;
    strokeRange(ctx, pts, cuts[k], cuts[k + 1]);
  }

  // gravel stretches over the sector colour
  for (const [f0, f1] of gravel) {
    const a = Math.round(f0 * span), b = Math.round(f1 * span);
    if (b <= a) continue;
    ctx.strokeStyle = THEME.gravel;
    ctx.lineWidth = width;
    strokeRange(ctx, pts, a, b);
    ctx.save();
    ctx.setLineDash([width * 0.6, width * 0.6]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(230,205,160,0.5)';
    ctx.lineWidth = Math.max(1, width * 0.3);
    strokeRange(ctx, pts, a, b);
    ctx.restore();
  }

  // Sector split ticks
  const lbl = closed ? (k: number) => `S${k + 1}` : (k: number) => `SPLIT ${k}`;
  for (let k = 1; k <= 2; k++) tick(ctx, pts, cuts[k], 9, '#ffffff', 2, lbl(k), closed);
  if (closed) drawStartLine(ctx, pts);
  else drawOpenEnds(ctx, pts);
  drawChevron(ctx, pts, closed);
}

function tangentAt(pts: Vec2[], i: number, closed = true): Vec2 {
  const n = pts.length;
  if (!closed) return normalize(sub(pts[Math.min(n - 1, i + 2)], pts[Math.max(0, i - 2)]));
  return normalize(sub(pts[(i + 2) % n], pts[(i - 2 + n) % n]));
}

function tick(ctx: Ctx, pts: Vec2[], i: number, half: number, color: string, lw: number, label?: string, closed = true): void {
  const p = pts[i % pts.length], t = tangentAt(pts, i % pts.length, closed);
  const nx = -t.y, ny = t.x;
  ctx.strokeStyle = THEME.casing;
  ctx.lineWidth = lw + 3;
  ctx.beginPath();
  ctx.moveTo(p.x - nx * half, p.y - ny * half);
  ctx.lineTo(p.x + nx * half, p.y + ny * half);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
  if (label) {
    ctx.font = `700 12px ${THEME.font}`;
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x + nx * (half + 10), p.y + ny * (half + 10));
  }
}

/** Bar across the track at pts[i]: chequered, or solid green when `color` is given. */
function drawBar(ctx: Ctx, pts: Vec2[], i: number, closed: boolean, color?: string): void {
  const p = pts[i], t = tangentAt(pts, i, closed);
  const nx = -t.y, ny = t.x;
  const half = 11, cells = 6, cw = (2 * half) / cells;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(ny, nx));
  ctx.fillStyle = '#000';
  ctx.fillRect(-half - 1, -cw - 1, 2 * half + 2, 2 * cw + 2);
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(-half, -cw, 2 * half, 2 * cw);
  } else {
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < cells; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#000' : '#fff';
        ctx.fillRect(-half + c * cw, -cw + r * cw, cw, cw);
      }
  }
  ctx.restore();
}

function drawStartLine(ctx: Ctx, pts: Vec2[]): void {
  drawBar(ctx, pts, 0, true);
}

/** Open stage: green START bar at the first point, chequered FINISH bar at the last. */
function drawOpenEnds(ctx: Ctx, pts: Vec2[]): void {
  const last = pts.length - 1;
  drawBar(ctx, pts, 0, false, '#2bd96b');
  drawBar(ctx, pts, last, false);
  for (const [i, text] of [[0, 'START'], [last, 'FINISH']] as const) {
    const t = tangentAt(pts, i, false);
    ctx.font = `700 12px ${THEME.font}`;
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pts[i].x - t.y * 24, pts[i].y + t.x * 24);
  }
}

/** Direction chevron a little way along the track. */
function drawChevron(ctx: Ctx, pts: Vec2[], closed: boolean): void {
  const k = Math.min(pts.length - 1, Math.max(6, Math.round(pts.length * 0.03)));
  const q = pts[k], d = tangentAt(pts, k, closed);
  const s = 7;
  ctx.fillStyle = THEME.text;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(q.x + d.x * s, q.y + d.y * s);
  ctx.lineTo(q.x - d.x * s - d.y * s, q.y - d.y * s + d.x * s);
  ctx.lineTo(q.x - d.x * s * 0.4, q.y - d.y * s * 0.4);
  ctx.lineTo(q.x - d.x * s + d.y * s, q.y - d.y * s - d.x * s);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function drawSelected(ctx: Ctx, view: View, pts: Vec2[]): void {
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 2.5;
  for (const c of pts) {
    const p = view.toScreen(c);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawControls(ctx: Ctx, view: View, controls: Vec2[], hot: number, closed = true): void {
  controls.forEach((c, i) => {
    const p = view.toScreen(c);
    const r = i === hot ? 7 : 4.5;
    if (!closed && i === controls.length - 1 && i > 0) {
      // finish control: small chequered square
      const q = r * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
      ctx.fillStyle = i === hot ? THEME.accent : '#000';
      ctx.fillRect(p.x - r, p.y - r, q * 1, q * 1);
      ctx.fillRect(p.x, p.y - r, q * 1, q * 1);
      ctx.fillRect(p.x - r + q, p.y - r + q, q, q);
      ctx.fillRect(p.x + q, p.y - r + q, q, q);
      ctx.fillRect(p.x - r, p.y, q, q);
      ctx.fillRect(p.x, p.y, q, q);
      ctx.fillRect(p.x - r + q, p.y + q, q, q);
      ctx.fillRect(p.x + q, p.y + q, q, q);
      ctx.lineWidth = 2;
      ctx.strokeStyle = THEME.controlEdge;
      ctx.strokeRect(p.x - r, p.y - r, 2 * r, 2 * r);
      return;
    }
    ctx.beginPath();
    if (i === 0) ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
    else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === hot ? THEME.accent : THEME.control;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.controlEdge;
    ctx.stroke();
  });
}

function drawTrace(ctx: Ctx, view: View, trace: Vec2[], closed = true): void {
  const pts = trace.map((p) => view.toScreen(p));
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  strokeRange(ctx, pts, 0, pts.length - 1);
  if (closed && pts.length > 2) {
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineTo(pts[0].x, pts[0].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? THEME.accent : THEME.control;
    ctx.fill();
    ctx.strokeStyle = THEME.controlEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}
