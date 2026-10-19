import { frameSize, pickFormat, videoBitrate, type Aspect, type Fps, type Resolution, type VideoFormat } from '../io/video';
import { AnimRenderer, type AnimOptions } from '../render/anim';
import { THEME } from '../render/theme';
import type { Race } from '../sim/race';

export interface ExportJob {
  race: Race;
  opts: AnimOptions;
  res: Resolution;
  aspect: Aspect;
  fps: Fps;
  /** playback speed: video length = race.total / speed */
  speed: number;
}

export interface ExportProgress {
  /** 0..1 of the race timeline */
  done: number;
  /** why recording is on hold, if it is */
  waiting: '' | 'hidden' | 'tiles';
}

export class ExportCancelled extends Error {}

/** Load the HUD font before the first frame so the video never shows the fallback. */
async function fontsReady(): Promise<void> {
  try {
    const family = THEME.font.split(',')[0];
    await Promise.all([600, 700, 800].map((w) => document.fonts.load(`${w} 20px ${family}`)));
    await Promise.all([document.fonts.load(`italic 800 20px ${family}`), document.fonts.ready]);
  } catch {
    /* fall back to whatever is available */
  }
}

export function supportedFormat(): VideoFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return pickFormat((m) => MediaRecorder.isTypeSupported(m));
}

function makeCanvas(res: Resolution, aspect: Aspect): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const { w, h } = frameSize(res, aspect);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')!, w, h };
}

/** Every map tile for this frame has arrived (always true without a map). */
function tilesReady(r: AnimRenderer, w: number, h: number): boolean {
  const { tiles, theme } = r.opts;
  if (!tiles || theme !== 'screenshot') return true;
  return tiles.ready(r.cam.visibleRect(w, h), r.cam.scale, 1);
}

/** One still frame at `time`, as PNG. */
export async function renderPng(job: Omit<ExportJob, 'fps' | 'speed'>, time: number): Promise<Blob> {
  await fontsReady();
  const { canvas, ctx, w, h } = makeCanvas(job.res, job.aspect);
  const r = new AnimRenderer(job.race, { ...job.opts });
  r.render(ctx, w, h, 1, time, true);
  for (let i = 0; i < 40 && !tilesReady(r, w, h); i++) {
    await new Promise((res) => setTimeout(res, 150));
    r.render(ctx, w, h, 1, time, true);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

/**
 * Real-time recording of the whole timeline with canvas.captureStream +
 * MediaRecorder. Race time follows the wall clock (× speed), so the video
 * has the right length even if some frames are slow. Recording pauses — and
 * race time stops — while the tab is hidden or map tiles are still loading,
 * so no frame is captured half-drawn.
 */
export class VideoExport {
  private cancelled = false;
  readonly format: VideoFormat;

  constructor(
    private readonly job: ExportJob,
    private readonly onProgress: (p: ExportProgress) => void,
    private readonly onPreview: (frame: HTMLCanvasElement) => void,
  ) {
    const f = supportedFormat();
    if (!f) throw new Error('This browser cannot record video (MediaRecorder unavailable).');
    this.format = f;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<Blob> {
    const { race, opts, res, aspect, fps, speed } = this.job;
    await fontsReady();
    const { canvas, ctx, w, h } = makeCanvas(res, aspect);
    const r = new AnimRenderer(race, { ...opts });

    // Manual frame push when available, so half-loaded frames are never sent.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const manual = typeof track.requestFrame === 'function';
    const rec = new MediaRecorder(manual ? stream : canvas.captureStream(fps), {
      mimeType: this.format.mime,
      videoBitsPerSecond: videoBitrate(res, fps),
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));

    // First frame, with its tiles, before the clock starts.
    r.render(ctx, w, h, 1, 0, true);
    while (!tilesReady(r, w, h) && !this.cancelled) {
      this.onProgress({ done: 0, waiting: 'tiles' });
      await new Promise((res2) => setTimeout(res2, 100));
      r.render(ctx, w, h, 1, 0, true);
    }

    rec.start(1000);
    if (manual) track.requestFrame();
    const frameMs = 1000 / fps;
    let t = 0;
    let last = performance.now();
    let lastEmit = last;

    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (this.cancelled) return resolve();
        // No cap: the recorder stamps frames with wall-clock time, so race time must
        // keep pace with it even when frames are slow, or the video plays in slow motion.
        // (Deliberate holds — hidden tab, loading tiles — pause the recorder instead.)
        const dt = (now - last) / 1000;
        last = now;

        const waiting: ExportProgress['waiting'] = document.hidden ? 'hidden' : tilesReady(r, w, h) ? '' : 'tiles';
        if (waiting) {
          if (rec.state === 'recording') rec.pause();
          if (waiting === 'tiles') r.render(ctx, w, h, 1, t); // keep requesting the frame's tiles
          this.onProgress({ done: t / race.total, waiting });
          return void requestAnimationFrame(tick);
        }
        if (rec.state === 'paused') rec.resume();
        else t = Math.min(race.total, t + dt * speed);

        if (now - lastEmit >= frameMs - 2 || t >= race.total) {
          r.render(ctx, w, h, 1, t);
          if (!tilesReady(r, w, h)) {
            // this view needs new tiles: hold the clock and the recorder until they arrive
            if (rec.state === 'recording') rec.pause();
            return void requestAnimationFrame(tick);
          }
          if (manual) track.requestFrame();
          lastEmit = now;
          this.onPreview(canvas);
          this.onProgress({ done: t / race.total, waiting: '' });
        }
        if (t >= race.total) return void setTimeout(resolve, 500); // hold the final frame briefly
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    if (this.cancelled) throw new ExportCancelled('Export cancelled');
    const blob = new Blob(chunks, { type: this.format.mime.split(';')[0] });
    if (!blob.size) throw new Error('the browser produced an empty video. Try again, or switch to WebM-capable Chrome/Edge.');
    return blob;
  }
}
