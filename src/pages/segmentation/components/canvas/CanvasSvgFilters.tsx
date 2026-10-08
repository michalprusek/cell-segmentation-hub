import React from 'react';

interface CanvasSvgFiltersProps {
  /** Current zoom. A blur radius here is in SVG user units, which the
   *  transform container multiplies by the zoom on screen. */
  zoom: number;
}

/** Blur radii in SCREEN pixels: the old user-unit `stdDeviation`s as they
 *  looked at zoom 1. Left fixed, the soma highlight was a 40 px blur at
 *  zoom 10 — spread so thin that it faded exactly when the user had zoomed in
 *  to look at the cell — and the hover glow a 15 px one. */
const SOMA_HIGHLIGHT_BLUR_PX = 4;
const HOVER_GLOW_BLUR_PX = 1.5;

/**
 * The `<defs>` block holding every SVG filter the canvas references.
 *
 * Two filters. `blue-glow` has exactly one job: the glow on a HOVERED,
 * unselected polyline. Anything selected carries `.polygon-selected`, whose
 * CSS `drop-shadow` beats a `filter` presentation attribute — so on a
 * selected shape a `url(#…)` attribute here paints nothing. That is why
 * `red-glow` was deleted: it was only ever emitted for selected closed
 * polygons, i.e. only ever in the case CSS overrides.
 *
 * Their blur radii are the two sizes on the canvas that follow the zoom
 * through a PROP instead of the overlay's custom property (see
 * `utils/overlayScale.ts`): `stdDeviation` is an attribute and cannot read
 * `var()`. This component is a handful of elements, so re-rendering it per
 * zoom step costs nothing — it is one attribute write per filter, where the
 * shapes that reference them do not re-render at all.
 *
 * Do NOT turn `blue-glow` into a CSS `drop-shadow()` class to get it onto the
 * custom property too. It was tried, and measured on WebKit 26.0: a CSS
 * `filter` function on an SVG child element paints NOTHING there (0 of 255
 * at every distance, where Chromium 143 and Firefox 144 paint 31 falling to
 * 4 over 12 px), while `url(#blue-glow)` paints in all three. So the class
 * would have removed the hover glow in Safari. (The same measurement means
 * the SELECTION glow, which is such a class, has never painted in Safari.
 * It stays CSS because its colour is the per-type `--polygon-selected-glow`,
 * which a shared `<filter>` cannot read from the element that references it.)
 *
 * Keep a filter defined for as long as anything names it: a `url(#…)`
 * reference to a missing filter makes the referencing element disappear under
 * SVG 1.1 rather than simply render unfiltered.
 */
const CanvasSvgFilters = ({ zoom }: CanvasSvgFiltersProps) => {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (
    <defs>
      <filter id="blue-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feFlood floodColor="#0EA5E9" floodOpacity="0.3" result="flood" />
        <feComposite
          in="flood"
          in2="SourceGraphic"
          operator="in"
          result="mask"
        />
        <feGaussianBlur
          in="mask"
          stdDeviation={HOVER_GLOW_BLUR_PX / z}
          result="blur"
        />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      {/*
        The soma pointed at from a neurite's "remove from Soma N" menu entry.
        Deliberately NOT `blue-glow`: that one floods a fixed #0EA5E9, and the
        whole point here is that the cell lights up in ITS OWN colour — the
        same one the menu entry's swatch carries, so the eye can join the two
        without reading anything. Blurring the source and stacking it under
        itself keeps the hue, whatever the assignment palette assigned.
        Doubled because one pass is too faint to read as "lit" against a
        microscopy background.

        CanvasPolygon applies it as an inline STYLE, which beats
        `.polygon-selected`'s class rule, so it paints on a selected soma too.
      */}
      <filter id="soma-highlight" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur
          in="SourceGraphic"
          stdDeviation={SOMA_HIGHLIGHT_BLUR_PX / z}
          result="halo"
        />
        <feMerge>
          <feMergeNode in="halo" />
          <feMergeNode in="halo" />
          <feMergeNode in="halo" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
};

export default CanvasSvgFilters;
