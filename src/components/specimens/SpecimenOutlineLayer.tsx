/**
 * The segmentation drawn over a specimen frame, as vectors.
 *
 * Shared by the landing showcase and the picker hover cards so both draw the
 * outlines the same way. It renders nothing but the SVG: the draw-on animation
 * belongs to the landing page (which owns its keyframes) and arrives through
 * `className`, and a 150 px hover tile deliberately does not animate — three of
 * them stroking themselves on every pointer move would be noise, not
 * information.
 *
 * `vectorEffect="non-scaling-stroke"` keeps `strokeWidth` in screen pixels, so
 * the same geometry reads at a 720 px hero and a 150 px thumbnail.
 */

import React from 'react';

export interface SpecimenOutlinePath {
  /** SVG path in the tile's 1000x1000 viewBox. */
  readonly d: string;
  readonly stroke: string;
}

interface SpecimenOutlineLayerProps {
  outlines: readonly SpecimenOutlinePath[];
  /** Stroke width in screen pixels (see non-scaling-stroke above). */
  strokeWidth: number;
  className?: string;
  /** Per-path inline styles, used by the landing page to stagger its draw-on. */
  pathStyle?: (index: number) => React.CSSProperties | undefined;
}

function SpecimenOutlineLayer({
  outlines,
  strokeWidth,
  className,
  pathStyle,
}: SpecimenOutlineLayerProps) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {outlines.map((outline, index) => (
          <path
            key={index}
            d={outline.d}
            stroke={outline.stroke}
            strokeWidth={strokeWidth}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            style={pathStyle?.(index)}
          />
        ))}
      </g>
    </svg>
  );
}

export default SpecimenOutlineLayer;
