import type { Vec2 } from '../geom/vec2';

export interface CamPose {
  /** world point shown at the anchor */
  cx: number;
  cy: number;
  /** screen px per world unit */
  scale: number;
  /** rotation applied to the world, radians */
  rot: number;
}

/**
 * Camera with rotation, anchored at a screen point, with exponential
 * smoothing towards a target pose (time constants in seconds of sim time).
 */
export class Camera implements CamPose {
  cx = 0;
  cy = 0;
  scale = 1;
  rot = 0;
  ax = 0;
  ay = 0;

  toScreen(p: Vec2): Vec2 {
    const dx = p.x - this.cx, dy = p.y - this.cy;
    const c = Math.cos(this.rot) * this.scale, s = Math.sin(this.rot) * this.scale;
    return { x: this.ax + c * dx - s * dy, y: this.ay + s * dx + c * dy };
  }

  toWorld(p: Vec2): Vec2 {
    const dx = p.x - this.ax, dy = p.y - this.ay;
    const c = Math.cos(-this.rot) / this.scale, s = Math.sin(-this.rot) / this.scale;
    return { x: this.cx + c * dx - s * dy, y: this.cy + s * dx + c * dy };
  }

  /** World bounding box of the w x h screen (handles rotation). */
  visibleRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
    const pts = [this.toWorld({ x: 0, y: 0 }), this.toWorld({ x: w, y: 0 }), this.toWorld({ x: 0, y: h }), this.toWorld({ x: w, y: h })];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** Set ctx so world coordinates draw through this camera (on top of a DPR scale). */
  apply(ctx: CanvasRenderingContext2D, dpr: number, ox = 0, oy = 0): void {
    const c = Math.cos(this.rot) * this.scale, s = Math.sin(this.rot) * this.scale;
    ctx.setTransform(
      dpr * c, dpr * s, -dpr * s, dpr * c,
      dpr * (this.ax + ox - (c * this.cx - s * this.cy)),
      dpr * (this.ay + oy - (s * this.cx + c * this.cy)),
    );
  }

  set(p: CamPose): void {
    this.cx = p.cx;
    this.cy = p.cy;
    this.scale = p.scale;
    this.rot = p.rot;
  }

  smoothTo(p: CamPose, dt: number, tauPos: number, tauScale: number, tauRot: number): void {
    const k = (tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau));
    this.cx += (p.cx - this.cx) * k(tauPos);
    this.cy += (p.cy - this.cy) * k(tauPos);
    // smooth in log space so zooming feels even
    this.scale = Math.exp(Math.log(this.scale) + (Math.log(p.scale) - Math.log(this.scale)) * k(tauScale));
    let dr = p.rot - this.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    this.rot += dr * k(tauRot);
  }
}
