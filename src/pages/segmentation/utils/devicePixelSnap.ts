/**
 * Snap a rendered translate to a whole number of DEVICE pixels.
 *
 * A transformed layer parked between device pixels is resampled bilinearly
 * by the compositor — every stroke edge and every image-pixel boundary gets
 * a blended pixel. Measured on production (Chrome 152, RTX A5000, a 16-bit
 * still), stroke 10-90 % edge width in device px, where 0.78 is the
 * box-filter limit of a 45-degree edge, i.e. as sharp as a stroke can be:
 *
 *   device scale       | zoom 2.35    | zoom 4.06    | zoom 10
 *   1                  | 1.29 -> 0.78 | 1.36 -> 0.79 | 1.55 -> 0.79
 *   1.25 (real, 125 %) | 1.34 -> 0.79 | 1.55 -> 0.79 | 1.16 -> 0.93
 *   1.5  (real, 150 %) | 1.41 -> 0.80 | 1.45 -> 0.77 | 1.14 -> 0.89
 *   2                  | 1.40 -> 0.81 | 1.50 -> 0.77 | 1.14 -> 0.78
 *
 * (production transforms are arbitrary floats, e.g.
 * `translate3d(-7263.43px, -2665.43px, 0px)`.)
 *
 * ONLY the translate — not "container origin + translate", which is how this
 * file started and is measurably wrong. The content's untransformed origin
 * is the centre of its container, a half CSS pixel whenever the container's
 * width or height is odd, and the obvious thing is to add that half to what
 * gets rounded. But Chrome rounds a transformed box's own position to a
 * whole pixel by itself; compensating for it puts the content exactly
 * BETWEEN two pixels. On a 1229 x 827 container at DPR 1 the "origin-aware"
 * snap measured 1.50 at every zoom — worse than not snapping at all — and
 * sweeping the fractional part of the translate showed the sharp position
 * was the whole number (0.79). With a real 1.5 device scale factor
 * (`--force-device-scale-factor`), moving the box's layout origin through
 * 0 .. 1.25 device px in quarter steps changed nothing (0.86 - 0.89 at all
 * six).
 *
 * One case this cannot make sharp, and nothing should try: a FRACTIONAL
 * device pixel ratio set through DevTools / Playwright emulation
 * (`deviceScaleFactor: 1.5`). There Chrome rounds the box position to a CSS
 * pixel instead of a device pixel, so sharpness depends on whether the
 * container centre is even or odd: 0.77 in a 1600 x 1000 viewport, 1.56 in a
 * 1602 x 1002 one. It is an artefact of the emulation — a real 150 % display
 * (`--force-device-scale-factor=1.5`) is sharp at every window size tried —
 * so do not "fix" a blurry emulated screenshot here.
 *
 * Render-only. The stored transform must stay unsnapped: a slow pan arrives
 * as sub-pixel deltas and rounding the state would discard them, and
 * hit-testing (`src/lib/coordinateUtils.ts`) reads the state — the drawn and
 * the logical position then differ by at most half a device pixel.
 */
export function snapToDevicePixel(
  value: number,
  devicePixelRatio: number
): number {
  if (!Number.isFinite(value)) return value;
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const snapped = Math.round(value * dpr) / dpr;
  // -0 would serialise as `-0px`: harmless, but two renders of the same
  // position would then differ as strings.
  return snapped === 0 ? 0 : snapped;
}
