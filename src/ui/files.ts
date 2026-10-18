/** Browser file helpers (DOM only). */

export const MAX_IMAGE_SIDE = 1600;

export interface LoadedImage {
  canvas: HTMLCanvasElement;
  data: ImageData;
}

/** Decode an image (File or URL) into a canvas, downscaled to MAX_IMAGE_SIDE. */
export async function loadImage(src: Blob | string): Promise<LoadedImage> {
  const img = new Image();
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    // onload rather than decode(): decode() can stall in background tabs
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not decode that image.'));
      img.src = url;
    });
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

export function download(name: string, data: string | Blob, mime = 'application/json'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type FileKind = 'image' | 'geo' | 'json' | 'unknown';

export function fileKind(f: File): FileKind {
  if (f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name)) return 'image';
  if (/\.(kml|gpx)$/i.test(f.name)) return 'geo';
  if (/\.json$/i.test(f.name) || f.type === 'application/json') return 'json';
  return 'unknown';
}

/** localStorage that never throws (private mode, quota, disabled storage). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
