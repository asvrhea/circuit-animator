import { inverseMercator, mercator, type LonLat } from './projection';
import type { Vec2 } from './vec2';

/**
 * Map world units: Web Mercator metres with y flipped to point down
 * (x = mercX, y = −mercY), so they behave like image pixels.
 * Slippy-map tiles (z/x/y, 256 px) live on the same grid.
 */

export const WORLD = 2 * Math.PI * 6378137;
export const TILE_PX = 256;
export const MAX_ZOOM = 19;

export const toUnits = (ll: LonLat): Vec2 => {
  const m = mercator(ll);
  return { x: m.x, y: -m.y };
};

export const fromUnits = (p: Vec2): LonLat => inverseMercator({ x: p.x, y: -p.y });

/** Ground metres per map unit at a point (Mercator stretches by 1/cos(lat)). */
export const groundMetresPerUnit = (p: Vec2): number => Math.cos((fromUnits(p).lat * Math.PI) / 180);

export const tileSpan = (z: number): number => WORLD / 2 ** z;

/** Zoom whose tiles show at about 1 tile pixel per device pixel. */
export function zoomForScale(cssPxPerUnit: number, dpr = 1): number {
  const z = Math.log2((WORLD * cssPxPerUnit * dpr) / TILE_PX);
  return Math.max(0, Math.min(MAX_ZOOM, Math.round(z - 0.2)));
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export interface UnitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World rect covered by a tile (x may be outside 0..2^z-1 for wrapped copies). */
export function tileRect({ z, x, y }: TileId): UnitRect {
  const t = tileSpan(z);
  return { x: -WORLD / 2 + x * t, y: -WORLD / 2 + y * t, w: t, h: t };
}

/** Tiles covering a world rect; capped so a bad zoom can't request thousands. */
export function tilesFor(r: UnitRect, z: number, max = 120): TileId[] {
  const t = tileSpan(z), n = 2 ** z;
  const x0 = Math.floor((r.x + WORLD / 2) / t), x1 = Math.floor((r.x + r.w + WORLD / 2) / t);
  const y0 = Math.max(0, Math.floor((r.y + WORLD / 2) / t)), y1 = Math.min(n - 1, Math.floor((r.y + r.h + WORLD / 2) / t));
  const out: TileId[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (out.length < max) out.push({ z, x, y });
  return out;
}

/** Wrap x into the valid tile range for fetching. */
export const wrapX = (x: number, z: number): number => {
  const n = 2 ** z;
  return ((x % n) + n) % n;
};
