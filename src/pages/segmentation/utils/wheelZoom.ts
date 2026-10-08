/**
 * Wheel -> zoom factor, and the per-frame accumulator that applies it.
 *
 * The step is exponential in the wheel delta, as in CVAT
 * (`cvat-canvas/src/typescript/canvasModel.ts` `zoom()`:
 * `(6 / 5) ** (-deltaY / 10)` with `deltaY` clamped to +-8) and d3-zoom
 * (`defaultWheelDelta`: `2 ** (-deltaY * 0.002)`, x10 under ctrlKey). The old
 * handler used only the SIGN of `deltaY`, so a trackpad — which sends dozens
 * of small deltas per gesture — zoomed a full 1.2x per animation frame.
 *
 * The constants deviate from CVAT's on purpose. CVAT clamps at 8 and divides
 * by 10, which makes a mouse notch (deltaY = 100 in Chrome, clamped to 8)
 * 1.2^0.8 = 1.157x. This editor documents 1.2x per notch and its shortcuts
 * and toolbar buttons use the same factor, so here the clamp IS one notch:
 * `ZOOM_FACTOR ** (-delta / 100)`, with `delta` clamped to +-100.
 */

/** One mouse-wheel notch in CSS pixels: what Chrome reports on Windows and
 *  Linux. The per-event clamp, and the delta that yields exactly one
 *  `ZOOM_FACTOR`. */
export const WHEEL_NOTCH_PX = 100;

/** Firefox reports a mouse notch as 3 LINES (`deltaMode === 1`), so a line
 *  is a third of a notch. */
const LINE_PX = WHEEL_NOTCH_PX / 3;
/** `deltaMode === 2`. Any page-sized delta is clamped to one notch anyway. */
const PAGE_PX = 800;
/** A trackpad pinch arrives as wheel events with `ctrlKey` set and deltas
 *  about a tenth of a scroll's; x10 is d3-zoom's factor for them. */
const PINCH_GAIN = 10;

export interface WheelLike {
  deltaY: number;
  deltaMode: number;
  ctrlKey?: boolean;
}

/** The wheel delta in pixels, clamped to one notch either way. */
export function normalizedWheelDelta(e: WheelLike): number {
  // deltaMode is read BEFORE deltaY on purpose: Firefox switches a
  // line-mode event to pixel values if the page reads a delta first.
  const mode = e.deltaMode;
  let delta = e.deltaY;
  if (!Number.isFinite(delta)) return 0;
  if (mode === 1) delta *= LINE_PX;
  else if (mode === 2) delta *= PAGE_PX;
  if (e.ctrlKey) delta *= PINCH_GAIN;
  return Math.max(-WHEEL_NOTCH_PX, Math.min(WHEEL_NOTCH_PX, delta));
}

/** Zoom multiplier for one wheel event. Scrolling up (negative delta) zooms
 *  in; a full notch is exactly `zoomFactorPerNotch`. */
export function wheelZoomFactor(
  e: WheelLike,
  zoomFactorPerNotch: number
): number {
  return zoomFactorPerNotch ** (-normalizedWheelDelta(e) / WHEEL_NOTCH_PX);
}

export interface WheelZoomAccumulator<P> {
  /** Fold one wheel event in; schedules a frame if none is pending. */
  push: (factor: number, anchor: P) => void;
  cancel: () => void;
}

/**
 * Applies wheel zoom once per animation frame, with EVERY event of that frame
 * in it.
 *
 * The old path went through `rafThrottle`, which kept only the last event of
 * a frame: two notches inside 16 ms zoomed 1.2x instead of 1.44x, so a fast
 * spin of the wheel felt slower than a slow one. Here the factors multiply
 * and the newest cursor position is the anchor.
 *
 * There is deliberately no minimum interval. `rafThrottle`'s 16 ms gate
 * dropped the callback whenever a frame arrived sooner than that — every
 * frame on a 120 Hz display — and, because it then cleared its handle without
 * rescheduling, the final event of a gesture was never applied at all.
 */
export function createWheelZoomAccumulator<P>(
  apply: (factor: number, anchor: P) => void,
  schedule: (cb: () => void) => number = cb => requestAnimationFrame(cb),
  unschedule: (id: number) => void = id => cancelAnimationFrame(id)
): WheelZoomAccumulator<P> {
  let pendingFactor = 1;
  let pendingAnchor: P | null = null;
  let frameId: number | null = null;

  const flush = () => {
    frameId = null;
    const factor = pendingFactor;
    const anchor = pendingAnchor;
    pendingFactor = 1;
    pendingAnchor = null;
    if (anchor !== null && factor !== 1) apply(factor, anchor);
  };

  return {
    push(factor, anchor) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      pendingFactor *= factor;
      pendingAnchor = anchor;
      if (frameId === null) frameId = schedule(flush);
    },
    cancel() {
      if (frameId !== null) unschedule(frameId);
      frameId = null;
      pendingFactor = 1;
      pendingAnchor = null;
    },
  };
}
