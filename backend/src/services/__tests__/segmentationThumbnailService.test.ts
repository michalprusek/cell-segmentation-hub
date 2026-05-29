/**
 * segmentationThumbnailService.test.ts
 *
 * Covers SegmentationThumbnailService (currently 7% coverage):
 *
 *   1. generateSegmentationThumbnail — Prisma not-found → null,
 *      no image → null, empty polygon array → null, non-existent path → null,
 *      VisualizationGenerator called with correct args, sharp resize called,
 *      DB updated with relative path, return value prefixed with /uploads/.
 *   2. generateSegmentationThumbnail error paths — viz throws → null,
 *      sharp throws → null and no DB update.
 *   3. isRetriableError (via generateSegmentationThumbnailWithRetry) —
 *      sharp-memory → retriable, DB-connection → retriable,
 *      "invalid" → non-retriable, unknown → retriable.
 *   4. generateBatchThumbnails — populates result Map, handles per-item
 *      failure (sets null).
 *   5. getConcurrencyStatus — returns expected shape.
 *
 * NOTE: VisualizationGenerator, sharp, fs, and Prisma are all mocked.
 * The vi.fn(impl) pattern is used throughout so that restoreMocks:true
 * (vitest config) restores to the working implementation instead of
 * resetting to undefined.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// All vi.mock() factories MUST use only inline expressions (no outer vars).
// ---------------------------------------------------------------------------

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: '/app/uploads',
    EXPORT_DIR: './exports',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(() => undefined),
    info: vi.fn(() => undefined),
    warn: vi.fn(() => undefined),
    error: vi.fn(() => undefined),
  },
}));

// sharp — vi.fn(impl) so restoreMocks:true restores the original (working) impl.
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn(function (this: unknown) {
      return this;
    }),
    jpeg: vi.fn(function (this: unknown) {
      return this;
    }),
    toFile: vi.fn(async () => undefined),
  })),
}));

// fs/promises — vi.fn(impl) throughout.
// IMPORTANT: the service imports `import fs from 'fs/promises'` (default),
// so the mock MUST export a `default` object for the service to call methods on.
vi.mock('fs/promises', () => {
  const mod = {
    mkdir: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('')),
    stat: vi.fn(async () => ({ size: 1 })),
    rm: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
  };
  return { ...mod, default: mod };
});

// fs — existsSync uses vi.fn(impl) so restoreMocks:true keeps returning true
vi.mock('fs', () => {
  const existsSync = vi.fn(() => true);
  return {
    default: {
      existsSync,
      promises: {
        mkdir: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
      },
    },
    existsSync,
    promises: {
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
  };
});

// VisualizationGenerator — spy stored on globalThis so tests can assert on
// it.  vi.fn(impl) ensures restoreMocks:true keeps the working implementation.
vi.mock('../visualization/visualizationGenerator', () => {
  const generateVisualization = vi.fn(async () => 'success');
  (globalThis as Record<string, unknown>).__thumbTestVizSpy =
    generateVisualization;
  return {
    VisualizationGenerator: vi.fn(function (this: Record<string, unknown>) {
      this.generateVisualization = generateVisualization;
    }),
    Polygon: {},
  };
});

vi.mock('../../storage', () => ({
  getStorageProvider: vi.fn(() => ({
    uploadFile: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
  })),
}));

vi.mock('../../utils/retryService', () => ({
  retryService: {
    executeWithRetry: vi.fn(
      async (
        operation: () => Promise<unknown>,
        _config: unknown,
        isRetriable?: (e: unknown) => boolean
      ) => {
        try {
          return await operation();
        } catch (err) {
          if (isRetriable && !isRetriable(err)) throw err;
          throw err;
        }
      }
    ),
  },
  RetryService: {
    isCommonRetriableError: vi.fn(() => false),
  },
}));

vi.mock('../../utils/concurrencyManager', () => ({
  ConcurrencyManager: vi.fn(function (
    this: Record<string, unknown>,
    maxConcurrent: number
  ) {
    this.execute = vi.fn(async (fn: () => Promise<unknown>, _name: string) =>
      fn()
    );
    this.getStatus = vi.fn(() => ({
      active: 0,
      queued: 0,
      maxConcurrent,
    }));
  }),
}));

vi.mock('../../utils/batchProcessor', () => ({
  batchProcessor: {
    processBatch: vi.fn(
      async (
        items: unknown[],
        processor: (item: unknown) => Promise<unknown>,
        opts?: {
          onBatchComplete?: (index: number, results: unknown[]) => void;
          onItemError?: (item: unknown, error: unknown) => void;
        }
      ) => {
        const results: unknown[] = [];
        for (const item of items) {
          try {
            results.push(await processor(item));
          } catch (err) {
            opts?.onItemError?.(item, err);
          }
        }
        opts?.onBatchComplete?.(0, results);
        return results;
      }
    ),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after all mocks)
// ---------------------------------------------------------------------------
import sharp from 'sharp';
import * as fs from 'fs';
import { RetryService, retryService } from '../../utils/retryService';
import { SegmentationThumbnailService } from '../segmentationThumbnailService';

// Access the module-level viz spy
const getVizSpy = (): ReturnType<typeof vi.fn> =>
  (globalThis as Record<string, unknown>).__thumbTestVizSpy as ReturnType<
    typeof vi.fn
  >;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A real existing path on Linux — the service's existsSync check passes
 * without needing to mock existsSync.
 */
const REAL_EXISTING_PATH = '/etc/hostname';

function makePrisma(
  overrides: Partial<{
    segmentationFindUnique: ReturnType<typeof vi.fn>;
    imageUpdate: ReturnType<typeof vi.fn>;
  }> = {}
) {
  return {
    segmentation: {
      findUnique:
        overrides.segmentationFindUnique ?? vi.fn().mockResolvedValue(null),
    },
    image: {
      update: overrides.imageUpdate ?? vi.fn(async () => undefined),
    },
  } as unknown as import('@prisma/client').PrismaClient;
}

function makeSegmentation(
  imageOverride?: Partial<{
    id: string;
    originalPath: string;
    project: { id: string; userId: string };
  }> | null
) {
  return {
    id: 'seg-1',
    polygons: JSON.stringify([
      { points: [{ x: 0, y: 0 }], geometry: 'polygon' },
    ]),
    imageId: 'img-1',
    model: 'hrnet',
    threshold: 0.5,
    confidence: null,
    processingTime: null,
    imageWidth: 100,
    imageHeight: 100,
    image:
      imageOverride === null
        ? null
        : {
            id: 'img-1',
            originalPath: REAL_EXISTING_PATH,
            project: { id: 'proj-1', userId: 'user-1' },
            ...imageOverride,
          },
  };
}

// ---------------------------------------------------------------------------
// 1. generateSegmentationThumbnail — early-return paths
// ---------------------------------------------------------------------------

describe('SegmentationThumbnailService — generateSegmentationThumbnail (early exit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when segmentation not found', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(null),
      })
    );
    expect(await service.generateSegmentationThumbnail('seg-x')).toBeNull();
  });

  it('returns null when segmentation has no image', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi
          .fn()
          .mockResolvedValue(makeSegmentation(null)),
      })
    );
    expect(await service.generateSegmentationThumbnail('seg-1')).toBeNull();
  });

  it('returns null for empty polygon array', async () => {
    const seg = makeSegmentation();
    (seg as { polygons: string }).polygons = '[]';
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(seg),
      })
    );
    expect(await service.generateSegmentationThumbnail('seg-1')).toBeNull();
  });

  it('returns null when original image does not exist on disk', async () => {
    // The fs mock returns true by default.  Override existsSync for THIS test
    // to return false so the service's guard fires.
    const fsMocked = fs as unknown as { existsSync: ReturnType<typeof vi.fn> };
    fsMocked.existsSync.mockReturnValueOnce(false);

    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );
    expect(await service.generateSegmentationThumbnail('seg-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. generateSegmentationThumbnail — happy path
// ---------------------------------------------------------------------------

describe('SegmentationThumbnailService — generateSegmentationThumbnail (happy path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls generateVisualization with the original image path', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    await service.generateSegmentationThumbnail('seg-1');

    const spy = getVizSpy();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe(REAL_EXISTING_PATH);
  });

  it('passes parsed polygon array to generateVisualization', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    await service.generateSegmentationThumbnail('seg-1');

    const polygons = getVizSpy().mock.calls[0][1];
    expect(Array.isArray(polygons)).toBe(true);
    expect(polygons[0]).toMatchObject({ geometry: 'polygon' });
  });

  it('calls sharp().resize().jpeg().toFile() with default 300x300', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    await service.generateSegmentationThumbnail('seg-1');

    const sharpMock = vi.mocked(sharp);
    expect(sharpMock).toHaveBeenCalledOnce();
    const instance = sharpMock.mock.results[0].value;
    expect(instance.resize).toHaveBeenCalledWith(
      300,
      300,
      expect.objectContaining({ fit: 'cover' })
    );
    expect(instance.jpeg).toHaveBeenCalledOnce();
    expect(instance.toFile).toHaveBeenCalledOnce();
  });

  it('respects custom width and height options', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    await service.generateSegmentationThumbnail('seg-1', {
      width: 128,
      height: 96,
    });

    const instance = vi.mocked(sharp).mock.results[0].value;
    expect(instance.resize).toHaveBeenCalledWith(
      128,
      96,
      expect.objectContaining({ fit: 'cover' })
    );
  });

  it('updates the image record with a relative segmentationThumbnailPath', async () => {
    const mockUpdate = vi.fn(async () => undefined);
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
        imageUpdate: mockUpdate,
      })
    );

    await service.generateSegmentationThumbnail('seg-1');

    expect(mockUpdate).toHaveBeenCalledOnce();
    const { where, data } = mockUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { segmentationThumbnailPath: string };
    };
    expect(where.id).toBe('img-1');
    expect(
      data.segmentationThumbnailPath.startsWith(
        'user-1/proj-1/segmentation_thumbnails/'
      )
    ).toBe(true);
  });

  it('returns a /uploads/-prefixed string on success', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    const result = await service.generateSegmentationThumbnail('seg-1');

    expect(result).toBeTruthy();
    expect(result!.startsWith('/uploads/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. generateSegmentationThumbnail — error paths
// ---------------------------------------------------------------------------

describe('SegmentationThumbnailService — generateSegmentationThumbnail (errors)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when VisualizationGenerator throws', async () => {
    getVizSpy().mockRejectedValueOnce(new Error('viz failure'));

    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    expect(await service.generateSegmentationThumbnail('seg-1')).toBeNull();
  });

  it('returns null and does NOT update DB when sharp throws', async () => {
    const mockUpdate = vi.fn(async () => undefined);

    vi.mocked(sharp).mockImplementationOnce(
      () =>
        ({
          resize: vi.fn(function (this: unknown) {
            return this;
          }),
          jpeg: vi.fn(function (this: unknown) {
            return this;
          }),
          toFile: vi.fn(async () => {
            throw new Error('out of memory');
          }),
        }) as never
    );

    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
        imageUpdate: mockUpdate,
      })
    );

    expect(await service.generateSegmentationThumbnail('seg-1')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. isRetriableError — tested via generateSegmentationThumbnailWithRetry
// ---------------------------------------------------------------------------

describe('SegmentationThumbnailService — isRetriableError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(RetryService.isCommonRetriableError).mockReturnValue(false);
  });

  const captureIsRetriable = async (
    errorMessage: string
  ): Promise<((e: unknown) => boolean) | undefined> => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi
          .fn()
          .mockRejectedValue(new Error(errorMessage)),
      })
    );
    let captured: ((e: unknown) => boolean) | undefined;
    vi.mocked(retryService.executeWithRetry).mockImplementationOnce(
      async (_op, _cfg, isRetriable) => {
        captured = isRetriable;
        return null;
      }
    );
    await service.generateSegmentationThumbnailWithRetry('seg-1');
    return captured;
  };

  it('marks sharp+memory errors as retriable', async () => {
    const fn = await captureIsRetriable('sharp memory exceeded');
    expect(fn!(new Error('sharp memory exceeded'))).toBe(true);
  });

  it('marks sharp+buffer errors as retriable', async () => {
    const fn = await captureIsRetriable('sharp buffer overflow');
    expect(fn!(new Error('sharp buffer overflow'))).toBe(true);
  });

  it('marks sharp+processing errors as retriable', async () => {
    const fn = await captureIsRetriable('sharp processing error');
    expect(fn!(new Error('sharp processing error'))).toBe(true);
  });

  it('marks prisma+timeout errors as retriable', async () => {
    const fn = await captureIsRetriable('prisma timeout');
    expect(fn!(new Error('prisma timeout'))).toBe(true);
  });

  it('marks prisma+connection errors as retriable', async () => {
    const fn = await captureIsRetriable('prisma connection refused');
    expect(fn!(new Error('prisma connection refused'))).toBe(true);
  });

  it('marks "invalid data" errors as non-retriable', async () => {
    const fn = await captureIsRetriable('invalid polygon data');
    expect(fn!(new Error('invalid polygon data'))).toBe(false);
  });

  it('marks "corrupt file" errors as non-retriable', async () => {
    const fn = await captureIsRetriable('corrupt file');
    expect(fn!(new Error('corrupt file detected'))).toBe(false);
  });

  it('marks unknown errors as retriable by default', async () => {
    const fn = await captureIsRetriable('something weird');
    expect(fn!(new Error('completely unknown error'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. generateBatchThumbnails
// ---------------------------------------------------------------------------

describe('SegmentationThumbnailService — generateBatchThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a Map with one entry per segmentation ID', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    const results = await service.generateBatchThumbnails(['seg-1', 'seg-2']);
    expect(results.size).toBe(2);
    expect(results.has('seg-1')).toBe(true);
    expect(results.has('seg-2')).toBe(true);
  });

  it('maps successful generations to non-null strings', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(makeSegmentation()),
      })
    );

    const results = await service.generateBatchThumbnails(['seg-1']);
    expect(results.get('seg-1')).toBeTruthy();
    expect(typeof results.get('seg-1')).toBe('string');
  });

  it('maps missing segmentation to null', async () => {
    const service = new SegmentationThumbnailService(
      makePrisma({
        segmentationFindUnique: vi.fn().mockResolvedValue(null),
      })
    );

    const results = await service.generateBatchThumbnails(['missing']);
    expect(results.get('missing')).toBeNull();
  });

  it('returns empty Map for empty input', async () => {
    const service = new SegmentationThumbnailService(makePrisma());
    expect((await service.generateBatchThumbnails([])).size).toBe(0);
  });

  it('continues processing after a failed item', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // first → null
      .mockResolvedValueOnce(makeSegmentation()); // second → success

    const service = new SegmentationThumbnailService(
      makePrisma({ segmentationFindUnique: findUnique })
    );

    const results = await service.generateBatchThumbnails([
      'bad-seg',
      'good-seg',
    ]);
    expect(results.has('bad-seg')).toBe(true);
    expect(results.has('good-seg')).toBe(true);
    expect(results.get('good-seg')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. getConcurrencyStatus
// ---------------------------------------------------------------------------

describe('SegmentationThumbnailService — getConcurrencyStatus', () => {
  it('returns active, queued, maxConcurrent', () => {
    const service = new SegmentationThumbnailService(makePrisma());
    const status = service.getConcurrencyStatus();
    expect(typeof status.active).toBe('number');
    expect(typeof status.queued).toBe('number');
    expect(typeof status.maxConcurrent).toBe('number');
    expect(status.maxConcurrent).toBe(5);
  });
});
