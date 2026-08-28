import React from 'react';

/**
 * The `<defs>` block holding every SVG filter the canvas references.
 *
 * Only the two glow filters are here. `point-shadow`, `line-glow` and
 * `point-glow` were defined alongside them but no element in the tree ever
 * carried a `filter` attribute naming one — `CanvasPolygon`'s `pathFilter` is
 * the single `filter=` in `src/`, and it only ever emits `''`,
 * `url(#blue-glow)` or `url(#red-glow)`.
 *
 * Keep a filter defined for as long as anything names it: a `url(#…)`
 * reference to a missing filter makes the referencing element disappear under
 * SVG 1.1 rather than simply render unfiltered.
 */
const CanvasSvgFilters = () => {
  return (
    <defs>
      <filter id="red-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feFlood floodColor="#ea384c" floodOpacity="0.3" result="flood" />
        <feComposite
          in="flood"
          in2="SourceGraphic"
          operator="in"
          result="mask"
        />
        <feGaussianBlur in="mask" stdDeviation="1.5" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

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
