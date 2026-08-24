/**
 * When the 8-bit playback proxy stops being good enough to draw.
 *
 * Lives on the client because the client is what decides: the backend serves
 * whichever representation it is asked for and has no opinion about the user's
 * window.
 *
 * See `docs/superpowers/specs/2026-08-21-playback-proxy-design.md`.
 */

/** Levels an 8-bit proxy can represent. */
export const PROXY_LEVELS = 256;

/**
 * Fewest proxy levels a window may span before the proxy stops being good
 * enough. Below roughly this many, quantisation shows as banding on smooth
 * gradients; above it, proxy and original are indistinguishable.
 *
 * Note what this means arithmetically: the fallback fires when the window is
 * narrower than `32/256` — an EIGHTH — of the range it is measured against.
 * That is a wide net, which is why measuring against the RIGHT range matters
 * as much as the threshold does (see `windowNeedsFullDepth`).
 */
export const MIN_LEVELS_IN_WINDOW = 32;

/**
 * What each channel's proxies are actually encoded against, learned from the
 * `X-Proxy-Range` of frames already fetched.
 *
 * WHY THIS EXISTS. The container-wide `proxyRangeMax` is one number covering
 * the brightest channel, and judging every channel by it switched the feature
 * off in its main use case. On the measured container that figure is 32767, so
 * the fallback fired for any window narrower than 4096 counts — and the dim
 * 640 nm channel's data never exceeds 1177, so bringing up its faint filaments,
 * which is the normal working state for this tool, dropped playback back to
 * full-depth PNGs. That channel's frames are encoded at range 1023, where a
 * 1177-wide window holds ~294 levels: nowhere near banding.
 *
 * So the guard uses the real per-channel range wherever one has been seen, and
 * the container figure only until then.
 */
const observed = new Map<string, number>();

/** Record the range a fetched frame of this channel was encoded against. */
export function noteProxyRange(channel: string, rangeMax: number): void {
  if (!Number.isFinite(rangeMax) || rangeMax <= 0) return;
  const previous = observed.get(channel) ?? 0;
  // The widest seen, because that is the channel's coarsest quantisation and
  // the guard has to be right about its worst frame, not its average one.
  if (rangeMax > previous) observed.set(channel, rangeMax);
}

/** Forget what was learned — leaving the editor, and the test seam. */
export function clearProxyRanges(): void {
  observed.clear();
}

/** What the registry currently holds. Exposed for assertions and debugging. */
export function observedProxyRanges(): Readonly<Record<string, number>> {
  return Object.fromEntries(observed);
}

/**
 * Whether the displayed frame must come from the original 16-bit PNG.
 *
 * A proxy spreads its frame's range over 256 levels. A window holding fewer
 * than `MIN_LEVELS_IN_WINDOW` of them would quantise the faint structure the
 * user narrowed the window to SEE into bands — exactly the detail a microtubule
 * measurement is looking for.
 *
 * Judged against the widest range among the channels named in `channels`. Since
 * windows are per channel now, production always names exactly one (or none, for
 * an image with no channel set); the reduction stays because the answer for a
 * SET still has to be its coarsest member — that is what
 * {@link anyWindowNeedsFullDepth} composes. Only used once every named channel's
 * real range is known; until then the container figure stands in, which errs
 * toward full depth.
 *
 * Deliberately conservative at the edges: a zero-width window, and a container
 * with no range at all, both answer "use the original", because neither can be
 * reasoned about.
 */
export function windowNeedsFullDepth(
  windowMin: number,
  windowMax: number,
  containerRangeMax: number | null,
  visibleChannels: readonly string[] = []
): boolean {
  const known = visibleChannels
    .map(c => observed.get(c))
    .filter((r): r is number => typeof r === 'number');
  const rangeMax =
    visibleChannels.length > 0 && known.length === visibleChannels.length
      ? Math.max(...known)
      : containerRangeMax;

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

/**
 * Whether ANY visible channel's own window forces the original 16-bit PNG.
 *
 * One frame carries every channel, so the strictest channel decides: if the
 * user has narrowed the IRM window to bring up faint filaments, the frame must
 * arrive at full depth even though the fluorescence channels are still wide
 * open. Each channel is judged against ITS OWN window and ITS OWN range.
 *
 * WHICH range, and why it matters. `observed` is the truth once a proxy has
 * been fetched, because a proxy's encode range can sit BELOW the channel's data
 * max and that is what quantises. But `observed` is filled ONLY from the
 * `X-Proxy-Range` header, which arrives only on a response to a `repr=proxy`
 * request — which this gate has to allow first. So on a cold registry the
 * fallback has to be something a dim channel can actually pass, or the loop
 * never closes. The container-wide figure is not: it is the BRIGHTEST channel's
 * number, and judged against it any channel dimmer than an eighth of the
 * container can never clear MIN_LEVELS_IN_WINDOW, no matter what the user does
 * — the slider ceiling is that channel's own rangeMax. So the channel's own
 * range is the fallback. (`rangeMax` is optional in the signature for tests
 * only; a real `ChannelWindow` always carries one, and a channel that has
 * reported nothing has no entry and is caught above.) The backend hits the same
 * failure one granularity up — its container-wide `proxyRangeMax` bootstraps
 * off the same request — and describes it in playbackProxyService.ts.
 *
 * With no visible channels there is nothing per-channel to judge, so the
 * caller's fallback window — the one kept for images with no channel set — is
 * measured against the container figure instead.
 */
export function anyWindowNeedsFullDepth(
  windows: Readonly<
    Partial<Record<string, { min: number; max: number; rangeMax?: number }>>
  >,
  containerRangeMax: number | null,
  visibleChannels: readonly string[],
  fallbackWindow: { min: number; max: number }
): boolean {
  if (visibleChannels.length === 0) {
    return windowNeedsFullDepth(
      fallbackWindow.min,
      fallbackWindow.max,
      containerRangeMax
    );
  }
  return visibleChannels.some(channel => {
    const win = windows[channel];
    // A channel whose window has not been reported yet cannot be reasoned
    // about; err toward the original, as every other edge case here does.
    if (!win) return true;
    return windowNeedsFullDepth(
      win.min,
      win.max,
      win.rangeMax ?? containerRangeMax,
      [channel]
    );
  });
}
