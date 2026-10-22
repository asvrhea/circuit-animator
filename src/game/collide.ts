/** A body in the world frame; `heading` orients its two collision circles, `mass` weights the push. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading?: number;
  mass?: number;
}

/** A car is two circles, front and rear, so cars can run side by side but not nose through tail. */
export const CIRCLE_SEP = 1.5;
export const CIRCLE_R = 1.05;

const RESTITUTION = 0.25;

/**
 * Car vs car. For each overlapping circle pair, separates the cars along the
 * line between the circles and exchanges the closing velocity. Returns true
 * if they touched.
 */
export function collide(a: Body, b: Body): boolean {
  let hit = false;
  const min = 2 * CIRCLE_R;
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      const ha = a.heading ?? 0, hb = b.heading ?? 0;
      const ax = a.x + Math.cos(ha) * CIRCLE_SEP * sa, ay = a.y + Math.sin(ha) * CIRCLE_SEP * sa;
      const bx = b.x + Math.cos(hb) * CIRCLE_SEP * sb, by = b.y + Math.sin(hb) * CIRCLE_SEP * sb;
      const dx = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy);
      if (dist >= min) continue;
      hit = true;
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
    }
  }
  return hit;
}
