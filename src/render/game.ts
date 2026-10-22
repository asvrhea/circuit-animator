import { forwardSpeed } from '../game/car';
import { gapBetween, lightsLit, type Game, type Racer } from '../game/race';
import { buildPaceNotes, noteLabel, upcomingNotes, type PaceNote } from '../game/pacenotes';
import { HALF_WIDTH } from '../game/track';
import { tilesFor, zoomForScale } from '../geom/tiles';
import { normalize, sub, type Vec2 } from '../geom/vec2';
import { formatLapTime, type Race, type RaceState } from '../sim/race';
import { AnimRenderer, type ThemeMode } from './anim';
import { Camera } from './camera';
import { drawOpenWheelCar, SPRITE_LENGTH } from './carSprite';
import { drawHud } from './hud';
import { THEME } from './theme';
import { OSM_ATTRIBUTION, type TileLayer } from './tiles';

type Ctx = CanvasRenderingContext2D;

export type Orientation = 'heading' | 'north';

export interface GameView {
  orientation: Orientation;
  theme: ThemeMode;
  image: CanvasImageSource | null;
  tiles: TileLayer | null;
  imageW: number;
  imageH: number;
  name: string;
  lengthKm: number;
  /** leave the bottom-left free for touch buttons */
  touch: boolean;
  /** pace-note callout */
  notes: boolean;
}

const font = (weight: number, px: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${px}px ${THEME.font}`;
const PANEL = 'rgba(11,13,16,0.86)';

/**
 * Draws a game frame: the track at true scale (so the 12 m road is what the
 * physics uses), every car, and the HUD. The existing animation renderer
 * supplies the backdrop pieces (grid, start bar) and the broadcast HUD.
 */
export class GameRenderer {
  readonly cam = new Camera();
  private readonly anim: AnimRenderer;
  private readonly units: Vec2[];
  private heading = 0;
  private tileZ = -1;
  private tileRef = 0;
  readonly notes: PaceNote[];
  private spanM = 120;

  constructor(
    private readonly game: Game,
    public view: GameView,
  ) {
    const t = game.track;
    this.units = t.path.map((p) => ({ x: p.x / t.mpu, y: p.y / t.mpu }));
    this.notes = buildPaceNotes(t);
    // the anim renderer only lends its backdrop helpers, so a path-shaped stub is enough
    const stub = { path: this.units, closed: t.closed, mpu: t.mpu, gravel: t.gravel, sectors: t.sectors } as unknown as Race;
    this.anim = new AnimRenderer(stub, {
      camera: 'follow', theme: view.theme, image: view.image, tiles: view.tiles, imageW: view.imageW, imageH: view.imageH,
      info: { name: view.name, lengthKm: view.lengthKm },
    });
  }

  render(ctx: Ctx, w: number, h: number, dpr: number, dt: number, snap = false): void {
    const g = this.game, t = g.track, p = g.player;
    const u = Math.max(0.6, Math.min(w, h) / 720);
    const mpu = t.mpu;
    const speed = Math.hypot(p.car.vx, p.car.vy);

    // ---- camera: true scale, a little wider at speed
    this.spanM += ((75 + speed * 0.75) - this.spanM) * (snap || dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.6));
    const pxPerM = Math.min(w, h * 1.1) / this.spanM;
    const headUp = this.view.orientation === 'heading';
    let dh = p.car.heading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading = snap ? p.car.heading : this.heading + dh * (dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.035));
    this.cam.ax = w / 2;
    this.cam.ay = headUp ? h * 0.62 : h / 2;
    const target = { cx: p.car.x / mpu, cy: p.car.y / mpu, scale: pxPerM * mpu, rot: headUp ? -Math.PI / 2 - this.heading : 0 };
    if (snap || dt <= 0) this.cam.set(target);
    else this.cam.smoothTo(target, dt, 0, 0.3, 0.02);
    const ppm = this.cam.scale / mpu;

    // ---- backdrop
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    const useTiles = this.view.theme === 'screenshot' && !!this.view.tiles;
    const useImage = this.view.theme === 'screenshot' && (!!this.view.image || useTiles);
    this.cam.apply(ctx, dpr);
    if (useTiles) {
      // one locked zoom for the whole race; no canvas filter (it re-runs on every tile every frame)
      this.view.tiles!.draw(ctx, this.cam.visibleRect(w, h), this.cam.scale, dpr, this.lockTileZoom(w, h, dpr));
    } else if (useImage) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.view.image!, 0, 0, this.view.imageW, this.view.imageH);
    } else {
      this.anim.cam.set(this.cam);
      this.anim.drawGrid(ctx);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (useImage) {
      ctx.fillStyle = 'rgba(11,13,16,0.45)';
      ctx.fillRect(0, 0, w, h);
    }

    this.drawRoad(ctx, ppm);
    for (const r of g.order.slice().reverse()) if (!r.isPlayer) this.drawCar(ctx, r, ppm, u);
    this.drawCar(ctx, p, ppm, u);
    this.drawHud(ctx, w, h, u);
    this.drawMinimap(ctx, w, u);
    if (useTiles) {
      ctx.font = font(600, 10 * u);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(232,236,241,0.75)';
      ctx.fillText(OSM_ATTRIBUTION, w - 6 * u, h - 3 * u);
    }
    ctx.restore();
  }

  /**
   * One tile zoom for the whole race, matched to a typical camera span. Only
   * a big resize re-picks it, and then the tiles around the whole track are
   * requested up front so nothing is fetched or decoded mid-corner.
   */
  private lockTileZoom(w: number, h: number, dpr: number): number {
    const mpu = this.game.track.mpu;
    const nominal = (Math.min(w, h * 1.1) / 90) * mpu; // css px per unit at a 90 m span
    if (this.tileZ >= 0 && nominal / this.tileRef > 0.6 && nominal / this.tileRef < 1.7) return this.tileZ;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of this.units) [x0, y0, x1, y1] = [Math.min(x0, q.x), Math.min(y0, q.y), Math.max(x1, q.x), Math.max(y1, q.y)];
    const pad = 150 / mpu;
    const rect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    let z = zoomForScale(nominal, dpr);
    while (z > 13 && tilesFor(rect, z, Infinity).length > 150) z--; // stay polite to the tile server
    const count = this.view.tiles!.prefetch(rect, z);
    this.view.tiles!.reserve(count * 1.3 + 60);
    this.tileZ = z;
    this.tileRef = nominal;
    return z;
  }

  // ------------------------------------------------------------ road

  private drawRoad(ctx: Ctx, ppm: number): void {
    const g = this.game, t = g.track;
    const pts = this.units.map((q) => this.cam.toScreen(q));
    const n = pts.length;
    const W = 2 * HALF_WIDTH * ppm;
    const stroke = (from: number, to: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[from % n].x, pts[from % n].y);
      for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i % n].x, pts[i % n].y);
      ctx.stroke();
    };
    const end = t.closed ? n : n - 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    // run-off area, kerbs, asphalt
    ctx.strokeStyle = 'rgba(32,52,38,0.55)';
    ctx.lineWidth = W * 2.6;
    stroke(0, end);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = W + Math.max(3, W * 0.12);
    stroke(0, end);
    ctx.strokeStyle = '#2a3039';
    ctx.lineWidth = W;
    stroke(0, end);
    for (const [f0, f1] of t.gravel) {
      const a = Math.round(f0 * end), b = Math.round(f1 * end);
      if (b <= a) continue;
      ctx.strokeStyle = THEME.gravel;
      ctx.lineWidth = W;
      stroke(a, b);
    }
    // edge lines + dashed centre
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, W * 0.025);
    ctx.setLineDash([W * 0.35, W * 0.55]);
    stroke(0, end);
    ctx.setLineDash([]);

    const tan0 = normalize(sub(pts[Math.min(2, n - 1)], pts[0]));
    if (t.closed) this.anim.drawBar(ctx, pts[0], normalize(sub(pts[2 % n], pts[n - 2])), W, true);
    else {
      const tan1 = normalize(sub(pts[n - 1], pts[Math.max(0, n - 3)]));
      this.anim.drawBar(ctx, pts[0], tan0, W, false);
      this.anim.drawBar(ctx, pts[n - 1], tan1, W, true);
      this.anim.drawLabel(ctx, 'START', pts[0], tan0, W);
      this.anim.drawLabel(ctx, 'FINISH', pts[n - 1], tan1, W);
    }
  }

  // ------------------------------------------------------------ cars

  private drawCar(ctx: Ctx, r: Racer, ppm: number, u: number): void {
    const mpu = this.game.track.mpu;
    const s = this.cam.toScreen({ x: r.car.x / mpu, y: r.car.y / mpu });
    // real size, but never smaller than a readable minimum
    const px = Math.max(ppm, (15 * u) / SPRITE_LENGTH);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(r.car.heading + this.cam.rot);
    drawOpenWheelCar(ctx, px, r.driver.color, r.isPlayer);
    ctx.restore();
    if (!r.isPlayer) {
      ctx.font = font(700, 11 * u);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const y = s.y - Math.max(1.4 * px * 2, 12 * u);
      ctx.strokeText(r.driver.code, s.x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(r.driver.code, s.x, y);
    }
  }

  // ------------------------------------------------------------ HUD

  private drawHud(ctx: Ctx, w: number, h: number, u: number): void {
    const g = this.game, p = g.player, t = g.track;
    const L = t.length;
    const closed = t.closed;
    const lapT = p.lapStartT === null ? 0 : Math.max(0, (p.finished ? p.finishTime! : g.raceTime) - p.lapStartT);
    const lapNo = Math.min(g.laps, p.lapsDone + 1);
    const cum = p.sectorCum;
    const f = (((p.dist % L) + L) % L) / L;
    const sector = p.finished ? 2 : f < t.sectors[0] ? 0 : f < t.sectors[1] ? 1 : 2;
    const splits: number[] = [];
    if (cum[0] !== undefined) splits.push(cum[0]);
    if (cum[1] !== undefined) splits.push(cum[1] - cum[0]);
    if (cum[2] !== undefined) splits.push(cum[2] - cum[1]);
    const lapTimes = p.lapTimes;
    const stateLike: RaceState = {
      phase: 'race', introP: 1, lap: lapNo, lapTime: p.finished && !closed ? p.finishTime! : lapT,
      dist: p.dist, speed: Math.hypot(p.car.vx, p.car.vy), accel: this.accel, index: 0, frac: 0, sector,
      sectorSplits: splits, lapTimes: closed ? lapTimes : [], finished: p.finished, surface: p.gravel ? 'gravel' : 'tarmac',
    };
    const raceLike = { closed, laps: g.laps, gravel: t.gravel, topSpeed: g.setup.car.vMax, sectors: t.sectors } as unknown as Race;
    drawHud(ctx, w, h - (this.view.touch ? 118 : 0), u, raceLike, stateLike, { name: this.view.name, lengthKm: this.view.lengthKm });

    if (this.view.notes && g.raceTime >= 0 && !p.finished) this.drawNotes(ctx, w, u);

    // position badge + standings
    if (closed) this.drawStandings(ctx, w, u);

    // status messages
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (g.phase === 'grid' || (g.raceTime >= 0 && g.raceTime < 1)) this.drawLights(ctx, w, h, u);
    const heading = p.car.heading;
    const wrong = !p.finished && g.raceTime > 1 && Math.hypot(p.car.vx, p.car.vy) > 3 &&
      Math.cos(heading - Math.atan2(t.ty[Math.max(0, p.hint)], t.tx[Math.max(0, p.hint)])) < -0.3 &&
      forwardSpeed(p.car) > 0;
    const msg = wrong ? 'WRONG WAY' : p.offTrack && g.raceTime > 0 && !p.finished ? 'OFF TRACK' : '';
    if (msg) {
      ctx.font = font(800, 28 * u, true);
      ctx.lineWidth = 5 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(msg, w / 2, h * 0.2);
      ctx.fillStyle = THEME.accent;
      ctx.fillText(msg, w / 2, h * 0.2);
    }
  }

  private drawNotes(ctx: Ctx, w: number, u: number): void {
    const g = this.game;
    const ahead = upcomingNotes(g.track, this.notes, g.player.prevS, 450, 2);
    if (!ahead.length) return;
    const bw = Math.min(w - 32 * u, 230 * u), bh = 54 * u;
    const x = (w - bw) / 2, y = 56 * u;
    const first = ahead[0];
    const n = first.note;
    const urgent = first.dist < 120;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = urgent ? THEME.accent : THEME.sectors[1];
    ctx.fillRect(x, y, 5 * u, bh);
    // arrow: up the road, then bending away by how tight the corner is
    const cx = x + 30 * u, cy = y + bh / 2 + 6 * u;
    const dirv = n.dir === 'left' ? -1 : 1;
    const ang = ([150, 115, 90, 62, 40, 22][n.severity - 1] * Math.PI) / 180;
    const fx = dirv * Math.sin(ang), fy = -Math.cos(ang);
    const kx = cx, ky = cy - 8 * u; // the knee
    const ex = kx + fx * 17 * u, ey = ky + fy * 17 * u;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5 * u;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy + 14 * u);
    ctx.lineTo(kx, ky);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const a = Math.atan2(fy, fx) + Math.PI + side * 0.55;
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a) * 9 * u, ey + Math.sin(a) * 9 * u);
    }
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = font(800, 26 * u, true);
    ctx.fillText(noteLabel(n), x + 64 * u, y + 20 * u);
    ctx.fillStyle = urgent ? THEME.accent : THEME.text;
    ctx.font = font(700, 20 * u);
    ctx.fillText(`${Math.max(0, Math.round(first.dist / 10) * 10)} m`, x + 64 * u, y + 42 * u);
    if (ahead[1]) {
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.muted;
      ctx.font = font(600, 13 * u);
      ctx.fillText(`then ${noteLabel(ahead[1].note)}`, x + bw - 8 * u, y + 20 * u);
      ctx.fillText(`${Math.round(ahead[1].dist / 10) * 10} m`, x + bw - 8 * u, y + 42 * u);
    }
  }

  /** Throttle (+) / brake (−) level for the HUD chips; the UI sets it. */
  accel = 0;

  private drawLights(ctx: Ctx, w: number, h: number, u: number): void {
    const g = this.game;
    const lit = lightsLit(g);
    const r = 17 * u, gap = 12 * u;
    const bw = 5 * (2 * r) + 4 * gap + 24 * u;
    const x0 = (w - bw) / 2, y = h * 0.14;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x0, y - r - 12 * u, bw, 2 * r + 24 * u);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(x0 + 12 * u + r + i * (2 * r + gap), y, r, 0, Math.PI * 2);
      ctx.fillStyle = i < lit ? '#ff2a3c' : '#2a1417';
      if (i < lit) {
        ctx.shadowColor = '#ff2a3c';
        ctx.shadowBlur = 14 * u;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (g.raceTime >= 0) {
      ctx.font = font(800, 40 * u, true);
      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText('GO!', w / 2, y + 64 * u);
      ctx.fillStyle = '#2bd67b';
      ctx.fillText('GO!', w / 2, y + 64 * u);
    }
  }

  private drawStandings(ctx: Ctx, w: number, u: number): void {
    const g = this.game, L = g.track.length;
    const rows = g.order.slice(0, 10);
    const rowH = 21 * u, tw = 148 * u, m = 16 * u;
    const x = w - m - tw;
    const y0 = m + 112 * u + 8 * u;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y0, tw, rowH * rows.length + 4 * u);
    ctx.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const y = y0 + 2 * u + i * rowH + rowH / 2;
      if (r.isPlayer) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, y - rowH / 2 + 1, tw, rowH - 1);
      }
      ctx.fillStyle = r.driver.color;
      ctx.fillRect(x + 22 * u, y - 7 * u, 4 * u, 14 * u);
      ctx.textAlign = 'left';
      ctx.font = font(700, 13 * u);
      ctx.fillStyle = THEME.muted;
      ctx.fillText(String(i + 1), x + 7 * u, y);
      ctx.fillStyle = r.isPlayer ? '#fff' : THEME.text;
      ctx.fillText(r.driver.code, x + 32 * u, y);
      ctx.textAlign = 'right';
      ctx.font = font(600, 12 * u);
      ctx.fillStyle = THEME.muted;
      let label = '';
      if (i === 0) label = r.finished ? 'FIN' : `L${Math.min(g.laps, r.lapsDone + 1)}`;
      else {
        const gap = gapBetween(r, g.order[i - 1], L);
        label = gap.laps >= 1 ? `+${gap.laps}L` : gap.seconds === null ? '' : `+${gap.seconds.toFixed(1)}`;
      }
      ctx.fillText(label, x + tw - 7 * u, y);
    });
    // my position, large
    const pos = g.order.indexOf(g.player) + 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(800, 30 * u, true);
    ctx.lineWidth = 5 * u;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const txt = `P${pos}`;
    ctx.strokeText(txt, x, y0 + rowH * rows.length + 34 * u);
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, x, y0 + rowH * rows.length + 34 * u);
    ctx.font = font(600, 14 * u);
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`/ ${g.racers.length}`, x + 46 * u, y0 + rowH * rows.length + 34 * u);
    // best lap
    const best = g.player.bestLap;
    if (best !== null) ctx.fillText(`BEST ${formatLapTime(best)}`, x, y0 + rowH * rows.length + 54 * u);
  }

  private drawMinimap(ctx: Ctx, w: number, u: number): void {
    const g = this.game, t = g.track;
    const size = 104 * u, m = 16 * u;
    const x = w - m - size, y = m;
    ctx.fillStyle = 'rgba(11,13,16,0.8)';
    ctx.fillRect(x, y, size, size);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of t.path) [x0, y0, x1, y1] = [Math.min(x0, q.x), Math.min(y0, q.y), Math.max(x1, q.x), Math.max(y1, q.y)];
    const k = (size - 16 * u) / Math.max(x1 - x0, y1 - y0, 1);
    const ox = x + (size - (x1 - x0) * k) / 2, oy = y + (size - (y1 - y0) * k) / 2;
    const map = (px: number, py: number) => ({ x: ox + (px - x0) * k, y: oy + (py - y0) * k });
    ctx.strokeStyle = 'rgba(232,236,241,0.7)';
    ctx.lineWidth = 2 * u;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    t.path.forEach((q, i) => {
      const a = map(q.x, q.y);
      if (i) ctx.lineTo(a.x, a.y);
      else ctx.moveTo(a.x, a.y);
    });
    if (t.closed) ctx.closePath();
    ctx.stroke();
    for (const r of g.racers.slice().reverse()) {
      const a = map(r.car.x, r.car.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, (r.isPlayer ? 4 : 3) * u, 0, Math.PI * 2);
      ctx.fillStyle = r.driver.color;
      ctx.fill();
      if (r.isPlayer) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}
