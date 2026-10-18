import { describe, expect, it } from 'vitest';
import { estimateSizeMB, exportFileName, letterbox, pickFormat, videoBitrate } from '../../src/io/video';

describe('video export settings', () => {
  it('prefers MP4 when the browser can record it', () => {
    expect(pickFormat((m) => m.startsWith('video/mp4'))?.ext).toBe('mp4');
    expect(pickFormat((m) => m === 'video/mp4;codecs=avc1')?.mime).toBe('video/mp4;codecs=avc1');
  });

  it('falls back to WebM, then nothing', () => {
    expect(pickFormat((m) => m.startsWith('video/webm'))).toEqual({ mime: 'video/webm;codecs=vp9', ext: 'webm' });
    expect(pickFormat(() => false)).toBeNull();
  });

  it('scales bitrate with resolution and frame rate', () => {
    expect(videoBitrate(1080, 60)).toBeGreaterThan(videoBitrate(1080, 30));
    expect(videoBitrate(1080, 30)).toBeGreaterThan(videoBitrate(720, 30));
    expect(estimateSizeMB(60, 8e6)).toBe(60);
  });

  it('names files from the track name', () => {
    expect(exportFileName('Kemayoran GP!', '1080p60', 'mp4')).toBe('kemayoran-gp-1080p60.mp4');
    expect(exportFileName('', 'frame', 'png')).toBe('circuit-frame.png');
  });

  it('letterboxes a 16:9 frame into a tall box', () => {
    expect(letterbox(1920, 1080, 400, 400)).toEqual({ x: 0, y: 87.5, w: 400, h: 225 });
  });
});
