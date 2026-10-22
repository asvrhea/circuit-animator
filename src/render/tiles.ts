import { tileRect, tilesFor, TILE_PX, wrapX, zoomForScale, type TileId, type UnitRect } from '../geom/tiles';

/** OSM standard tiles. Attribution is required wherever they are shown. */
export const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

interface Entry {
  img: HTMLImageElement;
  ok: boolean;
  failed: boolean;
  used: number;
}

const MAX_CACHE = 400;
/** eviction runs in batches so a busy frame never sorts the whole cache */
const EVICT_SLACK = 1.25;
const PARENT_FALLBACK = 5;

/**
 * Minimal slippy-map tile layer for Canvas 2D. Draw it with the context
 * already transformed into world (map unit) coordinates.
 */
export class TileLayer {
  private cache = new Map<string, Entry>();
  private clock = 0;
  private capacity = MAX_CACHE;

  constructor(
    private readonly onLoad: () => void,
    private readonly url = OSM_URL,
  ) {}

  private get({ z, x, y }: TileId, load: boolean): Entry | null {
    const key = `${z}/${wrapX(x, z)}/${y}`;
    let e = this.cache.get(key);
    if (!e && load) {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // keep the canvas exportable
      img.decoding = 'async';
      e = { img, ok: false, failed: false, used: 0 };
      const entry = e;
      img.onload = () => {
        entry.ok = true;
        this.onLoad();
      };
      img.onerror = () => (entry.failed = true);
      img.src = this.url.replace('{z}', String(z)).replace('{x}', String(wrapX(x, z))).replace('{y}', String(y));
      this.cache.set(key, e);
      this.evict();
    }
    if (e) e.used = ++this.clock;
    return e ?? null;
  }

  private evict(): void {
    if (this.cache.size <= this.capacity * EVICT_SLACK) return;
    const old = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.cache.size - this.capacity);
    for (const [k] of old) this.cache.delete(k);
  }

  /** Keep at least `n` tiles cached (never shrinks below the default). */
  reserve(n: number): void {
    this.capacity = Math.max(MAX_CACHE, Math.ceil(n));
  }

  /** Start loading every tile covering `view` at zoom z, without drawing. Returns how many tiles that is. */
  prefetch(view: UnitRect, z: number): number {
    const tiles = tilesFor(view, z, Infinity);
    for (const t of tiles) this.get(t, true);
    return tiles.length;
  }

  /** Draw tiles covering `view` (world rect) at `zoom`, or at a zoom matched to `cssPxPerUnit`. */
  draw(ctx: CanvasRenderingContext2D, view: UnitRect, cssPxPerUnit: number, dpr: number, zoom?: number): void {
    const z = zoom ?? zoomForScale(cssPxPerUnit, dpr);
    const bleed = 0.6 / cssPxPerUnit; // hide hairline seams between tiles
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const t of tilesFor(view, z)) {
      const r = tileRect(t);
      const e = this.get(t, true);
      if (e?.ok) {
        ctx.drawImage(e.img, r.x, r.y, r.w + bleed, r.h + bleed);
        continue;
      }
      // Until it arrives, stretch the nearest loaded ancestor over this tile.
      for (let k = 1; k <= PARENT_FALLBACK && z - k >= 0; k++) {
        const p = this.get({ z: z - k, x: t.x >> k, y: t.y >> k }, false);
        if (!p?.ok) continue;
        const sub = TILE_PX / 2 ** k;
        const sx = (wrapX(t.x, z) - (wrapX(t.x, z) >> k << k)) * sub;
        const sy = (t.y - (t.y >> k << k)) * sub;
        ctx.drawImage(p.img, sx, sy, sub, sub, r.x, r.y, r.w + bleed, r.h + bleed);
        break;
      }
    }
  }

  /** True when every tile for this view is loaded (or failed), e.g. before recording a frame. */
  ready(view: UnitRect, cssPxPerUnit: number, dpr: number): boolean {
    const z = zoomForScale(cssPxPerUnit, dpr);
    return tilesFor(view, z).every((t) => {
      const e = this.get(t, true);
      return !!e && (e.ok || e.failed);
    });
  }
}
