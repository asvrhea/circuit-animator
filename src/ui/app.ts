import {
  distanceToPath, fractionAt, insertControl, moveControl, nearestIndex, removeControl, reverseControls, reverseSectors,
  setSector, setStart, MIN_CONTROLS,
} from '../geom/edit';
import { polylineLength } from '../geom/polyline';
import { groundMetresPerUnit, toUnits, WORLD } from '../geom/tiles';
import { pathFromControls } from '../geom/track';
import { dist, type Vec2 } from '../geom/vec2';
import { geoToTrack, parseGeoFile } from '../io/geo';
import {
  calibrate, DEFAULT_SECTORS, newDoc, parseDoc, serializeDoc, syncLength, withLength, type TrackDoc,
} from '../io/trackFile';
import { drawEditor } from '../render/editor';
import { TileLayer } from '../render/tiles';
import { boundsOf, View } from '../render/view';
import { sampleColor, toleranceFromSlider } from '../vision/color';
import { extractTrack, type Confidence } from '../vision/extract';
import type { RGB } from '../vision/types';
import { Animator } from './animator';
import { download, fileKind, loadImage, store } from './files';

type Mode = 'edit' | 'pick' | 'trace' | 'start' | 'split0' | 'split1' | 'calibrate';

type Gesture =
  | { kind: 'drag'; index: number; start: Vec2; moved: boolean; before: TrackDoc }
  | { kind: 'pan'; start: Vec2; last: Vec2; moved: boolean }
  | { kind: 'pinch'; dist: number; mid: Vec2 };

const KEY_DOC = 'circuit-animator:doc';
const KEY_IMAGE = 'circuit-animator:image';
const KEY_MAPVIEW = 'circuit-animator:mapview';
const KEY_MAPON = 'circuit-animator:map';
const HISTORY_MAX = 60;
const LONG_PRESS_MS = 550;
const TAP_SLOP = 6;

const HINTS: Record<Mode, string> = {
  edit: '',
  pick: 'TAP THE DRAWN LINE TO SAMPLE ITS COLOUR',
  trace: 'TAP ALONG THE TRACK · TAP THE FIRST POINT TO CLOSE',
  start: 'TAP THE TRACK TO SET START / FINISH',
  split0: 'TAP THE TRACK WHERE SECTOR 2 BEGINS',
  split1: 'TAP THE TRACK WHERE SECTOR 3 BEGINS',
  calibrate: 'TAP TWO POINTS A KNOWN DISTANCE APART',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class App {
  private readonly canvas = $<HTMLCanvasElement>('view');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly view = new View();
  private cssW = 1;
  private cssH = 1;
  private drawQueued = false;

  private image: HTMLCanvasElement | null = null;
  private imageData: ImageData | null = null;
  private doc: TrackDoc | null = null;
  private path: Vec2[] = [];
  private history: TrackDoc[] = [];

  private mode: Mode = 'edit';
  private target: RGB | null = null;
  private seed: Vec2 | null = null;
  private confidence: Confidence | null = null;
  private trace: Vec2[] = [];
  /** calibration points (world) */
  private measure: Vec2[] = [];
  private hot = -1;

  private pointers = new Map<number, Vec2>();
  private gesture: Gesture | null = null;
  private longPress: number | undefined;
  private saveTimer: number | undefined;
  private toastTimer: number | undefined;
  /** keep refitting on resize until the user pans or zooms */
  private autoFit: 'track' | 'image' | null = 'image';

  private viewMode: 'edit' | 'animate' = 'edit';
  private readonly animator: Animator;
  /** OSM basemap visible (drawing on the map, or a track in map coordinates) */
  private mapOn = false;
  private mapViewTimer: number | undefined;
  private readonly tiles = new TileLayer(() => {
    if (this.viewMode === 'animate') this.animator.redrawIfPaused();
    else this.requestDraw();
  });

  constructor() {
    this.animator = new Animator(this.canvas, this.ctx, () =>
      this.doc ? { doc: this.doc, image: this.image, tiles: this.doc.crs === 'mercator' ? this.tiles : null } : null,
    );
    $('tab-edit').addEventListener('click', () => this.setView('edit'));
    $('tab-anim').addEventListener('click', () => this.setView('animate'));
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.bindPointer();
    this.bindPanel();
    this.bindFiles();
    window.addEventListener('keydown', (e) => this.onKey(e));
    void this.restore();
  }

  // ------------------------------------------------------------ drawing

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    if (this.autoFit) this.fit(this.autoFit);
    if (this.viewMode === 'animate') this.animator.redraw(true);
    else this.requestDraw();
  }

  private setView(v: 'edit' | 'animate'): void {
    if (v === 'animate' && !this.doc) return;
    this.viewMode = v;
    const anim = v === 'animate';
    $('tab-edit').classList.toggle('active', !anim);
    $('tab-anim').classList.toggle('active', anim);
    for (const id of ['sec-source', 'sec-detect', 'sec-track', 'sec-map', 'sec-trace']) $(id).classList.toggle('off', anim);
    $('attrib').hidden = anim || !this.mapOn;
    $('sec-anim').hidden = !anim;
    $('sec-export').hidden = !anim;
    $('sec-file').classList.toggle('off', anim); // export section has its own JSON button
    $('transport').hidden = !anim;
    document.querySelector<HTMLElement>('.zoom')!.hidden = anim;
    if (anim) {
      this.setMode('edit');
      $('hint').hidden = true;
      this.canvas.style.cursor = 'pointer';
      this.animator.enter();
    } else {
      this.animator.exit();
      this.canvas.style.cursor = 'default';
      this.requestDraw();
    }
  }

  private requestDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  private draw(): void {
    if (this.viewMode === 'animate') return;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const space = this.space();
    drawEditor(this.ctx, this.cssW, this.cssH, this.view, {
      image: this.image,
      basemap: this.mapOn ? (ctx) => this.drawTiles(ctx) : null,
      width: space.w,
      height: space.h,
      path: this.path,
      controls: this.doc?.controls ?? [],
      sectors: this.doc?.sectors ?? DEFAULT_SECTORS,
      showControls: !!this.doc && this.mode !== 'pick' && this.mode !== 'trace' && this.mode !== 'calibrate',
      hot: this.hot,
      trace: this.mode === 'trace' ? this.trace : [],
      measure: this.mode === 'calibrate' ? this.measure : [],
    });
  }

  /** World-space size: the image, else the doc's coordinate box. */
  private space(): { w: number; h: number } {
    if (this.image) return { w: this.image.width, h: this.image.height };
    if (this.doc) return { w: this.doc.width, h: this.doc.height };
    return { w: 1000, h: 1000 };
  }

  private fit(target: 'track' | 'image' = 'track'): void {
    this.autoFit = target;
    if (this.cssW < 2) return;
    if (target === 'track' && this.path.length > 2) {
      this.view.fit(boundsOf(this.path), this.cssW, this.cssH, 0.12);
    } else if (this.mapOn) {
      this.fitMapView();
    } else {
      const s = this.space();
      this.view.fit({ x: 0, y: 0, w: s.w, h: s.h }, this.cssW, this.cssH, 0.03);
    }
    this.requestDraw();
  }

  // ------------------------------------------------------------ state

  private setDoc(doc: TrackDoc | null, record = true): void {
    if (record && this.doc) {
      this.history.push(structuredClone(this.doc));
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    this.path = doc ? pathFromControls(doc.controls) : [];
    this.doc = doc ? syncLength(doc, this.pathUnits()) : null;
    this.hot = -1;
    this.scheduleSave();
    this.updatePanel();
    this.requestDraw();
  }

  private pathUnits(): number {
    return this.path.length > 2 ? polylineLength(this.path, true) : 0;
  }

  private patch(p: Partial<TrackDoc>, record = true): void {
    if (this.doc) this.setDoc({ ...this.doc, ...p }, record);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    if (m !== 'trace') this.trace = [];
    if (m !== 'calibrate') this.measure = [];
    const hint = $('hint');
    hint.textContent = HINTS[m];
    hint.hidden = !HINTS[m];
    this.canvas.style.cursor = m === 'edit' ? 'default' : 'crosshair';
    this.updatePanel();
    this.requestDraw();
  }

  private toast(msg: string, ms = 3200): void {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), ms);
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (this.doc) store.set(KEY_DOC, serializeDoc(this.doc));
      else store.remove(KEY_DOC);
    }, 300);
  }

  private async restore(): Promise<void> {
    const raw = store.get(KEY_DOC);
    if (!raw) {
      // was drawing on the map without a finished track yet
      if (store.get(KEY_MAPON)) {
        this.setMap(true);
        this.fit('image');
      }
      return this.updatePanel();
    }
    try {
      const doc = parseDoc(raw);
      const img = store.get(KEY_IMAGE);
      this.setMap(doc.crs === 'mercator');
      if (doc.crs !== 'mercator' && doc.source !== 'geo' && img) {
        const loaded = await loadImage(img);
        this.image = loaded.canvas;
        this.imageData = loaded.data;
      }
      this.setDoc(doc, false);
      this.fit();
      this.toast('Restored your last track');
    } catch {
      store.remove(KEY_DOC);
      this.updatePanel();
    }
  }

  // ------------------------------------------------------------ loading

  private async loadFile(f: File): Promise<void> {
    try {
      switch (fileKind(f)) {
        case 'image':
          return await this.loadImageFile(f);
        case 'geo':
          return this.loadGeo(f.name, await f.text());
        case 'json':
          return this.loadJson(await f.text());
        default:
          this.toast('Unsupported file. Use PNG/JPG, KML, GPX or a track JSON.');
      }
    } catch (e) {
      this.toast(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  private async loadImageFile(f: File): Promise<void> {
    const { canvas, data } = await loadImage(f);
    this.setMap(false);
    this.image = canvas;
    this.imageData = data;
    this.target = null;
    this.seed = null;
    this.confidence = null;
    this.history = [];
    this.setDoc(null, false);
    if (!store.set(KEY_IMAGE, canvas.toDataURL('image/jpeg', 0.85))) store.remove(KEY_IMAGE);
    this.fit('image');
    this.setMode('pick');
  }

  private loadGeo(name: string, text: string): void {
    const pts = parseGeoFile(name, text);
    if (pts.length < 3) throw new Error('No line found in that file.');
    const t = geoToTrack(pts);
    this.image = null;
    this.imageData = null;
    this.confidence = null;
    this.history = [];
    store.remove(KEY_IMAGE);
    const doc = newDoc('geo', t.width, t.height, t.controls, Math.round(t.lengthKm * 1000) / 1000);
    doc.name = name.replace(/\.(kml|gpx)$/i, '');
    doc.crs = 'mercator';
    doc.mpu = t.mpu;
    this.setMap(true);
    this.setDoc(doc, false);
    this.setMode('edit');
    this.fit();
    this.toast(`Loaded ${t.controls.length} points · ${t.lengthKm.toFixed(2)} km`);
  }

  private loadJson(text: string): void {
    const doc = parseDoc(text);
    this.setMap(doc.crs === 'mercator');
    if (this.image && (doc.crs === 'mercator' || doc.width !== this.image.width || doc.height !== this.image.height)) {
      this.image = null;
      this.imageData = null;
      store.remove(KEY_IMAGE);
    }
    this.confidence = null;
    this.setDoc(doc);
    this.setMode('edit');
    this.fit();
  }

  // ------------------------------------------------------------ detection

  private tolerance(): number {
    return Number($<HTMLInputElement>('tol').value);
  }

  private pickAt(world: Vec2): void {
    if (!this.imageData) return;
    this.seed = world;
    this.target = sampleColor(this.imageData, world.x, world.y);
    this.detect();
  }

  private detect(): void {
    if (!this.imageData || !this.target || !this.seed) return;
    $('hint').textContent = 'DETECTING…';
    // let the hint paint before the synchronous pipeline runs
    setTimeout(() => {
      try {
        const res = extractTrack(this.imageData!, {
          target: this.target!,
          tolerance: toleranceFromSlider(this.tolerance()),
          seed: this.seed!,
        });
        this.confidence = res.confidence;
        const prev = this.doc;
        const doc = newDoc('image', this.imageData!.width, this.imageData!.height, res.controls, prev?.lengthKm ?? 5);
        if (prev) [doc.name, doc.mpu] = [prev.name, prev.mpu]; // same image: keep its scale
        this.setDoc(doc);
        this.setMode('edit');
        this.fit();
      } catch (e) {
        this.confidence = null;
        this.setMode('pick');
        this.toast(e instanceof Error ? e.message : 'Detection failed.');
      }
      this.updatePanel();
    }, 30);
  }

  private finishTrace(): void {
    if (this.trace.length < MIN_CONTROLS) return this.toast(`Place at least ${MIN_CONTROLS} points.`);
    let doc: TrackDoc;
    if (this.mapOn) {
      const b = boundsOf(this.trace);
      doc = newDoc('map', b.w, b.h, this.trace.slice());
      doc.crs = 'mercator';
      doc.mpu = groundMetresPerUnit({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    } else {
      const s = this.space();
      doc = newDoc('manual', s.w, s.h, this.trace.slice(), this.doc?.lengthKm ?? 5);
      doc.mpu = this.doc?.mpu;
    }
    this.confidence = null;
    this.setDoc(doc);
    this.setMode('edit');
  }

  // ------------------------------------------------------------ map

  private setMap(on: boolean): void {
    this.mapOn = on;
    if (on) store.set(KEY_MAPON, '1');
    else store.remove(KEY_MAPON);
    // map units are metres: allow world view down to street level
    this.view.minScale = on ? 2e-6 : 0.05;
    this.view.maxScale = on ? 12 : 40;
    $('attrib').hidden = !on || this.viewMode === 'animate';
  }

  private drawTiles(ctx: CanvasRenderingContext2D): void {
    const dpr = window.devicePixelRatio || 1;
    const v = this.view;
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);
    const a = v.toWorld({ x: 0, y: 0 }), b = v.toWorld({ x: this.cssW, y: this.cssH });
    this.tiles.draw(ctx, { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, v.scale, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.saveMapView();
  }

  private saveMapView(): void {
    clearTimeout(this.mapViewTimer);
    this.mapViewTimer = window.setTimeout(() => {
      const c = this.view.toWorld({ x: this.cssW / 2, y: this.cssH / 2 });
      store.set(KEY_MAPVIEW, JSON.stringify({ x: c.x, y: c.y, scale: this.view.scale }));
    }, 500);
  }

  /** Show the last map position, or the whole world. */
  private fitMapView(): void {
    try {
      const v = JSON.parse(store.get(KEY_MAPVIEW) ?? 'null') as { x: number; y: number; scale: number } | null;
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.scale > 0) {
        this.view.scale = v.scale;
        this.view.ox = this.cssW / 2 - v.x * v.scale;
        this.view.oy = this.cssH / 2 - v.y * v.scale;
        return;
      }
    } catch {
      /* fall through */
    }
    this.view.fit({ x: -WORLD / 2, y: -WORLD / 2, w: WORLD, h: WORLD }, this.cssW, this.cssH, 0);
  }

  private enterMap(): void {
    if (this.doc && this.doc.crs !== 'mercator' && !confirm('Start a new track on the map? The current track will be replaced (Save JSON first to keep it).')) return;
    this.image = null;
    this.imageData = null;
    this.confidence = null;
    this.target = null;
    this.history = [];
    store.remove(KEY_IMAGE);
    this.setMap(true);
    if (this.doc?.crs !== 'mercator') this.setDoc(null, false);
    this.setMode('edit');
    this.autoFit = null;
    if (this.doc) this.fit();
    else this.fitMapView();
    this.requestDraw();
    $<HTMLInputElement>('map-q').focus();
  }

  /** Place search via OSM Nominatim (user-initiated, one request per search). */
  private async searchPlace(q: string): Promise<void> {
    if (!q.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
      });
      const hits = (await res.json()) as { lat: string; lon: string; display_name: string; boundingbox?: string[] }[];
      if (!hits.length) return this.toast('No place found. Try a different name.');
      const h = hits[0];
      const bb = h.boundingbox?.map(Number);
      const [s, n, w, e] = bb && bb.every(Number.isFinite) ? bb : [+h.lat - 0.01, +h.lat + 0.01, +h.lon - 0.01, +h.lon + 0.01];
      const a = toUnits({ lon: w, lat: n }), b = toUnits({ lon: e, lat: s });
      // never zoom closer than ~street level for a point result
      const minSpan = 600;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const sw = Math.max(b.x - a.x, minSpan), sh = Math.max(b.y - a.y, minSpan);
      this.autoFit = null;
      this.view.fit({ x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh }, this.cssW, this.cssH, 0.05);
      this.requestDraw();
      this.toast(h.display_name.split(',').slice(0, 3).join(','));
    } catch {
      this.toast('Search failed. Check your connection.');
    }
  }

  // ------------------------------------------------------------ pointer

  private local(e: PointerEvent | WheelEvent | MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitControl(screen: Vec2, touch: boolean): number {
    if (!this.doc || this.mode === 'pick' || this.mode === 'trace') return -1;
    const pts = this.doc.controls.map((c) => this.view.toScreen(c));
    return nearestIndex(pts, screen, touch ? 20 : 11);
  }

  private nearPath(screen: Vec2, touch: boolean): boolean {
    if (this.path.length < 3) return false;
    return distanceToPath(this.path, this.view.toWorld(screen)).dist * this.view.scale <= (touch ? 18 : 10);
  }

  private bindPointer(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (this.viewMode === 'animate') return this.animator.toggle();
      c.setPointerCapture(e.pointerId);
      const p = this.local(e);
      this.pointers.set(e.pointerId, p);
      this.cancelLongPress();

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        if (this.gesture?.kind === 'drag') this.commitDrag(this.gesture);
        this.gesture = { kind: 'pinch', dist: dist(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
      const hit = this.mode === 'edit' ? this.hitControl(p, e.pointerType === 'touch') : -1;
      if (hit >= 0 && this.doc) {
        this.gesture = { kind: 'drag', index: hit, start: p, moved: false, before: structuredClone(this.doc) };
        this.hot = hit;
        this.longPress = window.setTimeout(() => this.deleteControl(hit), LONG_PRESS_MS);
        this.requestDraw();
      } else {
        this.gesture = { kind: 'pan', start: p, last: p, moved: false };
      }
    });

    c.addEventListener('pointermove', (e) => {
      const p = this.local(e);
      if (!this.pointers.has(e.pointerId)) return this.hover(p, e.pointerType === 'touch');
      this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) return;

      if (g.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = dist(a, b), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.autoFit = null;
        this.view.panBy(mid.x - g.mid.x, mid.y - g.mid.y);
        if (g.dist > 0) this.view.zoomAt(mid, d / g.dist);
        g.dist = d;
        g.mid = mid;
        this.requestDraw();
      } else if (g.kind === 'drag' && this.doc) {
        if (!g.moved && dist(p, g.start) < TAP_SLOP) return;
        g.moved = true;
        this.cancelLongPress();
        this.doc = { ...this.doc, controls: moveControl(this.doc.controls, g.index, this.view.toWorld(p)) };
        this.path = pathFromControls(this.doc.controls);
        this.requestDraw();
      } else if (g.kind === 'pan') {
        if (!g.moved && dist(p, g.start) < TAP_SLOP) return;
        g.moved = true;
        this.autoFit = null;
        this.view.panBy(p.x - g.last.x, p.y - g.last.y);
        g.last = p;
        this.requestDraw();
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      this.cancelLongPress();
      const g = this.gesture;
      if (this.pointers.size > 0) {
        // leaving a pinch: continue as a pan with the remaining finger
        const rest = [...this.pointers.values()][0];
        this.gesture = { kind: 'pan', start: rest, last: rest, moved: true };
        return;
      }
      this.gesture = null;
      if (!g || e.type === 'pointercancel') return;
      if (g.kind === 'drag') this.commitDrag(g);
      else if (g.kind === 'pan' && !g.moved) {
        this.tap(this.local(e), e.pointerType === 'touch');
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.viewMode === 'animate') return;
      const i = this.hitControl(this.local(e), false);
      if (i >= 0) this.deleteControl(i);
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.viewMode === 'animate') return;
        this.autoFit = null;
        this.view.zoomAt(this.local(e), Math.exp(-e.deltaY * 0.0015));
        this.requestDraw();
      },
      { passive: false },
    );
    c.addEventListener('pointerleave', () => {
      if (!this.gesture && this.hot !== -1) {
        this.hot = -1;
        this.requestDraw();
      }
    });
  }

  /** Record a finished drag as one undoable change. */
  private commitDrag(g: Extract<Gesture, { kind: 'drag' }>): void {
    if (g.moved && this.doc) {
      const moved = this.doc;
      this.doc = g.before;
      this.setDoc(moved);
    }
    this.hot = -1;
    this.requestDraw();
  }

  private hover(p: Vec2, touch: boolean): void {
    if (touch || this.viewMode === 'animate') return;
    const i = this.hitControl(p, false);
    if (i !== this.hot) {
      this.hot = i;
      this.requestDraw();
    }
    if (this.mode === 'edit') this.canvas.style.cursor = i >= 0 ? 'grab' : this.nearPath(p, false) ? 'copy' : 'default';
  }

  private tap(screen: Vec2, touch: boolean): void {
    const world = this.view.toWorld(screen);
    switch (this.mode) {
      case 'pick':
        return this.pickAt(world);
      case 'trace': {
        const first = this.trace[0];
        if (this.trace.length >= MIN_CONTROLS && first && dist(this.view.toScreen(first), screen) <= (touch ? 20 : 12)) {
          return this.finishTrace();
        }
        this.trace.push(world);
        this.updatePanel();
        return this.requestDraw();
      }
      case 'start':
        if (!this.doc || !this.nearPath(screen, true)) return this.toast('Tap on the track line.');
        this.patch({ controls: setStart(this.doc.controls, world, 10 / this.view.scale), sectors: [...DEFAULT_SECTORS] });
        this.toast('Start/finish moved · sectors reset to equal thirds');
        return this.setMode('edit');
      case 'calibrate':
        this.measure = this.measure.length >= 2 ? [world] : [...this.measure, world];
        this.updatePanel();
        if (this.measure.length === 2) $<HTMLInputElement>('calib-m').focus();
        return this.requestDraw();
      case 'split0':
      case 'split1':
        if (!this.doc || !this.nearPath(screen, true)) return this.toast('Tap on the track line.');
        this.patch({ sectors: setSector(this.doc.sectors, this.mode === 'split0' ? 0 : 1, fractionAt(this.path, world)) });
        return this.setMode('edit');
      case 'edit':
        if (this.doc && this.hitControl(screen, touch) < 0 && this.nearPath(screen, touch)) {
          this.patch({ controls: insertControl(this.doc.controls, world).controls });
        }
    }
  }

  private deleteControl(i: number): void {
    this.cancelLongPress();
    if (!this.doc) return;
    if (this.doc.controls.length <= MIN_CONTROLS) return this.toast(`A track needs at least ${MIN_CONTROLS} points.`);
    if (this.gesture?.kind === 'drag') {
      this.doc = this.gesture.before;
      this.gesture = null;
    }
    navigator.vibrate?.(15);
    this.patch({ controls: removeControl(this.doc.controls, i) });
  }

  private cancelLongPress(): void {
    clearTimeout(this.longPress);
    this.longPress = undefined;
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    if (this.viewMode === 'animate') {
      if (this.animator.onKey(e)) e.preventDefault();
      return;
    }
    if (e.key === 'Escape') this.setMode('edit');
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.hot >= 0) this.deleteControl(this.hot);
  }

  private undo(): void {
    const prev = this.history.pop();
    if (prev) this.setDoc(prev, false);
  }

  // ------------------------------------------------------------ panel

  private bindFiles(): void {
    const input = $<HTMLInputElement>('file');
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void this.loadFile(f);
      input.value = '';
    });
    $('btn-open').addEventListener('click', () => input.click());

    const mask = $('dropmask');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      mask.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      if (--depth <= 0) [depth, mask.hidden] = [0, true];
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      mask.hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.loadFile(f);
    });
  }

  private bindPanel(): void {
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
    const toggle = (m: Mode) => () => this.setMode(this.mode === m ? 'edit' : m);

    on('btn-pick', toggle('pick'));
    const startTrace = () => {
      this.trace = [];
      toggle('trace')();
    };
    on('btn-trace', startTrace);
    on('btn-map-draw', startTrace);
    on('btn-map', () => this.enterMap());
    $('map-search').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.searchPlace($<HTMLInputElement>('map-q').value);
    });
    on('btn-trace-undo', () => {
      this.trace.pop();
      this.updatePanel();
      this.requestDraw();
    });
    on('btn-trace-done', () => this.finishTrace());
    on('btn-trace-cancel', () => this.setMode('edit'));

    const tol = $<HTMLInputElement>('tol');
    tol.addEventListener('input', () => ($('tol-out').textContent = Number(tol.value).toFixed(2)));
    tol.addEventListener('change', () => this.detect());

    on('btn-reverse', () => {
      if (this.doc) this.patch({ controls: reverseControls(this.doc.controls), sectors: reverseSectors(this.doc.sectors) });
    });
    on('btn-start', toggle('start'));
    on('btn-s2', toggle('split0'));
    on('btn-s3', toggle('split1'));
    on('btn-sectors-reset', () => this.patch({ sectors: [...DEFAULT_SECTORS] }));

    on('btn-calibrate', toggle('calibrate'));
    on('calib-cancel', () => this.setMode('edit'));
    const calibM = $<HTMLInputElement>('calib-m');
    const applyCalib = () => {
      const m = Number(calibM.value);
      if (!this.doc || this.measure.length < 2 || !(m > 0)) return;
      const [a, b] = this.measure;
      this.setDoc(calibrate(this.doc, a, b, m, this.pathUnits()));
      this.toast(`Scale set: 1 px = ${this.doc!.mpu!.toFixed(2)} m · lap ${this.doc!.lengthKm.toFixed(3)} km`);
      this.setMode('edit');
    };
    on('calib-apply', applyCalib);
    calibM.addEventListener('input', () => this.updatePanel());
    calibM.addEventListener('keydown', (e) => e.key === 'Enter' && applyCalib());
    on('btn-undo', () => this.undo());

    const name = $<HTMLInputElement>('name');
    name.addEventListener('change', () => this.patch({ name: name.value.trim() || 'Circuit' }));
    const len = $<HTMLInputElement>('length');
    len.addEventListener('change', () => {
      const v = Number(len.value);
      if (v > 0 && v <= 100 && this.doc) this.setDoc(withLength(this.doc, v, this.pathUnits()));
      else this.updatePanel();
    });

    on('btn-save', () => {
      if (!this.doc) return;
      const slug = this.doc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
      download(`${slug}.track.json`, serializeDoc(this.doc));
    });
    on('btn-clear', () => {
      this.image = null;
      this.imageData = null;
      this.confidence = null;
      this.history = [];
      store.remove(KEY_IMAGE);
      this.setMap(false);
      this.setDoc(null, false);
      this.setMode('edit');
      this.fit('image');
    });

    on('z-in', () => this.zoomButton(1.4));
    on('z-out', () => this.zoomButton(1 / 1.4));
    on('z-fit', () => this.fit(this.path.length ? 'track' : 'image'));
  }

  private zoomButton(f: number): void {
    this.autoFit = null;
    this.view.zoomAt({ x: this.cssW / 2, y: this.cssH / 2 }, f);
    this.requestDraw();
  }

  private updatePanel(): void {
    const d = this.doc;
    $('empty').hidden = !!(this.image || d || this.mapOn);
    $('sec-map').hidden = !this.mapOn;
    $('sec-trace').hidden = this.mode !== 'trace';
    $('btn-map-draw').textContent = d ? 'Draw new track' : 'Draw track';
    $('btn-map-draw').classList.toggle('active', this.mode === 'trace');
    $('sec-detect').hidden = !this.image;
    $('sec-track').hidden = !d;
    $<HTMLButtonElement>('tab-anim').disabled = !d;
    if (!d && this.viewMode === 'animate') this.setView('edit');
    $<HTMLButtonElement>('btn-save').disabled = !d;
    $<HTMLButtonElement>('btn-undo').disabled = !this.history.length;

    const active: Record<string, boolean> = {
      'btn-pick': this.mode === 'pick',
      'btn-trace': this.mode === 'trace',
      'btn-start': this.mode === 'start',
      'btn-s2': this.mode === 'split0',
      'btn-s3': this.mode === 'split1',
      'btn-calibrate': this.mode === 'calibrate',
    };
    for (const [id, on] of Object.entries(active)) $(id).classList.toggle('active', on);
    $('calib-tools').hidden = this.mode !== 'calibrate';
    $('btn-calibrate').hidden = d?.crs === 'mercator'; // map coordinates already carry the scale
    $<HTMLButtonElement>('calib-apply').disabled = this.measure.length < 2 || !(Number($<HTMLInputElement>('calib-m').value) > 0);
    $('calib-px').textContent =
      this.measure.length === 2
        ? `${Math.round(Math.hypot(this.measure[1].x - this.measure[0].x, this.measure[1].y - this.measure[0].y))} px between A and B`
        : `Tap point ${this.measure.length ? 'B' : 'A'}`;
    $<HTMLButtonElement>('btn-trace-done').disabled = this.trace.length < MIN_CONTROLS;

    const sw = $('swatch');
    sw.style.background = this.target ? `rgb(${this.target.r},${this.target.g},${this.target.b})` : 'transparent';
    sw.classList.toggle('empty', !this.target);

    const conf = $('confidence');
    const c = this.confidence;
    conf.hidden = !c;
    if (c) {
      conf.className = `confidence ${c.label}`;
      conf.innerHTML =
        `<strong>${c.label.toUpperCase()} CONFIDENCE</strong> <span>${Math.round(c.score * 100)}%</span>` +
        c.hints.map((h) => `<p>${h}</p>`).join('');
    }

    if (d) {
      const name = $<HTMLInputElement>('name');
      if (document.activeElement !== name) name.value = d.name;
      const len = $<HTMLInputElement>('length');
      if (document.activeElement !== len) len.value = String(d.lengthKm);
      const px = this.pathUnits();
      const unit = d.crs === 'mercator' ? 'map units' : 'px';
      const scale = d.mpu
        ? `<span>Scale <b>1 ${d.crs === 'mercator' ? 'unit' : 'px'} = ${d.mpu.toFixed(d.mpu < 10 ? 2 : 1)} m</b></span>`
        : `<span class="warn">Scale not set: calibrate or type the lap length</span>`;
      $('stats').innerHTML =
        `<span><b>${d.controls.length}</b> points</span><span><b>${Math.round(px)}</b> ${unit} lap</span>${scale}` +
        `<span>S1 <b>${Math.round(d.sectors[0] * 100)}%</b> · S2 <b>${Math.round((d.sectors[1] - d.sectors[0]) * 100)}%</b> · S3 <b>${Math.round((1 - d.sectors[1]) * 100)}%</b></span>`;
      $('meta').textContent = `${d.name.toUpperCase()} · ${d.lengthKm.toFixed(3)} KM`;
    } else {
      $('meta').textContent = '';
    }
  }
}
