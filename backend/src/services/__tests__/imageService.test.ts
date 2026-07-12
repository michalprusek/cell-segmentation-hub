/**
 * imageService.test.ts — consolidated core suite for ImageService.
 *
 * Covers every ImageService path that does NOT require a real
 * LocalStorageProvider instance (getStorageProvider returns a plain
 * `storageMock`, so `storage instanceof LocalStorageProvider` is false and
 * getImageBuffer throws — which is exactly what the getVideoFrameForDisplay
 * null-path tests exercise). The display/conversion pipeline that DOES need a
 * real LocalStorageProvider lives in imageService.display.test.ts.
 *
 * Organized by concern:
 *   - uploadImages / uploadImagesWithProgress
 *   - getProjectImages (listing, pagination, calibration bubble)
 *   - getImageById
 *   - deleteImage (storage cleanup + video-container directory)
 *   - deleteBatch (cascade cleanup, partial failure, WS emit)
 *   - getImageStats
 *   - updateSegmentationStatus (permission + WebSocket emit gating)
 *   - reorderImages
 *   - getVideoFrameForDisplay (null paths)
 *   - removeConvertedFile
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks (declared before the source import) ───────────────────────────────

const prismaMock = {
  project: { findFirst: vi.fn() as ReturnType<typeof vi.fn> },
  image: {
    create: vi.fn() as ReturnType<typeof vi.fn>,
    findMany: vi.fn() as ReturnType<typeof vi.fn>,
    findFirst: vi.fn() as ReturnType<typeof vi.fn>,
    findUnique: vi.fn() as ReturnType<typeof vi.fn>,
    count: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    updateMany: vi.fn() as ReturnType<typeof vi.fn>,
    aggregate: vi.fn() as ReturnType<typeof vi.fn>,
    groupBy: vi.fn() as ReturnType<typeof vi.fn>,
  },
  user: { findUnique: vi.fn() as ReturnType<typeof vi.fn> },
  $transaction: vi.fn() as ReturnType<typeof vi.fn>,
};

const storageMock = {
  upload: vi.fn() as ReturnType<typeof vi.fn>,
  getUrl: vi.fn() as ReturnType<typeof vi.fn>,
  delete: vi.fn() as ReturnType<typeof vi.fn>,
};

// WebSocket + fs/promises mocks are hoisted because the source imports
// `websocketService` eagerly (a direct, non-deferred reference in the vi.mock
// factory would otherwise hit a TDZ). `wsInstanceMock` is a persistent object
// so `toHaveBeenCalled` assertions hold across the emit-gating describes.
const { wsInstanceMock, webSocketServiceMock, fsRmMock } = vi.hoisted(() => {
  const wsInstanceMock = {
    emitToUser: vi.fn(),
    broadcastProjectUpdate: vi.fn(),
    emitDashboardUpdate: vi.fn(),
  };
  return {
    wsInstanceMock,
    webSocketServiceMock: { getInstance: vi.fn(() => wsInstanceMock) },
    // fs.rm used by the video-container delete branch (dynamic
    // `import('fs/promises')`).
    fsRmMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../db', () => ({ prisma: prismaMock }));

vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => storageMock),
  // A real class so `instanceof LocalStorageProvider` works (returns false for
  // the plain storageMock) and the static generateKey call in uploadImages
  // resolves. getImageBuffer therefore throws for storageMock — the behavior
  // the getVideoFrameForDisplay null-path tests depend on.
  LocalStorageProvider: class LocalStorageProvider {
    static generateKey(_userId: string, _projectId: string, filename: string) {
      return `uploads/${filename}`;
    }
  },
}));

vi.mock('../websocketService', () => ({
  WebSocketService: webSocketServiceMock,
}));

vi.mock('../userService', () => ({
  getUserStats: vi.fn().mockResolvedValue({
    totalProjects: 1,
    totalImages: 10,
    processedImages: 5,
    imagesUploadedToday: 2,
    storageUsed: '100 MB',
    storageUsedBytes: 100_000_000,
  }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    UPLOAD_DIR: '/tmp/uploads',
    STORAGE_TYPE: 'local',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
  },
}));

vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3001'),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('converted')),
  })),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('data')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ size: 100, mtimeMs: Date.now() }),
    access: vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('fs/promises', () => ({
  default: { rm: fsRmMock, mkdir: vi.fn(), readdir: vi.fn() },
  rm: fsRmMock,
}));

import { ImageService } from '../imageService';
import { logger } from '../../utils/logger';
import { getStorageProvider } from '../../storage/index';
import * as fsModule from 'fs';

const mockGetStorageProvider = getStorageProvider as ReturnType<typeof vi.fn>;

// ─── Fixtures / helpers ──────────────────────────────────────────────────────

const makeService = () => new ImageService(prismaMock as never);

const mockProject = { id: 'proj-1', userId: 'user-1' };

const mockUploadResult = {
  originalPath: 'uploads/test.jpg',
  thumbnailPath: 'uploads/test_thumb.jpg',
  fileSize: 1024,
  width: 800,
  height: 600,
  mimeType: 'image/jpeg',
};

const makeFile = (name = 'test.jpg', mimetype = 'image/jpeg') => ({
  originalname: name,
  buffer: Buffer.from('fake-image-data'),
  mimetype,
  size: 1024,
});

/** Full-featured Image DB row; override any field per test. */
const makeImage = (overrides: Record<string, unknown> = {}) => ({
  id: 'img-1',
  name: 'test.jpg',
  originalPath: 'uploads/test.jpg',
  thumbnailPath: 'uploads/test_thumb.jpg',
  segmentationThumbnailPath: null,
  projectId: 'proj-1',
  fileSize: BigInt(1024),
  width: 800,
  height: 600,
  mimeType: 'image/jpeg',
  segmentationStatus: 'no_segmentation',
  isVideoContainer: false,
  parentVideoId: null,
  frameIndex: null,
  displayOrder: 0,
  pixelSizeUm: null,
  frameIntervalMs: null,
  channels: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const paginationOpts = {
  page: 1,
  limit: 10,
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
};

// getImageStats uses server-side aggregation (image.aggregate + two
// image.groupBy calls) rather than loading rows. Derive those mock returns
// from a flat array of rows so per-test data stays readable, summing fileSize
// in bigint space to mirror Prisma's BigInt aggregate (guards fileSize
// overflow regressions).
function mockImageStatsRows(
  rows: Array<{
    fileSize?: number | bigint | null;
    segmentationStatus?: string;
    mimeType?: string | null;
  }>
) {
  prismaMock.image.aggregate.mockResolvedValueOnce({
    _count: { _all: rows.length },
    _sum: { fileSize: rows.reduce((s, r) => s + BigInt(r.fileSize ?? 0), 0n) },
  });

  const groupCount = (values: Array<string | null | undefined>, field: string) => {
    const counts = new Map<string, number>();
    for (const v of values) {
      if (v != null) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    return [...counts].map(([k, c]) => ({ [field]: k, _count: { _all: c } }));
  };

  prismaMock.image.groupBy
    .mockResolvedValueOnce(
      groupCount(rows.map(r => r.segmentationStatus), 'segmentationStatus')
    )
    .mockResolvedValueOnce(groupCount(rows.map(r => r.mimeType), 'mimeType'));
}

// Clears call history AND resets Prisma/storage one-time queues (global
// clearMocks does not clear `.mockResolvedValueOnce` queues, so an unconsumed
// one would leak into the next test once these describes share a process).
// Factory implementations that tests rely on are re-established afterwards.
beforeEach(() => {
  vi.clearAllMocks();

  for (const m of [
    prismaMock.project.findFirst,
    prismaMock.image.create,
    prismaMock.image.findMany,
    prismaMock.image.findFirst,
    prismaMock.image.findUnique,
    prismaMock.image.count,
    prismaMock.image.delete,
    prismaMock.image.update,
    prismaMock.image.updateMany,
    prismaMock.image.aggregate,
    prismaMock.image.groupBy,
    prismaMock.user.findUnique,
    prismaMock.$transaction,
    storageMock.upload,
    storageMock.getUrl,
    storageMock.delete,
  ]) {
    m.mockReset();
  }

  mockGetStorageProvider.mockReturnValue(storageMock);
  webSocketServiceMock.getInstance.mockReturnValue(wsInstanceMock);
  storageMock.upload.mockResolvedValue(mockUploadResult);
  storageMock.getUrl.mockImplementation(async (p: string) => `http://host/${p}`);
  storageMock.delete.mockResolvedValue(undefined);
});

// ─── uploadImages / uploadImagesWithProgress ─────────────────────────────────

describe('ImageService — uploadImages', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
  });

  it('verifies project ownership, uploads files, and returns ImageWithUrls', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    prismaMock.image.create.mockResolvedValueOnce(makeImage());

    const result = await service.uploadImages('proj-1', 'user-1', [makeFile()]);

    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'proj-1' }),
      })
    );
    expect(storageMock.upload).toHaveBeenCalledTimes(1);
    expect(prismaMock.image.create).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('originalUrl');
    expect(result[0]).toHaveProperty('displayUrl');
    expect(result[0].id).toBe('img-1');
  });

  it('throws forbidden and skips upload when project not found', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.uploadImages('bad-project', 'user-1', [makeFile()])
    ).rejects.toThrow('Access denied to this project');

    expect(storageMock.upload).not.toHaveBeenCalled();
  });

  it('continues past a single-file failure and returns only the successful uploads', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    storageMock.upload
      .mockResolvedValueOnce(mockUploadResult)
      .mockRejectedValueOnce(new Error('Storage error'));
    prismaMock.image.create.mockResolvedValueOnce(makeImage({ name: 'test.jpg' }));

    const result = await service.uploadImages('proj-1', 'user-1', [
      makeFile('good.jpg'),
      makeFile('bad.jpg'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test.jpg');
  });

  it('throws when ALL files fail to upload (zero uploaded)', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    storageMock.upload.mockRejectedValue(new Error('disk full'));

    await expect(
      service.uploadImages('proj-1', 'user-1', [makeFile('a.png', 'image/png')])
    ).rejects.toThrow();
  });
});

describe('ImageService — uploadImagesWithProgress', () => {
  it('throws "Access denied" when project not found', async () => {
    const service = makeService();
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.uploadImagesWithProgress(
        'proj-missing',
        'user-1',
        [makeFile('test.png', 'image/png')],
        'batch-1',
        vi.fn()
      )
    ).rejects.toThrow();
  });
});

// ─── getProjectImages (listing, pagination, calibration bubble) ──────────────

describe('ImageService — getProjectImages', () => {
  let service: ImageService;

  beforeEach(() => {
    service = makeService();
    prismaMock.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
    prismaMock.project.findFirst.mockResolvedValue(mockProject);
  });

  it('returns paginated images with a pagination object', async () => {
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);

    const result = await service.getProjectImages('proj-1', 'user-1', paginationOpts);

    expect(result.images).toHaveLength(1);
    expect(result.pagination).toEqual(
      expect.objectContaining({ page: 1, limit: 10, total: 1, totalPages: 1 })
    );
    expect(result.images[0]).toHaveProperty('originalUrl');
  });

  it('filters by segmentation status when provided', async () => {
    prismaMock.image.count.mockResolvedValueOnce(0);
    prismaMock.image.findMany.mockResolvedValueOnce([]);

    await service.getProjectImages('proj-1', 'user-1', {
      ...paginationOpts,
      status: 'completed' as never,
    });

    expect(prismaMock.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ segmentationStatus: 'completed' }),
      })
    );
  });

  it('excludes video container rows (isVideoContainer:false in where)', async () => {
    prismaMock.image.count.mockResolvedValueOnce(0);
    prismaMock.image.findMany.mockResolvedValueOnce([]);

    await service.getProjectImages('proj-1', 'user-1', paginationOpts);

    const findCall = prismaMock.image.findMany.mock.calls[0][0];
    expect(findCall.where).toMatchObject({ isVideoContainer: false });
  });

  it('pagination: hasNext=true, hasPrev=false on page 1 when more pages remain', async () => {
    prismaMock.image.count.mockResolvedValueOnce(25);
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);

    const result = await service.getProjectImages('proj-1', 'user-1', {
      ...paginationOpts,
      limit: 10,
    });

    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it('pagination: hasPrev=true and hasNext=true on page 2', async () => {
    prismaMock.image.count.mockResolvedValueOnce(25);
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);

    const result = await service.getProjectImages('proj-1', 'user-1', {
      ...paginationOpts,
      page: 2,
      limit: 10,
    });

    expect(result.pagination.hasPrev).toBe(true);
    expect(result.pagination.hasNext).toBe(true);
  });

  it('pagination: hasNext=false and hasPrev=false on the only page', async () => {
    prismaMock.image.count.mockResolvedValueOnce(5);
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);

    const result = await service.getProjectImages('proj-1', 'user-1', {
      ...paginationOpts,
      limit: 10,
    });

    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it('bubbles pixelSizeUm/frameIntervalMs from the parent container onto frame rows', async () => {
    const frame = makeImage({
      id: 'frame-1',
      parentVideoId: 'container-1',
      pixelSizeUm: null,
      frameIntervalMs: null,
    });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany
      .mockResolvedValueOnce([frame])
      .mockResolvedValueOnce([
        { id: 'container-1', pixelSizeUm: 0.065, frameIntervalMs: 250 },
      ]);

    const result = await service.getProjectImages('proj-1', 'user-1', paginationOpts);

    expect(result.images[0].pixelSizeUm).toBe(0.065);
    expect(result.images[0].frameIntervalMs).toBe(250);
  });

  it('keeps frame calibration null when the container calibration is null', async () => {
    const frame = makeImage({ id: 'frame-null', parentVideoId: 'container-null' });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany
      .mockResolvedValueOnce([frame])
      .mockResolvedValueOnce([
        { id: 'container-null', pixelSizeUm: null, frameIntervalMs: null },
      ]);

    const result = await service.getProjectImages('proj-1', 'user-1', paginationOpts);

    expect(result.images[0].pixelSizeUm).toBeNull();
    expect(result.images[0].frameIntervalMs).toBeNull();
  });

  it('keeps a standalone image own calibration when parentVideoId is null', async () => {
    const standalone = makeImage({
      id: 'standalone-1',
      parentVideoId: null,
      pixelSizeUm: 0.12,
    });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany.mockResolvedValueOnce([standalone]);

    const result = await service.getProjectImages('proj-1', 'user-1', paginationOpts);

    expect(result.images[0].pixelSizeUm).toBe(0.12);
  });

  it('warns when a frame references a missing parent container (orphan drift)', async () => {
    const frame = makeImage({ id: 'orphan-frame', parentVideoId: 'ghost-container' });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany
      .mockResolvedValueOnce([frame])
      .mockResolvedValueOnce([]);

    await service.getProjectImages('proj-1', 'user-1', paginationOpts);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('calibration bubble will fall through'),
      'ImageService',
      expect.objectContaining({ missingParentIds: ['ghost-container'] })
    );
  });

  it('throws when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.getProjectImages('proj-1', 'user-1', paginationOpts)
    ).rejects.toThrow('User not found');
  });

  it('throws forbidden when project not accessible', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getProjectImages('proj-1', 'user-1', paginationOpts)
    ).rejects.toThrow('Access denied to this project');
  });
});

// ─── getImageById ─────────────────────────────────────────────────────────────

describe('ImageService — getImageById', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
    prismaMock.project.findFirst.mockResolvedValue(mockProject);
  });

  it('returns null (and skips the image lookup) when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await service.getImageById('img-1', 'user-1');

    expect(result).toBeNull();
    expect(prismaMock.image.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when image not found (no permission)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(null);

    const result = await service.getImageById('img-1', 'user-1');

    expect(result).toBeNull();
  });

  it('returns ImageWithUrls including thumbnailUrl when thumbnailPath is set', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ project: mockProject })
    );

    const result = await service.getImageById('img-1', 'user-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('img-1');
    expect(result!.originalUrl).toBe('http://host/uploads/test.jpg');
    expect(result!.thumbnailUrl).toBe('http://host/uploads/test_thumb.jpg');
  });

  it('omits thumbnailUrl when thumbnailPath is null', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ thumbnailPath: null, project: mockProject })
    );

    const result = await service.getImageById('img-1', 'user-1');

    expect(result!.thumbnailUrl).toBeUndefined();
  });

  it('includes segmentationThumbnailUrl when segmentationThumbnailPath is set', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ segmentationThumbnailPath: 'uploads/seg_thumb.jpg', project: mockProject })
    );

    const result = await service.getImageById('img-1', 'user-1');

    expect(result!.segmentationThumbnailUrl).toBe('http://host/uploads/seg_thumb.jpg');
  });

  it('omits segmentationThumbnailUrl when segmentationThumbnailPath is null', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ segmentationThumbnailPath: null, project: mockProject })
    );

    const result = await service.getImageById('img-1', 'user-1');

    expect(result!.segmentationThumbnailUrl).toBeUndefined();
  });

  it('includes a displayUrl pointing at the image display endpoint', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ project: mockProject })
    );

    const result = await service.getImageById('img-1', 'user-1');

    expect(result!.displayUrl).toContain('/api/images/img-1/display');
  });
});

// ─── deleteImage (storage cleanup + video-container directory) ────────────────

describe('ImageService — deleteImage', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
    // emitProjectStatsUpdate issues two image.count queries.
    prismaMock.image.count.mockResolvedValue(3);
    prismaMock.user.findUnique.mockResolvedValue({ email: 'u@test.com' });
  });

  it('throws forbidden and skips storage when the image is not found', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(null);

    await expect(service.deleteImage('img-1', 'bad-user')).rejects.toThrow(
      'Access denied to this image'
    );
    expect(storageMock.delete).not.toHaveBeenCalled();
  });

  it('deletes originalPath and thumbnailPath from storage, then the DB row', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());
    prismaMock.image.delete.mockResolvedValueOnce(makeImage());

    await service.deleteImage('img-1', 'user-1');

    expect(storageMock.delete).toHaveBeenCalledWith('uploads/test.jpg');
    expect(storageMock.delete).toHaveBeenCalledWith('uploads/test_thumb.jpg');
    expect(prismaMock.image.delete).toHaveBeenCalledWith({ where: { id: 'img-1' } });
  });

  it('does NOT delete a thumbnail from storage when thumbnailPath is null', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage({ thumbnailPath: null }));
    prismaMock.image.delete.mockResolvedValueOnce({});

    await service.deleteImage('img-1', 'user-1');

    expect(storageMock.delete).toHaveBeenCalledTimes(1);
    expect(storageMock.delete).toHaveBeenCalledWith('uploads/test.jpg');
  });

  it('wraps and rethrows a storage.delete failure', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());
    storageMock.delete.mockRejectedValueOnce(new Error('disk full'));

    await expect(service.deleteImage('img-1', 'user-1')).rejects.toThrow('disk full');
  });

  it('emits a project stats update after a successful deletion', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());
    prismaMock.image.delete.mockResolvedValueOnce({});

    await service.deleteImage('img-1', 'user-1');

    expect(wsInstanceMock.emitToUser).toHaveBeenCalled();
    expect(wsInstanceMock.broadcastProjectUpdate).toHaveBeenCalled();
  });

  it('recursively removes the container directory when isVideoContainer=true (round-2 GAP-4)', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({
        id: 'vid-1',
        name: 'clip.mp4',
        originalPath: 'vid-1/original.mp4',
        thumbnailPath: 'vid-1/thumbnail.jpg',
        isVideoContainer: true,
      })
    );
    prismaMock.image.delete.mockResolvedValueOnce({});

    await service.deleteImage('vid-1', 'user-1');

    const rmCalls = fsRmMock.mock.calls.map(c => c[0] as string);
    expect(rmCalls).toContain('/tmp/uploads/projects/proj-1/images/vid-1');
    expect(fsRmMock.mock.calls[0]?.[1]).toEqual({ recursive: true, force: true });
    expect(prismaMock.image.delete).toHaveBeenCalledWith({ where: { id: 'vid-1' } });
  });

  it('does NOT touch the filesystem container directory for non-video images', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({
        id: 'img-99',
        originalPath: 'img-99/photo.jpg',
        thumbnailPath: 'img-99/photo-thumb.jpg',
        isVideoContainer: false,
      })
    );
    prismaMock.image.delete.mockResolvedValueOnce({});

    await service.deleteImage('img-99', 'user-1');

    const rmCalls = fsRmMock.mock.calls.map(c => c[0] as string);
    expect(rmCalls.find(p => p.endsWith('/images/img-99'))).toBeUndefined();
    expect(storageMock.delete).toHaveBeenCalledWith('img-99/photo.jpg');
  });
});

// ─── deleteBatch (cascade cleanup, partial failure, WS emit) ─────────────────

describe('ImageService — deleteBatch', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
    prismaMock.project.findFirst.mockResolvedValue(mockProject);
  });

  it('deletes multiple images and returns counts', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      await (cb as (tx: unknown) => Promise<unknown>)({
        image: {
          delete: vi.fn().mockResolvedValue(makeImage()),
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn(),
        },
      });
    });
    prismaMock.image.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);

    const result = await service.deleteBatch(['img-1'], 'user-1', 'proj-1');

    expect(result.deletedCount).toBe(1);
    expect(result.failedIds).toHaveLength(0);
  });

  it('throws when no images are found for deletion', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([]);

    await expect(
      service.deleteBatch(['nonexistent'], 'user-1', 'proj-1')
    ).rejects.toThrow('No images found for deletion');
  });

  it('reports not-found image IDs in failedIds and errors', async () => {
    const existing = makeImage({ id: 'img-found', thumbnailPath: null });
    prismaMock.image.findMany.mockResolvedValueOnce([existing]);
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      await (cb as (tx: unknown) => Promise<unknown>)({
        image: {
          delete: vi.fn().mockResolvedValue(existing),
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn(),
        },
      });
    });
    prismaMock.image.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const result = await service.deleteBatch(
      ['img-found', 'img-missing'],
      'user-1',
      'proj-1'
    );

    expect(result.deletedCount).toBe(1);
    expect(result.failedIds).toContain('img-missing');
    expect(result.errors[0]).toContain('img-missing');
  });

  it('cascades deletion of the orphan container when the last frame is removed', async () => {
    const frame = makeImage({
      id: 'frame-last',
      parentVideoId: 'container-orphan',
      thumbnailPath: null,
    });
    prismaMock.image.findMany.mockResolvedValueOnce([frame]);

    const txDelete = vi.fn().mockResolvedValue({});
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      await (cb as (tx: unknown) => Promise<unknown>)({
        image: {
          delete: txDelete,
          count: vi.fn().mockResolvedValue(0), // no siblings remain
          findFirst: vi.fn().mockResolvedValue({
            id: 'container-orphan',
            name: 'video.nd2',
            originalPath: 'uploads/video.nd2',
            thumbnailPath: 'uploads/video_thumb.jpg',
            isVideoContainer: true,
          }),
        },
      });
    });
    prismaMock.image.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await service.deleteBatch(['frame-last'], 'user-1', 'proj-1');

    expect(result.deletedCount).toBe(1);
    // Frame + orphan container both removed (container is bookkeeping-only).
    expect(txDelete).toHaveBeenCalledTimes(2);
    expect(storageMock.delete).toHaveBeenCalledWith('uploads/video.nd2');
    expect(storageMock.delete).toHaveBeenCalledWith('uploads/video_thumb.jpg');
  });

  it('deletes the thumbnail from storage when thumbnailPath is set', async () => {
    const withThumb = makeImage({ id: 'img-thumb', thumbnailPath: 'uploads/thumb.jpg' });
    prismaMock.image.findMany.mockResolvedValueOnce([withThumb]);
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      await (cb as (tx: unknown) => Promise<unknown>)({
        image: {
          delete: vi.fn().mockResolvedValue(withThumb),
          count: vi.fn().mockResolvedValue(5),
          findFirst: vi.fn(),
        },
      });
    });
    prismaMock.image.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

    await service.deleteBatch(['img-thumb'], 'user-1', 'proj-1');

    expect(storageMock.delete).toHaveBeenCalledWith('uploads/thumb.jpg');
  });

  it('collects failedIds when the transactional delete throws mid-batch', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      makeImage({ id: 'img-ok', originalPath: 'p/ok.png', thumbnailPath: null }),
      makeImage({ id: 'img-fail', originalPath: 'p/fail.png', thumbnailPath: null }),
    ]);
    const txDelete = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('FK constraint'));
    prismaMock.$transaction.mockImplementationOnce((cb: never) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        image: {
          delete: txDelete,
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn().mockResolvedValue(null),
        },
      })
    );
    prismaMock.image.count.mockResolvedValue(1);

    const result = await service.deleteBatch(['img-ok', 'img-fail'], 'user-1', 'proj-1');

    expect(result.deletedCount).toBe(1);
    expect(result.failedIds).toContain('img-fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('does not throw when the WebSocket service is unavailable', async () => {
    webSocketServiceMock.getInstance.mockImplementationOnce(() => {
      throw new Error('Not initialized');
    });
    prismaMock.image.findMany.mockResolvedValueOnce([
      makeImage({ id: 'img-ok', originalPath: 'p/ok.png', thumbnailPath: null }),
    ]);
    prismaMock.$transaction.mockImplementationOnce((cb: never) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        image: {
          delete: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(0),
          findFirst: vi.fn().mockResolvedValue(null),
        },
      })
    );
    prismaMock.image.count.mockResolvedValue(0);

    await expect(
      service.deleteBatch(['img-ok'], 'user-1', 'proj-1')
    ).resolves.toBeDefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('throws forbidden when project not accessible', async () => {
    prismaMock.project.findFirst.mockReset();
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.deleteBatch(['img-1'], 'user-1', 'proj-1')
    ).rejects.toThrow('Access denied to this project');
  });
});

// ─── getImageStats ────────────────────────────────────────────────────────────

describe('ImageService — getImageStats', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
  });

  it('computes totalImages, totalSize, byStatus and byMimeType', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    mockImageStatsRows([
      { fileSize: 500, segmentationStatus: 'segmented', mimeType: 'image/jpeg' },
      { fileSize: 300, segmentationStatus: 'no_segmentation', mimeType: 'image/png' },
      { fileSize: 200, segmentationStatus: 'failed', mimeType: 'image/jpeg' },
    ]);

    const stats = await service.getImageStats('proj-1', 'user-1');

    expect(stats.totalImages).toBe(3);
    expect(stats.totalSize).toBe(1000);
    expect(stats.byStatus.segmented).toBe(1);
    expect(stats.byStatus.no_segmentation).toBe(1);
    expect(stats.byStatus.failed).toBe(1);
    expect(stats.byMimeType['image/jpeg']).toBe(2);
    expect(stats.byMimeType['image/png']).toBe(1);
  });

  it('omits null-mimeType images from byMimeType', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    mockImageStatsRows([
      { fileSize: 100, segmentationStatus: 'no_segmentation', mimeType: null },
    ]);

    const stats = await service.getImageStats('proj-1', 'user-1');

    expect(Object.keys(stats.byMimeType)).toHaveLength(0);
  });

  it('treats null fileSize as 0 in totalSize', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    mockImageStatsRows([
      { fileSize: null, segmentationStatus: 'no_segmentation', mimeType: 'image/png' },
    ]);

    const stats = await service.getImageStats('proj-1', 'user-1');

    expect(stats.totalSize).toBe(0);
  });

  it('ignores unknown segmentationStatus values (not counted in byStatus)', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    mockImageStatsRows([
      { fileSize: 100, segmentationStatus: 'unknown_status', mimeType: 'image/png' },
    ]);

    const stats = await service.getImageStats('proj-1', 'user-1');

    expect(stats.byStatus.no_segmentation).toBe(0);
    expect(stats.byStatus.queued).toBe(0);
    expect(stats.totalImages).toBe(1);
  });

  it('returns all-zero stats for a project with no images', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    mockImageStatsRows([]);

    const stats = await service.getImageStats('proj-1', 'user-1');

    expect(stats.totalImages).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(Object.values(stats.byStatus).every(v => v === 0)).toBe(true);
    expect(Object.keys(stats.byMimeType)).toHaveLength(0);
  });

  it('throws forbidden when project not accessible', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(service.getImageStats('bad-project', 'user-1')).rejects.toThrow(
      'Access denied to this project'
    );
  });
});

// ─── updateSegmentationStatus (permission + WebSocket emit gating) ───────────

describe('ImageService — updateSegmentationStatus', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
    prismaMock.image.update.mockResolvedValue(makeImage());
  });

  it('updates status without a permission check when userId is omitted', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());

    await service.updateSegmentationStatus('img-1', 'segmented');

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.image.update).toHaveBeenCalledWith({
      where: { id: 'img-1' },
      data: { segmentationStatus: 'segmented' },
    });
  });

  it('performs the ownership check when userId is provided', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());

    await service.updateSegmentationStatus('img-1', 'processing', 'user-1');

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { email: true },
    });
    expect(prismaMock.image.update).toHaveBeenCalled();
  });

  it('throws forbidden (no userId) when the image is not found', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateSegmentationStatus('bad-image', 'segmented')
    ).rejects.toThrow('Access denied');
  });

  it('throws notFound (with userId) when the user is not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.updateSegmentationStatus('img-1', 'queued', 'user-ghost')
    ).rejects.toThrow('not found');
  });

  it('throws forbidden (with userId) when the image is not accessible', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateSegmentationStatus('img-1', 'queued', 'user-1')
    ).rejects.toThrow('Access denied');
  });

  describe('WebSocket emit gating', () => {
    const baseImage = makeImage({ id: 'img-ws', projectId: 'proj-ws' });
    beforeEach(() => {
      prismaMock.image.findFirst.mockResolvedValue(baseImage);
      prismaMock.image.update.mockResolvedValue({
        ...baseImage,
        segmentationStatus: 'segmented',
      });
      prismaMock.user.findUnique.mockResolvedValue({ email: 'u@test.com' });
    });

    it.each(['segmented', 'failed', 'no_segmentation'] as const)(
      'emits a project stats update for status %s',
      async status => {
        prismaMock.image.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

        await service.updateSegmentationStatus('img-ws', status, 'user-1');

        expect(wsInstanceMock.emitToUser).toHaveBeenCalled();
        expect(wsInstanceMock.broadcastProjectUpdate).toHaveBeenCalled();
      }
    );

    it.each(['queued', 'processing'] as const)(
      'does NOT emit a project stats update for status %s',
      async status => {
        await service.updateSegmentationStatus('img-ws', status, 'user-1');

        expect(wsInstanceMock.emitToUser).not.toHaveBeenCalled();
        expect(wsInstanceMock.broadcastProjectUpdate).not.toHaveBeenCalled();
      }
    );
  });
});

// ─── reorderImages ────────────────────────────────────────────────────────────

describe('ImageService — reorderImages', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
    prismaMock.user.findUnique.mockResolvedValue({ email: 'u@test.com' });
    prismaMock.project.findFirst.mockResolvedValue(mockProject);
  });

  it('throws notFound when the user does not exist', async () => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.reorderImages('proj-1', 'ghost', ['img-1'], 'all')
    ).rejects.toThrow('not found');
  });

  it('throws forbidden when project not accessible', async () => {
    prismaMock.project.findFirst.mockReset();
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1'], 'all')
    ).rejects.toThrow('Access denied');
  });

  it("throws when an imageId doesn't belong to the project", async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([{ id: 'img-1' }]);

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1', 'img-ghost'], 'all')
    ).rejects.toThrow('do not belong to this project');
  });

  it("throws in 'all' mode when the payload count mismatches the project total", async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([{ id: 'img-1' }, { id: 'img-2' }]);
    prismaMock.image.count.mockResolvedValueOnce(3);

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1', 'img-2'], 'all')
    ).rejects.toThrow("mode 'all' requires every project image");
  });

  it("'partial' mode updates listed images and shifts omitted ones to later positions", async () => {
    prismaMock.image.findMany
      .mockResolvedValueOnce([{ id: 'img-a' }, { id: 'img-b' }])
      .mockResolvedValueOnce([{ id: 'img-c' }, { id: 'img-d' }]);
    prismaMock.image.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementationOnce(async (ops: never) => {
      await Promise.all(ops as unknown as Promise<unknown>[]);
    });

    await service.reorderImages('proj-1', 'user-1', ['img-a', 'img-b'], 'partial');

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    const byId = Object.fromEntries(
      prismaMock.image.update.mock.calls.map((c: unknown[]) => {
        const arg = c[0] as { where: { id: string }; data: { displayOrder: number } };
        return [arg.where.id, arg.data.displayOrder];
      })
    );
    expect(byId['img-a']).toBe(0);
    expect(byId['img-b']).toBe(1);
    expect(byId['img-c']).toBe(2);
    expect(byId['img-d']).toBe(3);
  });

  it("'all' mode succeeds when the payload count matches the project total", async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([{ id: 'img-1' }, { id: 'img-2' }]);
    prismaMock.image.count.mockResolvedValueOnce(2);
    prismaMock.image.update.mockResolvedValue({});
    prismaMock.$transaction.mockResolvedValue([]);

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1', 'img-2'], 'all')
    ).resolves.toBeUndefined();
  });
});

// ─── getVideoFrameForDisplay (private helper — null paths) ───────────────────

describe('ImageService — getVideoFrameForDisplay', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
  });

  const callGetVideoFrame = (image: Record<string, unknown>) =>
    (
      service as unknown as {
        getVideoFrameForDisplay(image: unknown): Promise<{
          buffer: Buffer;
          mimeType: string;
          filename: string;
        } | null>;
      }
    ).getVideoFrameForDisplay(image);

  it('returns null when isVideoContainer=false and parentVideoId=null', async () => {
    const result = await callGetVideoFrame(
      makeImage({ isVideoContainer: false, parentVideoId: null })
    );
    expect(result).toBeNull();
  });

  it('returns null when the container has an empty channels array', async () => {
    const result = await callGetVideoFrame(
      makeImage({ isVideoContainer: true, channels: [] })
    );
    expect(result).toBeNull();
  });

  it('returns null when the source channel fails the safe-chars regex', async () => {
    const result = await callGetVideoFrame(
      makeImage({
        isVideoContainer: true,
        channels: [{ name: 'chan/../etc/passwd', isSegmentationSource: true }],
      })
    );
    expect(result).toBeNull();
  });

  it('returns null when getImageBuffer throws (storageMock is not a LocalStorageProvider)', async () => {
    const result = await callGetVideoFrame(
      makeImage({
        isVideoContainer: true,
        channels: [{ name: 'DAPI', isSegmentationSource: true }],
      })
    );
    expect(result).toBeNull();
  });

  it('returns null when a frame parentVideoId lookup finds no container', async () => {
    prismaMock.image.findUnique.mockResolvedValueOnce(null);

    const result = await callGetVideoFrame(
      makeImage({ isVideoContainer: false, parentVideoId: 'container-gone' })
    );
    expect(result).toBeNull();
  });
});

// ─── removeConvertedFile ──────────────────────────────────────────────────────

describe('ImageService — removeConvertedFile', () => {
  let service: ImageService;
  beforeEach(() => {
    service = makeService();
  });

  it('silently handles ENOENT (file already absent — no error logged)', async () => {
    vi.mocked(fsModule.promises).unlink.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    await expect(service.removeConvertedFile('img-absent')).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('swallows non-ENOENT fs.unlink errors and logs them', async () => {
    vi.mocked(fsModule.promises).unlink.mockRejectedValueOnce(
      Object.assign(new Error('EPERM'), { code: 'EPERM' })
    );

    await expect(service.removeConvertedFile('img-eperm')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('deletes the converted PNG (path includes the imageId and .png)', async () => {
    vi.mocked(fsModule.promises).unlink.mockResolvedValueOnce(undefined);

    await service.removeConvertedFile('img-abc');

    expect(vi.mocked(fsModule.promises).unlink).toHaveBeenCalledOnce();
    const calledPath = vi.mocked(fsModule.promises).unlink.mock.calls[0][0] as string;
    expect(calledPath).toContain('img-abc');
    expect(calledPath).toMatch(/\.png$/);
  });
});
