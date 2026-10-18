import { normalize, sub, type Vec2 } from '../geom/vec2';
import { THEME } from './theme';
import type { View } from './view';

export interface EditorScene {
  image: CanvasImageSource | null;
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
}

type Ctx = CanvasRenderingContext2D;

export function drawEditor(ctx: Ctx, w: number, h: number, view: View, s: EditorScene): void {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (s.image) {
    const tl = view.toScreen({ x: 0, y: 0 });
    ctx.globalAlpha = 0.42;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.image, tl.x, tl.y, s.width * view.scale, s.height * view.scale);
    ctx.globalAlpha = 1;
  } else {
    drawGrid(ctx, w, h, view);
  }
  ctx.restore();

  if (s.path.length > 2) drawTrack(ctx, view, s.path, s.sectors);
  if (s.trace.length) drawTrace(ctx, view, s.trace);
  if (s.showControls) drawControls(ctx, view, s.controls, s.hot);
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

export function drawTrack(ctx: Ctx, view: View, path: Vec2[], sectors: [number, number], width = 4): void {
  const pts = path.map((p) => view.toScreen(p));
  const n = pts.length;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = THEME.casing;
  ctx.lineWidth = width + 5;
  strokeRange(ctx, pts, 0, n);

  const cuts = [0, Math.round(sectors[0] * n), Math.round(sectors[1] * n), n];
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = THEME.sectors[k];
    ctx.lineWidth = width;
    strokeRange(ctx, pts, cuts[k], cuts[k + 1]);
  }

  // Sector split ticks
  for (let k = 1; k <= 2; k++) tick(ctx, pts, cuts[k], 9, '#ffffff', 2, `S${k + 1}`);
  drawStartLine(ctx, pts);
}

function tangentAt(pts: Vec2[], i: number): Vec2 {
  const n = pts.length;
  return normalize(sub(pts[(i + 2) % n], pts[(i - 2 + n) % n]));
}

function tick(ctx: Ctx, pts: Vec2[], i: number, half: number, color: string, lw: number, label?: string): void {
  const p = pts[i % pts.length], t = tangentAt(pts, i % pts.length);
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

/** Chequered start/finish bar plus a direction chevron. */
function drawStartLine(ctx: Ctx, pts: Vec2[]): void {
  const p = pts[0], t = tangentAt(pts, 0);
  const nx = -t.y, ny = t.x;
  const half = 11, cells = 6, cw = (2 * half) / cells;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(ny, nx));
  ctx.fillStyle = '#000';
  ctx.fillRect(-half - 1, -cw - 1, 2 * half + 2, 2 * cw + 2);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#000' : '#fff';
      ctx.fillRect(-half + c * cw, -cw + r * cw, cw, cw);
    }
  ctx.restore();

  // chevron a little way along the lap
  const k = Math.min(pts.length - 1, Math.max(6, Math.round(pts.length * 0.03)));
  const q = pts[k], d = tangentAt(pts, k);
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

function drawControls(ctx: Ctx, view: View, controls: Vec2[], hot: number): void {
  controls.forEach((c, i) => {
    const p = view.toScreen(c);
    const r = i === hot ? 7 : 4.5;
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

function drawTrace(ctx: Ctx, view: View, trace: Vec2[]): void {
  const pts = trace.map((p) => view.toScreen(p));
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  strokeRange(ctx, pts, 0, pts.length - 1);
  if (pts.length > 2) {
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
