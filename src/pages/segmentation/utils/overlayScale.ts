/**
 * Constant ON-SCREEN sizes for everything drawn in the editor's SVG overlay.
 *
 * The overlay lives inside the CSS-scaled transform container, so a size
 * written in SVG user units is multiplied by the zoom on screen
 * (`vector-effect: non-scaling-stroke` does not cancel an ANCESTOR's CSS
 * `scale()`; measured identical with and without). CVAT keeps its shapes at
 * a fixed screen width by rewriting `stroke-width = BASE / scale` on every
 * shape on every zoom event (`cvat-canvas/src/typescript/canvasView.ts`
 * `transformCanvas`, develop @ acdeda7c) — an O(N) attribute loop. Here the
 * same result is ONE style write: two custom properties on the `<svg>`,
 * which every stroke, vertex, hit band and the selection glow read through
 * `calc()`.
 *
 * Why that matters beyond cost: sizes used to be props of the memoised
 * `CanvasPolygon`, whose comparator skipped zoom-only re-renders while the
 * wheel was turning. Strokes and vertex dots were therefore stale for the
 * whole gesture and snapped ~150 ms after it (measured: a selected polyline
 * 7.2 px wide during the gesture, 5.0 px after). A custom property has no
 * such window — the browser restyles in the same frame as the transform.
 *
 * `calc(var(--x) * n)` on `stroke-width`, `r` and `stroke-dasharray` was
 * measured to resolve, and to follow a change of the property, in Chrome 152,
 * Chromium 143, Firefox 144 and WebKit 26.0 (Playwright's build): a 5 px dot
 * is 10 px across and a 12-stroke hit band 24 px wide at zoom 10 in all four.
 *
 * The one thing that does NOT carry over is `drop-shadow()`. Chromium and
 * Firefox resolve the `calc()` in it too; WebKit paints no CSS filter
 * function on an SVG child at all, with or without a variable. So the
 * selection glow (`.polygon-selected`) is absent in Safari, as it always
 * was, and the two glows that are SVG `<filter>`s get their blur from
 * CanvasSvgFilters' `zoom` prop instead — see there.
 */
import type React from 'react';

/** One screen pixel, expressed in SVG user units: `1 / zoom`, as a length. */
export const OVERLAY_PX_VAR = '--overlay-px';
/** The base stroke width in user units. Separate from {@link OVERLAY_PX_VAR}
 *  only because of the zoomed-out taper below. */
export const OVERLAY_STROKE_VAR = '--overlay-stroke';

/**
 * Base stroke width in SCREEN pixels.
 *
 * 2 px from zoom 0.7 up, with no upper break and no floor. The old code
 * dropped to 1.5 px above zoom 4 and then applied a 0.5-user-unit floor that
 * overrode it — an idle polyline measured 2.99 px at zoom 2.35, 2.24 px at
 * 4.06 and 5.02 px at 10.
 *
 * Below 0.7 the old steps are kept exactly (1.2 px, then 0.8 px under 0.5).
 * That is a deliberate deviation from CVAT's single constant: a 2048-px frame
 * fits the canvas at about 0.27, and 2 px strokes over an image minified
 * nearly four times bury the structures they outline. Keeping the steps also
 * means the fit view of every image looks as it did before this change.
 */
export function overlayStrokeBasePx(zoom: number): number {
  if (zoom < 0.5) return 0.8;
  if (zoom < 0.7) return 1.2;
  return 2;
}

/** The two custom properties, for the `style` of the overlay `<svg>`. */
export function overlayScaleStyle(zoom: number): React.CSSProperties {
  // A non-finite or non-positive zoom would emit `Infinitypx`, which
  // invalidates the declaration and collapses every stroke to its initial
  // 1 user unit. The transform itself is clamped upstream; this only keeps a
  // transient bad value from blanking the overlay.
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    [OVERLAY_PX_VAR]: `${1 / z}px`,
    [OVERLAY_STROKE_VAR]: `${overlayStrokeBasePx(z) / z}px`,
  } as React.CSSProperties;
}

/** `n` screen pixels, as a CSS length in user units. The `1px` fallback is
 *  what a component rendered outside the editor's `<svg>` (unit tests,
 *  Storybook-style isolation) resolves to: zoom 1. */
export const screenPx = (n: number): string =>
  `calc(var(${OVERLAY_PX_VAR}, 1px) * ${n})`;

/**
 * Radius of an overlay dot, `px` screen pixels — for the `style` of a
 * `<circle className="overlay-dot">`.
 *
 * Through a custom property and a class (`.overlay-dot` in `src/index.css`)
 * rather than `style.r`: React writes a custom property with `setProperty`,
 * which every browser accepts, but an ordinary one by assigning
 * `style[name]`, which silently does nothing where `r` is not exposed on
 * `CSSStyleDeclaration`. The radius is the one size here for which a miss
 * means an invisible, ungrabbable handle rather than a wrong width.
 */
export const OVERLAY_RADIUS_VAR = '--overlay-r';
/** The class that turns {@link OVERLAY_RADIUS_VAR} into a radius. These
 *  circles carry NO `r` attribute, so one without the class — or with the
 *  class and no matching rule in `src/index.css` — has radius 0: a handle
 *  that is neither drawn nor grabbable. jsdom applies no stylesheet and
 *  cannot see either, which is why `overlayScale.test.ts` reads the CSS. */
export const OVERLAY_DOT_CLASS = 'overlay-dot';
export const dotRadiusStyle = (px: number): React.CSSProperties =>
  ({ [OVERLAY_RADIUS_VAR]: String(px) }) as React.CSSProperties;

/** `multiplier` base stroke widths, as a CSS length in user units. */
export const strokeUnits = (multiplier: number): string =>
  `calc(var(${OVERLAY_STROKE_VAR}, 2px) * ${multiplier})`;

/** Stroke multipliers. Unchanged from before; only the unit they multiply
 *  is now constant on screen. At zoom >= 0.7 that is 2 px, so: closed shape
 *  2 px (2.6 hovered), polyline 3 px (5 hovered), highlighted soma 6 px. */
export const STROKE_MULTIPLIER = {
  polygon: 1,
  polygonHovered: 1.3,
  polyline: 1.5,
  polylineHovered: 2.5,
  somaHighlighted: 3,
} as const;

/**
 * Width of a polyline's invisible hit band, in base stroke widths.
 *
 * 12 is the old multiplier, so the band is what it was at every zoom up to
 * 4: 24 px at zoom 1. What is gone is `Math.max(strokeWidth * 12, 6)` — the
 * 6 was in USER units, so above zoom 4 the band grew with the image and
 * reached 60 px at zoom 10, where neighbouring microtubules' bands overlap
 * and the topmost one swallows every click near either.
 */
export const POLYLINE_HIT_BAND_MULTIPLIER = 12;

/** Dash length, screen px, of the stripes that mark a neurite shared by
 *  several somas (CanvasPolygon). Each soma's colour gets one dash per cycle. */
export const SOMA_STRIPE_DASH_PX = 10;

/** Vertex handle, screen px. 5 and 1.2 are the old values AT ZOOM 1; the old
 *  `5 / zoom^0.85` let the dot grow from 12 px across at zoom 2.3 to 17 px at
 *  zoom 10, covering the very pixels being edited. */
export const VERTEX_RADIUS_PX = 5;
export const VERTEX_STROKE_PX = 1.2;
export const VERTEX_HOVER_SCALE = 1.3;
export const VERTEX_DRAG_SCALE = 1.1;
export const VERTEX_START_SCALE = 1.2;

/** Radius of one vertex handle in screen px, for its interaction state. */
export function vertexRadiusPx(
  isHovered = false,
  isDragging = false,
  isStartPoint = false
): number {
  let r = VERTEX_RADIUS_PX;
  if (isHovered) r *= VERTEX_HOVER_SCALE;
  if (isDragging) r *= VERTEX_DRAG_SCALE;
  if (isStartPoint) r *= VERTEX_START_SCALE;
  // Rounded so the emitted `calc()` is a stable string for one state — a
  // float tail would change the style text without changing a pixel.
  return Math.round(r * 1000) / 1000;
}
