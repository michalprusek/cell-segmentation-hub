import React from 'react';

/**
 * The `<defs>` block holding every SVG filter the canvas references.
 *
 * Two filters. `blue-glow` has exactly one job: the glow on a HOVERED, unselected
 * polyline. Anything selected carries `.polygon-selected`, whose CSS
 * `drop-shadow` beats a `filter` presentation attribute — so on a selected
 * shape a `url(#…)` here paints nothing. That is why `red-glow` was deleted:
 * it was only ever emitted for selected closed polygons, i.e. only ever in
 * the case CSS overrides, so it had never once reached the screen.
 * `point-shadow`, `line-glow` and `point-glow` went earlier for the simpler
 * reason that nothing named them at all.
 *
 * Keep a filter defined for as long as anything names it: a `url(#…)`
 * reference to a missing filter makes the referencing element disappear under
 * SVG 1.1 rather than simply render unfiltered.
 */
const CanvasSvgFilters = () => {
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
        <feGaussianBlur in="mask" stdDeviation="1.5" result="blur" />
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

        Like every filter attribute here it is inert on a SELECTED shape,
        where `.polygon-selected`'s CSS drop-shadow wins — which costs nothing,
        because a selected soma is already glowing.
      */}
      <filter id="soma-highlight" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="halo" />
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
