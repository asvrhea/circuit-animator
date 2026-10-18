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

  /** Set ctx so world coordinates draw through this camera (on top of a DPR scale). */
  apply(ctx: CanvasRenderingContext2D, dpr: number): void {
    const c = Math.cos(this.rot) * this.scale, s = Math.sin(this.rot) * this.scale;
    ctx.setTransform(
      dpr * c, dpr * s, -dpr * s, dpr * c,
      dpr * (this.ax - (c * this.cx - s * this.cy)),
      dpr * (this.ay - (s * this.cx + c * this.cy)),
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
