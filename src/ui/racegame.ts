import { NO_CONTROLS, type Controls } from '../game/car';
import {
  createGame, finalizeResults, MAX_OPPONENTS, MIN_OPPONENTS, stepGame, type Difficulty, type Game, type Results,
} from '../game/race';
import { buildGameTrack } from '../game/track';
import { pathFromControls } from '../geom/track';
import { disciplineOf, isOpen } from '../io/trackFile';
import { GameRenderer, type Orientation } from '../render/game';
import type { ThemeMode } from '../render/anim';
import { formatLapTime } from '../sim/race';
import { CAR_PRESETS } from '../sim/speed';
import type { AnimSource } from './animator';
import { store } from './files';

export interface RaceSettings {
  orientation: Orientation;
  theme: ThemeMode;
  laps: number;
  rivals: number;
  difficulty: Difficulty;
}

const KEY = 'circuit-animator:race';
const SAMPLES = 1000;
const DEFAULTS: RaceSettings = { orientation: 'heading', theme: 'broadcast', laps: 3, rivals: 7, difficulty: 'normal' };
const RESULTS_DELAY = 3;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type State = 'ready' | 'running' | 'paused' | 'results';

const KEYS: Record<string, 'gas' | 'brake' | 'left' | 'right'> = {
  ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

const isTouchDevice = () =>
  new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Controller for the Race tab: owns the canvas, the loop, keys, touch buttons and the overlays while active. */
export class RaceGame {
  readonly settings: RaceSettings = { ...DEFAULTS };
  private game: Game | null = null;
  private renderer: GameRenderer | null = null;
  private state: State = 'ready';
  private active = false;
  private raf = 0;
  private last = 0;
  private readonly keys = new Set<string>();
  private readonly holds = new Map<string, Set<number>>();
  private readonly touch = isTouchDevice();
  private ctl: Controls = NO_CONTROLS;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly source: () => AnimSource | null,
  ) {
    try {
      Object.assign(this.settings, JSON.parse(store.get(KEY) ?? '{}'));
    } catch {
      /* defaults */
    }
    const s = this.settings;
    if (s.orientation !== 'heading' && s.orientation !== 'north') s.orientation = DEFAULTS.orientation;
    if (s.theme !== 'broadcast' && s.theme !== 'screenshot') s.theme = DEFAULTS.theme;
    if (!['easy', 'normal', 'hard'].includes(s.difficulty)) s.difficulty = DEFAULTS.difficulty;
    s.laps = Math.max(1, Math.min(10, Math.round(Number(s.laps) || DEFAULTS.laps)));
    s.rivals = Math.max(MIN_OPPONENTS, Math.min(MAX_OPPONENTS, Math.round(Number(s.rivals) || DEFAULTS.rivals)));
    this.bindUi();
    this.bindTouch();
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.lostFocus());
    document.addEventListener('visibilitychange', () => document.hidden && this.lostFocus());
    document.fonts?.ready.then(() => this.redraw()).catch(() => undefined);
  }

  // ------------------------------------------------------------ lifecycle

  enter(): void {
    this.active = true;
    this.build();
    this.setState('ready');
    $('touch').hidden = !this.touch;
    this.updateUi();
  }

  exit(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.keys.clear();
    this.holds.forEach((s) => s.clear());
    $('g-overlay').hidden = true;
    $('g-pausebtn').hidden = true;
    $('touch').hidden = true;
  }

  /** Fresh grid from the current track and settings. */
  private build(): void {
    const src = this.source();
    if (!src) return;
    const { doc, image, tiles } = src;
    const stage = isOpen(doc);
    const car = CAR_PRESETS[disciplineOf(doc) === 'formula' ? 'formula' : 'rally'].car;
    const track = buildGameTrack({
      path: pathFromControls(doc.controls, SAMPLES, !stage),
      closed: !stage,
      lengthKm: doc.lengthKm,
      gravel: doc.gravel ?? [],
      sectors: doc.sectors,
      car,
    });
    this.game = createGame({
      track, car, laps: this.settings.laps, opponents: this.settings.rivals, difficulty: this.settings.difficulty,
      seed: (Date.now() & 0xffff) + 1,
    });
    const theme: ThemeMode = image || tiles ? this.settings.theme : 'broadcast';
    this.renderer = new GameRenderer(this.game, {
      orientation: this.settings.orientation, theme, image, tiles,
      imageW: image?.width ?? doc.width, imageH: image?.height ?? doc.height,
      name: doc.name, lengthKm: doc.lengthKm, touch: this.touch,
    });
    this.redraw(true);
  }

  private setState(s: State): void {
    this.state = s;
    cancelAnimationFrame(this.raf);
    const live = s === 'running' || s === 'paused';
    $('g-pausebtn').hidden = !this.active || !live;
    $('g-pausebtn').textContent = s === 'paused' ? '▶' : '❚❚';
    if (s === 'running') {
      (document.activeElement as HTMLElement | null)?.blur?.();
      $('g-overlay').hidden = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    } else if (s === 'ready') this.showReady();
    else if (s === 'paused') this.showPause();
    this.redraw(s !== 'running');
  }

  private tick(now: number): void {
    if (this.state !== 'running' || !this.game || !this.renderer) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.ctl = this.controls();
    stepGame(this.game, this.ctl, dt);
    this.paint(dt);
    const g = this.game;
    if (g.phase === 'finished' && g.playerFinishT !== null && g.raceTime - g.playerFinishT > RESULTS_DELAY) {
      this.state = 'results';
      this.showResults(finalizeResults(g));
      $('g-pausebtn').hidden = true;
      this.paint(0);
      return;
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private paint(dt: number, snap = false): void {
    if (!this.renderer) return;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.accel = this.ctl.throttle * 6 - this.ctl.brake * 15;
    this.renderer.render(this.ctx, this.canvas.width / dpr, this.canvas.height / dpr, dpr, dt, snap);
  }

  redraw(snap = false): void {
    if (!this.active || this.state === 'running') return;
    this.ctl = this.state === 'paused' || this.state === 'results' ? this.ctl : NO_CONTROLS;
    this.paint(0, snap);
  }

  redrawIfPaused(): void {
    this.redraw();
  }

  // ------------------------------------------------------------ input

  private controls(): Controls {
    const on = (k: 'gas' | 'brake' | 'left' | 'right') => this.keys.has(k) || (this.holds.get(k)?.size ?? 0) > 0;
    return {
      throttle: on('gas') ? 1 : 0,
      brake: on('brake') ? 1 : 0,
      steer: (on('right') ? 1 : 0) - (on('left') ? 1 : 0),
    };
  }

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.active || this.typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYS[e.code];
    if (k) {
      this.keys.add(k);
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'running') this.pause();
      else if (this.state === 'paused') this.resume();
      e.preventDefault();
    } else if ((e.code === 'Enter' || e.code === 'Space') && this.state === 'ready') {
      this.begin();
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const k = KEYS[e.code];
    if (k) this.keys.delete(k);
  }

  private lostFocus(): void {
    this.keys.clear();
    this.holds.forEach((s) => s.clear());
    document.querySelectorAll('[data-hold].held').forEach((b) => b.classList.remove('held'));
    if (this.active && this.state === 'running') this.pause();
  }

  private bindTouch(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((b) => {
      const name = b.dataset.hold!;
      this.holds.set(name, new Set());
      const set = this.holds.get(name)!;
      const release = (e: PointerEvent) => {
        set.delete(e.pointerId);
        b.classList.toggle('held', set.size > 0);
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        set.add(e.pointerId);
        b.classList.add('held');
        navigator.vibrate?.(8);
      });
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  // ------------------------------------------------------------ flow

  private begin(): void {
    this.build();
    this.setState('running');
  }

  private pause(): void {
    if (this.state === 'running') this.setState('paused');
  }

  private resume(): void {
    if (this.state === 'paused') this.setState('running');
  }

  // ------------------------------------------------------------ overlays

  private overlay(html: string): void {
    $('g-box').innerHTML = html;
    $('g-overlay').hidden = false;
  }

  private on(id: string, fn: () => void): void {
    $(id).addEventListener('click', fn);
  }

  private showReady(): void {
    const g = this.game;
    if (!g) return;
    const stage = !g.track.closed;
    const km = g.track.length / 1000;
    this.overlay(
      `<h3>${stage ? 'RALLY STAGE' : 'READY TO RACE'}</h3>` +
        `<p>${esc(this.source()?.doc.name ?? '')} · ${km.toFixed(2)} km · ${
          stage ? 'solo time trial, no rivals' : `${g.laps} ${g.laps === 1 ? 'lap' : 'laps'} · ${g.racers.length - 1} rivals · start P${g.racers.length}`
        }</p>` +
        `<p>${this.touch ? 'Hold ◀ ▶ to steer, ▲ for gas, ▼ to brake and reverse.' : 'W / ↑ gas · S / ↓ brake, then reverse · A D / ← → steer · Esc pause.'}</p>` +
        `<div class="row"><button id="g-go" class="primary">${stage ? 'Start stage' : 'Start race'}</button></div>`,
    );
    this.on('g-go', () => this.begin());
  }

  private showPause(): void {
    this.overlay(
      `<h3>PAUSED</h3><div class="row"><button id="g-resume" class="primary">Resume</button></div>` +
        `<div class="row"><button id="g-restart">Restart</button><button id="g-quit">Quit</button></div>`,
    );
    this.on('g-resume', () => this.resume());
    this.on('g-restart', () => this.begin());
    this.on('g-quit', () => {
      this.build();
      this.setState('ready');
    });
  }

  private showResults(res: Results): void {
    const t = (v: number) => (Number.isFinite(v) ? formatLapTime(v) : '—');
    let html: string;
    if (!res.closed) {
      const row = res.rows[0];
      html =
        `<h3>STAGE COMPLETE</h3><p>${esc(this.source()?.doc.name ?? '')}</p>` +
        `<table><tr><th></th><th>SPLIT</th><th>TIME</th></tr>` +
        res.splits.map((s, i) => `<tr><td>${i + 1}</td><td>${i < 2 ? `Split ${i + 1}` : 'Finish'}</td><td>${s.toFixed(3)}</td></tr>`).join('') +
        `<tr class="me"><td></td><td>Total</td><td>${t(row.time)}</td></tr></table>`;
    } else {
      html =
        `<h3>RESULTS</h3><table><tr><th>P</th><th>DRIVER</th><th>TIME</th><th>GAP</th><th>BEST</th></tr>` +
        res.rows
          .map(
            (r) =>
              `<tr${r.isPlayer ? ' class="me"' : ''}><td>${r.pos}</td><td><span class="chip" style="background:${r.color}"></span>${esc(r.isPlayer ? 'You' : r.name)} <small>${r.code}</small></td>` +
              `<td>${t(r.time)}</td><td>${r.pos === 1 ? '' : '+' + r.gap.toFixed(3)}</td>` +
              `<td class="${r.fastest ? 'best' : ''}">${r.bestLap === null ? '—' : t(r.bestLap)}</td></tr>`,
          )
          .join('') +
        `</table>`;
    }
    this.overlay(html + `<div class="row"><button id="g-again" class="primary">Race again</button><button id="g-close">Close</button></div>`);
    this.on('g-again', () => this.begin());
    this.on('g-close', () => {
      this.build();
      this.setState('ready');
    });
  }

  // ------------------------------------------------------------ panel

  private change(p: Partial<RaceSettings>, rebuild: boolean): void {
    Object.assign(this.settings, p);
    store.set(KEY, JSON.stringify(this.settings));
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (rebuild && this.active) {
      this.build();
      this.setState('ready');
    } else if (this.renderer) {
      const src = this.source();
      this.renderer.view.orientation = this.settings.orientation;
      this.renderer.view.theme = src?.image || src?.tiles ? this.settings.theme : 'broadcast';
    }
    this.updateUi();
    this.redraw(false);
  }

  private bindUi(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-orient]').forEach((b) =>
      b.addEventListener('click', () => this.change({ orientation: b.dataset.orient as Orientation }, false)),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-gtheme]').forEach((b) =>
      b.addEventListener('click', () => this.change({ theme: b.dataset.gtheme as ThemeMode }, false)),
    );
    const laps = $<HTMLInputElement>('g-laps');
    laps.addEventListener('change', () => {
      const n = Math.max(1, Math.min(10, Math.round(Number(laps.value) || 1)));
      this.change({ laps: n }, true);
    });
    const rivals = $<HTMLSelectElement>('g-rivals');
    rivals.addEventListener('change', () => this.change({ rivals: Number(rivals.value) }, true));
    const diff = $<HTMLSelectElement>('g-diff');
    diff.addEventListener('change', () => this.change({ difficulty: diff.value as Difficulty }, true));
    $('g-start').addEventListener('click', () => {
      if (this.active) this.begin();
    });
    $('g-pausebtn').addEventListener('click', () => (this.state === 'running' ? this.pause() : this.resume()));
  }

  private updateUi(): void {
    const s = this.settings;
    const src = this.source();
    const hasMap = !!(src?.image || src?.tiles);
    document.querySelectorAll<HTMLButtonElement>('[data-orient]').forEach((b) => b.classList.toggle('active', b.dataset.orient === s.orientation));
    document.querySelectorAll<HTMLButtonElement>('[data-gtheme]').forEach((b) => {
      b.classList.toggle('active', b.dataset.gtheme === (hasMap ? s.theme : 'broadcast'));
      if (b.dataset.gtheme === 'screenshot') b.disabled = !hasMap;
    });
    const stage = !!src && isOpen(src.doc);
    const laps = $<HTMLInputElement>('g-laps'), rivals = $<HTMLSelectElement>('g-rivals');
    laps.value = String(stage ? 1 : s.laps);
    laps.disabled = stage;
    rivals.value = String(s.rivals);
    rivals.disabled = stage;
    $<HTMLSelectElement>('g-diff').value = s.difficulty;
    $<HTMLSelectElement>('g-diff').disabled = stage;
    const car = src ? CAR_PRESETS[disciplineOf(src.doc) === 'formula' ? 'formula' : 'rally'].label : '';
    $('g-info').innerHTML = src
      ? `<span>Car <b>${car}</b></span>` + (stage ? `<span>Solo <b>time trial</b></span>` : `<span>Field <b>${s.rivals + 1}</b> cars</span>`)
      : '';
  }
}
