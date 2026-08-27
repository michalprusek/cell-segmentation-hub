/**
 * Workload-scaled axios timeout for the microtubule export's ML-bound
 * requests (`mt-metrics`, `mt-background-rois`).
 *
 * Production evidence for why a fixed timeout is wrong: a 299-frame,
 * 2-channel, ~2.08-megapixel export took **24m32s** of real ML wall-clock,
 * against a hard-coded 5-minute axios timeout — so the backend gave up and
 * degraded the export to a hollow, geometry-only metrics sheet, and then the
 * ML service's real 200 OK (91,482 rows) landed 12 minutes later into
 * nothing. Any single fixed number is wrong on the next dataset: bigger
 * videos, more channels or higher resolution will always exist.
 *
 * Instead the budget scales with the actual request workload — frames x
 * channels, adjusted for frame resolution relative to the ~2-megapixel
 * reference size that rate was measured on — with a generous headroom
 * multiplier on top, and a floor so a tiny request isn't cut short by
 * request/queueing jitter.
 *
 * This still eventually fails a genuinely hung ML service: the computed
 * timeout is a large but FINITE number for any given workload (see the
 * worst-case note in the PR description), never "no timeout".
 */

/**
 * Measured on production 2026-08-2x: 299 frames x 2 channels x ~2.08 MP took
 * 24m32s (1472 s) of ML wall-clock => 1472 / (299*2*(2.08/2)) ≈ 2.46 s per
 * (frame x channel) unit at the ~2 MP reference size. Rounded up slightly.
 */
export const SECONDS_PER_UNIT_AT_REFERENCE_MP = 2.5;

/** The megapixel size the rate above was measured at. */
export const REFERENCE_MEGAPIXELS = 2;

/**
 * Generous headroom over the measured worst case. Covers (a) a slower
 * frame/channel mix than the one the rate was measured on, and (b) the
 * request still having to wait its turn behind whatever else is queued on
 * the shared per-export ML request gate (see `utils/concurrency.ts`).
 */
export const HEADROOM_MULTIPLIER = 3;

/**
 * Floor: never go below this even for a 1-frame, 1-channel request — at that
 * scale request setup + queueing jitter dominates, not the compute itself.
 */
export const MIN_ML_TIMEOUT_MS = 60_000;

export interface MlWorkload {
  /** Number of frames covered by the request. */
  frames: number;
  /** Number of channels sampled per frame. Pass `1` for a channel-independent
   *  (pure geometry) request such as `mt-background-rois`. */
  channels: number;
  /** Frame width x height in megapixels, when known. Falls back to the
   *  reference size (assume "typical", not "assume tiny") when omitted or
   *  non-finite/non-positive. */
  megapixels?: number | null;
}

/**
 * Compute the axios `timeout` (ms) for one ML-bound export request, scaled to
 * its actual workload with generous headroom. Exported so both
 * `mtMetricsExporter.ts` and `imagejRoiEncoder.ts` (and their tests) share the
 * exact same budget — the whole point is that neither hardcodes its own
 * fixed number again.
 */
export function estimateMlRequestTimeoutMs({
  frames,
  channels,
  megapixels,
}: MlWorkload): number {
  const safeFrames = Number.isFinite(frames) && frames > 0 ? frames : 0;
  const safeChannels =
    Number.isFinite(channels) && channels > 0 ? channels : 1;
  const mp =
    typeof megapixels === 'number' &&
    Number.isFinite(megapixels) &&
    megapixels > 0
      ? megapixels
      : REFERENCE_MEGAPIXELS;

  const units = safeFrames * safeChannels * (mp / REFERENCE_MEGAPIXELS);
  const seconds = units * SECONDS_PER_UNIT_AT_REFERENCE_MP * HEADROOM_MULTIPLIER;
  return Math.max(MIN_ML_TIMEOUT_MS, Math.ceil(seconds * 1000));
}

/**
 * Best-effort megapixel estimate from a list of `{ width, height }` pairs
 * (typically the frames of one video container — all frames of a video share
 * dimensions). Returns `null` when no usable dimensions are present, letting
 * `estimateMlRequestTimeoutMs` fall back to the reference size rather than
 * silently under-budgeting on a size we simply don't know.
 */
export function megapixelsFromFrames(
  frames: ReadonlyArray<{
    width?: number | null;
    height?: number | null;
  }>
): number | null {
  for (const f of frames) {
    if (
      typeof f.width === 'number' &&
      typeof f.height === 'number' &&
      Number.isFinite(f.width) &&
      Number.isFinite(f.height) &&
      f.width > 0 &&
      f.height > 0
    ) {
      return (f.width * f.height) / 1_000_000;
    }
  }
  return null;
}
