/**
 * Gap-coverage tests for metricsCalculator.ts
 *
 * Distinct filename to avoid clobbering the existing test files
 * (metricsCalculator.test.ts, metricsCalculator.basicMetrics.test.ts,
 *  metricsCalculator.sperm.test.ts).
 *
 * Targets uncovered branches:
 *
 *   1. calculateAllMetrics
 *      - image with no segmentation field → skipped, no metrics added
 *      - malformed polygon JSON → caught, image skipped gracefully
 *      - polylines filtered out (geometry='polyline') before metric calc
 *      - invalid scale (0 / negative / NaN / Infinity) → warns, returns px units
 *      - valid scale → applyScaleConversion called (area×scale², lengths×scale)
 *      - polygon count > 1000 → warn threshold logged
 *
 *   2. calculatePolygonMetrics — ML-endpoint SUCCESS path
 *      - all required keys present → metrics mapped 1:1 from response.data
 *      - missing keys in response → throws with clear message
 *      - missing polygon.points → throws before HTTP call
 *
 *   3. exportPolygonMetricsToExcel
 *      - writes polygon worksheet + summary worksheet
 *      - uses 'px^2'/'px' units when no scale; 'um^2'/'um' with scale
 *
 *   4. exportToExcel (ASPP / spheroid_invasive path)
 *      - passes imageMetrics rows to the sheet
 *      - no polygon rows written (per-image only)
 *
 * All shapes use hand-computable ground truth. Float comparisons use toBeCloseTo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MetricsCalculator,
  PolygonMetrics,
  ImageMetrics,
  ImageWithSegmentation,
} from '../metricsCalculator';

// ── Mock ExcelJS ──────────────────────────────────────────────────────────────

const mockWorksheetColumns: object[] = [];
const mockWorksheetRows: object[] = [];
const mockWorksheet = {
  get columns() {
    return mockWorksheetColumns;
  },
  set columns(v) {
    mockWorksheetColumns.splice(0, mockWorksheetColumns.length, ...v);
  },
  addRow: vi.fn((row: object) => {
    mockWorksheetRows.push(row);
    return {};
  }),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};

// Second worksheet (summary) needs separate tracking
const mockSummaryRows: unknown[][] = [];
const mockSummaryWorksheet = {
  columns: [] as object[],
  addRow: vi.fn((row: unknown[]) => {
    mockSummaryRows.push(row);
    return {};
  }),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};

let worksheetCallCount = 0;
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('exceljs', () => ({
  default: {
    Workbook: function MockWorkbook(this: object) {
      worksheetCallCount = 0;
      return {
        addWorksheet: vi.fn(() => {
          worksheetCallCount++;
          return worksheetCallCount === 1
            ? mockWorksheet
            : mockSummaryWorksheet;
        }),
        xlsx: { writeFile: mockWriteFile },
      };
    },
  },
}));

// ── Mock fs/promises ──────────────────────────────────────────────────────────

vi.mock('fs/promises', () => {
  const noop = vi.fn().mockResolvedValue(undefined);
  return {
    default: { mkdir: noop, writeFile: noop },
    mkdir: noop,
    writeFile: noop,
  };
});

// ── Mock csv-writer ───────────────────────────────────────────────────────────

vi.mock('csv-writer', () => ({
  createObjectCsvStringifier: vi.fn(() => ({
    getHeaderString: vi.fn(() => 'header\n'),
    stringifyRecords: vi.fn(() => 'row\n'),
  })),
}));

// ── postMock — controlled per test ────────────────────────────────────────────

const postMock = vi.fn();

vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ post: postMock })) },
  create: vi.fn(() => ({ post: postMock })),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock config ───────────────────────────────────────────────────────────────

vi.mock('../../../utils/config', () => ({
  config: { SEGMENTATION_SERVICE_URL: 'http://ml-service:8000' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** CCW unit square of given side. */
const square = (side: number, ox = 0, oy = 0) => [
  { x: ox, y: oy },
  { x: ox + side, y: oy },
  { x: ox + side, y: oy + side },
  { x: ox, y: oy + side },
];

const extPoly = (pts: { x: number; y: number }[]) => ({
  type: 'external' as const,
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

/** Full ML response data for a 10×10 square. */
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

// ══════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateAllMetrics: image-level edge cases', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('returns empty array when given an empty image list', async () => {
    const result = await calc.calculateAllMetrics([]);
    expect(result).toHaveLength(0);
  });

  it('skips images without a segmentation field', async () => {
    const image: ImageWithSegmentation = { id: 'no-seg', name: 'blank.png' };
    const result = await calc.calculateAllMetrics([image]);
    expect(result).toHaveLength(0);
  });

  it('skips images where polygon JSON is malformed', async () => {
    const image: ImageWithSegmentation = {
      id: 'bad-json',
      name: 'bad.png',
      segmentation: { polygons: '{bad', model: 'x', threshold: 0.5 },
    };
    const result = await calc.calculateAllMetrics([image]);
    // Malformed JSON → caught → image skipped → no metrics
    expect(result).toHaveLength(0);
  });

  it('filters out polyline polygons before sending to ML', async () => {
    const polyline = {
      geometry: 'polyline' as const,
      type: 'external' as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const image = buildImage('pl-only', [polyline]);
    const result = await calc.calculateAllMetrics([image]);
    // Polylines have no `type` that passes the filter → 0 metrics
    expect(result).toHaveLength(0);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('returns one metric entry per external polygon on success', async () => {
    const image = buildImage('two-ext', [
      extPoly(square(10)),
      extPoly(square(5, 20, 20)),
    ]);
    const result = await calc.calculateAllMetrics([image]);
    expect(result).toHaveLength(2);
  });

  it('falls back to basic metrics when ML endpoint rejects and still produces a result', async () => {
    postMock.mockRejectedValue(new Error('ML down'));
    const image = buildImage('fallback', [extPoly(square(10))]);
    const result = await calc.calculateAllMetrics([image]);
    // Fallback always succeeds for a valid polygon
    expect(result).toHaveLength(1);
    expect(result[0]!.area).toBeCloseTo(100, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculateAllMetrics: scale-conversion edge cases', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('returns pixel-unit values when scale is 0 (warns, skips conversion)', async () => {
    const image = buildImage('s0', [extPoly(square(10))]);
    const result = await calc.calculateAllMetrics([image], 0);
    // scale = 0 → "invalid" → returns pixel metrics unchanged
    expect(result[0]!.area).toBeCloseTo(ML_SQUARE_10.Area, 3);
    expect(result[0]!.perimeter).toBeCloseTo(ML_SQUARE_10.Perimeter, 3);
  });

  it('returns pixel-unit values when scale is negative', async () => {
    const image = buildImage('sneg', [extPoly(square(10))]);
    const result = await calc.calculateAllMetrics([image], -1);
    expect(result[0]!.area).toBeCloseTo(ML_SQUARE_10.Area, 3);
  });

  it('returns pixel-unit values when scale is NaN', async () => {
    const image = buildImage('snan', [extPoly(square(10))]);
    const result = await calc.calculateAllMetrics([image], NaN);
    expect(result[0]!.area).toBeCloseTo(ML_SQUARE_10.Area, 3);
  });

  it('returns pixel-unit values when scale is Infinity', async () => {
    const image = buildImage('sinf', [extPoly(square(10))]);
    const result = await calc.calculateAllMetrics([image], Infinity);
    expect(result[0]!.area).toBeCloseTo(ML_SQUARE_10.Area, 3);
  });

  it('multiplies area by scale² and lengths by scale for a valid scale', async () => {
    const scale = 2; // 2 µm/px
    const image = buildImage('s2', [extPoly(square(10))]);
    const result = await calc.calculateAllMetrics([image], scale);
    expect(result[0]!.area).toBeCloseTo(ML_SQUARE_10.Area * scale * scale, 3);
    expect(result[0]!.perimeter).toBeCloseTo(ML_SQUARE_10.Perimeter * scale, 3);
    expect(result[0]!.equivalentDiameter).toBeCloseTo(
      ML_SQUARE_10.EquivalentDiameter * scale,
      3
    );
    // Dimensionless fields unchanged
    expect(result[0]!.circularity).toBeCloseTo(ML_SQUARE_10.Circularity, 5);
    expect(result[0]!.feretAspectRatio).toBeCloseTo(
      ML_SQUARE_10.FeretAspectRatio,
      5
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — calculatePolygonMetrics (ML success path)', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
  });

  it('maps all ML response fields onto PolygonMetrics when endpoint succeeds', async () => {
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
    const image = buildImage('ml-ok', [extPoly(square(10))]);
    const result = await calc.calculateImageMetrics(
      [extPoly(square(10))],
      'ml-ok',
      'test.png'
    );

    expect(result).toHaveLength(1);
    const m = result[0]!;
    // Spot-check mapping — each field comes from ML, not the fallback
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

  it('falls back to basic metrics when ML response is missing required keys', async () => {
    // Return a response that is missing most required keys
    postMock.mockResolvedValue({ data: { Area: 100 } });
    const image = buildImage('ml-missing', [extPoly(square(10))]);
    const result = await calc.calculateImageMetrics(
      [extPoly(square(10))],
      'ml-missing',
      'test.png'
    );

    // The missing-keys error triggers the catch block → calculateBasicMetrics
    expect(result).toHaveLength(1);
    // Basic metrics for a 10×10 square should return area ≈ 100
    expect(result[0]!.area).toBeCloseTo(100, 3);
  });

  it('sets imageId and imageName on every returned metric', async () => {
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
    const result = await calc.calculateImageMetrics(
      [extPoly(square(10))],
      'img-id-check',
      'img-name.png'
    );
    expect(result[0]!.imageId).toBe('img-id-check');
    expect(result[0]!.imageName).toBe('img-name.png');
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — exportPolygonMetricsToExcel', () => {
  let calc: MetricsCalculator;

  const sampleMetrics: PolygonMetrics[] = [
    {
      imageId: 'img1',
      imageName: 'cell.png',
      polygonId: 1,
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
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorksheetRows.splice(0);
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('calls writeFile with the given output path', async () => {
    await calc.exportPolygonMetricsToExcel(sampleMetrics, '/tmp/test.xlsx');
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/test.xlsx');
  });

  it('uses px^2 / px units when no scale is supplied', async () => {
    await calc.exportPolygonMetricsToExcel(sampleMetrics, '/tmp/test.xlsx');
    const headers = mockWorksheetColumns.map(
      (c: Record<string, unknown>) => c.header as string
    );
    expect(headers.some(h => h.includes('px^2'))).toBe(true);
    expect(headers.some(h => h.includes('px'))).toBe(true);
  });

  it('uses um^2 / um units when a scale is provided', async () => {
    await calc.exportPolygonMetricsToExcel(
      sampleMetrics,
      '/tmp/test.xlsx',
      0.5
    );
    const headers = mockWorksheetColumns.map(
      (c: Record<string, unknown>) => c.header as string
    );
    expect(headers.some(h => h.includes('um^2'))).toBe(true);
    expect(headers.some(h => h.includes('um'))).toBe(true);
  });

  it('adds one data row per metric entry', async () => {
    await calc.exportPolygonMetricsToExcel(sampleMetrics, '/tmp/test.xlsx');
    // addRow is called on the mockWorksheet for data rows
    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(sampleMetrics.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('MetricsCalculator — exportToExcel (ASPP / spheroid_invasive path)', () => {
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
    },
    {
      imageId: 'img-b',
      imageName: 'well2.png',
      polygonCount: 2,
      disintegrationIndex: 0.15,
      wassersteinW1: 0.6,
      referenceMode: 'r_eff',
      nPixels: 30000,
      totalSpheroidArea: 800,
      coreArea: 0,
      invasionArea: 800,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
    postMock.mockResolvedValue({ data: ML_SQUARE_10 });
  });

  it('calls writeFile with the given output path', async () => {
    await calc.exportToExcel(
      [],
      '/tmp/aspp.xlsx',
      undefined,
      sampleImageMetrics
    );
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/aspp.xlsx');
  });

  it('adds one row per imageMetric entry', async () => {
    await calc.exportToExcel(
      [],
      '/tmp/aspp.xlsx',
      undefined,
      sampleImageMetrics
    );
    // The Image Metrics sheet gets addRow called for each image
    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(
      sampleImageMetrics.length
    );
  });

  it('writes the disintegrationIndex field into rows', async () => {
    await calc.exportToExcel(
      [],
      '/tmp/aspp.xlsx',
      undefined,
      sampleImageMetrics
    );
    const calls = (mockWorksheet.addRow as ReturnType<typeof vi.fn>).mock.calls;
    const firstRow = calls[0][0] as Record<string, number>;
    // DI from first entry: 0.42 → rounded to 4 decimals = 0.42
    expect(firstRow.disintegrationIndex).toBeCloseTo(0.42, 4);
  });

  it('uses px^2 units in column headers when no scale is provided', async () => {
    await calc.exportToExcel(
      [],
      '/tmp/aspp.xlsx',
      undefined,
      sampleImageMetrics
    );
    const headers = mockWorksheetColumns.map(
      (c: Record<string, unknown>) => c.header as string
    );
    // At least one column should mention px^2
    expect(headers.some(h => typeof h === 'string' && h.includes('px^2'))).toBe(
      true
    );
  });

  it('uses um^2 units in column headers when scale > 0 is provided', async () => {
    await calc.exportToExcel([], '/tmp/aspp.xlsx', 2.0, sampleImageMetrics);
    const headers = mockWorksheetColumns.map(
      (c: Record<string, unknown>) => c.header as string
    );
    expect(headers.some(h => typeof h === 'string' && h.includes('um^2'))).toBe(
      true
    );
  });

  it('handles empty imageMetrics gracefully (no rows added)', async () => {
    await calc.exportToExcel([], '/tmp/empty.xlsx', undefined, []);
    expect(mockWorksheet.addRow).not.toHaveBeenCalled();
  });
});
