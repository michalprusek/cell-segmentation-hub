/**
 * Consolidated unit tests for `metricsCalculator.ts`.
 *
 * Merged from the former incremental-accretion files
 * (metricsCalculator.test.ts / .basicMetrics / .gaps / .gaps5). Organised by
 * concern via `describe` blocks. The sperm and microcapsule export paths keep
 * their own files (distinct exporters, distinct fixtures).
 *
 * Geometric expectations use shapes with hand-computable ground truth:
 *   unit square (side s): area = s², perimeter = 4s, diagonal = s√2.
 *
 * The ML metrics endpoint (`axios`) is mocked via `postMock`; each block sets
 * it to resolve (ML path) or reject (offline `calculateBasicMetrics` fallback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MetricsCalculator,
  PolygonMetrics,
  ImageMetrics,
  ImageWithSegmentation,
  regimeFlags,
  UNVALIDATED_FRACTION_LO,
  UNVALIDATED_FRACTION_HI,
  VALIDATED_FRACTION_FLOOR,
} from '../metricsCalculator';
import { serialiseImageMetricsForStorage } from '../rasterImageMetrics';

// ── logger (hoisted so tests can assert warn/error calls) ──────────────────────
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../../utils/logger', () => ({ logger: mockLogger }));

// ── config (hoisted + mutable so the constructor test can inject a bad URL) ─────
const { configObj } = vi.hoisted(() => ({
  configObj: { SEGMENTATION_SERVICE_URL: 'http://ml-service:8000' },
}));
vi.mock('../../../utils/config', () => ({ config: configObj }));

// ── axios (controllable post — resolves or rejects per block) ──────────────────
const postMock = vi.fn();
vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ post: postMock })) },
  create: vi.fn(() => ({ post: postMock })),
}));

// ── fs/promises (no real disk writes) ──────────────────────────────────────────
vi.mock('fs/promises', () => {
  const noop = vi.fn().mockResolvedValue(undefined);
  const api = {
    mkdir: noop,
    readFile: noop,
    writeFile: noop,
    unlink: noop,
    access: noop,
    stat: noop,
  };
  return { default: api, ...api };
});

// ── csv-writer (captures the header config for unit-label assertions) ──────────
const csvState: { header: Array<{ id: string; title: string }> } = { header: [] };
const mockGetHeaderString = vi.fn(() => 'header\n');
const mockStringifyRecords = vi.fn(() => 'row\n');
vi.mock('csv-writer', () => ({
  createObjectCsvStringifier: vi.fn(
    (cfg: { header: Array<{ id: string; title: string }> }) => {
      csvState.header = cfg.header;
      return {
        getHeaderString: mockGetHeaderString,
        stringifyRecords: mockStringifyRecords,
      };
    }
  ),
}));

// ── exceljs (first worksheet = inspected data sheet; second = summary) ─────────
const primaryColumns: Array<{ header?: string; key?: string; width?: number }> =
  [];
const primaryWorksheet = {
  get columns() {
    return primaryColumns;
  },
  set columns(v: Array<{ header?: string; key?: string; width?: number }>) {
    primaryColumns.splice(0, primaryColumns.length, ...v);
  },
  addRow: vi.fn(() => ({ font: undefined, fill: undefined })),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};
const summaryWorksheet = {
  columns: [] as Array<{ header?: string; key?: string; width?: number }>,
  addRow: vi.fn(() => ({ font: undefined, fill: undefined })),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};
const mockWriteFile = vi.fn(() => Promise.resolve());
vi.mock('exceljs', () => ({
  default: {
    Workbook: function MockWorkbook(this: object) {
      let wsCall = 0;
      return {
        addWorksheet: vi.fn(() => {
          wsCall += 1;
          return wsCall === 1 ? primaryWorksheet : summaryWorksheet;
        }),
        xlsx: { writeFile: mockWriteFile },
      };
    },
  },
}));

// ── shared geometry helpers ────────────────────────────────────────────────────

/** CCW-ordered square vertices. Area = side². */
const square = (side: number, ox = 0, oy = 0) => [
  { x: ox, y: oy },
  { x: ox + side, y: oy },
  { x: ox + side, y: oy + side },
  { x: ox, y: oy + side },
];

const extPolygon = (pts: { x: number; y: number }[]) => ({
  type: 'external' as const,
  points: pts,
});

const intPolygon = (pts: { x: number; y: number }[]) => ({
  type: 'internal' as const,
  points: pts,
});

const corePolygon = (pts: { x: number; y: number }[]) => ({
  type: 'external' as const,
  partClass: 'core' as const,
  points: pts,
});

const buildImage = (
  id: string,
  polygons: unknown[],
  dims?: { width: number; height: number }
): ImageWithSegmentation => ({
  id,
  name: `img-${id}.png`,
  width: dims?.width,
  height: dims?.height,
  segmentation: {
    polygons: JSON.stringify(polygons),
    model: 'test',
    threshold: 0.5,
  },
});

type PolyArg = Parameters<MetricsCalculator['calculateImageMetrics']>[0];

/** A full PolygonMetrics row for the exporter tests. */
const polygonMetric = (
  over: Partial<PolygonMetrics> & { polygonId: number | string }
): PolygonMetrics => ({
  imageId: 'img1',
  imageName: 'cell.png',
  type: 'external',
  area: 200,
  perimeter: 60,
  perimeterWithHoles: 60,
  equivalentDiameter: 15.96,
  circularity: 0.7,
  feretDiameterMax: 20,
  feretDiameterMaxOrthogonalDistance: 14,
  feretDiameterMin: 12,
  feretAspectRatio: 1.67,
  lengthMajorDiameterThroughCentroid: 20,
  lengthMinorDiameterThroughCentroid: 12,
  boundingBoxWidth: 22,
  boundingBoxHeight: 14,
  extent: 0.65,
  compactness: 1.43,
  convexity: 0.95,
  solidity: 0.92,
  sphericity: 0.56,
  ...over,
});

/** Full ML response payload for a 10×10 square (Capitalised keys, as read by the SUT). */
const ML_SQUARE_10 = {
  Area: 100,
  Perimeter: 40,
  PerimeterWithHoles: 40,
  EquivalentDiameter: 11.28,
  Circularity: 0.785,
  FeretDiameterMax: 14.14,
  FeretDiameterMaxOrthogonalDistance: 10,
  FeretDiameterMin: 10,
  FeretAspectRatio: 1.414,
  LengthMajorDiameterThroughCentroid: 14.14,
  LengthMinorDiameterThroughCentroid: 10,
  BoundingBoxWidth: 10,
  BoundingBoxHeight: 10,
  Extent: 1.0,
  Compactness: 1.27,
  Convexity: 1.0,
  Solidity: 1.0,
  Sphericity: 0.628,
};

/** ML payload for a 100×100 square, used by the scale-conversion block. */
const ML_SQUARE_100 = {
  Area: 10000,
  Perimeter: 400,
  PerimeterWithHoles: 400,
  EquivalentDiameter: 112.84,
  Circularity: 0.785,
  FeretDiameterMax: 141.42,
  FeretDiameterMaxOrthogonalDistance: 100,
  FeretDiameterMin: 100,
  FeretAspectRatio: 1.414,
  LengthMajorDiameterThroughCentroid: 141.42,
  LengthMinorDiameterThroughCentroid: 100,
  BoundingBoxWidth: 100,
  BoundingBoxHeight: 100,
  Extent: 1.0,
  Compactness: 0.785,
  Convexity: 0.9,
  Solidity: 0.95,
  Sphericity: 0.628,
};

beforeEach(() => {
  // clearMocks + restoreMocks run automatically (vitest.config.ts). Reset the
  // shared mutable state the mocks close over.
  configObj.SEGMENTATION_SERVICE_URL = 'http://ml-service:8000';
  primaryColumns.length = 0;
  csvState.header = [];
});

// ════════════════════════════════════════════════════════════════════════════
// constructor
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — constructor', () => {
  it('throws when SEGMENTATION_SERVICE_URL has an invalid protocol', () => {
    configObj.SEGMENTATION_SERVICE_URL = 'ftp://ml-service:8000';
    expect(() => new MetricsCalculator()).toThrow(
      /Invalid.*SEGMENTATION_SERVICE_URL/i
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calculateAllMetrics — scale conversion (ML path, 100×100 payload)
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateAllMetrics: scale conversion', () => {
  let calc: MetricsCalculator;
  const image = buildImage('scale', [extPolygon(square(100))]);

  beforeEach(() => {
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_100 });
  });

  it('scales area by scale² and lengths by scale; leaves ratios unchanged', async () => {
    const metrics = await calc.calculateAllMetrics([image], 2.0);
    expect(metrics).toHaveLength(1);
    const m = metrics[0]!;
    expect(m.area).toBe(10000 * 4); // px² × scale²
    expect(m.perimeter).toBe(400 * 2); // px × scale
    expect(m.equivalentDiameter).toBeCloseTo(112.84 * 2);
    expect(m.feretDiameterMax).toBeCloseTo(141.42 * 2);
    expect(m.feretDiameterMin).toBe(100 * 2);
    // Dimensionless ratios are scale-invariant.
    expect(m.circularity).toBeCloseTo(0.785);
    expect(m.feretAspectRatio).toBeCloseTo(1.414);
    expect(m.compactness).toBeCloseTo(0.785);
    expect(m.convexity).toBe(0.9);
    expect(m.solidity).toBe(0.95);
    expect(m.sphericity).toBeCloseTo(0.628);
  });

  it('applies a fractional scale (0.5) to area and lengths', async () => {
    const metrics = await calc.calculateAllMetrics([image], 0.5);
    const m = metrics[0]!;
    expect(m.area).toBe(10000 * 0.25);
    expect(m.perimeter).toBe(400 * 0.5);
    expect(m.equivalentDiameter).toBeCloseTo(112.84 * 0.5);
  });

  it('leaves values in pixels when scale is undefined', async () => {
    const m = (await calc.calculateAllMetrics([image], undefined))[0]!;
    expect(m.area).toBe(10000);
    expect(m.perimeter).toBe(400);
    expect(m.equivalentDiameter).toBeCloseTo(112.84);
  });

  it.each([
    ['zero', 0],
    ['negative', -2],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('leaves values in pixels when scale is %s', async (_label, scale) => {
    const m = (await calc.calculateAllMetrics([image], scale as number))[0]!;
    expect(m.area).toBe(10000);
    expect(m.perimeter).toBe(400);
  });

  it('warns for an unusually high scale value', async () => {
    await calc.calculateAllMetrics([image], 150);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('High scale value detected'),
      'MetricsCalculator'
    );
  });

  it('warns for an unusually low scale value', async () => {
    await calc.calculateAllMetrics([image], 0.005);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Low scale value detected'),
      'MetricsCalculator'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calculateAllMetrics — image-level handling (ML path, 10×10 payload)
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateAllMetrics: image-level handling', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('returns an empty array for an empty image list', async () => {
    expect(await calc.calculateAllMetrics([])).toHaveLength(0);
  });

  it('skips an image with no segmentation field', async () => {
    const image: ImageWithSegmentation = { id: 'no-seg', name: 'blank.png' };
    expect(await calc.calculateAllMetrics([image])).toHaveLength(0);
  });

  it('skips an image whose polygon JSON is malformed', async () => {
    const image: ImageWithSegmentation = {
      id: 'bad-json',
      name: 'bad.png',
      segmentation: { polygons: '{bad', model: 'x', threshold: 0.5 },
    };
    expect(await calc.calculateAllMetrics([image])).toHaveLength(0);
  });

  it('filters out polyline polygons before calling the ML endpoint', async () => {
    const polyline = {
      geometry: 'polyline' as const,
      type: 'external' as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const result = await calc.calculateAllMetrics([
      buildImage('pl-only', [polyline]),
    ]);
    expect(result).toHaveLength(0);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('returns one metric entry per external polygon on success', async () => {
    const image = buildImage('two-ext', [
      extPolygon(square(10)),
      extPolygon(square(5, 20, 20)),
    ]);
    expect(await calc.calculateAllMetrics([image])).toHaveLength(2);
  });

  it('falls back to basic metrics when the ML endpoint rejects', async () => {
    postMock.mockRejectedValue(new Error('ML down'));
    const result = await calc.calculateAllMetrics([
      buildImage('fallback', [extPolygon(square(10))]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.area).toBeCloseTo(100, 3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calculateAllMetrics — polygon-count thresholds
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateAllMetrics: polygon-count thresholds', () => {
  const imageWithNPolygons = (n: number): ImageWithSegmentation => {
    const polys = Array.from({ length: n }, (_, i) => ({
      type: 'external' as const,
      points: square(10, i * 20, 0),
    }));
    return buildImage('bulk', polys, { width: 500, height: 500 });
  };

  beforeEach(() => {
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('logs an error when the polygon count exceeds the ERROR threshold (>5000)', async () => {
    await new MetricsCalculator().calculateAllMetrics([
      imageWithNPolygons(5001),
    ]);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringMatching(/exceeds error threshold/i),
      expect.any(Error),
      'MetricsCalculator'
    );
  });

  it('logs a warning when the polygon count exceeds the WARN threshold (>1000)', async () => {
    await new MetricsCalculator().calculateAllMetrics([
      imageWithNPolygons(1001),
    ]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/High polygon count/i),
      'MetricsCalculator'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calculateImageMetrics — ML success mapping (10×10 payload)
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateImageMetrics: ML success path', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('maps every ML response field 1:1 onto PolygonMetrics', async () => {
    const result = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'ml-ok',
      'name.png'
    );
    expect(result).toHaveLength(1);
    const m = result[0]!;
    expect(m.imageId).toBe('ml-ok');
    expect(m.imageName).toBe('name.png');
    expect(m.area).toBe(ML_SQUARE_10.Area);
    expect(m.perimeter).toBe(ML_SQUARE_10.Perimeter);
    expect(m.perimeterWithHoles).toBe(ML_SQUARE_10.PerimeterWithHoles);
    expect(m.feretDiameterMax).toBe(ML_SQUARE_10.FeretDiameterMax);
    expect(m.feretDiameterMin).toBe(ML_SQUARE_10.FeretDiameterMin);
    expect(m.feretAspectRatio).toBe(ML_SQUARE_10.FeretAspectRatio);
    expect(m.circularity).toBe(ML_SQUARE_10.Circularity);
    expect(m.compactness).toBe(ML_SQUARE_10.Compactness);
    expect(m.convexity).toBe(ML_SQUARE_10.Convexity);
    expect(m.solidity).toBe(ML_SQUARE_10.Solidity);
    expect(m.sphericity).toBe(ML_SQUARE_10.Sphericity);
    expect(m.extent).toBe(ML_SQUARE_10.Extent);
    expect(m.boundingBoxWidth).toBe(ML_SQUARE_10.BoundingBoxWidth);
    expect(m.boundingBoxHeight).toBe(ML_SQUARE_10.BoundingBoxHeight);
  });

  it('falls back to basic metrics when the ML response is missing required keys', async () => {
    postMock.mockResolvedValue({ data: { Area: 100 } });
    const result = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'ml-missing',
      'test.png'
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.area).toBeCloseTo(100, 3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calculateImageMetrics — offline calculateBasicMetrics fallback (ML rejects)
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateImageMetrics: offline fallback geometry', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    calc = new MetricsCalculator();
    // Force the ML endpoint to reject so every polygon hits calculateBasicMetrics.
    postMock.mockRejectedValue(new Error('ML service unavailable'));
  });

  const forSquare10 = () =>
    calc.calculateImageMetrics([extPolygon(square(10))], 'sq10', 'test.png');

  it('computes Shoelace area = 100 for a 10×10 square', async () => {
    expect((await forSquare10())[0]!.area).toBeCloseTo(100, 5);
  });

  it('computes perimeter = 40 for a 10×10 square', async () => {
    expect((await forSquare10())[0]!.perimeter).toBeCloseTo(40, 5);
  });

  it('computes circularity in (0.78, 1] for a square', async () => {
    const c = (await forSquare10())[0]!.circularity;
    expect(c).toBeGreaterThan(0.78);
    expect(c).toBeLessThanOrEqual(1.0);
  });

  it('computes compactness ≈ 1 / circularity', async () => {
    const m = (await forSquare10())[0]!;
    expect(m.compactness).toBeCloseTo(1 / m.circularity, 1);
  });

  it('computes equivalentDiameter = sqrt(4A/π)', async () => {
    const expected = Math.sqrt((4 * 100) / Math.PI);
    expect((await forSquare10())[0]!.equivalentDiameter).toBeCloseTo(expected, 3);
  });

  it('computes feretDiameterMax = side·√2 (square diagonal)', async () => {
    expect((await forSquare10())[0]!.feretDiameterMax).toBeCloseTo(
      10 * Math.SQRT2,
      2
    );
  });

  it('computes feretDiameterMin = side = 10', async () => {
    expect((await forSquare10())[0]!.feretDiameterMin).toBeCloseTo(10, 1);
  });

  it('computes feretAspectRatio ≈ √2', async () => {
    expect((await forSquare10())[0]!.feretAspectRatio).toBeCloseTo(Math.SQRT2, 1);
  });

  it('computes convexity ≈ 1 for a convex shape', async () => {
    expect((await forSquare10())[0]!.convexity).toBeCloseTo(1, 2);
  });

  it('computes solidity = 1 for a convex shape', async () => {
    expect((await forSquare10())[0]!.solidity).toBeCloseTo(1, 2);
  });

  it('computes sphericity = circularity × 0.8', async () => {
    const m = (await forSquare10())[0]!;
    expect(m.sphericity).toBeCloseTo(m.circularity * 0.8, 5);
  });

  it('computes extent = area / bbox = 1 for a square', async () => {
    expect((await forSquare10())[0]!.extent).toBeCloseTo(1, 5);
  });

  it('computes the bounding box of a 10×20 rectangle', async () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    const m = (
      await calc.calculateImageMetrics([extPolygon(rect)], 'rect', 'test.png')
    )[0]!;
    expect(m.boundingBoxWidth).toBeCloseTo(10, 5);
    expect(m.boundingBoxHeight).toBeCloseTo(20, 5);
  });

  it('subtracts hole area from the reported area', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10)), intPolygon(square(4, 3, 3))],
      'with-hole',
      'test.png'
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.area).toBeCloseTo(84, 1); // 100 − 16
  });

  it('adds hole perimeter to perimeterWithHoles', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10)), intPolygon(square(4, 3, 3))],
      'with-hole',
      'test.png'
    );
    expect(metrics[0]!.perimeterWithHoles).toBeCloseTo(56, 1); // 40 + 16
  });

  it('skips degenerate polygons with fewer than 3 points', async () => {
    const degenerate = {
      type: 'external' as const,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const metrics = await calc.calculateImageMetrics(
      [degenerate as PolyArg[number]],
      'degen',
      'test.png'
    );
    expect(metrics).toHaveLength(0);
  });

  it('returns an empty array when no external polygons are provided', async () => {
    const metrics = await calc.calculateImageMetrics(
      [intPolygon(square(5)) as unknown as PolyArg[number]],
      'no-ext',
      'test.png'
    );
    expect(metrics).toHaveLength(0);
  });

  it('returns an empty array for an empty polygon list', async () => {
    expect(
      await calc.calculateImageMetrics([], 'empty', 'test.png')
    ).toHaveLength(0);
  });

  it('assigns incremental polygonId starting at 1 and type="external"', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10)), extPolygon(square(5, 20, 20))],
      'two-polys',
      'test.png'
    );
    expect(metrics).toHaveLength(2);
    expect(metrics[0]!.polygonId).toBe(1);
    expect(metrics[1]!.polygonId).toBe(2);
    expect(metrics[0]!.type).toBe('external');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calculateAllImageMetrics — disintegration per-image / disintegration panel
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateAllImageMetrics (DI / panel)', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    calc = new MetricsCalculator();
    // Default: DI endpoint succeeds; individual tests override.
    postMock.mockResolvedValue({
      data: { di: 0.3, w1: 1.5, reference: 'core', n_pixels: 50000 },
    });
  });

  it('returns an empty-sentinel row for an image with no segmentation', async () => {
    const row = (
      await calc.calculateAllImageMetrics([{ id: 'no-seg', name: 'blank.png' }])
    )[0]!;
    expect(row.imageId).toBe('no-seg');
    expect(row.polygonCount).toBe(0);
    expect(row.disintegrationIndex).toBe(0);
    expect(row.referenceMode).toBe('none');
    expect(row.totalSpheroidArea).toBe(0);
    expect(row.coreArea).toBe(0);
    expect(row.invasionArea).toBe(0);
  });

  it('returns referenceMode="failed" for malformed polygon JSON', async () => {
    const image: ImageWithSegmentation = {
      id: 'bad-json',
      name: 'bad.png',
      segmentation: { polygons: '{not valid json', model: 'x', threshold: 0.5 },
    };
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.referenceMode).toBe('failed');
  });

  it('computes totalSpheroidArea via Shoelace for an external non-core polygon', async () => {
    const row = (
      await calc.calculateAllImageMetrics([
        buildImage('a1', [extPolygon(square(10))]),
      ])
    )[0]!;
    expect(row.totalSpheroidArea).toBeCloseTo(100, 3);
  });

  it('excludes core polygons from totalSpheroidArea and reports coreArea', async () => {
    const image = buildImage('a2', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ]);
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.totalSpheroidArea).toBeCloseTo(100, 3);
    expect(row.coreArea).toBeCloseTo(16, 3);
  });

  it('invasionArea = totalSpheroidArea − coreArea', async () => {
    const image = buildImage('a3', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ]);
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.invasionArea).toBeCloseTo(84, 3);
  });

  it('applies pixelToMicrometerScale² to area fields', async () => {
    const row = (
      await calc.calculateAllImageMetrics(
        [buildImage('a4', [extPolygon(square(10))])],
        2
      )
    )[0]!;
    expect(row.totalSpheroidArea).toBeCloseTo(400, 3); // 100 × 2²
  });

  it('referenceMode="none" when only an internal polygon is present', async () => {
    const row = (
      await calc.calculateAllImageMetrics([
        buildImage('a5', [intPolygon(square(5))]),
      ])
    )[0]!;
    expect(row.referenceMode).toBe('none');
    expect(row.disintegrationIndex).toBe(0);
  });

  it('referenceMode="none" when a core is present but the image lacks dimensions', async () => {
    const image = buildImage('a6', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ]);
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.referenceMode).toBe('none');
  });

  it('referenceMode="no_core" when externals exist without a core → panel is N/A, no ML call', async () => {
    const image = buildImage('a6b', [extPolygon(square(10))], {
      width: 100,
      height: 100,
    });
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.referenceMode).toBe('no_core');
    expect(row.disintegrationIndex).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
    expect(row.totalSpheroidArea).toBeCloseTo(100, 3);
    expect(row.indexB).toBeNull();
    expect(row.reachP90).toBeNull();
    expect(row.nFragments).toBeNull();
    expect(row.solidity).toBeNull();
    expect(row.coreFragmented).toBeNull();
    expect(row.diSource).toBe('polygons');
  });

  it('referenceMode="failed" when the DI HTTP call rejects (area still computed)', async () => {
    postMock.mockRejectedValue(new Error('Network error'));
    const image = buildImage('a7', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ], { width: 100, height: 100 });
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.referenceMode).toBe('failed');
    expect(row.totalSpheroidArea).toBeCloseTo(100, 3);
  });

  const corePanel = {
    di: 0.42,
    w1: 2.1,
    reference: 'core',
    n_pixels: 12345,
    note: '',
    warnings: [],
    index_b: 0.7,
    reach_p90: 2.5,
    n_fragments: 4,
    largest_fragment_frac: 0.55,
    solidity: 0.6,
    area_core_px: 3700,
    area_corona_px: 8645,
    area_total_px: 12345,
    n_core_components: 1,
    largest_core_component_frac: 1.0,
    core_centroid_shift: 0.0,
    core_fragmented: 0,
    unvalidated_regime: 0,
    below_validated_regime: 1,
  };

  it('propagates DI + the paper panel from a successful polygon-path response', async () => {
    postMock.mockResolvedValue({ data: corePanel });
    const image = buildImage('a8', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ], { width: 100, height: 100 });
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.disintegrationIndex).toBeCloseTo(0.42, 5);
    expect(row.wassersteinW1).toBeCloseTo(2.1, 5);
    expect(row.referenceMode).toBe('core');
    expect(row.nPixels).toBe(12345);
    expect(row.indexB).toBeCloseTo(0.7, 5);
    expect(row.reachP90).toBeCloseTo(2.5, 5);
    expect(row.nFragments).toBe(4);
    expect(row.largestFragmentFrac).toBeCloseTo(0.55, 5);
    expect(row.solidity).toBeCloseTo(0.6, 5);
    expect(row.nCoreComponents).toBe(1);
    expect(row.coreFragmented).toBe(0);
    expect(row.unvalidatedRegime).toBe(0);
    // The panel carries below_validated_regime = 1, as the old DI < 0.6 rule
    // gave for DI 0.42. The flag is derived from Index B (0.7 >= 0.61), so 0.
    expect(row.belowValidatedRegime).toBe(0);
    expect(row.diSource).toBe('polygons');
    // polygon path keeps the Shoelace areas
    expect(row.totalSpheroidArea).toBeCloseTo(100, 3);
  });

  it('sends the entered scale to the polygon path only as pixel_size_um', async () => {
    postMock.mockResolvedValue({ data: { ...corePanel, warnings: ['pixel size is 2 um/px; …'] } });
    const image = buildImage('a8b', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ], { width: 100, height: 100 });
    const row = (await calc.calculateAllImageMetrics([image], 2))[0]!;
    const body = postMock.mock.calls[0][1] as Record<string, unknown>;
    expect(body.pixel_size_um).toBe(2);
    expect(row.reachP90).toBeCloseTo(2.5, 5); // scale-free
    expect(row.warnings).toEqual(['pixel size is 2 um/px; …']);
  });

  it('maps an undefined-DI reference (core_too_small) to N/A with its note', async () => {
    postMock.mockResolvedValue({
      data: {
        di: 0, w1: 0, reference: 'core_too_small', n_pixels: 500,
        note: 'core of 16 px is below the minimum core size', warnings: [],
        index_b: null, reach_p90: null, n_fragments: null,
        largest_fragment_frac: null, solidity: null,
        n_core_components: 1, largest_core_component_frac: 1,
        core_centroid_shift: 0, core_fragmented: null,
        unvalidated_regime: null, below_validated_regime: null,
      },
    });
    const image = buildImage('a8c', [
      extPolygon(square(10)),
      corePolygon(square(4)),
    ], { width: 100, height: 100 });
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.referenceMode).toBe('core_too_small');
    expect(row.indexB).toBeNull();
    expect(row.note).toContain('minimum core size');
  });

  describe('regime flags', () => {
    it('are functions of the outside-core fraction alone', () => {
      expect(regimeFlags(null)).toEqual({ unvalidatedRegime: null, belowValidatedRegime: null });
      // intact: at the floor, not in the gap
      expect(regimeFlags(0)).toEqual({ unvalidatedRegime: 0, belowValidatedRegime: 1 });
      // the gap [0.08, 0.47) that holds no expert mask of the paper's release
      expect(regimeFlags(0.0799)).toEqual({ unvalidatedRegime: 0, belowValidatedRegime: 1 });
      expect(regimeFlags(0.08)).toEqual({ unvalidatedRegime: 1, belowValidatedRegime: 1 });
      expect(regimeFlags(0.4699)).toEqual({ unvalidatedRegime: 1, belowValidatedRegime: 1 });
      expect(regimeFlags(0.47)).toEqual({ unvalidatedRegime: 0, belowValidatedRegime: 1 });
      // the detection floor
      expect(regimeFlags(0.6099)).toEqual({ unvalidatedRegime: 0, belowValidatedRegime: 1 });
      expect(regimeFlags(0.61)).toEqual({ unvalidatedRegime: 0, belowValidatedRegime: 0 });
      expect(regimeFlags(0.95)).toEqual({ unvalidatedRegime: 0, belowValidatedRegime: 0 });
    });

    it('use the bounds of the ported compute_di.py', () => {
      const py = readFileSync(
        join(__dirname, '../../../../segmentation/api/disintegration_metrics.py'),
        'utf8'
      );
      const gap = /^UNVALIDATED_LO, UNVALIDATED_HI = ([0-9.]+), ([0-9.]+)$/m.exec(py);
      const floor = /^VALIDATED_FRACTION_FLOOR = ([0-9.]+)$/m.exec(py);
      expect(gap).not.toBeNull();
      expect(floor).not.toBeNull();
      expect(Number(gap![1])).toBe(UNVALIDATED_FRACTION_LO);
      expect(Number(gap![2])).toBe(UNVALIDATED_FRACTION_HI);
      expect(Number(floor![1])).toBe(VALIDATED_FRACTION_FLOOR);
      // the floor is no longer keyed on the distance-weighted index
      expect(py).not.toMatch(/VALIDATED_DI_FLOOR/);
    });
  });

  describe('stored raster read-out', () => {
    const polys = [extPolygon(square(10)), corePolygon(square(4))];
    const polygonsJson = JSON.stringify(polys);
    const raster = {
      algorithm: 'spheroid_seg/compute_di.py',
      algorithm_sha256: 'efdb7c3b',
      source: 'model_raster',
      image_width: 1024,
      image_height: 1024,
      reference: 'core',
      note: '',
      warnings: ['frame is 1024x1024 px; …'],
      DI: 0.61,
      W1: 0.71,
      index_B: 0.64,
      reach_p90: 1.86,
      n_fragments: 43,
      largest_fragment_frac: 0.86,
      solidity: 0.18,
      area_core_px: 20000,
      area_corona_px: 35000,
      area_total_px: 55000,
      n_core_components: 1,
      largest_core_component_frac: 1,
      core_centroid_shift: 0,
      core_fragmented: 0,
      unvalidated_regime: 0,
      below_validated_regime: 0,
    };
    const withStored = (id: string, polygons: string, stored: string | null) => ({
      id,
      name: `img-${id}.png`,
      width: 1024,
      height: 1024,
      segmentation: { polygons, model: 'spheroid_disintegration', threshold: 0.5, imageMetrics: stored },
    });

    it('is used, without any ML call, while its hash matches the polygons', async () => {
      const stored = serialiseImageMetricsForStorage(raster, polygonsJson);
      const row = (await calc.calculateAllImageMetrics([withStored('r1', polygonsJson, stored)], 2))[0]!;
      expect(postMock).not.toHaveBeenCalled();
      expect(row.diSource).toBe('model_raster');
      expect(row.disintegrationIndex).toBeCloseTo(0.61, 6);
      expect(row.indexB).toBeCloseTo(0.64, 6);
      expect(row.nFragments).toBe(43);
      // raster pixel counts × scale², not the polygons' Shoelace areas
      expect(row.totalSpheroidArea).toBeCloseTo(55000 * 4, 3);
      expect(row.coreArea).toBeCloseTo(20000 * 4, 3);
      expect(row.invasionArea).toBeCloseTo(35000 * 4, 3);
      // stored frame warning + the export-time pixel-size warning
      expect(row.warnings).toHaveLength(2);
      expect(row.warnings[1]).toContain('pixel size is 2 um/px');
    });

    it('re-derives both regime flags from the stored Index B, whatever flags were stored', async () => {
      // A read-out stored while the flags keyed on DI < 0.6 and on [0.15, 0.30):
      // DI 0.5 with Index B 0.64 was stored as below the floor, and Index B 0.10
      // as outside the unvalidated range.
      const stale = (indexB: number, di: number, below: number, unval: number) =>
        serialiseImageMetricsForStorage(
          { ...raster, DI: di, index_B: indexB, below_validated_regime: below, unvalidated_regime: unval },
          polygonsJson
        );
      const hug = (await calc.calculateAllImageMetrics([withStored('rf1', polygonsJson, stale(0.64, 0.5, 1, 0))]))[0]!;
      expect(postMock).not.toHaveBeenCalled();
      expect(hug.diSource).toBe('model_raster');
      expect(hug.belowValidatedRegime).toBe(0);
      expect(hug.unvalidatedRegime).toBe(0);
      const rim = (await calc.calculateAllImageMetrics([withStored('rf2', polygonsJson, stale(0.1, 0.03, 1, 0))]))[0]!;
      expect(rim.belowValidatedRegime).toBe(1);
      expect(rim.unvalidatedRegime).toBe(1);
    });

    it('is ignored once the polygons were edited (hash mismatch) and says so', async () => {
      postMock.mockResolvedValue({ data: corePanel });
      const stored = serialiseImageMetricsForStorage(raster, polygonsJson);
      const edited = JSON.stringify([extPolygon(square(11)), corePolygon(square(4))]);
      const row = (await calc.calculateAllImageMetrics([withStored('r2', edited, stored)]))[0]!;
      expect(postMock).toHaveBeenCalledTimes(1);
      expect(row.diSource).toBe('polygons');
      expect(row.disintegrationIndex).toBeCloseTo(0.42, 6);
      expect(row.note).toContain('polygons edited since segmentation');
    });

    it('falls back to the polygons when nothing is stored, with no note', async () => {
      postMock.mockResolvedValue({ data: corePanel });
      const row = (await calc.calculateAllImageMetrics([withStored('r3', polygonsJson, null)]))[0]!;
      expect(row.diSource).toBe('polygons');
      expect(row.note).toBe('');
    });

    it('reports an undefined raster DI as N/A even though polygons exist', async () => {
      const stored = serialiseImageMetricsForStorage(
        { ...raster, reference: 'core_too_small', note: 'core of 900 px is below the minimum core size', DI: null, index_B: null },
        polygonsJson
      );
      const row = (await calc.calculateAllImageMetrics([withStored('r4', polygonsJson, stored)]))[0]!;
      expect(postMock).not.toHaveBeenCalled();
      expect(row.referenceMode).toBe('core_too_small');
      expect(row.indexB).toBeNull();
      expect(row.note).toContain('minimum core size');
    });
  });

  it('polygonCount counts every closed polygon but excludes polylines', async () => {
    const polyline = {
      geometry: 'polyline' as const,
      type: 'external' as const,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    };
    const image = buildImage('a9', [
      extPolygon(square(10)),
      intPolygon(square(3, 2, 2)),
      extPolygon(square(5, 15, 15)),
      polyline,
    ]);
    const row = (await calc.calculateAllImageMetrics([image]))[0]!;
    expect(row.polygonCount).toBe(3); // 2 external + 1 internal; polyline excluded
  });

  it('processes multiple images independently', async () => {
    const result = await calc.calculateAllImageMetrics([
      buildImage('b1', [extPolygon(square(10))]),
      buildImage('b2', [extPolygon(square(20))]),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.imageId).toBe('b1');
    expect(result[1]!.imageId).toBe('b2');
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(100, 3);
    expect(result[1]!.totalSpheroidArea).toBeCloseTo(400, 3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// exportPolygonMetricsToExcel (spheroid / wound per-polygon report)
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — exportPolygonMetricsToExcel', () => {
  let calc: MetricsCalculator;
  const sample = [polygonMetric({ polygonId: 1 })];

  beforeEach(() => {
    calc = new MetricsCalculator();
  });

  it('writes to the given path with px^2/px units when no scale is supplied', async () => {
    await calc.exportPolygonMetricsToExcel(sample, '/tmp/test.xlsx');
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/test.xlsx');
    const headers = primaryColumns.map(c => c.header ?? '');
    expect(headers.some(h => h.includes('px^2'))).toBe(true);
    expect(headers.some(h => h.includes('px'))).toBe(true);
  });

  it('uses um^2/um units when a scale is provided', async () => {
    await calc.exportPolygonMetricsToExcel(sample, '/tmp/test.xlsx', 0.5);
    const headers = primaryColumns.map(c => c.header ?? '');
    expect(headers.some(h => h.includes('um^2'))).toBe(true);
    expect(headers.some(h => h.includes('um'))).toBe(true);
  });

  it('adds one data row per metric entry', async () => {
    await calc.exportPolygonMetricsToExcel(sample, '/tmp/test.xlsx');
    expect(primaryWorksheet.addRow).toHaveBeenCalledTimes(sample.length);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// exportToExcel (disintegration / spheroid_invasive per-image report)
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — exportToExcel (spheroid_invasive)', () => {
  let calc: MetricsCalculator;

  const sampleImageMetrics: ImageMetrics[] = [
    {
      imageId: 'img-a',
      imageName: 'well1.png',
      polygonCount: 3,
      disintegrationIndex: 0.42,
      wassersteinW1: 1.8,
      referenceMode: 'core',
      nPixels: 50000,
      totalSpheroidArea: 1200,
      coreArea: 300,
      invasionArea: 900,
      indexB: 0.75,
      reachP90: 2.5,
      nFragments: 3,
      largestFragmentFrac: 0.6,
      solidity: 0.55,
      nCoreComponents: 2,
      largestCoreComponentFrac: 0.985,
      coreCentroidShift: 0.12,
      coreFragmented: 1,
      unvalidatedRegime: 0,
      belowValidatedRegime: 1,
      diSource: 'model_raster',
      note: '',
      warnings: ['frame is 1024x1024 px; …', 'pixel size is 2 um/px; …'],
    },
    {
      imageId: 'img-b',
      imageName: 'well2.png',
      polygonCount: 2,
      disintegrationIndex: 0.15,
      wassersteinW1: 0.6,
      referenceMode: 'no_core',
      nPixels: 30000,
      totalSpheroidArea: 800,
      coreArea: 0,
      invasionArea: 800,
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
      diSource: 'polygons',
      note: 'no core: DI undefined',
      warnings: [],
    },
  ];

  const addRowCalls = () =>
    (primaryWorksheet.addRow as ReturnType<typeof vi.fn>).mock.calls;

  beforeEach(() => {
    calc = new MetricsCalculator();
  });

  it('writes to the given path with px^2 units and one row per image metric', async () => {
    await calc.exportToExcel([], '/tmp/aspp.xlsx', undefined, sampleImageMetrics);
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/aspp.xlsx');
    expect(primaryWorksheet.addRow).toHaveBeenCalledTimes(
      sampleImageMetrics.length
    );
    const headers = primaryColumns.map(c => c.header ?? '');
    expect(headers.some(h => h.includes('px^2'))).toBe(true);
  });

  it('writes the disintegrationIndex for a core row and "N/A" for a non-core row', async () => {
    await calc.exportToExcel([], '/tmp/aspp.xlsx', undefined, sampleImageMetrics);
    const calls = addRowCalls();
    expect((calls[0][0] as Record<string, number>).disintegrationIndex).toBeCloseTo(
      0.42,
      4
    );
    expect(
      (calls[1][0] as Record<string, unknown>).disintegrationIndex
    ).toBe('N/A');
  });

  it('writes the paper panel for a core row and "N/A" for a no_core row', async () => {
    await calc.exportToExcel([], '/tmp/aspp.xlsx', undefined, sampleImageMetrics);
    const calls = addRowCalls();
    const coreRow = calls[0][0] as Record<string, unknown>;
    const noCoreRow = calls[1][0] as Record<string, unknown>;
    expect(coreRow.indexB).toBeCloseTo(0.75, 4);
    expect(coreRow.reachP90).toBeCloseTo(2.5, 3);
    expect(coreRow.nFragments).toBe(3);
    expect(coreRow.largestFragmentFrac).toBeCloseTo(0.6, 4);
    expect(coreRow.solidity).toBeCloseTo(0.55, 4);
    expect(coreRow.nCoreComponents).toBe(2);
    expect(coreRow.coreFragmented).toBe(1);
    expect(coreRow.belowValidatedRegime).toBe(1);
    expect(coreRow.diSource).toBe('raster');
    expect(coreRow.warnings).toBe('frame is 1024x1024 px; … | pixel size is 2 um/px; …');
    for (const key of [
      'indexB',
      'wassersteinW1',
      'reachP90',
      'nFragments',
      'largestFragmentFrac',
      'solidity',
      'coreFragmented',
      'unvalidatedRegime',
      'belowValidatedRegime',
    ]) {
      expect(noCoreRow[key]).toBe('N/A');
    }
    expect(noCoreRow.diSource).toBe('polygons');
    expect(noCoreRow.note).toBe('no core: DI undefined');
  });

  it('has no q95 / hole-count / equivalent-diameter columns any more', async () => {
    await calc.exportToExcel([], '/tmp/aspp.xlsx', 2.0, sampleImageMetrics);
    const headers = primaryColumns.map(c => c.header ?? '');
    expect(headers.some(h => h.includes('um^2'))).toBe(true);
    expect(headers).toContain('Outside-core Fraction (Index B)');
    expect(headers).toContain('Unvalidated Regime: Outside-core Fraction 0.08-0.47 (0/1)');
    expect(headers).toContain('Below Validated Floor: Outside-core Fraction < 0.61 (0/1)');
    expect(headers.some(h => /DI < 0\.6|0\.15-0\.30/.test(h))).toBe(false);
    expect(headers).toContain('Reach p90 (R_core)');
    expect(headers.some(h => /q95|Hole Count|Equiv\. Diameter/.test(h))).toBe(false);
  });

  it('puts the outside-core fraction first, the Disintegration Index directly after it', async () => {
    // The paper reports the outside-core fraction (Index B) as its primary
    // read-out and DI as the secondary one; the sheet follows that order.
    await calc.exportToExcel([], '/tmp/aspp.xlsx', 2.0, sampleImageMetrics);
    const headers = primaryColumns.map(c => c.header ?? '');
    const fraction = headers.indexOf('Outside-core Fraction (Index B)');
    expect(fraction).toBeGreaterThan(-1);
    expect(headers.indexOf('Disintegration Index')).toBe(fraction + 1);
    expect(headers.indexOf('Invasion Area (um^2)')).toBe(fraction - 1);
  });

  it('adds no rows for empty imageMetrics', async () => {
    await calc.exportToExcel([], '/tmp/empty.xlsx', undefined, []);
    expect(primaryWorksheet.addRow).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// exportToCSV — unit labels
// ════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — exportToCSV', () => {
  let calc: MetricsCalculator;
  const sample = [polygonMetric({ polygonId: 1 })];

  const areaTitle = () =>
    csvState.header.find(h => h.id === 'area')?.title ?? '';

  beforeEach(() => {
    calc = new MetricsCalculator();
  });

  it('labels columns with um^2/um when a scale is provided', async () => {
    await calc.exportToCSV(sample, '/tmp/metrics.csv', 0.5);
    expect(mockGetHeaderString).toHaveBeenCalled();
    expect(areaTitle()).toBe('Area (um^2)');
  });

  it('labels columns with px^2/px when no scale is provided', async () => {
    await calc.exportToCSV(sample, '/tmp/metrics.csv');
    expect(areaTitle()).toBe('Area (px^2)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// escapeHtml + sanitizeUrl (pure utils — only coverage lives here)
// ════════════════════════════════════════════════════════════════════════════

describe('escapeHtml', () => {
  let escapeHtml: (s: string) => string;
  let sanitizeUrl: (s: string) => string;

  beforeEach(async () => {
    const mod = await import('../../../utils/escapeHtml');
    escapeHtml = mod.escapeHtml;
    sanitizeUrl = mod.sanitizeUrl;
  });

  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < and > to &lt; &gt;', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes / to &#x2F;', () => {
    expect(escapeHtml('a/b')).toBe('a&#x2F;b');
  });

  it('escapes all special chars in one string', () => {
    expect(escapeHtml('<b>"Hello"</b> & it\'s/fine')).toBe(
      '&lt;b&gt;&quot;Hello&quot;&lt;&#x2F;b&gt; &amp; it&#39;s&#x2F;fine'
    );
  });

  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello world 123')).toBe('Hello world 123');
  });

  describe('sanitizeUrl', () => {
    it('returns empty string for falsy input', () => {
      expect(sanitizeUrl('')).toBe('');
      expect(sanitizeUrl(null as unknown as string)).toBe('');
    });

    it('returns empty string for non-http protocols', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeUrl('ftp://example.com')).toBe('');
      expect(sanitizeUrl('data:text/html,<h1>')).toBe('');
    });

    it('returns a normalised http URL', () => {
      expect(sanitizeUrl('http://example.com/path')).toBe(
        'http://example.com/path'
      );
    });

    it('returns a normalised https URL', () => {
      expect(sanitizeUrl('https://example.com?q=1')).toBe(
        'https://example.com/?q=1'
      );
    });

    it('returns empty string for an invalid URL', () => {
      expect(sanitizeUrl('not a url')).toBe('');
      expect(sanitizeUrl('://bad')).toBe('');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getBaseUrl (pure env inspection — only coverage lives here)
// ════════════════════════════════════════════════════════════════════════════

describe('getBaseUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, originalEnv);
    delete process.env.API_BASE_URL;
    delete process.env.BACKEND_URL;
    delete process.env.PUBLIC_URL;
  });

  it('returns API_BASE_URL when set', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('https://api.example.com');
  });

  it('falls back to BACKEND_URL when API_BASE_URL is absent', async () => {
    process.env.BACKEND_URL = 'https://backend.example.com';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('https://backend.example.com');
  });

  it('falls back to PUBLIC_URL when both higher-priority vars are absent', async () => {
    process.env.PUBLIC_URL = 'https://public.example.com';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('https://public.example.com');
  });

  it('returns the localhost default in non-production when no env var is set', async () => {
    process.env.NODE_ENV = 'test';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('http://localhost:3001');
  });

  it('returns an empty string in production when no env var is set', async () => {
    process.env.NODE_ENV = 'production';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('');
  });
});
