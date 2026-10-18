import { pathFromControls } from '../geom/track';
import type { TrackDoc } from '../io/trackFile';
import { AnimRenderer, type CameraMode, type ThemeMode } from '../render/anim';
import { buildRace, formatLapTime, type Race } from '../sim/race';
import { CAR_PRESETS, type CarPreset } from '../sim/speed';
import { store } from './files';

export interface AnimSource {
  doc: TrackDoc;
  image: HTMLCanvasElement | null;
}

export interface AnimSettings {
  camera: CameraMode;
  theme: ThemeMode;
  car: CarPreset;
  laps: number;
  speed: number;
}

const KEY = 'circuit-animator:anim';
const SIM_SAMPLES = 1000;
const DEFAULTS: AnimSettings = { camera: 'full', theme: 'broadcast', car: 'formula', laps: 3, speed: 1 };

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
    this.bindUi();
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
    const { doc, image } = src;
    const race = buildRace({
      path: pathFromControls(doc.controls, SIM_SAMPLES),
      lengthKm: doc.lengthKm,
      car: CAR_PRESETS[this.settings.car].car,
      laps: this.settings.laps,
      sectors: doc.sectors,
    });
    const theme: ThemeMode = image ? this.settings.theme : 'broadcast';
    this.renderer = new AnimRenderer(race, {
      camera: this.settings.camera,
      theme,
      image,
      imageW: image?.width ?? doc.width,
      imageH: image?.height ?? doc.height,
      info: { name: doc.name, lengthKm: doc.lengthKm },
    });
    this.time = Math.min(this.time, race.total);
    this.updateUi();
  }

  redraw(snap = false): void {
    if (!this.active || !this.renderer) return;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.render(this.ctx, this.canvas.width / dpr, this.canvas.height / dpr, dpr, this.time, snap);
    this.updateTransport();
  }

  play(): void {
    if (!this.renderer || this.playing) return;
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
      if (this.renderer.opts.image) this.renderer.opts.theme = this.settings.theme;
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
    const hasImage = !!this.source()?.image;
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === s.camera));
    document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === (hasImage ? s.theme : 'broadcast'));
      if (b.dataset.theme === 'screenshot') b.disabled = !hasImage;
    });
    $<HTMLSelectElement>('car').value = s.car;
    $<HTMLInputElement>('laps').value = String(s.laps);
    $<HTMLSelectElement>('pb-speed').value = String(s.speed);

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
