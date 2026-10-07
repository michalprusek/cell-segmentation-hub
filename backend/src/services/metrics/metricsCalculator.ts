import { isMeasuredMicrocapsule } from '../microcapsuleRelevance';
import { MEMBRANE_CLASS } from '../microcapsuleMembrane';
import { annulusWidth, radialDiameter } from './radialDiameter';
import axios, { AxiosInstance } from 'axios';
import ExcelJS from 'exceljs';
import { createObjectCsvStringifier } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';
import {
  /* SCALE_CONFIG, */ validateScale /* getScaleValidationMessage, getScaleWarningMessage */,
} from './scaleConfig';
import type {
  PolygonPartClass,
  SpermPartClass,
} from '../../utils/polygonValidation';
import type {
  MinimalPolygon,
  PolygonPoint,
} from '../../types/polygon';
import { polylineLength } from '../../utils/polygonGeometry';
import { readStoredImageMetrics, pixelSizeWarning } from './rasterImageMetrics';
import { groupPolylinesByInstanceId, findPart } from '../../utils/spermGrouping';
import {
  calculatePolygonArea,
  calculatePerimeter,
  calculateBoundingBox,
  calculateConvexHull,
  rotatingCalipers,
  isPolygonInside,
} from './geometricPrimitives';

export interface PolygonMetrics {
  imageId: string;
  imageName: string;
  polygonId: number;
  type: 'external' | 'internal';
  area: number;
  perimeter: number;
  perimeterWithHoles: number;
  equivalentDiameter: number;
  circularity: number;
  /** Per-instance detection score (microcapsule YOLO); undefined otherwise. */
  confidence?: number;
  /** Microcapsule completeness flag; undefined for non-microcapsule polygons.
   *  Rows that reach here are already measured, so this is `true` unless the
   *  user typed a border-cut capsule back in — carried for the focused
   *  microcapsule exporter. */
  complete?: boolean;
  /** Mean of six chords through the centroid, 30 degrees apart — the
   *  microcapsule "Diameter". Computed from the polygon's own points, so it is
   *  available on both metric paths (the Python service and the local
   *  fallback), neither of which returns it. */
  radialDiameter?: number;
  /** Mean radial gap between this capsule's wall and the membrane inside it,
   *  in the same units as the other lengths. Undefined when the capsule has no
   *  membrane — which for a microcapsule means its membrane has dissolved, a
   *  different statement from an annulus of zero width. See `annulusWidth`. */
  membraneAnnulusWidth?: number;
  /** The user's type label, if they set one. Carried so the later filters ask
   *  `isMeasuredMicrocapsule` the SAME question the parse filter asked: a
   *  border-cut capsule re-typed as relevant passes upstream and would be
   *  dropped again here if the row only knew about `complete`. */
  mtType?: string;
  feretDiameterMax: number;
  feretDiameterMaxOrthogonalDistance: number;
  feretDiameterMin: number;
  feretAspectRatio: number;
  lengthMajorDiameterThroughCentroid: number;
  lengthMinorDiameterThroughCentroid: number;
  boundingBoxWidth: number;
  boundingBoxHeight: number;
  extent: number;
  compactness: number;
  convexity: number;
  solidity: number;
  sphericity: number;
}

/** Per-image disintegration metrics. Computed on-demand at export time.
 *
 * DI is core-anchored and **requires a core**: distances are normalised by the
 * core radius R_C and compared to the analytical uniform-disk reference
 * (paper eq. 1). There is no equivalent-disk fallback.
 *
 * `referenceMode` distinguishes whether DI was computed (or why it wasn't):
 *   - 'core'    → computed per eq. (1) from the detected core polygon
 *   - 'no_core' → no usable core polygon; DI is undefined → N/A (not 0)
 *   - 'none'    → no externals or no image dimensions; DI not attempted
 *   - 'failed'  → DI HTTP call or polygon JSON parse threw an error
 * Every non-'core' mode means the DI field is an N/A sentinel: exporters must
 * render `'N/A'`, never the sentinel `0`.
 */
export interface ImageMetrics {
  imageId: string;
  imageName: string;
  polygonCount: number;
  disintegrationIndex: number; // tanh(W1) ∈ [0, 1); valid only when referenceMode==='core'
  wassersteinW1: number; // raw 1-Wasserstein distance, ≥ 0
  // 'core_too_small': a core below the paper's minimum core size (DI undefined).
  referenceMode: 'core' | 'no_core' | 'core_too_small' | 'none' | 'failed';
  nPixels: number;
  // Areas (px² by default, μm² when pixelToMicrometerScale is provided). From
  // the raster read-out when diSource==='model_raster' (pixel counts, as the
  // paper), otherwise Shoelace areas of the stored polygons.
  totalSpheroidArea: number; // foreground (corona ∪ core)
  coreArea: number; // dense core (0 if no core)
  invasionArea: number; // totalSpheroidArea − coreArea, clamped at 0
  // The paper's per-image panel (spheroid_seg/compute_di.py, same names in
  // snake_case). Every field is null unless referenceMode==='core'.
  indexB: number | null; // outside-core fraction of the foreground (Lim's Index B); the primary read-out
  reachP90: number | null; // 90th pct of core-normalised distances (core radii)
  nFragments: number | null; // raw 4-connected corona components
  largestFragmentFrac: number | null; // largest corona component / corona
  solidity: number | null; // foreground / convex hull (pixels)
  nCoreComponents: number | null; // 8-connected core components
  largestCoreComponentFrac: number | null;
  coreCentroidShift: number | null; // centroid shift by the minor pieces, in R_core
  coreFragmented: number | null; // 0/1: the core anchor is broken (inspect)
  unvalidatedRegime: number | null; // 0/1: Index B in [0.08, 0.47), where the paper's release holds no expert mask
  belowValidatedRegime: number | null; // 0/1: Index B < 0.61 (the detection floor), a screen not a grade
  // Where the numbers came from: the model's raster mask at inference time,
  // or the stored polygons re-rasterised (no raster read-out, or edited).
  diSource: 'model_raster' | 'polygons' | null;
  note: string; // why DI is undefined, or why the polygons were scored
  warnings: string[]; // input outside the validated 2048x2048 / ~1.28 um/px regime
}

/** The DI + panel subset of ImageMetrics (everything not derived locally). */
type DiFields = Omit<
  ImageMetrics,
  | 'imageId'
  | 'imageName'
  | 'polygonCount'
  | 'totalSpheroidArea'
  | 'coreArea'
  | 'invasionArea'
>;

/** N/A DI result: DI + every panel metric absent. Used for every reference mode
 * except 'core' (no core → the whole panel is undefined, rendered as N/A). */
function naDiFields(
  referenceMode: ImageMetrics['referenceMode'],
  diSource: ImageMetrics['diSource'] = null,
  note = '',
  warnings: string[] = []
): DiFields {
  return {
    disintegrationIndex: 0,
    wassersteinW1: 0,
    referenceMode,
    nPixels: 0,
    indexB: null,
    reachP90: null,
    nFragments: null,
    largestFragmentFrac: null,
    solidity: null,
    nCoreComponents: null,
    largestCoreComponentFrac: null,
    coreCentroidShift: null,
    coreFragmented: null,
    unvalidatedRegime: null,
    belowValidatedRegime: null,
    diSource,
    note,
    warnings,
  };
}

/** The paper's field names (ML response / stored raster read-out) → ImageMetrics. */
interface PaperPanel {
  reference: string;
  note?: string;
  warnings?: string[];
  DI?: number | null;
  W1?: number | null;
  index_B?: number | null;
  reach_p90?: number | null;
  n_fragments?: number | null;
  largest_fragment_frac?: number | null;
  solidity?: number | null;
  area_total_px?: number | null;
  n_core_components?: number | null;
  largest_core_component_frac?: number | null;
  core_centroid_shift?: number | null;
  core_fragmented?: number | null;
  unvalidated_regime?: number | null;
  below_validated_regime?: number | null;
}

// The two regime flags are functions of the outside-core fraction (Index B)
// alone. Mirrors UNVALIDATED_LO / UNVALIDATED_HI / VALIDATED_FRACTION_FLOOR in
// backend/segmentation/api/disintegration_metrics.py (a verbatim port of the
// paper's compute_di.py); a unit test reads that file and fails if they drift.
export const UNVALIDATED_FRACTION_LO = 0.08;
export const UNVALIDATED_FRACTION_HI = 0.47;
export const VALIDATED_FRACTION_FLOOR = 0.61;

// Derived here from Index B instead of being read from the panel, so that a
// read-out stored before the flags were re-keyed (until 2026-10 they keyed on
// Index B in [0.15, 0.30) and on DI < 0.6) is exported under the current rule
// without recomputing anything.
export function regimeFlags(indexB: number | null): {
  unvalidatedRegime: number | null;
  belowValidatedRegime: number | null;
} {
  if (indexB === null) {
    return { unvalidatedRegime: null, belowValidatedRegime: null };
  }
  return {
    unvalidatedRegime:
      indexB >= UNVALIDATED_FRACTION_LO && indexB < UNVALIDATED_FRACTION_HI
        ? 1
        : 0,
    belowValidatedRegime: indexB < VALIDATED_FRACTION_FLOOR ? 1 : 0,
  };
}

function panelToDiFields(
  p: PaperPanel,
  diSource: 'model_raster' | 'polygons',
  extraWarnings: string[] = [],
  extraNote = ''
): DiFields {
  const known: ImageMetrics['referenceMode'][] = [
    'core',
    'no_core',
    'core_too_small',
    'none',
  ];
  const reference = (known as string[]).includes(p.reference)
    ? (p.reference as ImageMetrics['referenceMode'])
    : 'failed';
  const warnings = [...(p.warnings ?? []), ...extraWarnings];
  const note = [p.note ?? '', extraNote].filter(Boolean).join('; ');
  if (reference !== 'core') {
    return {
      ...naDiFields(reference, diSource, note, warnings),
      nPixels: p.area_total_px ?? 0,
    };
  }
  const n = (v: number | null | undefined): number | null =>
    v === null || v === undefined || !Number.isFinite(v) ? null : v;
  return {
    disintegrationIndex: n(p.DI) ?? 0,
    wassersteinW1: n(p.W1) ?? 0,
    referenceMode: 'core',
    nPixels: p.area_total_px ?? 0,
    indexB: n(p.index_B),
    reachP90: n(p.reach_p90),
    nFragments: n(p.n_fragments),
    largestFragmentFrac: n(p.largest_fragment_frac),
    solidity: n(p.solidity),
    nCoreComponents: n(p.n_core_components),
    largestCoreComponentFrac: n(p.largest_core_component_frac),
    coreCentroidShift: n(p.core_centroid_shift),
    coreFragmented: n(p.core_fragmented),
    ...regimeFlags(n(p.index_B)),
    diSource,
    note,
    warnings,
  };
}

// Local Point alias kept so the many call sites in this file stay terse.
// Structurally identical to PolygonPoint from ../../types/polygon.
export type Point = PolygonPoint;

/** Re-export of the shared minimal polygon shape — metrics math only
 *  needs `points` + `type`. Kept named `Polygon` so existing call sites
 *  inside this file don't need to be touched. */
export type Polygon = MinimalPolygon;

export interface ParsedPolygon {
  points: Point[];
  type?: 'external' | 'internal';
  geometry?: 'polygon' | 'polyline';
  /** Semantic class stamped by the model — `microcapsule`, `membrane`,
   *  `microtubule`, … Already carried on the wire and through storage; declared
   *  here because the microcapsule export has to tell a capsule from the
   *  membrane inside it, and both are `type: 'external'`. */
  class?: string;
  partClass?: PolygonPartClass;
  instanceId?: string;
  /** Per-instance detection score (microcapsule YOLO). */
  confidence?: number;
  /** Microcapsule completeness: `false` when cut off by the image border.
   *  A DEFAULT, not a verdict — `mtType` overrides it either way. */
  complete?: boolean;
  /** User-assigned type label id (the project's type-label palette). */
  mtType?: string;
}

export interface SegmentationData {
  polygons: string;
  model: string;
  threshold: number;
  confidence?: number;
  processingTime?: number;
  // JSON of the ML service's raster read-out + polygons_sha256
  // (see ./rasterImageMetrics.ts); null for every model but spheroid_disintegration.
  imageMetrics?: string | null;
}

export interface ImageWithSegmentation {
  id: string;
  name: string;
  width?: number;
  height?: number;
  segmentation?: SegmentationData;
}

export type SummaryStatisticsRow = (string | number)[];

/** The microcapsule export's "Diameter" column: the mean of six chords through
 *  the centroid, 30 degrees apart (see `radialDiameter.ts` for why, and for
 *  what it gives up versus the Feret mean it replaced on 2026-09-02).
 *
 *  Falls back to `(FeretMax + FeretMin) / 2` — the old definition — only when
 *  the star could not be measured at all, which needs a polygon of fewer than
 *  three points or a centroid outside a wildly non-convex outline. Reporting 0
 *  there would read as a real measurement of zero. */
function capsuleDiameter(m: PolygonMetrics): number {
  return m.radialDiameter && m.radialDiameter > 0
    ? m.radialDiameter
    : (m.feretDiameterMax + m.feretDiameterMin) / 2;
}

/** Ovality = Feret Max / Feret Min elongation ratio (≥ 1; 1.0 = round). Shared
 *  by the CSV, Excel and summary exports so the value + degenerate handling stay
 *  identical. ``feretDiameterMin`` is always > 0 for a real capsule (the shorter
 *  side of a ≥ _MIN_AREA_PX min-area rectangle), so the guard returns the neutral
 *  in-range 1.0 only for a degenerate zero-width polygon that can't reach export
 *  — never the out-of-range 0 that would drag the summary average below 1. */
function microcapsuleOvality(m: PolygonMetrics): number {
  return m.feretDiameterMin > 0
    ? m.feretDiameterMax / m.feretDiameterMin
    : 1;
}

export class MetricsCalculator {
  private pythonApiUrl: string;
  private http: AxiosInstance;
  private logger = logger;

  constructor() {
    // Validate ML service URL
    try {
      const url = new URL(config.SEGMENTATION_SERVICE_URL);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid protocol - must be http or https');
      }
      this.pythonApiUrl = config.SEGMENTATION_SERVICE_URL;
    } catch (error) {
      const errorMsg = `Invalid SEGMENTATION_SERVICE_URL configuration (from env var SEGMENTATION_SERVICE_URL): ${config.SEGMENTATION_SERVICE_URL} - ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(errorMsg, error as Error, 'MetricsCalculator');
      throw new Error(errorMsg);
    }

    // Initialize Axios client with baseURL and timeout
    this.http = axios.create({
      baseURL: this.pythonApiUrl,
      timeout: 30000, // 30 seconds timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Calculate metrics for all images with performance monitoring
   */
  async calculateAllMetrics(
    images: ImageWithSegmentation[],
    pixelToMicrometerScale?: number
  ): Promise<PolygonMetrics[]> {
    const startTime = Date.now();
    const allMetrics: PolygonMetrics[] = [];
    let totalPolygonCount = 0;

    // Performance thresholds
    const WARN_POLYGON_COUNT = 1000;
    const ERROR_POLYGON_COUNT = 5000;
    const WARN_CALC_TIME_MS = 5000;
    const ERROR_CALC_TIME_MS = 30000;

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];

      if (image && image.segmentation?.polygons) {
        const result = image.segmentation;
        if (result.polygons) {
          try {
            const parsed: ParsedPolygon[] = JSON.parse(result.polygons);
            // Filter to closed polygons only (exclude polylines used for sperm
            // morphology), then drop the microcapsules that do not count.
            // `isMeasuredMicrocapsule` reads the user's type label first and
            // falls back to the model's `complete` flag, so a border-cut
            // capsule the user re-typed IS measured and a whole one they typed
            // "non relevant" is not. Other project types set neither field, so
            // it leaves them untouched.
            const polygons = parsed.filter(
              (p): p is ParsedPolygon & { type: 'external' | 'internal' } =>
                p.geometry !== 'polyline' &&
                !!p.type &&
                isMeasuredMicrocapsule(p)
            );
            totalPolygonCount += polygons.length;

            const imageMetrics = await this.calculateImageMetrics(
              polygons,
              image.id,
              image.name
            );
            allMetrics.push(...imageMetrics);
          } catch (parseError) {
            this.logger.error(
              `Failed to parse polygons for image ${image.id} at index ${imageIdx}`,
              parseError instanceof Error
                ? parseError
                : new Error(String(parseError)),
              'MetricsCalculator',
              { imageId: image.id, imageIdx }
            );
            continue;
          }
        }
      }
    }

    // Calculate performance metrics
    const calcTime = Date.now() - startTime;

    // Check thresholds and log warnings
    if (totalPolygonCount > ERROR_POLYGON_COUNT) {
      this.logger.error(
        `Polygon count (${totalPolygonCount}) exceeds error threshold (${ERROR_POLYGON_COUNT})`,
        new Error('Too many polygons for metrics calculation'),
        'MetricsCalculator'
      );
    } else if (totalPolygonCount > WARN_POLYGON_COUNT) {
      this.logger.warn(
        `High polygon count in metrics calculation: ${totalPolygonCount} polygons`,
        'MetricsCalculator'
      );
    }

    if (calcTime > ERROR_CALC_TIME_MS) {
      this.logger.error(
        `Metrics calculation time (${calcTime}ms) exceeds error threshold (${ERROR_CALC_TIME_MS}ms)`,
        new Error('Metrics calculation timeout'),
        'MetricsCalculator'
      );
    } else if (calcTime > WARN_CALC_TIME_MS) {
      this.logger.warn(
        `Slow metrics calculation: ${calcTime}ms for ${totalPolygonCount} polygons across ${images.length} images`,
        'MetricsCalculator'
      );
    }

    // Log performance summary
    const polygonsPerSec =
      calcTime > 0 ? (totalPolygonCount / (calcTime / 1000)).toFixed(0) : 'N/A';
    this.logger.info(
      `Metrics calculated: ${totalPolygonCount} polygons across ${images.length} images in ${calcTime}ms (${polygonsPerSec} polygons/sec)`,
      'MetricsCalculator'
    );

    // Apply scale conversion if provided
    if (pixelToMicrometerScale) {
      if (pixelToMicrometerScale <= 0 || !isFinite(pixelToMicrometerScale)) {
        this.logger.warn(
          `Invalid scale value: ${pixelToMicrometerScale}. Scale must be greater than 0. Using pixel units instead.`,
          'MetricsCalculator'
        );
        // Continue with pixel units (don't apply scale)
        return allMetrics;
      }
      return this.applyScaleConversion(allMetrics, pixelToMicrometerScale);
    }

    return allMetrics;
  }

  /**
   * Calculate metrics for polygons in a single image
   */
  async calculateImageMetrics(
    polygons: ParsedPolygon[],
    imageId: string,
    imageName: string
  ): Promise<PolygonMetrics[]> {
    const metrics: PolygonMetrics[] = [];

    // Separate external and internal polygons. Type-guard predicates narrow the
    // optional `type` to a required literal so each element satisfies the
    // MinimalPolygon shape the geometry helpers expect.
    // Membranes are `type: 'external'` too — they are closed outlines, not
    // holes — but they are NOT objects to measure: each one belongs to the
    // capsule around it and contributes ONE number to that capsule's row, the
    // annulus width. Leaving them in would double every microcapsule export
    // with rows for boundaries the user never counts.
    const membranePolygons = polygons.filter(
      p => p.type === 'external' && p.class === MEMBRANE_CLASS
    );
    const externalPolygons = polygons.filter(
      (p): p is ParsedPolygon & { type: 'external' } =>
        p.type === 'external' && p.class !== MEMBRANE_CLASS
    );
    const internalPolygons = polygons.filter(
      (p): p is ParsedPolygon & { type: 'internal' } => p.type === 'internal'
    );

    // Calculate metrics for each external polygon
    for (let i = 0; i < externalPolygons.length; i++) {
      const polygon = externalPolygons[i];

      if (!polygon) {
        this.logger.warn(
          `Skipping undefined polygon at index ${i}`,
          'MetricsCalculator'
        );
        continue;
      }

      // Skip degenerate polygons with insufficient points
      if (!polygon.points || polygon.points.length < 3) {
        this.logger.warn(
          `Skipping degenerate polygon at index ${i} with ${polygon.points?.length || 0} points`,
          'MetricsCalculator'
        );
        continue;
      }

      try {
        // Find holes that are inside this specific polygon
        const holesForPolygon = internalPolygons.filter(inner =>
          isPolygonInside(inner, polygon)
        );

        // Calculate metrics using Python service
        const polygonMetrics = await this.calculatePolygonMetrics(
          polygon,
          holesForPolygon
        );

        // The membrane this capsule encloses, if any. Paired by CONTAINMENT
        // rather than by an id on either polygon: a membrane can be drawn,
        // moved or deleted by hand, so a stored link would have to be
        // maintained through every edit path (and through the five polygon
        // validator stages that strip unknown fields). Where a membrane sits
        // is the durable fact — capsules do not overlap, so the capsule
        // containing it is unambiguous.
        const membrane = membranePolygons.find(m =>
          isPolygonInside(m, polygon)
        );

        metrics.push({
          imageId,
          imageName,
          polygonId: i + 1,
          type: 'external',
          confidence: polygon.confidence,
          complete: polygon.complete,
          mtType: polygon.mtType,
          radialDiameter: radialDiameter(polygon.points),
          // undefined (not 0) when there is no membrane: the capsule has no
          // annulus, which is a different statement from one of zero width.
          membraneAnnulusWidth:
            membrane && membrane.points
              ? (annulusWidth(polygon.points, membrane.points) ?? undefined)
              : undefined,
          ...polygonMetrics,
        });
      } catch (error) {
        this.logger.error(
          `Failed to calculate metrics for polygon ${i + 1}:`,
          error instanceof Error ? error : new Error(String(error)),
          'MetricsCalculator'
        );

        // Fallback to basic calculations with proper hole mapping
        const holesForPolygon = internalPolygons.filter(inner =>
          isPolygonInside(inner, polygon)
        );

        // The annulus is computed here too. It is pure local geometry — two
        // stored outlines and a centroid — so losing it when the Python
        // metrics service is unreachable would drop a column for a reason
        // that has nothing to do with it. This branch runs whenever that
        // service is down, which is a real production state, not a test-only
        // one.
        const fallbackMembrane = membranePolygons.find(m =>
          isPolygonInside(m, polygon)
        );

        metrics.push({
          imageId,
          imageName,
          polygonId: i + 1,
          type: 'external',
          confidence: polygon.confidence,
          complete: polygon.complete,
          membraneAnnulusWidth:
            fallbackMembrane && fallbackMembrane.points
              ? (annulusWidth(polygon.points, fallbackMembrane.points) ??
                undefined)
              : undefined,
          ...this.calculateBasicMetrics(polygon, holesForPolygon),
        });
      }
    }

    return metrics;
  }

  /**
   * Compute per-image area metrics + the Disintegration Index for every image
   * that has a segmentation.
   *
   * Per image, in order of preference:
   *  1. the RASTER read-out the ML service computed from the model's argmax
   *     mask at inference time (`segmentation.imageMetrics`), as long as its
   *     `polygons_sha256` still matches the stored polygons. This is the
   *     paper's read-out (compute_di.py, verbatim port) and needs no network;
   *  2. otherwise the stored polygons: the union of every external non-core
   *     polygon as the foreground and the union of every `partClass='core'`
   *     polygon as the core, POSTed to `/api/disintegration-index`, which
   *     scores them with the same algorithm. `diSource` says which was used.
   * Areas come from the same source: raster pixel counts for (1), Shoelace
   * areas of the polygons for (2); the Shoelace areas are reported even if
   * the DI HTTP call fails.
   *
   * DI is core-anchored and **requires a core**. When no `partClass='core'`
   * polygon is present the DI is undefined (`referenceMode='no_core'`, rendered
   * as N/A) and no ML call is made — there is no equivalent-disk fallback.
   */
  async calculateAllImageMetrics(
    images: ImageWithSegmentation[],
    pixelToMicrometerScale?: number
  ): Promise<ImageMetrics[]> {
    // Area unit conversion: px² → μm² when scale is set and valid.
    const areaScale =
      pixelToMicrometerScale && pixelToMicrometerScale > 0
        ? pixelToMicrometerScale * pixelToMicrometerScale
        : 1;
    const result: ImageMetrics[] = [];
    for (const image of images) {
      if (!image?.segmentation?.polygons) {
        result.push(this._emptyImageMetrics(image));
        continue;
      }

      // Step 1: parse polygons and compute area metrics. These are
      // self-contained (no network) so they always succeed when polygon
      // JSON is well-formed.
      let closed: Array<ParsedPolygon & { type: 'external' | 'internal' }> = [];
      let externals: typeof closed = [];
      let cores: typeof closed = [];
      let totalSpheroidArea = 0;
      let coreArea = 0;
      let invasionArea = 0;
      try {
        const parsed: ParsedPolygon[] = JSON.parse(image.segmentation.polygons);
        closed = parsed.filter(
          (p): p is ParsedPolygon & { type: 'external' | 'internal' } =>
            p.geometry !== 'polyline' && !!p.type
        );
        externals = closed.filter(p => p.type === 'external');
        cores = closed.filter(p => p.partClass === 'core');

        const totalSpheroidAreaPx = externals
          .filter(p => p.partClass !== 'core')
          .reduce((sum, p) => sum + calculatePolygonArea(p.points), 0);
        const coreAreaPx = cores.reduce(
          (sum, p) => sum + calculatePolygonArea(p.points),
          0
        );
        const invasionAreaPx = Math.max(0, totalSpheroidAreaPx - coreAreaPx);
        totalSpheroidArea = totalSpheroidAreaPx * areaScale;
        coreArea = coreAreaPx * areaScale;
        invasionArea = invasionAreaPx * areaScale;
      } catch (err) {
        this.logger.error(
          `Failed to parse polygons for image ${image.id}`,
          err instanceof Error ? err : new Error(String(err)),
          'MetricsCalculator'
        );
        // Flag the row so exporters can show 'N/A' instead of a sentinel 0.
        result.push({
          ...this._emptyImageMetrics(image),
          referenceMode: 'failed',
        });
        continue;
      }

      // Step 2a: the raster read-out stored at inference time, if it still
      // describes these polygons. No network, and it is the paper's number.
      const stored = readStoredImageMetrics(
        image.segmentation.imageMetrics,
        image.segmentation.polygons
      );
      const scaleWarning = pixelSizeWarning(pixelToMicrometerScale);
      if (stored.metrics) {
        const r = stored.metrics;
        const di = panelToDiFields(
          r,
          'model_raster',
          scaleWarning ? [scaleWarning] : []
        );
        const totalPx = r.area_total_px ?? 0;
        const corePx = r.area_core_px ?? 0;
        result.push({
          imageId: image.id,
          imageName: image.name,
          polygonCount: closed.length,
          ...di,
          totalSpheroidArea: totalPx * areaScale,
          coreArea: corePx * areaScale,
          invasionArea: Math.max(0, totalPx - corePx) * areaScale,
        });
        continue;
      }
      // A raster read-out that exists but no longer matches (edited polygons)
      // is worth saying in the row; "none stored" is the normal legacy case.
      const fallbackNote = image.segmentation.imageMetrics
        ? `scored from polygons: ${stored.reason}`
        : '';

      // Step 2b: DI + panel from the polygons. Network call to ML; failures
      // must NOT void the area metrics already computed in step 1.
      let di: DiFields = naDiFields('none', null, fallbackNote);

      const usableExternals = externals.filter(p => p.partClass !== 'core');
      if (usableExternals.length > 0 && cores.length === 0) {
        // DI is core-anchored and requires a core. Without one it is undefined;
        // report N/A explicitly rather than issuing a doomed ML call.
        di = naDiFields(
          'no_core',
          'polygons',
          ['no core: DI undefined', fallbackNote].filter(Boolean).join('; '),
          scaleWarning ? [scaleWarning] : []
        );
      } else if (usableExternals.length > 0) {
        try {
          // DI is computed from the UNION of every external polygon (the
          // entire disintegration segmentation mask), not just the largest spheroid.
          const maskPolygons = usableExternals.map(p => p.points);
          // Use every detected core; the Python endpoint unions them too.
          const corePolygonsForDi = cores.map(c => c.points);

          if (!image.width || !image.height) {
            this.logger.warn(
              `Image ${image.id} missing width/height in DB — DI requires real dimensions; skipping`,
              'MetricsCalculator'
            );
          } else {
            di = await this.calculateImageDisintegrationIndex(
              maskPolygons,
              corePolygonsForDi,
              image.width,
              image.height,
              pixelToMicrometerScale,
              fallbackNote
            );
          }
        } catch (err) {
          // Areas already computed above; mark DI fields explicitly failed.
          this.logger.error(
            `DI computation failed for image ${image.id}; areas still reported`,
            err instanceof Error ? err : new Error(String(err)),
            'MetricsCalculator',
            { imageId: image.id }
          );
          di = naDiFields('failed', 'polygons', fallbackNote);
        }
      }

      result.push({
        imageId: image.id,
        imageName: image.name,
        polygonCount: closed.length,
        ...di,
        totalSpheroidArea,
        coreArea,
        invasionArea,
      });
    }
    return result;
  }

  private _emptyImageMetrics(
    image: ImageWithSegmentation | undefined
  ): ImageMetrics {
    return {
      imageId: image?.id ?? '',
      imageName: image?.name ?? '',
      polygonCount: 0,
      ...naDiFields('none'),
      totalSpheroidArea: 0,
      coreArea: 0,
      invasionArea: 0,
    };
  }

  private async calculateImageDisintegrationIndex(
    maskPolygons: Point[][],
    corePolygons: Point[][],
    imageWidth: number,
    imageHeight: number,
    pixelToMicrometerScale?: number,
    extraNote = ''
  ): Promise<DiFields> {
    const mask_polygons = maskPolygons.map(pts => pts.map(p => [p.x, p.y]));
    // DI requires a core; callers only reach here with a non-empty core set.
    const core_polygons = corePolygons.map(pts => pts.map(p => [p.x, p.y]));
    const response = await this.http.post<{
      di: number;
      w1: number;
      reference: string;
      n_pixels: number;
      note?: string;
      warnings?: string[];
      index_b: number | null;
      reach_p90: number | null;
      n_fragments: number | null;
      largest_fragment_frac: number | null;
      solidity: number | null;
      n_core_components: number | null;
      largest_core_component_frac: number | null;
      core_centroid_shift: number | null;
      core_fragmented: number | null;
      unvalidated_regime: number | null;
      below_validated_regime: number | null;
    }>('/api/disintegration-index', {
      mask_polygons,
      core_polygons,
      image_width: imageWidth,
      image_height: imageHeight,
      // Only feeds the endpoint's input-scale warning; nothing is rescaled.
      ...(pixelToMicrometerScale && pixelToMicrometerScale > 0
        ? { pixel_size_um: pixelToMicrometerScale }
        : {}),
    });
    const d = response.data;
    // Every panel field is scale-free (fractions, counts, core radii), so the
    // µm/px scale only reaches the areas, which are computed by the caller.
    return panelToDiFields(
      {
        reference: d.reference,
        note: d.note,
        warnings: d.warnings,
        DI: d.di,
        W1: d.w1,
        index_B: d.index_b,
        reach_p90: d.reach_p90,
        n_fragments: d.n_fragments,
        largest_fragment_frac: d.largest_fragment_frac,
        solidity: d.solidity,
        area_total_px: d.n_pixels,
        n_core_components: d.n_core_components,
        largest_core_component_frac: d.largest_core_component_frac,
        core_centroid_shift: d.core_centroid_shift,
        core_fragmented: d.core_fragmented,
        unvalidated_regime: d.unvalidated_regime,
        below_validated_regime: d.below_validated_regime,
      },
      'polygons',
      [],
      extraNote
    );
  }

  /**
   * Calculate metrics for a single polygon using Python service
   */
  private async calculatePolygonMetrics(
    polygon: Polygon,
    holes: Polygon[]
  ): Promise<
    Omit<PolygonMetrics, 'imageId' | 'imageName' | 'polygonId' | 'type'>
  > {
    try {
      // Convert polygon points to numpy-compatible format
      if (!polygon?.points) {
        throw new Error('Polygon points are undefined');
      }
      const contour = polygon.points.map(p => [p.x, p.y]);
      const holeContours = holes.map(h => {
        if (!h?.points) {
          throw new Error('Hole polygon points are undefined');
        }
        return h.points.map(p => [p.x, p.y]);
      });

      // Call Python API for metrics calculation
      const response = await this.http.post('/api/calculate-metrics', {
        contour,
        holes: holeContours,
      });

      // Validate response data has all required metric keys
      const requiredKeys = [
        'Area',
        'Perimeter',
        'PerimeterWithHoles',
        'EquivalentDiameter',
        'Circularity',
        'FeretDiameterMax',
        'FeretDiameterMaxOrthogonalDistance',
        'FeretDiameterMin',
        'FeretAspectRatio',
        'LengthMajorDiameterThroughCentroid',
        'LengthMinorDiameterThroughCentroid',
        'BoundingBoxWidth',
        'BoundingBoxHeight',
        'Extent',
        'Compactness',
        'Convexity',
        'Solidity',
        'Sphericity',
      ];

      const missingKeys = requiredKeys.filter(key => !(key in response.data));
      if (missingKeys.length > 0) {
        throw new Error(
          `Missing required metric keys in response: ${missingKeys.join(', ')}`
        );
      }

      return {
        area: response.data.Area,
        perimeter: response.data.Perimeter,
        perimeterWithHoles: response.data.PerimeterWithHoles,
        equivalentDiameter: response.data.EquivalentDiameter,
        circularity: response.data.Circularity,
        feretDiameterMax: response.data.FeretDiameterMax,
        feretDiameterMaxOrthogonalDistance:
          response.data.FeretDiameterMaxOrthogonalDistance,
        feretDiameterMin: response.data.FeretDiameterMin,
        feretAspectRatio: response.data.FeretAspectRatio,
        lengthMajorDiameterThroughCentroid:
          response.data.LengthMajorDiameterThroughCentroid,
        lengthMinorDiameterThroughCentroid:
          response.data.LengthMinorDiameterThroughCentroid,
        boundingBoxWidth: response.data.BoundingBoxWidth,
        boundingBoxHeight: response.data.BoundingBoxHeight,
        extent: response.data.Extent,
        compactness: response.data.Compactness,
        convexity: response.data.Convexity,
        solidity: response.data.Solidity,
        sphericity: response.data.Sphericity,
      };
    } catch (error) {
      this.logger.error(
        'Python metrics calculation failed:',
        error instanceof Error ? error : new Error(String(error)),
        'MetricsCalculator'
      );
      throw error;
    }
  }

  /**
   * Calculate basic metrics without Python service (fallback)
   */
  private calculateBasicMetrics(
    polygon: Polygon,
    holes: Polygon[]
  ): Omit<PolygonMetrics, 'imageId' | 'imageName' | 'polygonId' | 'type'> {
    // Check if polygon has valid points
    if (!polygon?.points || polygon.points.length === 0) {
      throw new Error('Polygon points are undefined or empty');
    }

    // Calculate main polygon area using Shoelace formula
    const mainArea = calculatePolygonArea(polygon.points);

    // Subtract hole areas
    const holesArea = holes.reduce((sum, hole) => {
      if (!hole?.points || hole.points.length === 0) {
        return sum; // Skip invalid holes
      }
      return sum + calculatePolygonArea(hole.points);
    }, 0);
    let area = Math.max(0, mainArea - holesArea);

    // Calculate perimeter of external boundary only
    const externalPerimeter = calculatePerimeter(polygon.points);

    // Calculate perimeter with holes (external + all hole perimeters)
    const holesPerimeter = holes.reduce((sum, hole) => {
      if (!hole?.points || hole.points.length === 0) {
        return sum; // Skip invalid holes
      }
      return sum + calculatePerimeter(hole.points);
    }, 0);
    const perimeterWithHoles = externalPerimeter + holesPerimeter;

    // Add geometric value guards - clamp to safe ranges
    area = Math.max(0, area);
    const perimeter = Math.max(externalPerimeter, Number.EPSILON);

    // Calculate bounding box for extent calculation
    const boundingBox = calculateBoundingBox(polygon.points);
    const boundingBoxArea = boundingBox.width * boundingBox.height;

    // Calculate circularity: 4*pi * area / perimeter^2 (clamped to [0,1])
    const circularity =
      perimeter > 0
        ? Math.min(1.0, (4 * Math.PI * area) / (perimeter * perimeter))
        : 0;

    // Calculate compactness: P^2/(4*pi*A) - reciprocal of circularity
    const compactness =
      area > 0 ? (perimeter * perimeter) / (4 * Math.PI * area) : 0;

    // Calculate extent: Area/(BBox.width * BBox.height)
    const extent = boundingBoxArea > 0 ? area / boundingBoxArea : 0;

    // Calculate equivalent diameter: diameter of circle with same area
    const equivalentDiameter = Math.sqrt((4 * area) / Math.PI);

    // Calculate convex hull for convexity, solidity, and proper Feret diameters
    const convexHull = calculateConvexHull(polygon.points);
    const convexArea = calculatePolygonArea(convexHull);
    const convexPerimeter = calculatePerimeter(convexHull);

    // Convexity: perimeter of convex hull / perimeter of polygon
    const convexity = perimeter > 0 ? convexPerimeter / perimeter : 0;

    // Solidity: area of polygon / area of convex hull
    const solidity = convexArea > 0 ? area / convexArea : 0;

    // Calculate proper Feret diameters using rotating calipers
    const feretDiameters = rotatingCalipers(convexHull);

    // Ensure safe division for aspect ratio
    const feretAspectRatio =
      feretDiameters.min > 0 ? feretDiameters.max / feretDiameters.min : 0;

    return {
      area,
      perimeter,
      perimeterWithHoles,
      equivalentDiameter,
      circularity,
      feretDiameterMax: feretDiameters.max,
      feretDiameterMaxOrthogonalDistance: feretDiameters.orthogonal,
      feretDiameterMin: feretDiameters.min,
      feretAspectRatio: isFinite(feretAspectRatio) ? feretAspectRatio : 0,
      lengthMajorDiameterThroughCentroid: feretDiameters.max,
      lengthMinorDiameterThroughCentroid: feretDiameters.min,
      boundingBoxWidth: boundingBox.width,
      boundingBoxHeight: boundingBox.height,
      extent,
      compactness,
      convexity,
      solidity,
      sphericity: circularity * 0.8, // Estimate for 3D-like sphericity
    };
  }

  /**
   * Export metrics to Excel
   */
  /**
   * Comprehensive polygon-level Excel export for **standard spheroid** /
   * **wound** projects: every polygon gets its own row with the full set of
   * shape descriptors (area, perimeter, circularity, Feret, etc.) + Summary.
   *
   * Used when the project's `type` field is `'spheroid'` or `'wound'`.
   */
  async exportPolygonMetricsToExcel(
    metrics: PolygonMetrics[],
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Polygon Metrics');
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    worksheet.columns = [
      { header: 'Image Name', key: 'imageName', width: 20 },
      { header: 'Polygon ID', key: 'polygonId', width: 10 },
      { header: 'Type', key: 'type', width: 10 },
      { header: `Area (${areaUnit})`, key: 'area', width: 12 },
      { header: `Perimeter (${lengthUnit})`, key: 'perimeter', width: 12 },
      { header: `Perimeter with Holes (${lengthUnit})`, key: 'perimeterWithHoles', width: 20 },
      { header: `Equivalent Diameter (${lengthUnit})`, key: 'equivalentDiameter', width: 18 },
      { header: 'Circularity', key: 'circularity', width: 10 },
      { header: `Feret Diameter Max (${lengthUnit})`, key: 'feretDiameterMax', width: 18 },
      { header: `Feret Diameter Min (${lengthUnit})`, key: 'feretDiameterMin', width: 18 },
      { header: `Feret Diameter Orthogonal (${lengthUnit})`, key: 'feretDiameterOrthogonal', width: 22 },
      { header: 'Feret Aspect Ratio', key: 'feretAspectRatio', width: 15 },
      { header: `Major Axis Length (${lengthUnit})`, key: 'lengthMajorDiameter', width: 18 },
      { header: `Minor Axis Length (${lengthUnit})`, key: 'lengthMinorDiameter', width: 18 },
      { header: `Bounding Box Width (${lengthUnit})`, key: 'boundingBoxWidth', width: 20 },
      { header: `Bounding Box Height (${lengthUnit})`, key: 'boundingBoxHeight', width: 20 },
      { header: 'Extent', key: 'extent', width: 10 },
      { header: 'Compactness', key: 'compactness', width: 12 },
      { header: 'Convexity', key: 'convexity', width: 10 },
      { header: 'Solidity', key: 'solidity', width: 10 },
      { header: 'Sphericity', key: 'sphericity', width: 10 },
    ];

    const safeValue = (value: number, decimals = 2): number =>
      isFinite(value) ? parseFloat(value.toFixed(decimals)) : 0;
    metrics.forEach(m => {
      worksheet.addRow({
        imageName: m.imageName,
        polygonId: m.polygonId,
        type: m.type,
        area: safeValue(m.area, 2),
        perimeter: safeValue(m.perimeter, 2),
        perimeterWithHoles: safeValue(m.perimeterWithHoles, 2),
        equivalentDiameter: safeValue(m.equivalentDiameter, 2),
        circularity: safeValue(m.circularity, 4),
        feretDiameterMax: safeValue(m.feretDiameterMax, 2),
        feretDiameterMin: safeValue(m.feretDiameterMin, 2),
        feretDiameterOrthogonal: safeValue(m.feretDiameterMaxOrthogonalDistance, 2),
        feretAspectRatio: safeValue(m.feretAspectRatio, 2),
        lengthMajorDiameter: safeValue(m.lengthMajorDiameterThroughCentroid, 2),
        lengthMinorDiameter: safeValue(m.lengthMinorDiameterThroughCentroid, 2),
        boundingBoxWidth: safeValue(m.boundingBoxWidth, 2),
        boundingBoxHeight: safeValue(m.boundingBoxHeight, 2),
        extent: safeValue(m.extent, 4),
        compactness: safeValue(m.compactness, 4),
        convexity: safeValue(m.convexity, 4),
        solidity: safeValue(m.solidity, 4),
        sphericity: safeValue(m.sphericity, 4),
      });
    });
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Summary sheet (aggregates across the project).
    const summarySheet = workbook.addWorksheet('Summary');
    const summaryData = this.generateSummaryStatistics(metrics, pixelToMicrometerScale);
    summaryData.forEach((row, index) => {
      const excelRow = summarySheet.addRow(row);
      if (index === 0) {
        excelRow.font = { bold: true };
        excelRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' },
        };
      }
    });
    summarySheet.columns.forEach(column => { column.width = 20; });

    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });
    await workbook.xlsx.writeFile(outputPath);
    this.logger.info(`Polygon Metrics Excel written: ${outputPath}`, 'MetricsCalculator');
  }

  /**
   * Focused Excel export for **microcapsule** projects. One row per *complete*
   * capsule — border-cut capsules are already excluded upstream in
   * `generateMetrics`. Columns are intentionally minimal: the user wants area,
   * perimeter and compactness per capsule, not the full spheroid descriptor set.
   *
   * "Compactness" here is the **circularity** value (4π·A/P², in [0, 1], where
   * 1.0 is a perfect circle) — the agreed, most-intuitive shape measure for
   * round capsules. `PolygonMetrics.circularity` already holds exactly this;
   * the unbounded reciprocal `PolygonMetrics.compactness` is deliberately not
   * surfaced.
   */
  async exportMicrocapsuleMetricsToExcel(
    metrics: PolygonMetrics[],
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Microcapsule Metrics');
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    worksheet.columns = [
      { header: 'Image Name', key: 'imageName', width: 20 },
      { header: 'Capsule ID', key: 'polygonId', width: 12 },
      { header: `Area (${areaUnit})`, key: 'area', width: 14 },
      { header: `Perimeter (${lengthUnit})`, key: 'perimeter', width: 14 },
      { header: `Width (${lengthUnit})`, key: 'width', width: 12 },
      { header: `Height (${lengthUnit})`, key: 'height', width: 12 },
      { header: `Diameter (${lengthUnit})`, key: 'diameter', width: 12 },
      { header: `Feret Max (${lengthUnit})`, key: 'feretMax', width: 14 },
      { header: `Feret Min (${lengthUnit})`, key: 'feretMin', width: 14 },
      {
        header: `Equivalent Diameter (${lengthUnit})`,
        key: 'equivalentDiameter',
        width: 20,
      },
      { header: 'Compactness', key: 'compactness', width: 12 },
      { header: 'Ovality', key: 'ovality', width: 10 },
      // Blank, not 0, when the capsule has no membrane: its membrane has
      // dissolved, which is a different fact from an annulus of zero width and
      // must not average into a column as one.
      {
        header: `Membrane annulus width (${lengthUnit})`,
        key: 'membraneAnnulusWidth',
        width: 24,
      },
      { header: 'Confidence', key: 'confidence', width: 12 },
    ];

    const safeValue = (value: number, decimals = 2): number =>
      isFinite(value) ? parseFloat(value.toFixed(decimals)) : 0;

    // Only measured capsules reach here (excluded upstream), but guard anyway.
    const rows = metrics.filter(isMeasuredMicrocapsule);
    rows.forEach(m => {
      worksheet.addRow({
        imageName: m.imageName,
        polygonId: m.polygonId,
        area: safeValue(m.area, 2),
        perimeter: safeValue(m.perimeter, 2),
        width: safeValue(m.boundingBoxWidth, 2),
        height: safeValue(m.boundingBoxHeight, 2),
        diameter: safeValue(capsuleDiameter(m), 2),
        feretMax: safeValue(m.feretDiameterMax, 2),
        feretMin: safeValue(m.feretDiameterMin, 2),
        equivalentDiameter: safeValue(m.equivalentDiameter, 2),
        compactness: safeValue(m.circularity, 4),
        ovality: safeValue(microcapsuleOvality(m), 4),
        membraneAnnulusWidth:
          typeof m.membraneAnnulusWidth === 'number'
            ? safeValue(m.membraneAnnulusWidth, 2)
            : '',
        confidence:
          typeof m.confidence === 'number' ? safeValue(m.confidence, 4) : '',
      });
    });
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    const summarySheet = workbook.addWorksheet('Summary');
    const summaryData = this.generateMicrocapsuleSummary(
      rows,
      pixelToMicrometerScale
    );
    summaryData.forEach((row, index) => {
      const excelRow = summarySheet.addRow(row);
      if (index === 0) {
        excelRow.font = { bold: true };
        excelRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' },
        };
      }
    });
    summarySheet.columns.forEach(column => {
      column.width = 26;
    });

    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });
    await workbook.xlsx.writeFile(outputPath);
    this.logger.info(
      `Microcapsule Metrics Excel written: ${outputPath}`,
      'MetricsCalculator'
    );
  }

  /**
   * Focused CSV export for **microcapsule** projects — the CSV twin of
   * `exportMicrocapsuleMetricsToExcel` (same focused columns, complete capsules
   * only, "Compactness" = circularity 4π·A/P²).
   */
  async exportMicrocapsuleToCSV(
    metrics: PolygonMetrics[],
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<void> {
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'imageName', title: 'Image Name' },
        { id: 'polygonId', title: 'Capsule ID' },
        { id: 'area', title: `Area (${areaUnit})` },
        { id: 'perimeter', title: `Perimeter (${lengthUnit})` },
        { id: 'width', title: `Width (${lengthUnit})` },
        { id: 'height', title: `Height (${lengthUnit})` },
        { id: 'diameter', title: `Diameter (${lengthUnit})` },
        { id: 'feretMax', title: `Feret Max (${lengthUnit})` },
        { id: 'feretMin', title: `Feret Min (${lengthUnit})` },
        {
          id: 'equivalentDiameter',
          title: `Equivalent Diameter (${lengthUnit})`,
        },
        { id: 'compactness', title: 'Compactness' },
        { id: 'ovality', title: 'Ovality' },
        {
          id: 'membraneAnnulusWidth',
          title: `Membrane annulus width (${lengthUnit})`,
        },
        { id: 'confidence', title: 'Confidence' },
      ],
    });

    const records = metrics
      .filter(isMeasuredMicrocapsule)
      .map(m => ({
        imageName: m.imageName,
        polygonId: m.polygonId,
        area: m.area,
        perimeter: m.perimeter,
        width: m.boundingBoxWidth,
        height: m.boundingBoxHeight,
        // "Diameter" = mean Feret diameter (rotation-invariant), distinct from
        // the axis-aligned Width/Height and the area-based Equivalent Diameter.
        diameter: capsuleDiameter(m),
        // Feret Max/Min = longer / shorter side of the min-area bounding rect
        // (the capsule's long axis / narrowest width).
        feretMax: m.feretDiameterMax,
        feretMin: m.feretDiameterMin,
        equivalentDiameter: m.equivalentDiameter,
        // "Compactness" column carries the circularity value by design.
        compactness: m.circularity,
        ovality: microcapsuleOvality(m),
        // Mean radial gap between the capsule wall and the membrane inside it,
        // on the same six-spoke star as Diameter. Empty when the capsule has
        // no membrane — see the Excel writer above.
        membraneAnnulusWidth:
          typeof m.membraneAnnulusWidth === 'number'
            ? m.membraneAnnulusWidth
            : '',
        confidence: typeof m.confidence === 'number' ? m.confidence : '',
      }));

    const header = csvStringifier.getHeaderString();
    const body = csvStringifier.stringifyRecords(records);

    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(outputPath, header + body);
    this.logger.info(
      `Microcapsule CSV created: ${outputPath}`,
      'MetricsCalculator'
    );
  }

  /**
   * Summary aggregates for the microcapsule report: how many complete capsules
   * were analysed plus area / compactness statistics.
   */
  private generateMicrocapsuleSummary(
    metrics: PolygonMetrics[],
    pixelToMicrometerScale?: number
  ): SummaryStatisticsRow[] {
    if (metrics.length === 0) {
      return [['No complete microcapsules found']];
    }

    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    const areas = metrics.map(m => m.area);
    const compactness = metrics.map(m => m.circularity);

    return [
      ['Microcapsule Summary'],
      [''],
      ['Metric', 'Value'],
      ['Capsules analysed (complete)', metrics.length],
      [`Average Area (${areaUnit})`, this.average(areas).toFixed(2)],
      [`Minimum Area (${areaUnit})`, Math.min(...areas).toFixed(2)],
      [`Maximum Area (${areaUnit})`, Math.max(...areas).toFixed(2)],
      [
        `Average Perimeter (${lengthUnit})`,
        this.average(metrics.map(m => m.perimeter)).toFixed(2),
      ],
      [
        `Average Width (${lengthUnit})`,
        this.average(metrics.map(m => m.boundingBoxWidth)).toFixed(2),
      ],
      [
        `Average Height (${lengthUnit})`,
        this.average(metrics.map(m => m.boundingBoxHeight)).toFixed(2),
      ],
      [
        `Average Diameter (${lengthUnit})`,
        this.average(metrics.map(capsuleDiameter)).toFixed(2),
      ],
      [
        `Average Feret Max (${lengthUnit})`,
        this.average(metrics.map(m => m.feretDiameterMax)).toFixed(2),
      ],
      [
        `Average Feret Min (${lengthUnit})`,
        this.average(metrics.map(m => m.feretDiameterMin)).toFixed(2),
      ],
      [
        `Average Equivalent Diameter (${lengthUnit})`,
        this.average(metrics.map(m => m.equivalentDiameter)).toFixed(2),
      ],
      ['Average Compactness', this.average(compactness).toFixed(4)],
      ['Minimum Compactness', Math.min(...compactness).toFixed(4)],
      ['Maximum Compactness', Math.max(...compactness).toFixed(4)],
      [
        'Average Ovality',
        this.average(metrics.map(microcapsuleOvality)).toFixed(4),
      ],
    ];
  }

  async exportToExcel(
    metrics: PolygonMetrics[],
    outputPath: string,
    pixelToMicrometerScale?: number,
    imageMetrics?: ImageMetrics[]
  ): Promise<void> {
    // `metrics` (per-polygon) are intentionally NOT written here — for
    // disintegrated-spheroid (`spheroid_invasive`) projects the user only wants
    // ONE row per image. Detailed methodology lives in `metrics_guide.md`.
    void metrics;
    const workbook = new ExcelJS.Workbook();

    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    // Every panel column is scale-free (fractions, counts, core radii); only
    // the three areas carry a unit.
    const areaUnit = isScaled ? 'um^2' : 'px^2';

    const sheet = workbook.addWorksheet('Image Metrics');
    sheet.columns = [
      { header: 'Image Name', key: 'imageName', width: 32 },
      {
        header: `Total Spheroid Area (${areaUnit})`,
        key: 'totalSpheroidArea',
        width: 26,
      },
      { header: `Core Area (${areaUnit})`, key: 'coreArea', width: 22 },
      {
        header: `Invasion Area (${areaUnit})`,
        key: 'invasionArea',
        width: 24,
      },
      // The outside-core fraction (Lim's Index B, the dispersed-mass fraction)
      // is the paper's primary read-out and comes first; the Disintegration
      // Index, a distance-weighted secondary read-out, sits beside it. The rest
      // is the paper's panel, compute_di.py's definitions. All N/A when no
      // usable core anchored the computation.
      { header: 'Outside-core Fraction (Index B)', key: 'indexB', width: 30 },
      {
        header: 'Disintegration Index',
        key: 'disintegrationIndex',
        width: 22,
      },
      { header: 'W1', key: 'wassersteinW1', width: 10 },
      { header: 'Reach p90 (R_core)', key: 'reachP90', width: 20 },
      { header: 'Corona Fragments', key: 'nFragments', width: 18 },
      {
        header: 'Largest-Fragment Fraction',
        key: 'largestFragmentFrac',
        width: 26,
      },
      { header: 'Solidity', key: 'solidity', width: 12 },
      { header: 'Core Components', key: 'nCoreComponents', width: 17 },
      {
        header: 'Largest Core Component Fraction',
        key: 'largestCoreComponentFrac',
        width: 31,
      },
      {
        header: 'Core Centroid Shift (R_core)',
        key: 'coreCentroidShift',
        width: 28,
      },
      { header: 'Core Fragmented (0/1)', key: 'coreFragmented', width: 22 },
      {
        header: 'Unvalidated Regime: Outside-core Fraction 0.08-0.47 (0/1)',
        key: 'unvalidatedRegime',
        width: 52,
      },
      {
        header: 'Below Validated Floor: Outside-core Fraction < 0.61 (0/1)',
        key: 'belowValidatedRegime',
        width: 52,
      },
      { header: 'DI Source', key: 'diSource', width: 14 },
      { header: 'Note', key: 'note', width: 48 },
      { header: 'Input-Scale Warning', key: 'warnings', width: 60 },
    ];

    const safe = (v: number, decimals = 2): number =>
      isFinite(v) ? parseFloat(v.toFixed(decimals)) : 0;
    // Panel fields are null exactly when DI wasn't core-anchored → render N/A.
    const naNum = (v: number | null, decimals: number): number | 'N/A' =>
      v === null || v === undefined || !isFinite(v)
        ? 'N/A'
        : parseFloat(v.toFixed(decimals));

    if (imageMetrics) {
      imageMetrics.forEach(m => {
        const isCore = m.referenceMode === 'core';
        sheet.addRow({
          imageName: m.imageName,
          totalSpheroidArea: safe(m.totalSpheroidArea, 2),
          coreArea: safe(m.coreArea, 2),
          invasionArea: safe(m.invasionArea, 2),
          // DI is defined only when a core anchored the computation; every
          // other reference mode (no_core / core_too_small / none / failed)
          // is a genuine N/A, not a real zero.
          disintegrationIndex: isCore ? safe(m.disintegrationIndex, 4) : 'N/A',
          indexB: naNum(m.indexB, 4),
          wassersteinW1: isCore ? safe(m.wassersteinW1, 4) : 'N/A',
          reachP90: naNum(m.reachP90, 3),
          nFragments: naNum(m.nFragments, 0),
          largestFragmentFrac: naNum(m.largestFragmentFrac, 4),
          solidity: naNum(m.solidity, 4),
          nCoreComponents: naNum(m.nCoreComponents, 0),
          largestCoreComponentFrac: naNum(m.largestCoreComponentFrac, 4),
          coreCentroidShift: naNum(m.coreCentroidShift, 4),
          coreFragmented: naNum(m.coreFragmented, 0),
          unvalidatedRegime: naNum(m.unvalidatedRegime, 0),
          belowValidatedRegime: naNum(m.belowValidatedRegime, 0),
          diSource:
            m.diSource === 'model_raster'
              ? 'raster'
              : m.diSource === 'polygons'
                ? 'polygons'
                : '',
          note: m.note ?? '',
          warnings: (m.warnings ?? []).join(' | '),
        });
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });
    await workbook.xlsx.writeFile(outputPath);
    this.logger.info(`Excel file created: ${outputPath}`, 'MetricsCalculator');
  }

  /**
   * Export sperm morphology metrics to Excel.
   * One row per sperm instance with head/midpiece/tail lengths.
   * Returns true if sperm data was found and the Excel file was written,
   * false if no polyline data exists (no file is created in that case).
   */
  async exportSpermToExcel(
    images: ImageWithSegmentation[],
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<boolean> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sperm Metrics');

    const scale = (pixelToMicrometerScale && pixelToMicrometerScale > 0) ? pixelToMicrometerScale : 1;
    const unit = scale !== 1 ? 'µm' : 'px';

    // Headers
    const columns: Partial<ExcelJS.Column>[] = [
      { header: 'Image Name', key: 'imageName', width: 25 },
      { header: 'Instance ID', key: 'instanceId', width: 15 },
      { header: `Head Length (${unit})`, key: 'headLength', width: 16 },
      { header: `Midpiece Length (${unit})`, key: 'midpieceLength', width: 18 },
      { header: `Tail Length (${unit})`, key: 'tailLength', width: 16 },
      { header: `Total Length (${unit})`, key: 'totalLength', width: 16 },
    ];
    worksheet.columns = columns;

    let hasData = false;

    for (const image of images) {
      if (!image.segmentation?.polygons) {continue;}

      let polygons: ParsedPolygon[];
      try {
        const parsed = JSON.parse(image.segmentation.polygons);
        if (!Array.isArray(parsed)) {continue;}
        polygons = parsed;
      } catch (parseError) {
        this.logger.warn(
          `Failed to parse polygons for image "${image.name}" (${image.id}) during sperm export — skipping`,
          'MetricsCalculator',
          { imageId: image.id, error: String(parseError) }
        );
        continue;
      }

      // Polylines are sperm-only (partClass ∈ {head|midpiece|tail}); narrow the
      // type so spermGrouping doesn't see the wider 'core' literal.
      const allPolylines = polygons.filter(
        (
          p
        ): p is ParsedPolygon & {
          geometry: 'polyline';
          partClass?: SpermPartClass;
        } => p.geometry === 'polyline' && p.partClass !== 'core'
      );
      const { groups, orphanCount } = groupPolylinesByInstanceId(allPolylines);
      if (orphanCount > 0) {
        this.logger.warn(
          `Image "${image.name}" has ${orphanCount} polyline(s) without instanceId — excluded from sperm metrics`,
          'MetricsCalculator',
          { imageId: image.id }
        );
      }

      for (const { instanceId, parts } of groups) {
        hasData = true;
        const head = findPart(parts, 'head');
        const mid = findPart(parts, 'midpiece');
        const tail = findPart(parts, 'tail');

        const headLen = head ? polylineLength(head.points) * scale : 0;
        const midLen = mid ? polylineLength(mid.points) * scale : 0;
        const tailLen = tail ? polylineLength(tail.points) * scale : 0;

        worksheet.addRow({
          imageName: image.name,
          instanceId,
          headLength: parseFloat(headLen.toFixed(2)),
          midpieceLength: parseFloat(midLen.toFixed(2)),
          tailLength: parseFloat(tailLen.toFixed(2)),
          totalLength: parseFloat((headLen + midLen + tailLen).toFixed(2)),
        });
      }
    }

    if (!hasData) {return false;}

    // Style header
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };

    // Create parent directory
    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });

    await workbook.xlsx.writeFile(outputPath);
    this.logger.info(
      `Sperm metrics Excel created: ${outputPath}`,
      'MetricsCalculator'
    );
    return true;
  }

  /**
   * Export metrics to CSV
   */
  async exportToCSV(
    metrics: PolygonMetrics[],
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<void> {
    // Determine units based on scale
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'imageName', title: 'Image Name' },
        { id: 'polygonId', title: 'Polygon ID' },
        { id: 'type', title: 'Type' },
        { id: 'area', title: `Area (${areaUnit})` },
        { id: 'perimeter', title: `Perimeter (${lengthUnit})` },
        {
          id: 'perimeterWithHoles',
          title: `Perimeter with Holes (${lengthUnit})`,
        },
        {
          id: 'equivalentDiameter',
          title: `Equivalent Diameter (${lengthUnit})`,
        },
        { id: 'circularity', title: 'Circularity' },
        { id: 'feretDiameterMax', title: `Feret Diameter Max (${lengthUnit})` },
        { id: 'feretDiameterMin', title: `Feret Diameter Min (${lengthUnit})` },
        {
          id: 'feretDiameterMaxOrthogonalDistance',
          title: `Feret Diameter Orthogonal (${lengthUnit})`,
        },
        { id: 'feretAspectRatio', title: 'Feret Aspect Ratio' },
        {
          id: 'lengthMajorDiameterThroughCentroid',
          title: `Major Axis Length (${lengthUnit})`,
        },
        {
          id: 'lengthMinorDiameterThroughCentroid',
          title: `Minor Axis Length (${lengthUnit})`,
        },
        { id: 'boundingBoxWidth', title: `Bounding Box Width (${lengthUnit})` },
        {
          id: 'boundingBoxHeight',
          title: `Bounding Box Height (${lengthUnit})`,
        },
        { id: 'extent', title: 'Extent' },
        { id: 'compactness', title: 'Compactness' },
        { id: 'convexity', title: 'Convexity' },
        { id: 'solidity', title: 'Solidity' },
        { id: 'sphericity', title: 'Sphericity' },
      ],
    });

    const header = csvStringifier.getHeaderString();
    const records = csvStringifier.stringifyRecords(metrics);

    // Create parent directory if it doesn't exist
    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });

    await fs.writeFile(outputPath, header + records);
    this.logger.info(`CSV file created: ${outputPath}`, 'MetricsCalculator');
  }

  /**
   * Generate summary statistics for the per-polygon metrics report.
   * Used by `exportPolygonMetricsToExcel` for `spheroid` and `wound` projects.
   * DI aggregates live in the `spheroid_invasive` Excel report directly,
   * not here — keep this function focused on shape descriptors.
   */
  private generateSummaryStatistics(
    metrics: PolygonMetrics[],
    pixelToMicrometerScale?: number
  ): SummaryStatisticsRow[] {
    const externalMetrics = metrics.filter(m => m.type === 'external');

    if (externalMetrics.length === 0) {
      return [['No external polygons found']];
    }

    const stats = {
      count: externalMetrics.length,
      avgArea: this.average(externalMetrics.map(m => m.area)),
      minArea: Math.min(...externalMetrics.map(m => m.area)),
      maxArea: Math.max(...externalMetrics.map(m => m.area)),
      avgPerimeter: this.average(externalMetrics.map(m => m.perimeter)),
      avgCircularity: this.average(externalMetrics.map(m => m.circularity)),
      avgCompactness: this.average(externalMetrics.map(m => m.compactness)),
      avgExtent: this.average(externalMetrics.map(m => m.extent)),
      avgSolidity: this.average(externalMetrics.map(m => m.solidity)),
      avgSphericity: this.average(externalMetrics.map(m => m.sphericity)),
    };

    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    const rows: SummaryStatisticsRow[] = [
      ['Summary Statistics'],
      [''],
      ['Metric', 'Value'],
      ['Total External Polygons', stats.count],
      [`Average Area (${areaUnit})`, stats.avgArea.toFixed(2)],
      [`Minimum Area (${areaUnit})`, stats.minArea.toFixed(2)],
      [`Maximum Area (${areaUnit})`, stats.maxArea.toFixed(2)],
      [`Average Perimeter (${lengthUnit})`, stats.avgPerimeter.toFixed(2)],
      ['Average Circularity', stats.avgCircularity.toFixed(4)],
      ['Average Compactness', stats.avgCompactness.toFixed(4)],
      ['Average Extent', stats.avgExtent.toFixed(4)],
      ['Average Solidity', stats.avgSolidity.toFixed(4)],
      ['Average Sphericity', stats.avgSphericity.toFixed(4)],
    ];

    return rows;
  }

  private average(numbers: number[]): number {
    if (!numbers || numbers.length === 0) {
      return 0;
    }
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }


  /**
   * Apply scale conversion to metrics with enhanced validation
   */
  private applyScaleConversion(
    metrics: PolygonMetrics[],
    scale: number
  ): PolygonMetrics[] {
    // Validate scale using enhanced validation
    const validation = validateScale(scale);

    if (!validation.valid) {
      this.logger.error(
        validation.error || 'Invalid scale value',
        new Error('Scale validation failed'),
        'MetricsCalculator'
      );
      this.logger.info(
        'Falling back to pixel units due to invalid scale',
        'MetricsCalculator'
      );
      return metrics;
    }

    if (validation.warning) {
      this.logger.warn(validation.warning, 'MetricsCalculator');

      // Log additional context for debugging
      this.logger.info(
        `Scale conversion will proceed with ${scale} um/pixel. ` +
          `This will convert: 1 pixel = ${scale.toFixed(4)} um, ` +
          `100x100 px area = ${(10000 * scale * scale).toFixed(2)} um^2`,
        'MetricsCalculator'
      );
    } else {
      // Log normal scale application for valid common values
      this.logger.info(
        `Applying scale conversion: ${scale} um/pixel (1 pixel = ${scale.toFixed(4)} um)`,
        'MetricsCalculator'
      );
    }

    return metrics.map(metric => ({
      ...metric,
      // Convert area from px^2 to um^2 (multiply by scale^2)
      area: metric.area * (scale * scale),
      // Convert linear measurements from px to um (multiply by scale)
      perimeter: metric.perimeter * scale,
      perimeterWithHoles: metric.perimeterWithHoles * scale,
      equivalentDiameter: metric.equivalentDiameter * scale,
      // A LENGTH like the Ferets beside it. Left unscaled it would stay in
      // pixels while everything it is compared against became micrometres —
      // and because `capsuleDiameter` falls back to the Feret mean, the
      // Diameter column would silently switch units per capsule.
      radialDiameter:
        metric.radialDiameter === undefined
          ? undefined
          : metric.radialDiameter * scale,
      // A LENGTH too, and it sits in the same table as Diameter — leaving it
      // in pixels would put two columns of different units side by side with
      // nothing on screen to say so.
      membraneAnnulusWidth:
        metric.membraneAnnulusWidth === undefined
          ? undefined
          : metric.membraneAnnulusWidth * scale,
      feretDiameterMax: metric.feretDiameterMax * scale,
      feretDiameterMaxOrthogonalDistance:
        metric.feretDiameterMaxOrthogonalDistance * scale,
      feretDiameterMin: metric.feretDiameterMin * scale,
      lengthMajorDiameterThroughCentroid:
        metric.lengthMajorDiameterThroughCentroid * scale,
      lengthMinorDiameterThroughCentroid:
        metric.lengthMinorDiameterThroughCentroid * scale,
      boundingBoxWidth: metric.boundingBoxWidth * scale,
      boundingBoxHeight: metric.boundingBoxHeight * scale,
      // Dimensionless ratios remain unchanged
      circularity: metric.circularity,
      feretAspectRatio: metric.feretAspectRatio,
      extent: metric.extent,
      compactness: metric.compactness,
      convexity: metric.convexity,
      solidity: metric.solidity,
      sphericity: metric.sphericity,
    }));
  }
}
