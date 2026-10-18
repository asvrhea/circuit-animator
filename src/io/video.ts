/** Video export settings, independent of the DOM so they can be unit tested. */

export type Resolution = 720 | 1080;
export type Fps = 30 | 60;

export const RESOLUTIONS: Record<Resolution, { w: number; h: number }> = {
  720: { w: 1280, h: 720 },
  1080: { w: 1920, h: 1080 },
};

export interface VideoFormat {
  mime: string;
  ext: 'mp4' | 'webm';
}

/** MP4 (H.264) first, so phones and editors open it directly; WebM otherwise. */
const CANDIDATES: VideoFormat[] = [
  { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.4d0028', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

export function pickFormat(isSupported: (mime: string) => boolean): VideoFormat | null {
  return CANDIDATES.find((c) => isSupported(c.mime)) ?? null;
}

/** Bits per second: enough for crisp HUD text and thin lines. */
export function videoBitrate(res: Resolution, fps: Fps): number {
  const base = res === 1080 ? 12e6 : 6e6;
  return Math.round(fps === 60 ? base * 1.5 : base);
}

export function estimateSizeMB(seconds: number, bitsPerSecond: number): number {
  return (seconds * bitsPerSecond) / 8 / 1e6;
}

export function exportFileName(name: string, suffix: string, ext: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
  return `${slug}-${suffix}.${ext}`;
}

/** Fit a w x h frame inside a box, centred (for the live preview while recording). */
export function letterbox(w: number, h: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
  const k = Math.min(boxW / w, boxH / h);
  return { x: (boxW - w * k) / 2, y: (boxH - h * k) / 2, w: w * k, h: h * k };
}
