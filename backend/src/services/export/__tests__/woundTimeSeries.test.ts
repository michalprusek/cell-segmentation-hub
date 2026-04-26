import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Using the real renderWoundAreaChart — node-canvas is a backend dependency
// and works in the test environment. Failure-path tests use vi.spyOn to
// override specific cases rather than vi.mock, because vi.mock of an
// ESM module produces unreliable return values in ts-jest/ESM preset.

import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import {
  buildWoundTimeSeries,
  shouldExportWoundTimeSeries,
  appendWoundTimeSeriesSheet,
  writeStandaloneWoundChart,
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
    expect(result.chartError).toBeUndefined();
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

  it('returns a real PNG Buffer on chartPng so the caller can write it to disk', async () => {
    const imgs = [
      sampleExternalSquareImage({ id: 'a', displayOrder: 0 }),
      sampleExternalSquareImage({ id: 'b', displayOrder: 1 }),
    ];
    const result = await appendWoundTimeSeriesSheet(workbook, imgs as never[]);
    expect(result.count).toBe(2);
    expect(result.chartError).toBeUndefined();
    expect(Buffer.isBuffer(result.chartPng)).toBe(true);
    // PNG magic bytes
    expect(result.chartPng!.slice(0, 4).toString('hex')).toBe('89504e47');
  });

  it('sets chartError when renderWoundAreaChart throws', async () => {
    const mod = await import('../woundChartRenderer');
    const spy = jest
      .spyOn(mod, 'renderWoundAreaChart')
      .mockRejectedValueOnce(new Error('canvas backend unavailable'));
    try {
      const imgs = [
        sampleExternalSquareImage({ id: 'a', displayOrder: 0 }),
        sampleExternalSquareImage({ id: 'b', displayOrder: 1 }),
      ];
      const result = await appendWoundTimeSeriesSheet(
        workbook,
        imgs as never[]
      );
      expect(result.count).toBe(2);
      expect(result.chartPng).toBeNull();
      expect(result.chartError).toMatch(/canvas backend unavailable/);
      // Data rows are still written — only the chart image is missing.
      expect(workbook.getWorksheet('WoundTimeSeries')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('writeStandaloneWoundChart', () => {
  let exportDir: string;

  beforeEach(async () => {
    exportDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wound-export-test-')
    );
  });

  afterEach(async () => {
    await fsp.rm(exportDir, { recursive: true, force: true });
  });

  it('writes the PNG into wound_healing/wound_area_chart.png', async () => {
    const buf = Buffer.from('89504e470d0a1a0a', 'hex');
    const chartPath = await writeStandaloneWoundChart(exportDir, buf);
    expect(chartPath).toBe(
      path.join(exportDir, 'wound_healing', 'wound_area_chart.png')
    );
    const st = await fsp.stat(chartPath);
    expect(st.size).toBe(buf.length);
    const readBack = await fsp.readFile(chartPath);
    expect(readBack.equals(buf)).toBe(true);
  });

  it('is idempotent across repeated calls (mkdir recursive)', async () => {
    const buf1 = Buffer.from('89504e470d0a1a0a', 'hex');
    const buf2 = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    await writeStandaloneWoundChart(exportDir, buf1);
    const p = await writeStandaloneWoundChart(exportDir, buf2);
    const readBack = await fsp.readFile(p);
    // Second call should overwrite, not append / fail.
    expect(readBack.equals(buf2)).toBe(true);
  });

});
