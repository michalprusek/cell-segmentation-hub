// Shared segmentation geometry types and helpers.
//
// This file once also carried `applyThresholding`, `findContours` and
// `segmentImage` — a client-side thresholder plus two stubs returning empty
// results. Nothing called them, and they misdescribed the architecture:
// segmentation runs in the Python ML service, never in the browser.

export interface Point {
  x: number;
  y: number;
}

export const SPERM_PART_CLASSES = ['head', 'midpiece', 'tail'] as const;
export type SpermPartClass = (typeof SPERM_PART_CLASSES)[number];

export const isValidSpermPartClass = (
  value: unknown
): value is SpermPartClass =>
  typeof value === 'string' &&
  (SPERM_PART_CLASSES as readonly string[]).includes(value);

/**
 * Semantic classes emitted by the two-class neurite/soma model. Mirrors the
 * backend SSOT in `backend/src/utils/polygonValidation.ts`.
 *
 * Unlike the sperm parts above — polylines that together make up ONE instance
 * — these tag whole CLOSED polygons, each an independent object of its class.
 * They are the only thing distinguishing a process from a cell body once the
 * mask has been contoured.
 *
 * Declared as its own group rather than folded into a flat list so that
 * `SPERM_PART_CLASSES` / `isValidSpermPartClass` stay exactly three values:
 * they gate sperm-only paths (COCO polyline export, instance grouping,
 * the head/midpiece/tail context menu) that must NOT accept a neuron class.
 */
export const NEURON_PART_CLASSES = ['neurite', 'soma'] as const;
export type NeuronPartClass = (typeof NEURON_PART_CLASSES)[number];

export const isValidNeuronPartClass = (
  value: unknown
): value is NeuronPartClass =>
  typeof value === 'string' &&
  (NEURON_PART_CLASSES as readonly string[]).includes(value);

// Wider class union covering sperm parts, the spheroid 'core' (dense central
// region detected by the disintegration model) and the neuron classes.
export const POLYGON_PART_CLASSES = [
  ...SPERM_PART_CLASSES,
  'core',
  ...NEURON_PART_CLASSES,
] as const;
export type PolygonPartClass = (typeof POLYGON_PART_CLASSES)[number];

export interface Polygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal'; // Changed from optional to required
  class?: string;
  name?: string;
  confidence?: number;
  area?: number;
  parent_id?: string;
  geometry?: 'polygon' | 'polyline'; // absent = 'polygon' (backward compat with rows stored before sperm model)
  partClass?: PolygonPartClass;
  instanceId?: string;
  /** Microcapsule completeness flag written by the instance model: `false`
   *  when the capsule's mask is cut off by the image border. Such capsules are
   *  drawn grey in the editor and excluded from metrics. Absent for other
   *  project types. */
  complete?: boolean;
  /** Cross-frame microtubule track ID; populated by the tracker after a
   *  video container's batch finishes segmentation. Equal across frames
   *  for sibling polylines representing the same MT over time. */
  trackId?: string;
  /** LEGACY. Base64-encoded float16 (M × 32) embedding sampled at each
   *  polyline point by the microtubule **v7** model, which the tracker used
   *  to establish cross-frame identity.
   *
   *  Nothing produces or reads it since the v5H swap — the model emits no
   *  embedding field and the tracker matches geometrically. The declaration
   *  stays because rows written by v7 are still in the database and still
   *  served; read paths strip it before it reaches the editor (a
   *  several-KB-per-polyline blob with no UI consumer). */
  _embedding?: string;
  /** User-assigned microtubule type-label id. Resolved to a class
   *  name/colour via the project's `mtTypeLabels` palette. Microtubule
   *  projects only; set/cleared via the tracks/type endpoint. */
  mtType?: string;
}

export const isPolyline = (p: Polygon): boolean => p.geometry === 'polyline';

/** Branded string identifying a polygon for cross-frame UI state. Use
 *  `Set<PolygonKey>` / `Map<PolygonKey, ...>` to make accidental keying
 *  by arbitrary strings (filenames, ids of other entities) a compile
 *  error. */
export type PolygonKey = string & { readonly __brand: 'PolygonKey' };

/** Cross-frame stable key for UI state: `trackId` if set (microtubule
 *  polylines), else the per-inference `id`. Uses `||` not `??` so an
 *  accidentally empty `trackId` falls back to id rather than colliding
 *  every empty-trackId polygon to the same key. */
export const polygonKey = (p: Polygon): PolygonKey =>
  (p.trackId || p.id) as PolygonKey;

// SegmentationResult type removed - use Polygon[] directly

// Calculate polygon perimeter
export const calculatePerimeter = (polygon: Point[]): number => {
  let perimeter = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = polygon[j].x - polygon[i].x;
    const dy = polygon[j].y - polygon[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }

  return perimeter;
};
