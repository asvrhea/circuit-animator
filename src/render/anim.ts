import { normalize, sub, type Vec2 } from '../geom/vec2';
import { poseAt, raceState, type Race, type RaceState } from '../sim/race';
import { Camera, type CamPose } from './camera';
import { drawHud, drawTitles, type HudInfo } from './hud';
import { THEME } from './theme';
import { OSM_ATTRIBUTION, type TileLayer } from './tiles';
import { boundsOf, type Rect } from './view';

export type CameraMode = 'full' | 'follow';
export type ThemeMode = 'broadcast' | 'screenshot';

export interface AnimOptions {
  camera: CameraMode;
  /** 'screenshot' = the source map: the screenshot image, or OSM tiles for map-coordinate tracks */
  theme: ThemeMode;
  image: CanvasImageSource | null;
  tiles: TileLayer | null;
  imageW: number;
  imageH: number;
  info: HudInfo;
}

type Ctx = CanvasRenderingContext2D;

const FOLLOW_ZOOM = 3.2;
const TRAIL_STEPS = 22;
const TRAIL_DT = 0.035;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Draws one frame of the lap animation for a given race time. Resolution
 * independent: pass any w x h (CSS px) and the DPR the context is scaled by.
 */
export class AnimRenderer {
  readonly cam = new Camera();
  private bounds: Rect;
  private heading = 0;
  private lastTime = -1;

  constructor(
    readonly race: Race,
    public opts: AnimOptions,
  ) {
    this.bounds = boundsOf(race.path);
  }

  private fitPose(w: number, h: number): CamPose {
    const b = this.bounds;
    const scale = Math.min((w * 0.8) / Math.max(b.w, 1), (h * 0.78) / Math.max(b.h, 1));
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, scale, rot: 0 };
  }

  /** Render `time`; `snap` jumps the camera instead of easing (seeking, first frame). */
  render(ctx: Ctx, w: number, h: number, dpr: number, time: number, snap = false, frame?: { ox: number; oy: number; uiScale: number }): RaceState {
    const r = this.race;
    const s = raceState(r, time);
    const dt = this.lastTime < 0 || snap ? 0 : time - this.lastTime;
    this.lastTime = time;
    const u = frame ? frame.uiScale : Math.max(0.6, Math.min(w, h) / 720);
    const ox = frame?.ox ?? 0, oy = frame?.oy ?? 0;
    const base = () => ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);

    // ---- camera
    const pose = poseAt(r.path, s.index, s.frac, r.closed);
    let dh = pose.heading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading = snap ? pose.heading : this.heading + dh * (1 - Math.exp(-Math.max(0, dt) / 0.12));

    const fit = this.fitPose(w, h);
    const follow = this.opts.camera === 'follow' && s.phase !== 'intro';
    this.cam.ax = w / 2;
    this.cam.ay = follow ? h * 0.6 : h / 2;
    const target: CamPose = follow
      ? { cx: pose.p.x, cy: pose.p.y, scale: fit.scale * FOLLOW_ZOOM, rot: -Math.PI / 2 - this.heading }
      : fit;
    if (snap || dt === 0) this.cam.set(target);
    else this.cam.smoothTo(target, dt, follow ? 0.06 : 0.4, 0.5, 0.35);
    const zoomRel = this.cam.scale / fit.scale;

    // ---- background
    ctx.save();
    base();
    if (frame) {
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
    }
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    const useTiles = this.opts.theme === 'screenshot' && !!this.opts.tiles;
    const useImage = this.opts.theme === 'screenshot' && (!!this.opts.image || useTiles);
    this.cam.apply(ctx, dpr, ox, oy);
    if (useTiles) {
      // muted map so the track and HUD read first
      ctx.filter = 'grayscale(0.7) brightness(0.8) contrast(1.05)';
      this.opts.tiles!.draw(ctx, this.cam.visibleRect(w, h), this.cam.scale, dpr);
      ctx.filter = 'none';
    } else if (useImage) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.opts.image!, 0, 0, this.opts.imageW, this.opts.imageH);
    } else {
      this.drawGrid(ctx);
    }
    base();
    if (useImage) {
      ctx.fillStyle = 'rgba(11,13,16,0.45)';
      ctx.fillRect(0, 0, w, h);
    } else {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // ---- track
    const trackW = Math.min(26, 6 * Math.sqrt(zoomRel)) * u;
    const reveal = s.phase === 'intro' ? ease(s.introP / 0.8) : 1;
    this.drawTrack(ctx, trackW, reveal, s);

    // ---- car + trail
    if (s.phase !== 'intro') {
      this.drawTrail(ctx, time, trackW);
      this.drawCar(ctx, this.cam.toScreen(pose.p), this.heading + this.cam.rot, trackW);
    } else if (reveal >= 1) {
      this.drawCar(ctx, this.cam.toScreen(r.path[0]), poseAt(r.path, 0, 0, r.closed).heading + this.cam.rot, trackW);
    }

    // ---- overlays
    drawHud(ctx, w, h, u, r, s, this.opts.info);
    if (s.phase !== 'intro') this.drawScaleBar(ctx, w, h, u);
    if (this.opts.camera === 'follow' && s.phase !== 'intro') this.drawMinimap(ctx, w, u, pose.p);
    drawTitles(ctx, w, h, u, r, s, this.opts.info, time - (r.total - r.outro));
    if (useTiles) {
      ctx.font = `600 ${10 * u}px ${THEME.font}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(232,236,241,0.75)';
      ctx.fillText(OSM_ATTRIBUTION, w - 6 * u, h - 3 * u);
    }
    ctx.restore();
    return s;
  }

  private drawGrid(ctx: Ctx): void {
    const step = 100 / this.race.mpu; // 100 m
    const b = this.bounds;
    const pad = Math.max(b.w, b.h) * 0.6;
    const x0 = Math.floor((b.x - pad) / step) * step, x1 = b.x + b.w + pad;
    const y0 = Math.floor((b.y - pad) / step) * step, y1 = b.y + b.h + pad;
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth = 1 / this.cam.scale;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y += step) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }

  private drawTrack(ctx: Ctx, W: number, reveal: number, s: RaceState): void {
    const pts = this.race.path.map((p) => this.cam.toScreen(p));
    const n = pts.length;
    const closed = this.race.closed;
    const span = closed ? n : n - 1;
    const end = Math.max(1, Math.round(reveal * span));
    const stroke = (from: number, to: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[from % n].x, pts[from % n].y);
      for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i % n].x, pts[i % n].y);
      ctx.stroke();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = W + 5;
    stroke(0, end);
    ctx.strokeStyle = '#2a3039';
    ctx.lineWidth = W;
    stroke(0, end);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, W * 0.12);
    stroke(0, end);

    // gravel stretches over the asphalt
    for (const [f0, f1] of this.race.gravel) {
      const a = Math.round(f0 * span), b = Math.min(Math.round(f1 * span), end);
      if (b <= a) continue;
      ctx.strokeStyle = THEME.gravel;
      ctx.lineWidth = W;
      stroke(a, b);
      ctx.save();
      ctx.setLineDash([W * 0.6, W * 0.6]);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(230,205,160,0.5)';
      ctx.lineWidth = Math.max(1, W * 0.2);
      stroke(a, b);
      ctx.restore();
    }

    const cuts = [0, Math.round(this.race.sectors[0] * span), Math.round(this.race.sectors[1] * span), span];
    for (let k = 0; k < 3; k++) {
      const a = cuts[k], b = Math.min(cuts[k + 1], end);
      if (b <= a) continue;
      const active = s.phase === 'race' && s.sector === k;
      ctx.globalAlpha = s.phase === 'race' ? (active ? 1 : 0.4) : 0.85;
      ctx.strokeStyle = THEME.sectors[k];
      ctx.lineWidth = Math.max(1.5, W * 0.3);
      stroke(a, b);
    }
    ctx.globalAlpha = 1;

    // head of the draw-in
    if (reveal < 1) {
      const p = pts[Math.min(end, n - 1) % n];
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, W * 3);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, W * 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (closed) {
      this.drawBar(ctx, pts[0], normalize(sub(pts[2 % n], pts[n - 2])), W, true);
    } else {
      const t0 = normalize(sub(pts[Math.min(2, n - 1)], pts[0]));
      const t1 = normalize(sub(pts[n - 1], pts[Math.max(0, n - 3)]));
      this.drawBar(ctx, pts[0], t0, W, false);
      this.drawBar(ctx, pts[n - 1], t1, W, true);
      this.drawLabel(ctx, 'START', pts[0], t0, W);
      this.drawLabel(ctx, 'FINISH', pts[n - 1], t1, W);
    }
  }

  /** Chequered (or solid green) bar across the track at p, perpendicular to tangent t. */
  private drawBar(ctx: Ctx, p: Vec2, t: Vec2, W: number, chequer: boolean): void {
    const half = W * 0.5 + 4;
    const cells = 6, cw = (2 * half) / cells;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(t.x, -t.y));
    if (chequer) {
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < cells; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#000' : '#fff';
          ctx.fillRect(-half + c * cw, -cw + r * cw, cw, cw);
        }
    } else {
      ctx.fillStyle = '#2bd96b';
      ctx.fillRect(-half, -cw, 2 * half, 2 * cw);
    }
    ctx.restore();
  }

  private drawLabel(ctx: Ctx, text: string, p: Vec2, t: Vec2, W: number): void {
    const size = Math.max(9, W * 0.7);
    const off = W * 0.5 + size * 1.2;
    // place beside the track (left normal on screen)
    const x = p.x + t.y * off, y = p.y - t.x * off;
    ctx.save();
    ctx.font = `700 ${size}px ${THEME.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.25);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawTrail(ctx: Ctx, time: number, W: number): void {
    const r = this.race;
    const raceStart = r.intro;
    const pts: Vec2[] = [];
    for (let k = 0; k <= TRAIL_STEPS; k++) {
      const t = time - k * TRAIL_DT;
      if (t < raceStart) break;
      const st = raceState(r, t);
      pts.push(this.cam.toScreen(poseAt(r.path, st.index, st.frac, r.closed).p));
    }
    ctx.lineCap = 'round';
    for (let k = 0; k < pts.length - 1; k++) {
      const f = 1 - k / TRAIL_STEPS;
      ctx.strokeStyle = `rgba(255,42,60,${0.75 * f * f})`;
      ctx.lineWidth = Math.max(1, W * 0.55 * f);
      ctx.beginPath();
      ctx.moveTo(pts[k].x, pts[k].y);
      ctx.lineTo(pts[k + 1].x, pts[k + 1].y);
      ctx.stroke();
    }
  }

  private drawCar(ctx: Ctx, p: Vec2, heading: number, W: number): void {
    const L = Math.max(10, W * 1.7);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(heading);
    ctx.shadowColor = 'rgba(255,42,60,0.8)';
    ctx.shadowBlur = L * 0.8;
    ctx.beginPath();
    ctx.moveTo(L * 0.65, 0);
    ctx.lineTo(-L * 0.45, L * 0.38);
    ctx.lineTo(-L * 0.25, 0);
    ctx.lineTo(-L * 0.45, -L * 0.38);
    ctx.closePath();
    ctx.fillStyle = THEME.accent;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, L * 0.1);
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  /** Bottom-right scale bar with a round length (camera scale is isotropic, so rotation doesn't matter). */
  private drawScaleBar(ctx: Ctx, w: number, h: number, u: number): void {
    const pxPerM = this.cam.scale / this.race.mpu;
    const target = 110 * u;
    const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const m = nice.reduce((best, v) => (Math.abs(v * pxPerM - target) < Math.abs(best * pxPerM - target) ? v : best), nice[0]);
    const len = m * pxPerM;
    const x1 = w - 16 * u, x0 = x1 - len, y = h - 26 * u;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 5 * u;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x0, y - 5 * u);
    ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.lineTo(x1, y - 5 * u);
    ctx.stroke();
    ctx.strokeStyle = THEME.text;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.fillStyle = THEME.text;
    ctx.font = `700 ${12 * u}px ${THEME.font}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(m >= 1000 ? `${m / 1000} KM` : `${m} M`, x1, y - 6 * u);
  }

  private drawMinimap(ctx: Ctx, w: number, u: number, car: Vec2): void {
    const size = 130 * u, m = 16 * u;
    const x = w - m - size, y = m;
    ctx.fillStyle = 'rgba(11,13,16,0.8)';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    const b = this.bounds;
    const k = (size - 20 * u) / Math.max(b.w, b.h, 1);
    const ox = x + (size - b.w * k) / 2, oy = y + (size - b.h * k) / 2;
    const map = (p: Vec2) => ({ x: ox + (p.x - b.x) * k, y: oy + (p.y - b.y) * k });
    ctx.strokeStyle = 'rgba(232,236,241,0.7)';
    ctx.lineWidth = 2 * u;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.race.path.forEach((p, i) => {
      const q = map(p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    if (this.race.closed) ctx.closePath();
    ctx.stroke();
    if (!this.race.closed) {
      const f = map(this.race.path[this.race.path.length - 1]);
      const q = 3 * u;
      ctx.fillStyle = '#fff';
      ctx.fillRect(f.x - q, f.y - q, 2 * q, 2 * q);
      ctx.fillStyle = '#000';
      ctx.fillRect(f.x - q, f.y - q, q, q);
      ctx.fillRect(f.x, f.y, q, q);
    }
    const c = map(car);
    ctx.fillStyle = THEME.accent;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
