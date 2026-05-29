import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../db', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

vi.mock('../sharingService', () => ({
  hasProjectAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
}));

vi.mock('../websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({ emitToUser: vi.fn() })),
  },
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'job-sperm-orch') }));

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: './test-uploads',
    EXPORT_DIR: './test-exports',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

vi.mock('fs/promises', () => {
  const noop = vi.fn().mockResolvedValue(undefined);
  const api = {
    mkdir: noop,
    writeFile: noop,
    readFile: noop,
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({}),
    unlink: noop,
    copyFile: noop,
    open: vi.fn(),
  };
  return { default: api, ...api };
});

vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    directory: vi.fn(),
    on: vi.fn(),
    pipe: vi.fn(),
    finalize: vi.fn(),
  })),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
  })),
}));

vi.mock('../visualization/visualizationGenerator', () => ({
  VisualizationGenerator: vi.fn(),
}));

vi.mock('../metrics/metricsCalculator', () => ({
  MetricsCalculator: vi.fn(),
}));

vi.mock('../export/formatConverter', () => ({
  FormatConverter: vi.fn(),
  resolveImageDimensions: vi
    .fn()
    .mockResolvedValue({ width: 100, height: 100 }),
}));

vi.mock('../../utils/batchProcessor', () => ({
  batchProcessor: {
    processBatch: vi.fn(
      async (
        items: unknown[],
        processor: (item: unknown) => Promise<unknown>
      ) => Promise.all(items.map(processor))
    ),
  },
}));

import { ExportService } from '../exportService';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';
import { FormatConverter } from '../export/formatConverter';
import { logger } from '../../utils/logger';

const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<
  typeof vi.fn
>;
const MockVisualizationGenerator =
  VisualizationGenerator as unknown as ReturnType<typeof vi.fn>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<
  typeof vi.fn
>;
const mockedLogger = logger as Mocked<typeof logger>;

const resetSingleton = () => {
  (ExportService as any).instance = undefined;
};

interface SpyHandles {
  exportSpermToExcel: ReturnType<typeof vi.fn>;
  exportPolygonMetricsToExcel: ReturnType<typeof vi.fn>;
  exportToExcel: ReturnType<typeof vi.fn>;
  calculateAllMetrics: ReturnType<typeof vi.fn>;
  calculateAllImageMetrics: ReturnType<typeof vi.fn>;
}

const buildImage = (
  id: string,
  polygons: unknown[]
): {
  id: string;
  name: string;
  width: number;
  height: number;
  segmentation: { polygons: string; model: string; threshold: number };
} => ({
  id,
  name: `${id}.png`,
  // width+height set so generateMetrics skips the disk-based BMP/sharp branch.
  width: 100,
  height: 100,
  segmentation: {
    polygons: JSON.stringify(polygons),
    model: 'sperm',
    threshold: 0.5,
  },
});

const spermPolyline = (
  partClass: 'head' | 'midpiece' | 'tail',
  instanceId = 'sperm_1'
) => ({
  id: `pl-${partClass}`,
  type: 'external',
  geometry: 'polyline',
  partClass,
  instanceId,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
});

describe('ExportService — sperm Excel orchestration (generateMetrics)', () => {
  let service: ExportService;
  let spies: SpyHandles;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSingleton();

    spies = {
      exportSpermToExcel: vi.fn(),
      exportPolygonMetricsToExcel: vi.fn().mockResolvedValue(undefined),
      exportToExcel: vi.fn().mockResolvedValue(undefined),
      calculateAllMetrics: vi.fn().mockResolvedValue([]),
      calculateAllImageMetrics: vi.fn().mockResolvedValue([]),
    };

    MockVisualizationGenerator.mockImplementation(function (this: any) {
      this.generateVisualization = vi.fn().mockResolvedValue(undefined);
    });
    MockFormatConverter.mockImplementation(function (this: any) {
      this.convertToCOCO = vi.fn().mockResolvedValue({});
      this.convertToYOLO = vi
        .fn()
        .mockResolvedValue({ content: '', warnings: [] });
      this.convertToJSON = vi.fn().mockResolvedValue({});
    });
    MockMetricsCalculator.mockImplementation(function (this: any) {
      this.calculateAllMetrics = spies.calculateAllMetrics;
      this.calculateAllImageMetrics = spies.calculateAllImageMetrics;
      this.exportToExcel = spies.exportToExcel;
      this.exportToCSV = vi.fn().mockResolvedValue(undefined);
      this.exportPolygonMetricsToExcel = spies.exportPolygonMetricsToExcel;
      this.exportSpermToExcel = spies.exportSpermToExcel;
    });

    service = ExportService.getInstance();
  });

  afterEach(() => {
    resetSingleton();
  });

  const callGenerateMetrics = (
    projectType: string,
    images: ReturnType<typeof buildImage>[],
    options?: { pixelToMicrometerScale?: number }
  ) =>
    (service as any).generateMetrics(
      images,
      '/tmp/sperm-orch-test',
      ['excel'],
      'project-name',
      projectType,
      options,
      'job-sperm-orch'
    );

  it('uses sperm Excel only when projectType is sperm and data exists', async () => {
    spies.exportSpermToExcel.mockResolvedValue(true);

    await callGenerateMetrics('sperm', [
      buildImage('img1', [
        spermPolyline('head'),
        spermPolyline('midpiece'),
        spermPolyline('tail'),
      ]),
    ]);

    expect(spies.exportSpermToExcel).toHaveBeenCalledTimes(1);
    expect(spies.exportPolygonMetricsToExcel).not.toHaveBeenCalled();
    expect(spies.exportToExcel).not.toHaveBeenCalled();
  });

  it('falls back to polygon-metrics Excel and warns when sperm export returns false', async () => {
    spies.exportSpermToExcel.mockResolvedValue(false);

    await callGenerateMetrics('sperm', [buildImage('img1', [])]);

    expect(spies.exportSpermToExcel).toHaveBeenCalledTimes(1);
    expect(spies.exportPolygonMetricsToExcel).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('flagged as sperm but no polyline data'),
      'ExportService',
      expect.objectContaining({ jobId: 'job-sperm-orch' })
    );
  });

  it('propagates pixelToMicrometerScale to exportSpermToExcel', async () => {
    spies.exportSpermToExcel.mockResolvedValue(true);

    await callGenerateMetrics(
      'sperm',
      [buildImage('img1', [spermPolyline('head')])],
      { pixelToMicrometerScale: 2.5 }
    );

    expect(spies.exportSpermToExcel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/metrics\.xlsx$/),
      2.5
    );
  });

  it('passes scale-undefined when no scale option is provided', async () => {
    spies.exportSpermToExcel.mockResolvedValue(true);

    await callGenerateMetrics('sperm', [
      buildImage('img1', [spermPolyline('head')]),
    ]);

    expect(spies.exportSpermToExcel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      undefined
    );
  });

  it('routes spheroid projects through polygon-metrics Excel, never sperm', async () => {
    await callGenerateMetrics('spheroid', [buildImage('img1', [])]);

    expect(spies.exportSpermToExcel).not.toHaveBeenCalled();
    expect(spies.exportPolygonMetricsToExcel).toHaveBeenCalledTimes(1);
  });

  it('routes spheroid_invasive projects through DI-shaped Excel, never sperm', async () => {
    await callGenerateMetrics('spheroid_invasive', [buildImage('img1', [])]);

    expect(spies.exportSpermToExcel).not.toHaveBeenCalled();
    expect(spies.exportToExcel).toHaveBeenCalledTimes(1);
  });

  it('forwards image segmentation JSON unchanged to exportSpermToExcel', async () => {
    spies.exportSpermToExcel.mockResolvedValue(true);

    const polylines = [spermPolyline('head'), spermPolyline('tail')];
    await callGenerateMetrics('sperm', [buildImage('img-x', polylines)]);

    const passedImages = spies.exportSpermToExcel.mock.calls[0]?.[0];
    expect(passedImages).toHaveLength(1);
    expect(passedImages[0].id).toBe('img-x');
    expect(passedImages[0].segmentation.polygons).toBe(
      JSON.stringify(polylines)
    );
  });
});
