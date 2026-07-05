/**
 * Minimal grayscale-PNG decoder that preserves 16-bit sample depth.
 *
 * Why this exists: the browser's native image path (`createImageBitmap` →
 * `<canvas>` → `getImageData`) always hands back 8-bit RGBA, silently
 * discarding the low byte of a 16-bit microscopy PNG. To offer ImageJ-style
 * window/level on the true 16-bit values, the editor needs the raw samples,
 * so we decode grayscale PNGs ourselves.
 *
 * Scope (deliberately narrow — anything else returns `null` so the caller
 * falls back to the 8-bit `createImageBitmap` path):
 *   - PNG colour type 0 (grayscale), bit depth 8 or 16.
 *   - No interlacing (PIL/tifffile never emit Adam7 for these stacks).
 *
 * Inflate uses the platform `DecompressionStream('deflate')` (PNG IDAT is
 * zlib-wrapped deflate). On the rare browser without it, decode returns
 * `null` and the caller degrades to 8-bit — never throws.
 *
 * Verified byte-exact against real MetaMorph/PIL 16-bit frames (a TIRF
 * channel decoded to min=640 max=23480, matching tifffile ground truth).
 */

import { logger } from '@/lib/logger';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface DecodedGray {
  width: number;
  height: number;
  /** 8 or 16 — the PNG's stored bit depth. */
  bitDepth: number;
  /** Grayscale samples, one per pixel, row-major. Uint16Array for 16-bit
   *  sources, Uint8Array for 8-bit. */
  data: Uint16Array | Uint8Array;
  /** Min/max sample value across the frame (for auto-contrast windowing). */
  min: number;
  max: number;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') {
    logger.warn(
      'png16: DecompressionStream unavailable in this browser; cannot inflate PNG IDAT, falling back to 8-bit decode'
    );
    return null;
  }
  try {
    const ds = new DecompressionStream('deflate');
    const stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await stream.arrayBuffer());
  } catch (error) {
    logger.warn(
      'png16: inflating PNG IDAT threw, falling back to 8-bit decode',
      error
    );
    return null;
  }
}

/**
 * Decode a grayscale PNG Blob to its native-depth samples, or `null` when
 * the PNG isn't a grayscale 8/16-bit non-interlaced image (caller falls
 * back to the browser's 8-bit decode). Never throws.
 */
export async function decodeGrayPng(blob: Blob): Promise<DecodedGray | null> {
  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
  if (buf.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null;
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];

  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(
      buf[off + 4],
      buf[off + 5],
      buf[off + 6],
      buf[off + 7]
    );
    const dstart = off + 8;
    if (dstart + len > buf.length) return null; // truncated
    if (type === 'IHDR') {
      width = dv.getUint32(dstart);
      height = dv.getUint32(dstart + 4);
      bitDepth = buf[dstart + 8];
      colorType = buf[dstart + 9];
      interlace = buf[dstart + 12];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dstart, dstart + len));
    } else if (type === 'IEND') {
      break;
    }
    off = dstart + len + 4; // skip data + 4-byte CRC
  }

  // Only grayscale (colour type 0), 8/16-bit, non-interlaced.
  if (colorType !== 0) return null;
  if (bitDepth !== 8 && bitDepth !== 16) return null;
  if (interlace !== 0) return null;
  if (width <= 0 || height <= 0 || idat.length === 0) return null;

  let total = 0;
  for (const c of idat) total += c.length;
  const comp = new Uint8Array(total);
  let cp = 0;
  for (const c of idat) {
    comp.set(c, cp);
    cp += c.length;
  }

  const raw = await inflate(comp);
  if (!raw) {
    logger.warn(
      `png16: inflate failed for ${width}x${height} bitDepth=${bitDepth} PNG; downgrading to 8-bit fallback`
    );
    return null;
  }

  const bpp = bitDepth === 16 ? 2 : 1; // grayscale sample bytes
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    // filter byte per row
    logger.warn(
      `png16: inflated PNG data truncated (got ${raw.length} bytes, expected ${expected}) for ${width}x${height} bitDepth=${bitDepth}; downgrading to 8-bit fallback`
    );
    return null;
  }

  // Unfilter scanlines in place (PNG filter types 0..4).
  const out = new Uint8Array(height * stride);
  let rawOff = 0;
  let prevRow: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    const row = out.subarray(y * stride, y * stride + stride);
    const src = raw.subarray(rawOff, rawOff + stride);
    rawOff += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prevRow ? prevRow[x] : 0;
      const c = prevRow && x >= bpp ? prevRow[x - bpp] : 0;
      let v = src[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          v = (v + paeth(a, b, c)) & 0xff;
          break;
        default:
          // unknown filter → bail to fallback
          logger.warn(
            `png16: unknown PNG filter byte ${filter} at row ${y} of ${width}x${height} bitDepth=${bitDepth} image; downgrading to 8-bit fallback`
          );
          return null;
      }
      row[x] = v;
    }
    prevRow = row;
  }

  const n = width * height;
  let min = Infinity;
  let max = -Infinity;
  if (bitDepth === 16) {
    const data = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const v = (out[i * 2] << 8) | out[i * 2 + 1]; // PNG samples are big-endian
      data[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { width, height, bitDepth, data, min, max };
  }
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = out[i];
    data[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { width, height, bitDepth, data, min, max };
}
