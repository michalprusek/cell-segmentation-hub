import React from 'react';

/**
 * The `<defs>` block holding every SVG filter the canvas references.
 *
 * One filter, and it has exactly one job: the glow on a HOVERED, unselected
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
    </defs>
  );
};

export default CanvasSvgFilters;
