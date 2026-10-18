import { formatLapTime, type Race, type RaceState } from '../sim/race';
import { THEME } from './theme';

type Ctx = CanvasRenderingContext2D;

const font = (weight: number, px: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${px}px ${THEME.font}`;
const PANEL = 'rgba(11,13,16,0.86)';

/** Skewed broadcast slab. */
function slab(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, skew = 0): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - skew, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}

export interface HudInfo {
  name: string;
  lengthKm: number;
}

/** Timing tower (top-left) and speed box (bottom-left). `u` is the UI scale. */
export function drawHud(ctx: Ctx, _w: number, h: number, u: number, r: Race, s: RaceState, info: HudInfo): void {
  if (s.phase === 'intro') return;
  const m = 16 * u;
  const tw = 236 * u;

  // ---- tower header
  let y = m;
  slab(ctx, m, y, tw, 28 * u, THEME.accent, 8 * u);
  ctx.fillStyle = '#fff';
  ctx.font = font(800, 16 * u, true);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(clip(ctx, info.name.toUpperCase(), tw * 0.58), m + 14 * u, y + 14.5 * u);
  ctx.textAlign = 'right';
  ctx.font = font(700, 15 * u);
  ctx.fillText(`LAP ${s.lap}/${r.laps}`, m + tw - 14 * u, y + 14.5 * u);
  y += 28 * u;

  // ---- lap timer
  slab(ctx, m, y, tw, 58 * u, PANEL);
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.muted;
  ctx.font = font(600, 12 * u);
  ctx.fillText(s.finished ? 'FINAL LAP' : 'LAP TIME', m + 14 * u, y + 14 * u);
  ctx.fillStyle = THEME.text;
  ctx.font = font(700, 36 * u);
  ctx.fillText(formatLapTime(s.lapTime), m + 12 * u, y + 38 * u);
  y += 58 * u;

  // ---- sectors
  for (let k = 0; k < 3; k++) {
    const rowH = 24 * u;
    slab(ctx, m, y, tw, rowH, k === s.sector && !s.finished ? 'rgba(30,35,42,0.92)' : PANEL);
    ctx.fillStyle = THEME.sectors[k];
    ctx.fillRect(m, y + 3 * u, 4 * u, rowH - 6 * u);
    ctx.font = font(700, 14 * u);
    ctx.textAlign = 'left';
    ctx.fillStyle = k === s.sector && !s.finished ? THEME.text : THEME.muted;
    ctx.fillText(`S${k + 1}`, m + 14 * u, y + rowH / 2);
    ctx.textAlign = 'right';
    const split = s.sectorSplits[k];
    ctx.fillStyle = split !== undefined ? THEME.text : THEME.muted;
    ctx.fillText(split !== undefined ? split.toFixed(3) : '--.---', m + tw - 14 * u, y + rowH / 2);
    y += rowH;
  }

  // ---- last / best
  if (s.lapTimes.length) {
    const rowH = 24 * u;
    slab(ctx, m, y, tw, rowH, PANEL);
    const last = s.lapTimes[s.lapTimes.length - 1];
    const best = Math.min(...s.lapTimes);
    ctx.font = font(600, 13 * u);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`LAST ${formatLapTime(last)}`, m + 14 * u, y + rowH / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b77dff';
    ctx.fillText(`BEST ${formatLapTime(best)}`, m + tw - 14 * u, y + rowH / 2);
  }

  drawSpeed(ctx, h, u, r, s);
}

function drawSpeed(ctx: Ctx, h: number, u: number, r: Race, s: RaceState): void {
  const m = 16 * u;
  const bw = 200 * u, bh = 84 * u;
  const x = m, y = h - m - bh;
  slab(ctx, x, y, bw, bh, PANEL, 8 * u);

  const kmh = s.speed * 3.6;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.fillStyle = THEME.text;
  ctx.font = font(800, 50 * u, true);
  ctx.fillText(String(Math.round(kmh)), x + 118 * u, y + 52 * u);
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.muted;
  ctx.font = font(700, 15 * u);
  ctx.fillText('KM/H', x + 126 * u, y + 50 * u);

  // speed bar
  const barX = x + 14 * u, barY = y + 62 * u, barW = bw - 36 * u, barH = 6 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = THEME.accent;
  ctx.fillRect(barX, barY, barW * Math.min(1, s.speed / Math.max(r.topSpeed, 1)), barH);

  // throttle / brake chips
  const thr = Math.max(0, Math.min(1, s.accel / 6));
  const brk = Math.max(0, Math.min(1, -s.accel / 15));
  chip(ctx, x + 154 * u, y + 16 * u, 10 * u, 34 * u, '#2bd67b', thr);
  chip(ctx, x + 170 * u, y + 16 * u, 10 * u, 34 * u, THEME.accent, brk);
  ctx.textBaseline = 'middle';
}

function chip(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, level: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y + h * (1 - level), w, h * level);
}

function clip(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** Lower-third title during the intro, centred banner after the flag. */
export function drawTitles(ctx: Ctx, w: number, h: number, u: number, r: Race, s: RaceState, info: HudInfo, outroT: number): void {
  if (s.phase === 'intro') {
    const a = Math.min(1, s.introP * 4) * Math.min(1, (1 - s.introP) * 6);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const bw = Math.min(w - 32 * u, 420 * u), bh = 64 * u;
    const x = (w - bw) / 2, y = h - 40 * u - bh;
    slab(ctx, x, y, bw, bh, PANEL, 10 * u);
    slab(ctx, x, y, 8 * u, bh, THEME.accent);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.text;
    ctx.font = font(800, 26 * u, true);
    ctx.fillText(clip(ctx, info.name.toUpperCase(), bw - 40 * u), x + 24 * u, y + 24 * u);
    ctx.fillStyle = THEME.muted;
    ctx.font = font(600, 15 * u);
    ctx.fillText(`${info.lengthKm.toFixed(3)} KM · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}`, x + 24 * u, y + 47 * u);
    ctx.globalAlpha = 1;
    return;
  }
  if (s.phase === 'outro') {
    const a = Math.min(1, outroT * 2);
    ctx.globalAlpha = a;
    const bw = Math.min(w - 32 * u, 380 * u), bh = 78 * u;
    const x = (w - bw) / 2, y = h * 0.5 - bh / 2;
    slab(ctx, x, y, bw, bh, PANEL, 10 * u);
    chequer(ctx, x + 18 * u, y + 18 * u, 42 * u, 42 * u);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.text;
    ctx.font = font(800, 24 * u, true);
    ctx.fillText('FINISH', x + 76 * u, y + 28 * u);
    ctx.fillStyle = THEME.muted;
    ctx.font = font(600, 15 * u);
    const total = s.lapTimes.reduce((a2, b) => a2 + b, 0);
    ctx.fillText(`TOTAL ${formatLapTime(total)} · BEST ${formatLapTime(Math.min(...s.lapTimes))}`, x + 76 * u, y + 54 * u);
    ctx.globalAlpha = 1;
  }
}

function chequer(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const n = 4, cw = w / n, ch = h / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      ctx.fillRect(x + i * cw, y + j * ch, cw, ch);
    }
}
