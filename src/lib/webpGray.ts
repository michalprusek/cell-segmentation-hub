/**
 * Decode an 8-bit grayscale WebP playback proxy into the shape the canvas
 * already understands.
 *
 * WHY THIS IS CHEAPER THAN THE PNG PATH. `decodeGrayPngPooled` un-filters and
 * inflates a 16-bit PNG in JavaScript — about 25 ms per channel, which is why a
 * worker pool exists at all. `createImageBitmap` hands the same job to the
 * browser's own native image decoder instead. Faster decoding is a side effect
 * here; the reason the proxy exists is that it is a fifteenth of the bytes.
 *
 * WHY THE SAMPLES COME BACK THROUGH A CANVAS. There is no API that yields a
 * decoded image's raw bytes directly. Painting the bitmap and reading it back
 * is the standard route, and for a grayscale source the three colour channels
 * are equal, so taking R is exact rather than an approximation.
 *
 * See `docs/superpowers/specs/2026-08-21-playback-proxy-design.md`.
 */

import type { DecodedGray } from './png16';

/**
 * True when this browser can decode a proxy at all.
 *
 * Both APIs are present in every browser this app supports and in workers, but
 * a caller that cannot check cheaply would otherwise have to `try` its way to
 * the same answer on every frame.
 */
export function canDecodeWebpGray(): boolean {
  return (
    typeof createImageBitmap === 'function' &&
    typeof OffscreenCanvas === 'function'
  );
}

/**
 * @param rangeMax the value the proxy's 255 stands for, or null to hand back
 *   the raw 8-bit samples.
 *
 * WHY EXPAND AT ALL. The proxy is a linear map of `[0, rangeMax]` onto
 * `[0, 255]`, so drawing it directly would need the window — expressed in the
 * data's own units — rescaled to match, everywhere it is used. That works right
 * up until the server answers a `repr=proxy` request with the ORIGINAL PNG,
 * which it does for every frame the batch has not reached yet: the canvas would
 * then be holding 16-bit samples while believing they were 8-bit, and would
 * draw them far too dark. Undoing the map here instead costs one pass over the
 * samples — against the hundreds of milliseconds even a proxy spends on the
 * wire — and leaves every consumer, window arithmetic, LUT, compositor and
 * cache accounting alike, reading one kind of number.
 */
export async function decodeWebpGray(
  blob: Blob,
  rangeMax: number
): Promise<DecodedGray> {
  // No default, and no "just hand back the 8-bit samples" branch. Raw proxy
  // samples are 0..255 where every consumer expects the data's own units, so a
  // caller that lost the range must get nothing rather than something 256x too
  // dark — a wrong picture in a measurement tool is worse than a missing one.
  if (!Number.isFinite(rangeMax) || rangeMax <= 0) {
    throw new Error(`webpGray: a proxy needs its range, got ${rangeMax}`);
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    // `willReadFrequently` keeps the drawing surface on the CPU. Without it a
    // browser may put it on the GPU and pay a readback stall on getImageData —
    // per frame, per channel, during playback.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('webpGray: no 2d context for the proxy canvas');
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

    const pixels = bitmap.width * bitmap.height;
    const data = new Uint8Array(pixels);
    let min = 255;
    let max = 0;
    for (let i = 0, o = 0; i < pixels; i++, o += 4) {
      // R of an RGBA quad; G and B carry the same value for a gray source.
      const v = rgba[o];
      data[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // An empty frame would otherwise report min 255 / max 0, which reads as an
    // inverted window everywhere downstream.
    if (pixels === 0) {
      min = 0;
      max = 0;
    }

    // Back into the units the sliders and the LUT speak. The step is
    // rangeMax/255, so the samples are coarser than the original — which is
    // the whole bargain, and is what `windowNeedsFullDepth` guards.
    const scale = rangeMax / 255;
    const expanded = new Uint16Array(pixels);
    for (let i = 0; i < pixels; i++) {
      expanded[i] = Math.round(data[i] * scale);
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      bitDepth: 16,
      data: expanded,
      min: Math.round(min * scale),
      max: Math.round(max * scale),
    };
  } finally {
    // The bitmap holds decoded pixels outside the JS heap; at ~2 Mpx a frame
    // and several frames in flight, leaving them to the GC is megabytes the
    // collector has no pressure signal for.
    bitmap.close();
  }
}
