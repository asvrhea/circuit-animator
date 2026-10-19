import { pathFromControls } from '../geom/track';
import type { TrackDoc } from '../io/trackFile';
import { AnimRenderer, type CameraMode, type ThemeMode } from '../render/anim';
import { buildRace, formatLapTime, type Race } from '../sim/race';
import type { TileLayer } from '../render/tiles';
import { CAR_PRESETS, type CarPreset } from '../sim/speed';
import { serializeDoc } from '../io/trackFile';
import { estimateSizeMB, exportFileName, exportSuffix, frameSize, letterbox, videoBitrate, type Aspect, type Fps, type Resolution } from '../io/video';
import { ExportCancelled, renderPng, supportedFormat, VideoExport } from './exporter';
import { download, store } from './files';

export interface AnimSource {
  doc: TrackDoc;
  image: HTMLCanvasElement | null;
  /** basemap for tracks in map coordinates */
  tiles: TileLayer | null;
}

export interface AnimSettings {
  camera: CameraMode;
  theme: ThemeMode;
  car: CarPreset;
  laps: number;
  speed: number;
  res: Resolution;
  fps: Fps;
  aspect: Aspect;
}

const KEY = 'circuit-animator:anim';
const SIM_SAMPLES = 1000;
const DEFAULTS: AnimSettings = { camera: 'full', theme: 'broadcast', car: 'formula', laps: 3, speed: 1, res: 1080, fps: 30, aspect: '16:9' };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Playback controller for the Animate tab. Owns the canvas while active. */
export class Animator {
  private renderer: AnimRenderer | null = null;
  private time = 0;
  private playing = false;
  private raf = 0;
  private lastNow = 0;
  private active = false;
  private scrubbing = false;
  readonly settings: AnimSettings = { ...DEFAULTS };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly source: () => AnimSource | null,
  ) {
    try {
      Object.assign(this.settings, JSON.parse(store.get(KEY) ?? '{}'));
    } catch {
      /* keep defaults */
    }
    if (!(this.settings.car in CAR_PRESETS)) this.settings.car = DEFAULTS.car;
    if (this.settings.res !== 720 && this.settings.res !== 1080) this.settings.res = DEFAULTS.res;
    if (this.settings.aspect !== '16:9' && this.settings.aspect !== '9:16') this.settings.aspect = DEFAULTS.aspect;
    if (this.settings.fps !== 30 && this.settings.fps !== 60) this.settings.fps = DEFAULTS.fps;
    this.bindUi();
    this.bindExport();
    // repaint once the HUD font arrives
    document.fonts?.ready.then(() => this.redraw()).catch(() => undefined);
  }

  // ------------------------------------------------------------ export

  private job: VideoExport | null = null;

  get exporting(): boolean {
    return !!this.job;
  }

  private bindExport(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-aspect]').forEach((b) =>
      b.addEventListener('click', () => this.change({ aspect: b.dataset.aspect as Aspect }, false)),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-res]').forEach((b) =>
      b.addEventListener('click', () => this.change({ res: Number(b.dataset.res) as Resolution }, false)),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((b) =>
      b.addEventListener('click', () => this.change({ fps: Number(b.dataset.fps) as Fps }, false)),
    );
    $('btn-record').addEventListener('click', () => void this.record());
    $('export-cancel').addEventListener('click', () => this.job?.cancel());
    $('btn-png').addEventListener('click', () => void this.png());
    $('btn-json').addEventListener('click', () => {
      const doc = this.source()?.doc;
      if (doc) download(exportFileName(doc.name, 'track', 'json'), serializeDoc(doc));
    });
  }

  private async record(): Promise<void> {
    const r = this.renderer;
    if (!r || this.job) return;
    this.pause();
    const { res, fps, speed, aspect } = this.settings;
    let job: VideoExport;
    try {
      job = new VideoExport(
        { race: r.race, opts: { ...r.opts }, res, aspect, fps, speed },
        (p) => {
          $<HTMLElement>('export-bar').style.width = `${(p.done * 100).toFixed(1)}%`;
          $('export-status').textContent =
            p.waiting === 'hidden' ? 'Paused: tab hidden' : p.waiting === 'tiles' ? 'Loading map tiles…' :
            `${Math.round(p.done * 100)}% · ${clock(p.done * r.race.total)} / ${clock(r.race.total)}`;
        },
        (frame) => this.preview(frame),
      );
    } catch (e) {
      return alert(e instanceof Error ? e.message : String(e));
    }
    this.job = job;
    this.setExportUi(true);
    try {
      const blob = await job.run();
      const name = this.source()?.doc.name ?? 'circuit';
      download(exportFileName(name, exportSuffix(res, fps, aspect), job.format.ext), blob, blob.type);
    } catch (e) {
      if (!(e instanceof ExportCancelled)) alert(`Recording failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.job = null;
      this.setExportUi(false);
      this.redraw(true);
    }
  }

  private async png(): Promise<void> {
    const r = this.renderer;
    const doc = this.source()?.doc;
    if (!r || !doc) return;
    const blob = await renderPng({ race: r.race, opts: { ...r.opts }, res: this.settings.res, aspect: this.settings.aspect }, this.time);
    const t = Math.round(this.time * 10) / 10;
    download(exportFileName(doc.name, `${this.settings.res}p${this.settings.aspect === '9:16' ? '-vertical' : ''}-${t}s`, 'png'), blob, 'image/png');
  }

  /** Show the frame being recorded, letterboxed in the live canvas. */
  private preview(frame: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr, h = this.canvas.height / dpr;
    const b = letterbox(frame.width, frame.height, w, h);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.drawImage(frame, b.x, b.y, b.w, b.h);
  }

  private setExportUi(on: boolean): void {
    $('export-overlay').hidden = !on;
    $('transport').classList.toggle('off', on);
    for (const id of ['btn-record', 'btn-png', 'tab-edit']) $<HTMLButtonElement>(id).disabled = on;
    document.querySelectorAll<HTMLButtonElement>('#sec-anim button, #sec-anim select, #sec-anim input, #sec-export .seg button')
      .forEach((el) => ((el as HTMLButtonElement).disabled = on));
    if (!on) this.updateUi();
  }

  get race(): Race | null {
    return this.renderer?.race ?? null;
  }

  enter(): void {
    this.active = true;
    this.build();
    this.time = Math.min(this.time, this.race?.total ?? 0);
    this.redraw(true);
  }

  exit(): void {
    this.pause();
    this.active = false;
  }

  /** Rebuild the race from the current track + settings. */
  build(): void {
    const src = this.source();
    if (!src) return;
    const { doc, image, tiles } = src;
    const race = buildRace({
      path: pathFromControls(doc.controls, SIM_SAMPLES),
      lengthKm: doc.lengthKm,
      car: CAR_PRESETS[this.settings.car].car,
      laps: this.settings.laps,
      sectors: doc.sectors,
    });
    const theme: ThemeMode = image || tiles ? this.settings.theme : 'broadcast';
    this.renderer = new AnimRenderer(race, {
      camera: this.settings.camera,
      theme,
      image,
      tiles,
      imageW: image?.width ?? doc.width,
      imageH: image?.height ?? doc.height,
      info: { name: doc.name, lengthKm: doc.lengthKm },
    });
    this.time = Math.min(this.time, race.total);
    this.updateUi();
  }

  redraw(snap = false): void {
    if (!this.active || !this.renderer || this.job) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.width / dpr, cssH = this.canvas.height / dpr;
    const { w: fw, h: fh } = frameSize(this.settings.res, this.settings.aspect);
    const box = letterbox(fw, fh, cssW, cssH);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, cssW, cssH);
    this.renderer.render(this.ctx, box.w, box.h, dpr, this.time, snap, { ox: box.x, oy: box.y, uiScale: Math.min(box.w, box.h) / 720 });
    this.updateTransport();
  }

  /** A map tile arrived: repaint the still frame (the play loop repaints anyway). */
  redrawIfPaused(): void {
    if (!this.playing) this.redraw();
  }

  play(): void {
    if (!this.renderer || this.playing || this.job) return;
    if (this.time >= this.renderer.race.total - 1e-3) this.seek(0);
    this.playing = true;
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
    this.updateTransport();
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.updateTransport();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    if (!this.renderer) return;
    this.time = Math.max(0, Math.min(this.renderer.race.total, t));
    this.redraw(true);
  }

  private tick(now: number): void {
    if (!this.playing || !this.renderer) return;
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.time += dt * this.settings.speed;
    if (this.time >= this.renderer.race.total) {
      this.time = this.renderer.race.total;
      this.redraw();
      return this.pause();
    }
    this.redraw();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.job) return false;
    if (e.key === ' ') {
      this.toggle();
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      this.seek(this.time + (e.key === 'ArrowRight' ? 5 : -5));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ UI

  private save(): void {
    store.set(KEY, JSON.stringify(this.settings));
  }

  private change(p: Partial<AnimSettings>, rebuild: boolean): void {
    Object.assign(this.settings, p);
    this.save();
    if (rebuild) this.build();
    else if (this.renderer) {
      this.renderer.opts.camera = this.settings.camera;
      if (this.renderer.opts.image || this.renderer.opts.tiles) this.renderer.opts.theme = this.settings.theme;
    }
    this.updateUi();
    this.redraw(!this.playing);
  }

  private bindUi(): void {
    $('tp-play').addEventListener('click', () => this.toggle());
    const scrub = $<HTMLInputElement>('tp-scrub');
    scrub.addEventListener('input', () => {
      this.scrubbing = true;
      if (this.renderer) this.seek((Number(scrub.value) / 1000) * this.renderer.race.total);
    });
    scrub.addEventListener('change', () => (this.scrubbing = false));

    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', () => this.change({ camera: b.dataset.cam as CameraMode }, false)),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) =>
      b.addEventListener('click', () => this.change({ theme: b.dataset.theme as ThemeMode }, false)),
    );

    const car = $<HTMLSelectElement>('car');
    car.innerHTML = Object.entries(CAR_PRESETS)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');
    car.addEventListener('change', () => this.change({ car: car.value as CarPreset }, true));

    const laps = $<HTMLInputElement>('laps');
    laps.addEventListener('change', () => {
      const n = Math.max(1, Math.min(10, Math.round(Number(laps.value) || 1)));
      laps.value = String(n);
      this.change({ laps: n }, true);
    });
    const speed = $<HTMLSelectElement>('pb-speed');
    speed.addEventListener('change', () => this.change({ speed: Number(speed.value) }, false));
  }

  updateUi(): void {
    const s = this.settings;
    const src = this.source();
    const hasImage = !!(src?.image || src?.tiles);
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === s.camera));
    document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === (hasImage ? s.theme : 'broadcast'));
      if (b.dataset.theme === 'screenshot') b.disabled = !hasImage;
    });
    $<HTMLSelectElement>('car').value = s.car;
    $<HTMLInputElement>('laps').value = String(s.laps);
    $<HTMLSelectElement>('pb-speed').value = String(s.speed);
    document.querySelectorAll<HTMLButtonElement>('[data-aspect]').forEach((b) => b.classList.toggle('active', b.dataset.aspect === s.aspect));
    document.querySelectorAll<HTMLButtonElement>('[data-res]').forEach((b) => b.classList.toggle('active', Number(b.dataset.res) === s.res));
    document.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((b) => b.classList.toggle('active', Number(b.dataset.fps) === s.fps));
    const fmt = supportedFormat();
    const fs = frameSize(s.res, s.aspect);
    const rt = this.race;
    $('export-info').textContent = !fmt
      ? 'This browser cannot record video. Try Chrome or Edge.'
      : rt
        ? `${fs.w}×${fs.h} · ${fmt.ext.toUpperCase()} · ${clock(rt.total / s.speed)} at ${s.speed}× · ~${Math.max(1, Math.round(estimateSizeMB(rt.total / s.speed, videoBitrate(s.res, s.fps))))} MB · records in real time`
        : '';
    $<HTMLButtonElement>('btn-record').disabled = !fmt || !!this.job;

    const r = this.race;
    $('lap-stats').innerHTML = r
      ? `<span>Flying lap <b>${formatLapTime(r.flying.lapTime)}</b></span>` +
        `<span>Standing start <b>${formatLapTime(r.first.lapTime)}</b></span>` +
        `<span>Top <b>${Math.round(r.topSpeed * 3.6)}</b> km/h</span>` +
        `<span>Slowest corner <b>${Math.round(r.minSpeed * 3.6)}</b> km/h</span>` +
        `<span>Video <b>${clock(r.total / s.speed)}</b> at ${s.speed}×</span>`
      : '';
  }

  private updateTransport(): void {
    const total = this.race?.total ?? 0;
    $('tp-play').textContent = this.playing ? '❚❚' : '▶';
    $('tp-play').setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    if (!this.scrubbing) $<HTMLInputElement>('tp-scrub').value = String(total ? Math.round((this.time / total) * 1000) : 0);
    $('tp-time').textContent = `${clock(this.time)} / ${clock(total)}`;
  }
}
