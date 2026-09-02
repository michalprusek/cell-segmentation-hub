/**
 * The stroke colour of one preview outline.
 *
 * WHY THE COLOUR IS NOT IN THE DATA. The generated `*.geom.json` files store a
 * polygon's IDENTITY — is it a polyline, which part class, which track, is it
 * cut by the border — and this module turns that into the colour the canvas
 * would draw, using the canvas's own modules (`neuronClassStyle`,
 * `colorFromInstanceId`). Baking hex strings at generation time was the
 * obvious alternative and is worse: the tiles would keep the palette of
 * whatever day they were generated, and an editor recolour would silently
 * leave the pickers showing the old one.
 *
 * The rule mirrors `CanvasPolygon`'s `pathColor` in its unselected branch —
 * a preview tile has no selection — and `__tests__/specimenPreviews.test.ts`
 * pins the two together.
 */

import type { PolygonPartClass, SpermPartClass } from '@/lib/segmentation';
import { colorFromInstanceId } from '@/pages/segmentation/utils/instanceColors';
import { neuronClassStyle } from '@/pages/segmentation/utils/neuronClassStyle';

/** One outline of a preview tile, as stored in `<id>.geom.json`.
 *
 *  The keys are single letters because the whole set is ~127 kB of geometry
 *  fetched over the wire; the field names would otherwise be a third of it. */
export interface SpecimenOutline {
  /** SVG path in the tile's 1000x1000 viewBox. Closed (`Z`) for polygons. */
  readonly d: string;
  /** `'i'` for an internal contour (a hole). Absent means external. */
  readonly t?: 'i';
  /** The polygon's `partClass`. Typed against the editor's own SSOT rather
   *  than left as a `string`, so a model that ships a SEVENTH class fails to
   *  compile here instead of silently drawing it in external-contour red. */
  readonly c?: PolygonPartClass;
  /** `'l'` for an open polyline. Absent means a closed polygon. */
  readonly g?: 'l';
  /** Colour seed for an unclassed polyline — the polygon's trackId,
   *  instanceId or id, exactly as the canvas picks it. */
  readonly s?: string;
  /** Set when the object is cut off by the image border (`complete: false`). */
  readonly x?: 1;
}

export interface SpecimenGeometry {
  readonly outlines: readonly SpecimenOutline[];
}

/** Border-cut microcapsule: excluded from metrics, and greyed here for the
 *  same reason the canvas greys it. */
const BORDER_CUT = '#969696';
const SPHEROID_CORE = '#22c55e';
const SPERM_PARTS: Record<SpermPartClass, string> = {
  head: '#22c55e',
  midpiece: '#f59e0b',
  tail: '#06b6d4',
};
const INTERNAL_CONTOUR = '#0ea5e9';
const EXTERNAL_CONTOUR = '#ef4444';

/** The colour `CanvasPolygon` would stroke this outline with, unselected. */
export function specimenStroke(outline: SpecimenOutline): string {
  if (outline.x) return BORDER_CUT;

  const isPolyline = outline.g === 'l';
  if (!isPolyline) {
    if (outline.c === 'core') return SPHEROID_CORE;
    const neuron = neuronClassStyle(outline.c);
    if (neuron) return neuron.stroke;
    return outline.t === 'i' ? INTERNAL_CONTOUR : EXTERNAL_CONTOUR;
  }

  const part = outline.c ? SPERM_PARTS[outline.c as SpermPartClass] : undefined;
  if (part) return part;
  // Instance mode: one hue per track. The tiles are rendered outside the
  // editor, so there is no by-label ("semantic") colouring to honour.
  return colorFromInstanceId(outline.s ?? '');
}
