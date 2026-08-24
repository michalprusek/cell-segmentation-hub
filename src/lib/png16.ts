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

  // Un-filter and pack in ONE pass per row (PNG filter types 0..4).
  //
  // Shape matters here: this is the only synchronous cost left in the decode,
  // and it runs per channel per displayed frame. Measured on a real 1474x1412
  // 16-bit frame from the microtubule editor, restructuring this loop took it
  // from 22.7 ms to 10.0 ms (2.27x) with byte-identical output. Three things
  // account for that, none of them clever:
  //
  //   1. The filter type is constant for a row, so the `switch` moved OUTSIDE
  //      the byte loop. It used to be evaluated ~2.9 M times per channel.
  //   2. Only the first `bpp` bytes of a row lack a left neighbour, so they
  //      are peeled into a prologue and the body runs with no bounds tests.
  //      `x >= bpp ? ... : 0` used to be evaluated three times per byte.
  //   3. A Uint8Array store truncates to 8 bits already, so the explicit
  //      `& 0xff` was redundant; and swapping the two row buffers replaces a
  //      `prev.set(cur)` that copied the entire image, one row at a time.
  //
  // The sample pack and the min/max sweep stay fused to the row while it is
  // still hot in cache, instead of re-reading the finished image afterwards.
  const n = width * height;
  const out16 = bitDepth === 16 ? new Uint16Array(n) : null;
  const out8 = bitDepth === 16 ? null : new Uint8Array(n);
  let cur = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  let min = Infinity;
  let max = -Infinity;
  let rawOff = 0;
  let outI = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    switch (filter) {
      case 0:
        for (let x = 0; x < stride; x++) cur[x] = raw[rawOff + x];
        break;
      case 1:
        for (let x = 0; x < bpp; x++) cur[x] = raw[rawOff + x];
        for (let x = bpp; x < stride; x++)
          cur[x] = raw[rawOff + x] + cur[x - bpp];
        break;
      case 2:
        for (let x = 0; x < stride; x++) cur[x] = raw[rawOff + x] + prev[x];
        break;
      case 3:
        for (let x = 0; x < bpp; x++) cur[x] = raw[rawOff + x] + (prev[x] >> 1);
        for (let x = bpp; x < stride; x++)
          cur[x] = raw[rawOff + x] + ((cur[x - bpp] + prev[x]) >> 1);
        break;
      case 4:
        for (let x = 0; x < bpp; x++) cur[x] = raw[rawOff + x] + prev[x];
        for (let x = bpp; x < stride; x++)
          cur[x] =
            raw[rawOff + x] + paeth(cur[x - bpp], prev[x], prev[x - bpp]);
        break;
      default:
        logger.warn(
          `png16: unknown PNG filter byte ${filter} at row ${y} of ${width}x${height} bitDepth=${bitDepth} image; downgrading to 8-bit fallback`
        );
        return null;
    }
    rawOff += stride;

    if (out16) {
      for (let x = 0; x < stride; x += 2) {
        const v = (cur[x] << 8) | cur[x + 1]; // PNG samples are big-endian
        out16[outI++] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    } else {
      for (let x = 0; x < stride; x++) {
        const v = cur[x];
        out8![outI++] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    const swap = prev;
    prev = cur;
    cur = swap;
  }

  return {
    width,
    height,
    bitDepth,
    data: (out16 ?? out8) as Uint16Array | Uint8Array,
    min,
    max,
  };
}
