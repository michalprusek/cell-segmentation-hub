/**
 * The window/level tone curve, in one place.
 *
 * WHY IT LIVES HERE. This arithmetic is implemented three times over: as this
 * lookup table for the CPU composite, as GLSL in webglCompositor, and as
 * `evaluateChannelSample` — the JavaScript mirror the shader is diffed against.
 * The two composite paths must produce the same image, so the table has to be
 * importable by both the component that runs it and the test that checks the
 * shader against it. A copy pasted into the test could not do that job: edit
 * this function and the copy stays green while the GPU and CPU paths silently
 * drift apart, which is the one failure the whole exercise exists to prevent.
 */

/** Largest index buildLut() will ever produce (the table caps at 65536 entries).
 *  webglCompositor clamps sample values to this same bound in the shader. */
export const MAX_LUT_INDEX = 65535;

/** Window/level LUT over the sample domain [0, rangeMax] → 8-bit display.
 *  Sized to ONE channel's brightest value — the caller builds a table per
 *  channel, because channels are windowed independently — so a 16-bit channel
 *  gets up to a 65536-entry table. Values ≤ windowMin map to black,
 *  ≥ windowMax to white; an inverted window is swapped, and a zero-width one
 *  divides by 1 rather than by 0. */
export function buildLut(
  windowMin: number,
  windowMax: number,
  rangeMax: number
): Uint8ClampedArray {
  const size = Math.min(MAX_LUT_INDEX, Math.max(1, Math.round(rangeMax))) + 1;
  const lut = new Uint8ClampedArray(size);
  const lo = Math.min(windowMin, windowMax);
  const hi = Math.max(windowMin, windowMax);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < size; i++) {
    if (i <= lo) lut[i] = 0;
    else if (i >= hi) lut[i] = 255;
    else lut[i] = Math.round(((i - lo) * 255) / range);
  }
  return lut;
}
