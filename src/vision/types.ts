/** RGBA pixels, layout-compatible with DOM ImageData but usable in Node. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Binary mask, one byte per pixel (0 or 1), row-major. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const createMask = (width: number, height: number): Mask => ({
  width,
  height,
  data: new Uint8Array(width * height),
});

export const countOn = (m: Mask): number => {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n;
};
