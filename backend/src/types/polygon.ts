/**
 * Shared polygon type building blocks for backend services.
 *
 * Background: before this file existed, the same 5 fields (points, type,
 * id?, geometry?, instanceId?) were redeclared verbatim in three service
 * files (visualizationGenerator, formatConverter, metricsCalculator).
 * Each redeclaration was a chance for the shape to drift; if a new field
 * (e.g. `confidence`) needed to flow through render → export, four files
 * had to be edited in lockstep.
 *
 * What IS NOT shared here:
 * - `partClass`. Both visualization and export now type it as the full
 *   `PolygonPartClass` (sperm sub-parts, spheroid 'core', neurite/soma),
 *   because the neuron model tags CLOSED polygons and those DO reach the
 *   export. They stay separate declarations only because each service adds
 *   its own extra fields; narrowing either to `SpermPartClass` would drop
 *   a class that is now on the wire. Sperm-only behaviour is enforced by
 *   `isValidSpermPartClass` at each polyline use site, not by the type.
 * - `polygonValidation.Polygon`. That type represents the wire-format
 *   payload (snake_case `parent_id`, optional `type`, plus
 *   color/category/confidence) and serves a different purpose
 *   (parsing/validation). Leaving it separate keeps the two domains
 *   distinct.
 *
 * What IS shared:
 * - `MinimalPolygon` — points + type. The metrics layer only needs
 *   these; broader downstream metadata is irrelevant to area/perimeter
 *   math.
 * - `BasePolygon` — extends Minimal with the 3 optional render-side
 *   fields (id, geometry, instanceId). Both visualization and export
 *   polygons extend this; they each add only their `partClass` flavor.
 */

export interface PolygonPoint {
  x: number;
  y: number;
}

/** Smallest polygon shape — just the geometry needed for area/perimeter
 *  calculations. Used by the metrics layer where richer metadata isn't
 *  relevant. */
export interface MinimalPolygon {
  points: PolygonPoint[];
  type: 'external' | 'internal';
}

/** Render/export-ready polygon with optional identity and geometry
 *  variant. Service-specific `partClass` flavors are added by extending
 *  this interface. */
export interface BasePolygon extends MinimalPolygon {
  id?: string;
  geometry?: 'polygon' | 'polyline';
  instanceId?: string;
  /** Stable cross-frame identifier for microtubule polylines, written by
   *  the tracker after Hungarian matching. Editor state (hide / select)
   *  and BE cross-frame propagation both key on this. */
  trackId?: string;
  /** Human-friendly label set in the editor; mirrored across sibling
   *  frames during cross-frame save propagation. */
  name?: string;
  /** Per-instance detection score (0..1), written by instance models
   *  (microcapsule YOLO). Carried through render → export. */
  confidence?: number;
  /** Microcapsule completeness flag: `false` when the capsule's mask is cut
   *  off by the image border. Incomplete capsules are drawn grey and EXCLUDED
   *  from metrics + the metrics export. Absent for non-microcapsule polygons. */
  complete?: boolean;
}
