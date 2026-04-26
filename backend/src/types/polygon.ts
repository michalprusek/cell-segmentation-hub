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
 * - `partClass`. Visualization renders BOTH sperm sub-parts and the
 *   spheroid 'core' annotation, so its `partClass` is `PolygonPartClass`
 *   (4 values). Exports never carry the 'core' value, so format
 *   converters use `SpermPartClass` (3 values). The two services
 *   intentionally differ on this one field — combining them would
 *   either widen the export contract incorrectly or lose 'core'
 *   annotations from rendered visualizations.
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
}
