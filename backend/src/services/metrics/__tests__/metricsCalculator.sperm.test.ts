import { MetricsCalculator, ImageWithSegmentation } from '../metricsCalculator';

const mockWorksheet = {
  columns: [] as Array<{ header?: string; key?: string; width?: number }>,
  addRow: vi.fn(),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};

const mockAddWorksheet = vi.fn(() => mockWorksheet);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

// Plain constructor inside the factory: not a vi.fn(), so `restoreMocks: true`
// (vitest.config.ts) cannot wipe its body between tests. Top-level mock state
// is captured by closure and accessed lazily when `new ExcelJS.Workbook()` runs.
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

// Override the global fs/promises mock from src/test/setup.ts which lacks a
// default export. metricsCalculator uses `import fs from 'fs/promises'`.
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

vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ post: vi.fn() })) },
  create: vi.fn(() => ({ post: vi.fn() })),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://ml-service:8000',
  },
}));

import { logger } from '../../../utils/logger';
const mockedLogger = logger as Mocked<typeof logger>;

const buildImage = (
  id: string,
  name: string,
  polygons: unknown
): ImageWithSegmentation => ({
  id,
  name,
  segmentation: {
    polygons:
      typeof polygons === 'string' ? polygons : JSON.stringify(polygons),
    model: 'sperm',
    threshold: 0.5,
  },
});

const headPart = (instanceId = 'sperm_1') => ({
  id: 'h',
  type: 'external' as const,
  geometry: 'polyline' as const,
  partClass: 'head' as const,
  instanceId,
  points: [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ],
});

const midPart = (instanceId = 'sperm_1') => ({
  id: 'm',
  type: 'external' as const,
  geometry: 'polyline' as const,
  partClass: 'midpiece' as const,
  instanceId,
  points: [
    { x: 3, y: 0 },
    { x: 3, y: 4 },
  ],
});

const tailPart = (instanceId = 'sperm_1') => ({
  id: 't',
  type: 'external' as const,
  geometry: 'polyline' as const,
  partClass: 'tail' as const,
  instanceId,
  points: [
    { x: 3, y: 4 },
    { x: 3, y: 9 },
  ],
});

describe('MetricsCalculator.exportSpermToExcel', () => {
  let calculator: MetricsCalculator;
  const outputPath = '/tmp/sperm-test/sperm.xlsx';

  beforeEach(() => {
    // restoreMocks: true clears mockImplementation set after creation, so
    // re-establish here; original impls passed to vi.fn(impl) DO survive.
    mockWorksheet.columns = [];
    mockWorksheet.addRow.mockReset();
    mockWorksheet.getRow.mockReset();
    mockWorksheet.getRow.mockImplementation(() => ({
      font: undefined,
      fill: undefined,
    }));
    mockAddWorksheet.mockClear();
    mockWriteFile.mockClear();
    mockedLogger.warn.mockClear();

    calculator = new MetricsCalculator();
  });

  it('returns false and writes no file when no polylines exist', async () => {
    const closedPolygon = {
      id: 'p1',
      type: 'external',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    const result = await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [closedPolygon])],
      outputPath
    );

    expect(result).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWorksheet.addRow).not.toHaveBeenCalled();
  });

  it('returns true and writes one row per sperm instance with exact lengths', async () => {
    const result = await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [headPart(), midPart(), tailPart()])],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(outputPath);
    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(1);
    expect(mockWorksheet.addRow).toHaveBeenCalledWith({
      imageName: 'a.png',
      instanceId: 'sperm_1',
      headLength: 3,
      midpieceLength: 4,
      tailLength: 5,
      totalLength: 12,
    });
  });

  it('uses px units in headers when no scale is provided', async () => {
    await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [headPart(), midPart(), tailPart()])],
      outputPath
    );

    const headers = mockWorksheet.columns.map(c => c.header);
    expect(headers).toEqual([
      'Image Name',
      'Instance ID',
      'Head Length (px)',
      'Midpiece Length (px)',
      'Tail Length (px)',
      'Total Length (px)',
    ]);
  });

  it('uses µm units and scales lengths when pixelToMicrometerScale > 0', async () => {
    await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [headPart(), midPart(), tailPart()])],
      outputPath,
      2
    );

    const headers = mockWorksheet.columns.map(c => c.header);
    expect(headers).toContain('Head Length (µm)');
    expect(headers).toContain('Total Length (µm)');
    expect(mockWorksheet.addRow).toHaveBeenCalledWith({
      imageName: 'a.png',
      instanceId: 'sperm_1',
      headLength: 6,
      midpieceLength: 8,
      tailLength: 10,
      totalLength: 24,
    });
  });

  it('treats scale = 0 and undefined as "no scale" (uses px)', async () => {
    await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [headPart()])],
      outputPath,
      0
    );

    const headers = mockWorksheet.columns.map(c => c.header);
    expect(headers).toContain('Head Length (px)');
    expect(mockWorksheet.addRow).toHaveBeenCalledWith(
      expect.objectContaining({ headLength: 3 })
    );
  });

  it('records 0 for missing parts (e.g. instance with only head)', async () => {
    const result = await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [headPart('sperm_1')])],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockWorksheet.addRow).toHaveBeenCalledWith({
      imageName: 'a.png',
      instanceId: 'sperm_1',
      headLength: 3,
      midpieceLength: 0,
      tailLength: 0,
      totalLength: 3,
    });
  });

  it('writes one row per instance when an image contains multiple sperm', async () => {
    const result = await calculator.exportSpermToExcel(
      [
        buildImage('img1', 'a.png', [
          headPart('sperm_1'),
          midPart('sperm_1'),
          tailPart('sperm_1'),
          headPart('sperm_2'),
          tailPart('sperm_2'),
        ]),
      ],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(2);
    const rows = mockWorksheet.addRow.mock.calls.map(c => c[0]);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: 'sperm_1', totalLength: 12 }),
        expect.objectContaining({
          instanceId: 'sperm_2',
          totalLength: 8,
          midpieceLength: 0,
        }),
      ])
    );
  });

  it('skips images with malformed JSON without crashing and continues processing', async () => {
    const result = await calculator.exportSpermToExcel(
      [
        buildImage('img1', 'broken.png', '{not-valid-json'),
        buildImage('img2', 'good.png', [headPart(), midPart(), tailPart()]),
      ],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse polygons'),
      'MetricsCalculator',
      expect.objectContaining({ imageId: 'img1' })
    );
    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(1);
    expect(mockWorksheet.addRow).toHaveBeenCalledWith(
      expect.objectContaining({ imageName: 'good.png' })
    );
  });

  it('excludes orphan polylines (no instanceId) and warns', async () => {
    const orphan = { ...headPart(), instanceId: undefined };
    const result = await calculator.exportSpermToExcel(
      [buildImage('img1', 'a.png', [orphan, midPart(), tailPart()])],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('without instanceId'),
      'MetricsCalculator',
      expect.objectContaining({ imageId: 'img1' })
    );
    const row = mockWorksheet.addRow.mock.calls[0]?.[0];
    expect(row).toEqual(
      expect.objectContaining({
        instanceId: 'sperm_1',
        headLength: 0,
        midpieceLength: 4,
        tailLength: 5,
        totalLength: 9,
      })
    );
  });

  it('ignores polylines whose partClass is "core" (not a sperm part)', async () => {
    const corePolyline = {
      id: 'c',
      type: 'external' as const,
      geometry: 'polyline' as const,
      partClass: 'core' as const,
      instanceId: 'sperm_1',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    const result = await calculator.exportSpermToExcel(
      [
        buildImage('img1', 'a.png', [
          corePolyline,
          headPart(),
          midPart(),
          tailPart(),
        ]),
      ],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockWorksheet.addRow).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'sperm_1',
        headLength: 3,
        midpieceLength: 4,
        tailLength: 5,
        totalLength: 12,
      })
    );
  });

  it('skips images with no segmentation data', async () => {
    const result = await calculator.exportSpermToExcel(
      [
        { id: 'img1', name: 'no-seg.png' },
        buildImage('img2', 'a.png', [headPart(), midPart(), tailPart()]),
      ],
      outputPath
    );

    expect(result).toBe(true);
    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(1);
  });
});
