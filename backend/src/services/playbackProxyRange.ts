/**
 * Arithmetic for the 8-bit playback proxy.
 *
 * Kept apart from the service that reads files and spawns Python so the two
 * decisions that can silently corrupt what a scientist sees — how bright a
 * sample ends up, and when 8 bits stop being enough — are pure functions with
 * tests rather than lines buried in an I/O path.
 *
 * See `docs/superpowers/specs/2026-08-21-playback-proxy-design.md`.
 */

/** Levels an 8-bit proxy can represent. */
export const PROXY_LEVELS = 256;

/**
 * Fewest proxy levels a window may span before the proxy stops being good
 * enough to draw. Below roughly this many, quantisation shows as banding on
 * smooth gradients; above it, proxy and original are indistinguishable.
 */
export const MIN_LEVELS_IN_WINDOW = 32;

/**
 * The value that maps to 255, for a whole channel.
 *
 * MUST be derived per container and channel, never per frame: a per-frame range
 * would rescale every frame to its own brightest pixel, so a passing bright
 * object would darken the whole series and playback would flicker. That would
 * be a worse defect than the stutter this feature exists to remove.
 *
 * Rounded up to a power of two so the value is stable under resampling: taking
 * the maxima of three frames rather than all three hundred is only safe if a
 * slightly brighter frame elsewhere still lands inside the range. A frame that
 * exceeds it anyway is served at full depth rather than clipped — see
 * `make_playback_proxy.py`, which reports such frames instead of writing them.
 */
export function deriveRangeMax(maxima: readonly number[]): number {
  if (maxima.length === 0) {
    throw new Error('deriveRangeMax: no maxima to derive a range from');
  }
  for (const m of maxima) {
    if (!Number.isFinite(m)) {
      throw new Error('deriveRangeMax: maxima must be finite');
    }
  }
  const peak = Math.max(...maxima);
  // Never below 8 bits: a narrower range would map distinct samples onto the
  // same proxy level for no gain, since the proxy has 256 levels regardless.
  let bits = 8;
  while ((1 << bits) - 1 < peak && bits < 16) bits++;
  return Math.min((1 << bits) - 1, 65535);
}

/**
 * Whether the displayed frame must come from the original 16-bit PNG.
 *
 * The proxy spreads `rangeMax` over 256 levels. A window narrower than a
 * thirty-second of the range therefore contains fewer than 32 of them, and the
 * faint structure the user narrowed the window to see would be quantised into
 * bands — exactly the detail a microtubule measurement is looking for.
 *
 * Deliberately conservative at the edges: a zero-width window and a missing
 * range both answer "use the original", because neither can be reasoned about.
 */
export function windowNeedsFullDepth(
  windowMin: number,
  windowMax: number,
  rangeMax: number
): boolean {
  if (!Number.isFinite(rangeMax) || rangeMax <= 0) return true;
  if (!Number.isFinite(windowMin) || !Number.isFinite(windowMax)) return true;
  // An inverted window means the same span; the display code swaps it too.
  const lo = Math.min(windowMin, windowMax);
  const hi = Math.max(windowMin, windowMax);
  const width = hi - lo;
  if (width <= 0) return true;
  const levelsInWindow = (width / rangeMax) * PROXY_LEVELS;
  return levelsInWindow < MIN_LEVELS_IN_WINDOW;
}
