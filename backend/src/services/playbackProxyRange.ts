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
