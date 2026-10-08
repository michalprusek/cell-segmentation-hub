/**
 * The two CSS properties every bitmap path of the editor shares: the `<img>`
 * and the 16-bit `<canvas>` of `CanvasImage`, and the WebGL / 2D `<canvas>`
 * of `MultiChannelCanvas`. One module so the three cannot drift — they did:
 * all three carried their own copy of `crisp-edges`.
 */

/**
 * `image-rendering` for the "Smooth image" setting. CVAT's semantics
 * (`cvat-canvas` `canvasView.ts`, `.cvat_canvas_pixelized`): on = the
 * browser's default interpolation, off = nearest neighbour.
 *
 * NEVER `crisp-edges`. Chrome accepts the unprefixed keyword only from 148;
 * before that the declaration is invalid and silently computes to `auto`.
 * Measured on Chromium 143: fraction of adjacent screen pixels that differ
 * at zoom 10 was 0.948 (bilinear) where nearest neighbour gives 0.098 — so
 * the "sharp" setting was smooth there. `pixelated` is the portable value
 * (Chrome 41, Firefox 93, Safari 10).
 *
 * It is a style and must stay one: putting the mode in a `key` or switching
 * element type would remount the canvas, which recreates the WebGL context
 * and refires `onLoad`.
 */
export function imageRenderingFor(smooth: boolean): 'auto' | 'pixelated' {
  return smooth ? 'auto' : 'pixelated';
}

/**
 * The brightness/contrast CSS filter, or `undefined` at 100 / 100.
 *
 * An identity `brightness(1) contrast(1)` is not free. Any `filter` gives the
 * element its own compositor surface, and that surface is drawn at whatever
 * sub-pixel offset the pan left it — so with `image-rendering: pixelated`
 * every image-pixel boundary gained one blended screen pixel. Measured on
 * production at zoom 2.33: 80 % of adjacent pixel pairs differed where pure
 * nearest neighbour gives 43 %. It also halved the pan frame rate on a
 * software GPU (33 ms -> 17 ms median frame without it).
 */
export function displayFilter(
  brightness: number,
  contrast: number
): string | undefined {
  if (brightness === 100 && contrast === 100) return undefined;
  return `brightness(${brightness / 100}) contrast(${contrast / 100})`;
}
