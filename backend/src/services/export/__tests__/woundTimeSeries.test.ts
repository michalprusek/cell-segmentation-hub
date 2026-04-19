import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../woundChartRenderer', () => ({
  renderWoundAreaChart: jest.fn(async () =>
    Buffer.from([0x89, 0x50, 0x4e, 0x47])
  ),
}));

import ExcelJS from 'exceljs';
import {
  buildWoundTimeSeries,
  shouldExportWoundTimeSeries,
  appendWoundTimeSeriesSheet,
} from '../woundTimeSeries';

// Helper: build a 100×100 image row with one external square (40×40 @ (10,10))
// → 1600 px² external area out of 10000 → 16% wound area.
function sampleExternalSquareImage(overrides: Record<string, unknown> = {}) {
  const polygons = JSON.stringify([
    {
      id: 'ext1',
      type: 'external',
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
    },
  ]);
  return {
    id: 'img-1',
    name: 'frame_001.jpg',
    width: 100,
    height: 100,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    displayOrder: 0,
    segmentation: {
      polygons,
      model: 'wound',
      threshold: 0.5,
    },
    ...overrides,
  };
}

describe('shouldExportWoundTimeSeries', () => {
  it('returns false when no image has wound model', () => {
    const img = sampleExternalSquareImage({
      segmentation: {
        polygons: '[]',
        model: 'hrnet',
        threshold: 0.5,
      },
    });
    expect(shouldExportWoundTimeSeries([img as never])).toBe(false);
  });

  it('returns true when at least one image has wound model', () => {
    const wound = sampleExternalSquareImage();
    const other = sampleExternalSquareImage({
      id: 'img-2',
      segmentation: {
        polygons: '[]',
        model: 'hrnet',
        threshold: 0.5,
      },
    });
    expect(shouldExportWoundTimeSeries([wound, other] as never[])).toBe(true);
  });
});

describe('buildWoundTimeSeries — area computation', () => {
  it('computes 16% for a 40×40 external square in a 100×100 image', () => {
    const points = buildWoundTimeSeries([
      sampleExternalSquareImage() as never,
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].woundAreaPct).toBeCloseTo(16.0, 2);
    expect(points[0].polygonCount).toBe(1);
    expect(points[0].order).toBe(0);
  });

  it('subtracts internal hole with parent_id from external area', () => {
    const polygons = JSON.stringify([
      {
        id: 'ext1',
        type: 'external',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
      {
        id: 'hole1',
        type: 'internal',
        parent_id: 'ext1',
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 40 },
          { x: 20, y: 40 },
        ],
      },
    ]);
    const img = sampleExternalSquareImage({
      segmentation: {
        polygons,
        model: 'wound',
        threshold: 0.5,
      },
    });
    // Full 100×100 square = 100% - hole 20×20 / 100×100 = 4% → 96%
    const [p] = buildWoundTimeSeries([img as never]);
    expect(p.woundAreaPct).toBeCloseTo(96.0, 2);
  });

  it('treats orphaned internal (parent_id missing) as external, not as hole', () => {
    // C1 regression guard: when the parent contour was filtered at < 50px,
    // a child tagged "internal" without parent_id must NOT be subtracted.
    const polygons = JSON.stringify([
      {
        id: 'orphan',
        type: 'internal',
        // parent_id intentionally missing — simulates filtered parent
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
      },
    ]);
    const img = sampleExternalSquareImage({
      segmentation: {
        polygons,
        model: 'wound',
        threshold: 0.5,
      },
    });
    const [p] = buildWoundTimeSeries([img as never]);
    // Treated as external → 50×50 in 100×100 = 25%, not -25% clamped to 0
    expect(p.woundAreaPct).toBeCloseTo(25.0, 2);
  });

  it('returns sentinel note on malformed polygon JSON', () => {
    const img = sampleExternalSquareImage({
      segmentation: {
        polygons: '{not valid json',
        model: 'wound',
        threshold: 0.5,
      },
    });
    const [p] = buildWoundTimeSeries([img as never]);
    expect(p.woundAreaPct).toBe(0);
    expect(p.polygonCount).toBe(0);
    expect(p.note).toMatch(/polygon JSON parse failed/);
  });

  it('returns sentinel note when width or height missing', () => {
    const img = sampleExternalSquareImage({ width: undefined });
    const [p] = buildWoundTimeSeries([img as never]);
    expect(p.note).toBe('missing image dimensions');
    expect(p.woundAreaPct).toBe(0);
  });

  it('skips polygons with fewer than 3 points', () => {
    const polygons = JSON.stringify([
      { id: 'tiny', type: 'external', points: [{ x: 0, y: 0 }] },
    ]);
    const img = sampleExternalSquareImage({
      segmentation: { polygons, model: 'wound', threshold: 0.5 },
    });
    const [p] = buildWoundTimeSeries([img as never]);
    expect(p.woundAreaPct).toBe(0);
    // polygonCount still reflects raw JSON count for diagnostics
    expect(p.polygonCount).toBe(1);
  });

  it('filters out non-wound-model images even if present in the list', () => {
    const wound = sampleExternalSquareImage();
    const spheroid = sampleExternalSquareImage({
      id: 'img-spheroid',
      segmentation: {
        polygons: sampleExternalSquareImage().segmentation.polygons,
        model: 'hrnet',
        threshold: 0.5,
      },
    });
    const points = buildWoundTimeSeries([wound, spheroid] as never[]);
    expect(points).toHaveLength(1);
    expect(points[0].imageId).toBe('img-1');
  });
});

describe('buildWoundTimeSeries — ordering', () => {
  it('sorts by displayOrder ascending', () => {
    const imgs = [
      sampleExternalSquareImage({ id: 'b', displayOrder: 2 }),
      sampleExternalSquareImage({ id: 'a', displayOrder: 0 }),
      sampleExternalSquareImage({ id: 'c', displayOrder: 1 }),
    ];
    const points = buildWoundTimeSeries(imgs as never[]);
    expect(points.map(p => p.imageId)).toEqual(['a', 'c', 'b']);
    expect(points.map(p => p.order)).toEqual([0, 1, 2]);
  });

  it('falls back to createdAt when displayOrder is null', () => {
    const imgs = [
      sampleExternalSquareImage({
        id: 'late',
        displayOrder: null,
        createdAt: new Date('2026-04-19T12:00:00Z'),
      }),
      sampleExternalSquareImage({
        id: 'early',
        displayOrder: null,
        createdAt: new Date('2026-04-19T10:00:00Z'),
      }),
    ];
    const points = buildWoundTimeSeries(imgs as never[]);
    expect(points.map(p => p.imageId)).toEqual(['early', 'late']);
  });
});

describe('appendWoundTimeSeriesSheet', () => {
  let workbook: ExcelJS.Workbook;

  beforeEach(() => {
    workbook = new ExcelJS.Workbook();
  });

  it('returns count=0 and chartPng=null when no wound images', async () => {
    const img = sampleExternalSquareImage({
      segmentation: {
        polygons: '[]',
        model: 'hrnet',
        threshold: 0.5,
      },
    });
    const result = await appendWoundTimeSeriesSheet(workbook, [img as never]);
    expect(result.count).toBe(0);
    expect(result.chartPng).toBeNull();
    expect(result.points).toEqual([]);
    expect(workbook.worksheets).toHaveLength(0);
  });

  it('writes WoundTimeSeries sheet with one row per wound image', async () => {
    const imgs = [
      sampleExternalSquareImage({ id: 'a', displayOrder: 0 }),
      sampleExternalSquareImage({ id: 'b', displayOrder: 1 }),
      sampleExternalSquareImage({ id: 'c', displayOrder: 2 }),
    ];
    const result = await appendWoundTimeSeriesSheet(workbook, imgs as never[]);
    expect(result.count).toBe(3);
    const sheet = workbook.getWorksheet('WoundTimeSeries');
    expect(sheet).toBeDefined();
    // Header row + 3 data rows
    expect(sheet!.rowCount).toBe(4);
  });

  it('returns a chartPng field so the caller can write it to disk', async () => {
    const imgs = [
      sampleExternalSquareImage({ id: 'a', displayOrder: 0 }),
      sampleExternalSquareImage({ id: 'b', displayOrder: 1 }),
    ];
    const result = await appendWoundTimeSeriesSheet(workbook, imgs as never[]);
    expect(result.count).toBe(2);
    expect(result.points).toHaveLength(2);
    // The field MUST be present in the return shape so
    // ``maybeAppendWoundTimeSeries`` in exportService.ts can branch on it
    // to decide whether to write ``wound_healing/wound_area_chart.png``.
    // The VALUE depends on whether canvas rendering succeeded in the test
    // environment; we only assert shape here.
    expect(result).toHaveProperty('chartPng');
  });
});
