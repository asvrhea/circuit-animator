/**
 * A generic open-wheel race car seen from above, drawn with canvas paths in
 * metres (x forward, y to the right, centre at the middle of the car, 5.6 m
 * long and 2 m wide). Flat fills in the car's colour with a darker outline.
 * Original shapes: a narrow nose with a front wing, four exposed wheels,
 * a slim body with sidepods, a cockpit with a halo bar and a rear wing.
 */
type Ctx = CanvasRenderingContext2D;

export const SPRITE_LENGTH = 5.6;
export const SPRITE_WIDTH = 2;

/** Mix a #rrggbb colour with black (f = 0 keeps it, 1 is black). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const k = 1 - f;
  const c = (v: number) => Math.round(v * k);
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw at the current origin, heading along +x of the current transform.
 * `pxPerM` scales metres to pixels (the caller has already translated/rotated).
 */
export function drawOpenWheelCar(ctx: Ctx, pxPerM: number, color: string, glow = false): void {
  const dark = shade(color, 0.5);
  const mid = shade(color, 0.22);
  ctx.save();
  ctx.scale((pxPerM * SPRITE_LENGTH) / 5.8, (pxPerM * SPRITE_LENGTH) / 5.8); // the drawing spans 5.8 m including both wings
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const line = 0.07;

  // wheels first (they sit outside the body): front pair narrower, rear pair wider
  const wheel = (cx: number, cy: number, w: number, h: number) => {
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 0.12);
    ctx.fillStyle = '#15181d';
    ctx.fill();
    ctx.lineWidth = line * 0.7;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; // tread highlight
    ctx.fillRect(cx - w * 0.3, cy - h * 0.12, w * 0.6, h * 0.24);
  };
  // axles
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(1.75, -0.8);
  ctx.lineTo(1.75, 0.8);
  ctx.moveTo(-1.75, -0.78);
  ctx.lineTo(-1.75, 0.78);
  ctx.stroke();
  for (const sy of [-1, 1]) {
    wheel(1.75, sy * 0.86, 0.95, 0.42);
    wheel(-1.75, sy * 0.84, 1.1, 0.52);
  }

  if (glow) {
    ctx.shadowColor = 'rgba(255,255,255,0.85)';
    ctx.shadowBlur = 1.4;
  }

  // front wing
  ctx.beginPath();
  ctx.moveTo(2.65, -0.98);
  ctx.lineTo(2.9, -0.98);
  ctx.lineTo(2.9, 0.98);
  ctx.lineTo(2.65, 0.98);
  ctx.lineTo(2.55, 0.5);
  ctx.lineTo(2.55, -0.5);
  ctx.closePath();
  ctx.fillStyle = mid;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = line;
  ctx.strokeStyle = dark;
  ctx.stroke();
  ctx.fillStyle = '#0b0d10'; // end plates
  ctx.fillRect(2.62, -1.0, 0.3, 0.1);
  ctx.fillRect(2.62, 0.9, 0.3, 0.1);

  // body: nose, tub, sidepods, engine cover in one outline
  ctx.beginPath();
  ctx.moveTo(2.6, 0);
  ctx.lineTo(2.5, -0.1);
  ctx.lineTo(1.0, -0.3);
  ctx.lineTo(0.8, -0.62); // sidepod inlet
  ctx.lineTo(-0.7, -0.66);
  ctx.lineTo(-1.5, -0.4);
  ctx.lineTo(-2.4, -0.2);
  ctx.lineTo(-2.4, 0.2);
  ctx.lineTo(-1.5, 0.4);
  ctx.lineTo(-0.7, 0.66);
  ctx.lineTo(0.8, 0.62);
  ctx.lineTo(1.0, 0.3);
  ctx.lineTo(2.5, 0.1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = dark;
  ctx.stroke();
  // centre stripe along the engine cover
  ctx.fillStyle = mid;
  ctx.fillRect(-2.3, -0.08, 2.0, 0.16);

  // cockpit opening and halo bar
  ctx.beginPath();
  ctx.ellipse(0.35, 0, 0.42, 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0d10';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.78, 0);
  ctx.bezierCurveTo(0.74, -0.34, 0.1, -0.36, -0.02, -0.2);
  ctx.moveTo(0.78, 0);
  ctx.bezierCurveTo(0.74, 0.34, 0.1, 0.36, -0.02, 0.2);
  ctx.strokeStyle = '#d8dde4';
  ctx.lineWidth = 0.07;
  ctx.stroke();

  // rear wing
  ctx.beginPath();
  ctx.rect(-2.9, -0.82, 0.42, 1.64);
  ctx.fillStyle = mid;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = dark;
  ctx.stroke();
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(-2.9, -0.88, 0.5, 0.08);
  ctx.fillRect(-2.9, 0.8, 0.5, 0.08);
  ctx.restore();
}
