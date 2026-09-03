/**
 * Tests for the microcapsule metrics path:
 *   - calculateAllMetrics EXCLUDES border-cut capsules (complete === false)
 *     from the computed metrics, while keeping complete / unflagged polygons.
 *   - exportMicrocapsuleMetricsToExcel emits the FOCUSED column set and maps
 *     the "Compactness" column to the circularity value (4π·A/P²).
 *   - exportMicrocapsuleToCSV emits the same focused columns and omits cut-off
 *     capsules.
 *
 * The Python metrics endpoint is mocked to reject so geometry is computed by the
 * offline calculateBasicMetrics fallback (deterministic, no network).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MetricsCalculator,
  ImageWithSegmentation,
  PolygonMetrics,
} from '../metricsCalculator';

// ── ExcelJS mock (captures columns + rows) ──────────────────────────────────
const mockWorksheet = {
  columns: [] as Array<{ header?: string; key?: string; width?: number }>,
  // addRow returns a fresh row whose font/fill can be assigned (the summary
  // sheet does `excelRow.font = ...` on the first row).
  addRow: vi.fn(() => ({ font: undefined, fill: undefined })),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};
const mockAddWorksheet = vi.fn(() => mockWorksheet);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('exceljs', () => ({
  default: {
    Workbook: function MockWorkbook(this: object) {
      return {
        addWorksheet: mockAddWorksheet,
        xlsx: { writeFile: mockWriteFile },
      };
    },
  },
}));

// ── fs/promises mock (captures CSV writeFile content) ───────────────────────
const fsWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('fs/promises', () => {
  const noop = vi.fn().mockResolvedValue(undefined);
  const api = {
    mkdir: noop,
    readFile: noop,
    writeFile: (...args: unknown[]) => fsWriteFile(...args),
    unlink: noop,
    access: noop,
    stat: noop,
  };
  return { default: api, ...api };
});

// ── axios mock (rejects → offline fallback) ─────────────────────────────────
const postMock = vi.fn();
vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ post: postMock })) },
  create: vi.fn(() => ({ post: postMock })),
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../utils/config', () => ({
  config: { SEGMENTATION_SERVICE_URL: 'http://ml-service:8000' },
}));

// ── helpers ─────────────────────────────────────────────────────────────────
const square = (side: number, ox = 0, oy = 0) => [
  { x: ox, y: oy },
  { x: ox + side, y: oy },
  { x: ox + side, y: oy + side },
  { x: ox, y: oy + side },
];

/** External microcapsule polygon with an explicit completeness flag. */
const capsule = (side: number, complete: boolean, confidence: number) => ({
  type: 'external' as const,
  class: 'microcapsule',
  points: square(side),
  complete,
  confidence,
});

const buildImage = (polygons: unknown[]): ImageWithSegmentation => ({
  id: 'cap1',
  name: 'capsules.png',
  segmentation: {
    polygons: JSON.stringify(polygons),
    model: 'microcapsule',
    threshold: 0.25,
  },
});

// A focused PolygonMetrics row (only the fields the focused exporter reads).
const metricRow = (
  over: Partial<PolygonMetrics> & { polygonId: number }
): PolygonMetrics =>
  ({
    imageId: 'cap1',
    imageName: 'capsules.png',
    type: 'external',
    area: 100,
    perimeter: 40,
    perimeterWithHoles: 40,
    equivalentDiameter: 11.28,
    circularity: 0.785,
    compactness: 1.273,
    confidence: 0.9,
    complete: true,
    feretDiameterMax: 14.1,
    feretDiameterMaxOrthogonalDistance: 10,
    feretDiameterMin: 10,
    feretAspectRatio: 1.41,
    lengthMajorDiameterThroughCentroid: 14.1,
    lengthMinorDiameterThroughCentroid: 10,
    boundingBoxWidth: 10,
    boundingBoxHeight: 10,
    extent: 1,
    convexity: 1,
    solidity: 1,
    sphericity: 0.6,
    ...over,
  }) as PolygonMetrics;

describe('MetricsCalculator — microcapsule completeness exclusion', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
    postMock.mockRejectedValue(new Error('ML service unavailable'));
  });

  it('excludes border-cut capsules (complete === false) from metrics', async () => {
    const image = buildImage([
      capsule(10, true, 0.95), // complete → counted
      capsule(12, false, 0.6), // cut off  → excluded
      capsule(8, true, 0.8), // complete → counted
    ]);

    const metrics = await calc.calculateAllMetrics([image]);

    expect(metrics).toHaveLength(2);
    // Both remaining rows are the two complete capsules (areas 100 and 64).
    const areas = metrics.map(m => Math.round(m.area)).sort((a, b) => a - b);
    expect(areas).toEqual([64, 100]);
    // None of the kept rows is the excluded one.
    expect(metrics.every(m => m.complete !== false)).toBe(true);
  });

  it('keeps polygons that do not set the complete flag (other project types)', async () => {
    const image = buildImage([
      { type: 'external', points: square(10) }, // no `complete` field
      { type: 'external', points: square(8), complete: true },
    ]);

    const metrics = await calc.calculateAllMetrics([image]);
    expect(metrics).toHaveLength(2);
  });

  it('carries confidence onto the computed metric rows', async () => {
    const image = buildImage([capsule(10, true, 0.97)]);
    const metrics = await calc.calculateAllMetrics([image]);
    expect(metrics[0]!.confidence).toBeCloseTo(0.97, 5);
  });

  // A capsule with an intact membrane stores TWO closed outlines, both
  // `type: 'external'`. Only the capsule is an object to count.
  it('does not emit a metric row for the membrane inside a capsule', async () => {
    const ring = (r: number) =>
      Array.from({ length: 60 }, (_, i) => {
        const t = (2 * Math.PI * i) / 60;
        return { x: 100 + r * Math.cos(t), y: 100 + r * Math.sin(t) };
      });
    const image = buildImage([
      {
        type: 'external',
        class: 'microcapsule',
        points: ring(50),
        complete: true,
      },
      { type: 'external', class: 'membrane', points: ring(30) },
    ]);

    const metrics = await calc.calculateAllMetrics([image]);

    // ONE row. Without the class filter this is 2 and every microcapsule
    // export silently doubles.
    expect(metrics).toHaveLength(1);
  });

  it('measures the annulus onto the capsule row that contains the membrane', async () => {
    const ring = (r: number, cx = 100, cy = 100) =>
      Array.from({ length: 120 }, (_, i) => {
        const t = (2 * Math.PI * i) / 120;
        return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
      });
    const image = buildImage([
      {
        type: 'external',
        class: 'microcapsule',
        points: ring(50),
        complete: true,
      },
      { type: 'external', class: 'membrane', points: ring(30) },
    ]);

    const metrics = await calc.calculateAllMetrics([image]);

    expect(metrics).toHaveLength(1);
    // Concentric circles of radius 50 and 30: the gap is 20 everywhere.
    expect(metrics[0]!.membraneAnnulusWidth).toBeCloseTo(20, 0);
  });

  it('leaves the annulus undefined for a capsule with no membrane', async () => {
    const image = buildImage([capsule(10, true, 0.9)]);
    const metrics = await calc.calculateAllMetrics([image]);
    expect(metrics[0]!.membraneAnnulusWidth).toBeUndefined();
  });

  it('pairs by containment on the ML-service path too, not only the fallback', async () => {
    // Every other test in this file mocks the metrics service as UNAVAILABLE,
    // so they all exercise the fallback branch. The pairing also exists on the
    // success path, and "the same code is tested over there" is exactly the
    // reasoning that lets a divergence through — so this one lets the service
    // succeed.
    const OK_METRICS = {
      Area: 100,
      Perimeter: 40,
      PerimeterWithHoles: 40,
      EquivalentDiameter: 11,
      Circularity: 0.9,
      FeretDiameterMax: 14,
      FeretDiameterMaxOrthogonalDistance: 10,
      FeretDiameterMin: 10,
      FeretAspectRatio: 1.4,
      LengthMajorDiameterThroughCentroid: 14,
      LengthMinorDiameterThroughCentroid: 10,
      BoundingBoxWidth: 10,
      BoundingBoxHeight: 10,
      Extent: 1,
      Compactness: 1,
      Convexity: 1,
      Solidity: 1,
      Sphericity: 0.6,
    };
    postMock.mockResolvedValue({ data: OK_METRICS });

    const ring = (r: number, cx: number) =>
      Array.from({ length: 120 }, (_, i) => {
        const t = (2 * Math.PI * i) / 120;
        return { x: cx + r * Math.cos(t), y: 100 + r * Math.sin(t) };
      });
    const image = buildImage([
      { type: 'external', class: 'microcapsule', points: ring(40, 100), complete: true },
      { type: 'external', class: 'membrane', points: ring(30, 100) },
      { type: 'external', class: 'microcapsule', points: ring(40, 300), complete: true },
      { type: 'external', class: 'membrane', points: ring(15, 300) },
    ]);

    const metrics = await calc.calculateAllMetrics([image]);

    expect(metrics).toHaveLength(2);
    const widths = metrics.map(m =>
      typeof m.membraneAnnulusWidth === 'number'
        ? Math.round(m.membraneAnnulusWidth)
        : m.membraneAnnulusWidth
    );
    expect(widths).toEqual([10, 25]);
  });

  it('gives each capsule ITS OWN membrane, not merely the first one', async () => {
    // Two capsules, each with its own membrane of a different radius. Pairing
    // by position rather than containment ("take the first membrane") would
    // hand capsule B capsule A's membrane; `annulusWidth` would then refuse
    // the non-nested pair and B would silently lose its measurement. Distinct
    // radii are what make the mix-up visible instead of merely absent.
    const ring = (r: number, cx: number) =>
      Array.from({ length: 120 }, (_, i) => {
        const t = (2 * Math.PI * i) / 120;
        return { x: cx + r * Math.cos(t), y: 100 + r * Math.sin(t) };
      });
    const image = buildImage([
      { type: 'external', class: 'microcapsule', points: ring(40, 100), complete: true },
      { type: 'external', class: 'membrane', points: ring(30, 100) },
      { type: 'external', class: 'microcapsule', points: ring(40, 300), complete: true },
      { type: 'external', class: 'membrane', points: ring(15, 300) },
    ]);

    const metrics = await calc.calculateAllMetrics([image]);

    expect(metrics).toHaveLength(2);
    const widths = metrics
      .map(m => m.membraneAnnulusWidth)
      .map(w => (typeof w === 'number' ? Math.round(w) : w));
    // 40-30 = 10 and 40-15 = 25: both measured, and each from its own pair.
    expect(widths).toEqual([10, 25]);
  });

  it('does not pair a membrane with a capsule that does not contain it', async () => {
    // Two capsules, one membrane. Pairing is by containment, so the membrane
    // must land on the capsule it sits inside and NOT on its neighbour.
    const ring = (r: number, cx: number) =>
      Array.from({ length: 120 }, (_, i) => {
        const t = (2 * Math.PI * i) / 120;
        return { x: cx + r * Math.cos(t), y: 100 + r * Math.sin(t) };
      });
    const image = buildImage([
      { type: 'external', class: 'microcapsule', points: ring(40, 100), complete: true },
      { type: 'external', class: 'microcapsule', points: ring(40, 300), complete: true },
      { type: 'external', class: 'membrane', points: ring(25, 300) },
    ]);

    const metrics = await calc.calculateAllMetrics([image]);

    expect(metrics).toHaveLength(2);
    const withMembrane = metrics.filter(
      m => typeof m.membraneAnnulusWidth === 'number'
    );
    expect(withMembrane).toHaveLength(1);
    expect(withMembrane[0]!.membraneAnnulusWidth).toBeCloseTo(15, 0);
  });
});

describe('MetricsCalculator — exportMicrocapsuleMetricsToExcel', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorksheet.columns = [];
    calc = new MetricsCalculator();
  });

  it('emits the focused column set (no Feret / solidity / sphericity)', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [metricRow({ polygonId: 1 })],
      '/tmp/metrics.xlsx'
    );
    const headers = mockWorksheet.columns.map(c => c.header);
    expect(headers).toEqual([
      'Image Name',
      'Capsule ID',
      'Area (px^2)',
      'Perimeter (px)',
      'Width (px)',
      'Height (px)',
      'Diameter (px)',
      'Feret Max (px)',
      'Feret Min (px)',
      'Equivalent Diameter (px)',
      'Compactness',
      'Ovality',
      // Added 2026-09-03. Blank for a capsule whose membrane has dissolved —
      // see the membrane-annulus suite below for why that is not a 0.
      'Membrane annulus width (px)',
      'Confidence',
    ]);
    // The focused report must NOT carry the rich spheroid descriptors.
    expect(headers).not.toContain('Feret Diameter Max (px)');
    expect(headers).not.toContain('Solidity');
    expect(headers).not.toContain('Sphericity');
  });

  it('exports Feret max/min and ovality = max/min per capsule', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [metricRow({ polygonId: 1, feretDiameterMax: 30, feretDiameterMin: 20 })],
      '/tmp/metrics.xlsx'
    );
    const row = mockWorksheet.addRow.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(row.feretMax).toBeCloseTo(30, 4);
    expect(row.feretMin).toBeCloseTo(20, 4);
    expect(row.ovality).toBeCloseTo(1.5, 4); // 30 / 20
  });

  it('ovality falls back to the neutral 1 (not 0) when feretMin <= 0', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [metricRow({ polygonId: 1, feretDiameterMax: 30, feretDiameterMin: 0 })],
      '/tmp/metrics.xlsx'
    );
    const row = mockWorksheet.addRow.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    // Degenerate (unreachable for a real capsule) → 1.0, in-range [1,∞); a 0
    // would be out-of-range and drag the summary Average Ovality below 1.
    expect(row.ovality).toBe(1);
  });

  it('summary Average Ovality is the mean of per-capsule ratios', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [
        metricRow({ polygonId: 1, feretDiameterMax: 30, feretDiameterMin: 20 }), // 1.5
        metricRow({ polygonId: 2, feretDiameterMax: 50, feretDiameterMin: 20 }), // 2.5
      ],
      '/tmp/metrics.xlsx'
    );
    // Summary rows are arrays pushed to the shared mock after the data rows.
    const ovalityRow = mockWorksheet.addRow.mock.calls
      .map(c => c[0])
      .find(r => Array.isArray(r) && r[0] === 'Average Ovality') as unknown[];
    expect(ovalityRow).toBeDefined();
    expect(parseFloat(String(ovalityRow[1]))).toBeCloseTo(2.0, 4); // mean(1.5, 2.5)
  });

  it('width/height = bounding box, diameter = mean Feret', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [
        metricRow({
          polygonId: 1,
          boundingBoxWidth: 24,
          boundingBoxHeight: 18,
          feretDiameterMax: 26,
          feretDiameterMin: 20,
        }),
      ],
      '/tmp/metrics.xlsx'
    );
    const row = mockWorksheet.addRow.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(row.width).toBeCloseTo(24, 4);
    expect(row.height).toBeCloseTo(18, 4);
    expect(row.diameter).toBeCloseTo(23, 4); // (26 + 20) / 2
  });

  it('maps the Compactness column to the circularity value, not compactness', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [metricRow({ polygonId: 1, circularity: 0.82, compactness: 1.22 })],
      '/tmp/metrics.xlsx'
    );
    // First addRow call is the data row on the metrics sheet.
    const row = mockWorksheet.addRow.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(row.compactness).toBeCloseTo(0.82, 4); // = circularity
    expect(row.compactness).not.toBeCloseTo(1.22, 4); // NOT the reciprocal
  });

  it('uses µm² / µm units when a pixel scale is supplied', async () => {
    await calc.exportMicrocapsuleMetricsToExcel(
      [metricRow({ polygonId: 1 })],
      '/tmp/metrics.xlsx',
      0.5
    );
    const headers = mockWorksheet.columns.map(c => c.header);
    expect(headers).toContain('Area (um^2)');
    expect(headers).toContain('Perimeter (um)');
  });
});

describe('MetricsCalculator — exportMicrocapsuleToCSV', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
  });

  it('writes the focused CSV header and excludes cut-off capsules', async () => {
    await calc.exportMicrocapsuleToCSV(
      [
        metricRow({ polygonId: 1, area: 100, complete: true }),
        metricRow({ polygonId: 2, area: 50, complete: false }),
      ],
      '/tmp/metrics.csv'
    );
    expect(fsWriteFile).toHaveBeenCalledTimes(1);
    const content = String(fsWriteFile.mock.calls[0]![1]);
    expect(content).toContain('Capsule ID');
    expect(content).toContain('Compactness');
    expect(content).toContain('Confidence');
    expect(content).not.toContain('Sphericity');
    // Two metric rows in, one excluded → one data line + the header.
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('emits Feret Max / Feret Min / Ovality columns with correct values', async () => {
    await calc.exportMicrocapsuleToCSV(
      [
        metricRow({
          polygonId: 1,
          feretDiameterMax: 30,
          feretDiameterMin: 20,
          complete: true,
        }),
      ],
      '/tmp/metrics.csv'
    );
    const content = String(fsWriteFile.mock.calls[0]![1]);
    const [headerLine, dataLine] = content.trim().split('\n');
    const headers = headerLine.split(',');
    const vals = dataLine.split(',');
    const valOf = (prefix: string): number =>
      parseFloat(vals[headers.findIndex(h => h.startsWith(prefix))]);
    expect(valOf('Feret Max')).toBeCloseTo(30, 4);
    expect(valOf('Feret Min')).toBeCloseTo(20, 4);
    expect(valOf('Ovality')).toBeCloseTo(1.5, 4); // 30 / 20 — guards the CSV
    // copy of the ovality logic against drifting from the Excel path.
  });
});

// ── Membrane annulus ───────────────────────────────────────────────────────
// A microcapsule with an intact internal membrane carries a SECOND closed
// outline of class `membrane` beside it (2026-09-03). It is not an object to
// count — it belongs to the capsule around it and contributes one number to
// that capsule's row: the mean radial gap between the two boundaries.

describe('MetricsCalculator — membrane annulus width', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
  });

  it('writes the annulus width into the capsule row', async () => {
    await calc.exportMicrocapsuleToCSV(
      [metricRow({ polygonId: 1, membraneAnnulusWidth: 40, complete: true })],
      '/tmp/m.csv'
    );
    const content = String(fsWriteFile.mock.calls[0]![1]);
    expect(content).toContain('Membrane annulus width');
    expect(content.trim().split('\n')[1]).toContain('40');
  });

  it('leaves the cell EMPTY, not 0, for a capsule with no membrane', async () => {
    // A dissolved membrane means there is no annulus at all. A 0 would average
    // into the column as a real, infinitely thin one — and the whole point of
    // the measurement is to compare widths across capsules.
    await calc.exportMicrocapsuleToCSV(
      [metricRow({ polygonId: 1, complete: true })],
      '/tmp/m.csv'
    );
    const content = String(fsWriteFile.mock.calls[0]![1]);
    const header = content.trim().split('\n')[0].split(',');
    const row = content.trim().split('\n')[1].split(',');
    const col = header.indexOf('Membrane annulus width (px)');
    expect(col).toBeGreaterThanOrEqual(0);
    expect(row[col]).toBe('');
  });

  it('labels the column with the unit in use, like every other length', async () => {
    // It sits in the same table as Diameter. A length column with no unit
    // beside columns that have one reads as dimensionless.
    await calc.exportMicrocapsuleToCSV(
      [metricRow({ polygonId: 1, membraneAnnulusWidth: 40, complete: true })],
      '/tmp/m.csv',
      0.5
    );
    const content = String(fsWriteFile.mock.calls[0]![1]);
    expect(content).toContain('Membrane annulus width (um)');
  });
});

describe('MetricsCalculator — annulus scale conversion', () => {
  it('converts the annulus width to micrometres with the other lengths', () => {
    // `applyScaleConversion` is where every length becomes micrometres. The
    // annulus MUST go through it: the CSV header says `(um)` whenever a scale
    // is set, so a value left in pixels would be mislabelled rather than
    // merely wrong — the column would read as micrometres and be off by the
    // scale factor with nothing on screen to show it.
    const calc = new MetricsCalculator();
    const convert = (
      calc as unknown as {
        applyScaleConversion: (
          m: PolygonMetrics[],
          scale: number
        ) => PolygonMetrics[];
      }
    ).applyScaleConversion.bind(calc);

    const [out] = convert(
      [metricRow({ polygonId: 1, membraneAnnulusWidth: 40, complete: true })],
      0.5
    );
    expect(out.membraneAnnulusWidth).toBeCloseTo(20, 6);
    // ...and scaled by the SAME factor as the diameter beside it.
    expect(out.feretDiameterMax).toBeCloseTo(14.1 * 0.5, 6);
  });

  it('leaves a missing annulus undefined rather than scaling it to 0', () => {
    const calc = new MetricsCalculator();
    const convert = (
      calc as unknown as {
        applyScaleConversion: (
          m: PolygonMetrics[],
          scale: number
        ) => PolygonMetrics[];
      }
    ).applyScaleConversion.bind(calc);

    const [out] = convert([metricRow({ polygonId: 1, complete: true })], 0.5);
    expect(out.membraneAnnulusWidth).toBeUndefined();
  });
});
