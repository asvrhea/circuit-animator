import { CAR_RADIUS } from './car';

/** A body in the world frame; `mass` weights the push. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass?: number;
}

const RESTITUTION = 0.25;

/**
 * Circle vs circle. Separates the pair along the line between them and
 * exchanges the closing velocity. Returns true if they were touching.
 */
export function collide(a: Body, b: Body, radius = CAR_RADIUS): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = 2 * radius;
  if (dist >= min) return false;
  const nx = dist > 1e-6 ? dx / dist : 1, ny = dist > 1e-6 ? dy / dist : 0;
  const ma = a.mass ?? 1, mb = b.mass ?? 1;
  const wa = mb / (ma + mb), wb = ma / (ma + mb);
  const push = min - dist;
  a.x -= nx * push * wa;
  a.y -= ny * push * wa;
  b.x += nx * push * wb;
  b.y += ny * push * wb;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn < 0) {
    const j = (-(1 + RESTITUTION) * vn) / (1 / ma + 1 / mb);
    a.vx -= (j / ma) * nx;
    a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx;
    b.vy += (j / mb) * ny;
  }
  return true;
}
