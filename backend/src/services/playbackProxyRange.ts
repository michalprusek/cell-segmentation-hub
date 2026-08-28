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
 * The brightest value the CONTAINER holds, rounded up to a power of two.
 *
 * NOT the range a proxy is encoded against. Each frame is mapped onto its own
 * maximum by `make_playback_proxy.py`, which names the result
 * `<channel>.p<range>.webp` and lets the client multiply it back out — see the
 * revision note in the design doc for why per-frame won and why it does not
 * make brightness flicker.
 *
 * What this figure IS for: the client's `windowNeedsFullDepth`, which has to
 * decide whether the user's window is narrow enough that 256 levels would band.
 * That judgement needs one number for the whole container, and taking the
 * largest is the conservative direction — it can ask for full depth where a
 * dimmer channel's own proxy would have been fine, never the reverse.
 *
 * Rounded up to a power of two so sampling three frames instead of three
 * hundred is safe: a slightly brighter frame elsewhere still lands inside it.
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
  while ((1 << bits) - 1 < peak && bits < 16) {
    bits++;
  }
  return Math.min((1 << bits) - 1, 65535);
}
