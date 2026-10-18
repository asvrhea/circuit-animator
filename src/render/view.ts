import type { Vec2 } from '../geom/vec2';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World (image px) <-> screen (CSS px) transform: uniform scale + offset. */
export class View {
  scale = 1;
  ox = 0;
  oy = 0;
  /** zoom limits in screen px per world unit (map units need a much wider range) */
  minScale = 0.05;
  maxScale = 40;

  toScreen(p: Vec2): Vec2 {
    return { x: p.x * this.scale + this.ox, y: p.y * this.scale + this.oy };
  }

  toWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.ox) / this.scale, y: (p.y - this.oy) / this.scale };
  }

  /** Fit a world rect inside a screen of size w x h with `pad` fraction of margin. */
  fit(r: Rect, w: number, h: number, pad = 0.08): void {
    const rw = Math.max(r.w, 1), rh = Math.max(r.h, 1);
    this.scale = Math.min((w * (1 - 2 * pad)) / rw, (h * (1 - 2 * pad)) / rh);
    this.ox = w / 2 - (r.x + rw / 2) * this.scale;
    this.oy = h / 2 - (r.y + rh / 2) * this.scale;
  }

  zoomAt(screen: Vec2, factor: number): void {
    const s = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const k = s / this.scale;
    this.ox = screen.x - (screen.x - this.ox) * k;
    this.oy = screen.y - (screen.y - this.oy) * k;
    this.scale = s;
  }

  panBy(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
  }
}

export function boundsOf(pts: Vec2[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return pts.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 };
}
