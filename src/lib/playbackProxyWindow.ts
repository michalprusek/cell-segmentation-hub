/**
 * When the 8-bit playback proxy stops being good enough to draw, and how to
 * express the window against it.
 *
 * Lives on the client because the client is what decides: the backend serves
 * whichever representation it is asked for and has no opinion about the user's
 * window. Keeping the decision here means there is one copy of it, not a
 * frontend and a backend copy that can drift.
 *
 * See `docs/superpowers/specs/2026-08-21-playback-proxy-design.md`.
 */

/** Levels an 8-bit proxy can represent. */
export const PROXY_LEVELS = 256;

/**
 * Fewest proxy levels a window may span before the proxy stops being good
 * enough. Below roughly this many, quantisation shows as banding on smooth
 * gradients; above it, proxy and original are indistinguishable.
 */
export const MIN_LEVELS_IN_WINDOW = 32;

/**
 * Whether the displayed frame must come from the original 16-bit PNG.
 *
 * The proxy spreads `rangeMax` over 256 levels. A window narrower than a
 * thirty-second of the range therefore contains fewer than 32 of them, and the
 * faint structure the user narrowed the window to SEE would be quantised into
 * bands — exactly the detail a microtubule measurement is looking for.
 *
 * Deliberately conservative at the edges: a zero-width window and a missing
 * range both answer "use the original", because neither can be reasoned about.
 */
export function windowNeedsFullDepth(
  windowMin: number,
  windowMax: number,
  rangeMax: number | null
): boolean {
  if (rangeMax === null) return true;
  if (!Number.isFinite(rangeMax) || rangeMax <= 0) return true;
  if (!Number.isFinite(windowMin) || !Number.isFinite(windowMax)) return true;
  // An inverted window means the same span; the display code swaps it too.
  const lo = Math.min(windowMin, windowMax);
  const hi = Math.max(windowMin, windowMax);
  const width = hi - lo;
  if (width <= 0) return true;
  return (width / rangeMax) * PROXY_LEVELS < MIN_LEVELS_IN_WINDOW;
}
