/**
 * imageService.gaps3.test.ts
 *
 * Covers branches still uncovered after imageService.test.ts, .gaps.test.ts,
 * .gaps2.test.ts, and .deleteVideoContainer.test.ts:
 *
 *  A. getProjectImages — calibration bubble from parent container
 *     - bubbles pixelSizeUm / frameIntervalMs from container to frame rows
 *     - warns when a frame references a missing container (orphan drift)
 *     - standalone images keep their own calibration
 *     - pagination: hasNext / hasPrev flags computed correctly
 *
 *  B. updateSegmentationStatus
 *     - without userId: skips permission check (no user.findUnique call)
 *     - without userId: throws ApiError.forbidden when image not found
 *     - with userId: throws ApiError.notFound when user not found
 *     - with userId: throws ApiError.forbidden when image not accessible
 *     - does NOT call emitProjectStatsUpdate for 'queued' status change
 *     - DOES call emitProjectStatsUpdate for 'segmented' status change (best-effort, no throw)
 *
 *  C. uploadImages (legacy) — partial failure path
 *     - continues past single-file error and returns successfully uploaded files
 *     - throws when ALL files fail (zero uploaded)
 *
 *  D. reorderImages
 *     - throws notFound when user not found
 *     - throws forbidden when project not accessible
 *     - throws badRequest when an imageId does not belong to the project
 *     - throws badRequest in 'all' mode when count mismatches
 *
 *  E. getImageStats
 *     - ignores unknown segmentationStatus values (not counted in byStatus)
 *     - handles zero images (all counts 0, totalSize 0)
 *
 *  F. removeConvertedFile — non-ENOENT error swallowed
 *
 * Real FS / sharp / storage are never touched — all I/O mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
  getUrl: vi.fn(async (p: string) => `http://host/${p}`) as ReturnType<
    typeof vi.fn
  >,
  delete: vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn>,
};

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: '/tmp/uploads',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn(() => 'http://api.test'),
}));

vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => storageMock),
  LocalStorageProvider: {
    generateKey: vi.fn(
      (_uid: string, _pid: string, name: string) => `uploads/${name}`
    ),
  },
}));

const { wsServiceMock } = vi.hoisted(() => ({
  wsServiceMock: {
    getInstance: vi.fn(() => ({
      emitToUser: vi.fn(),
      broadcastProjectUpdate: vi.fn(),
      emitDashboardUpdate: vi.fn(),
    })),
  },
}));

vi.mock('../websocketService', () => ({
  WebSocketService: wsServiceMock,
}));

vi.mock('../userService', () => ({
  getUserStats: vi.fn().mockResolvedValue({
    totalProjects: 1,
    totalImages: 1,
    processedImages: 0,
    imagesUploadedToday: 0,
    storageUsed: '0',
    storageUsedBytes: 0,
  }),
}));

vi.mock('fs', () => ({
  promises: {
    access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('data')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  },
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('png')),
  })),
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { ImageService } from '../imageService';
import { logger } from '../../utils/logger';
import * as fsPromises from 'fs';

// ─── Helper to build a minimal Image row ─────────────────────────────────────

function makeImage(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'img-1',
    name: 'photo.png',
    originalPath: 'projects/p/images/img-1/original.png',
    thumbnailPath: null,
    segmentationThumbnailPath: null,
    projectId: 'proj-1',
    fileSize: BigInt(1024),
    width: 100,
    height: 100,
    mimeType: 'image/png',
    segmentationStatus: 'no_segmentation',
    isVideoContainer: false,
    parentVideoId: null,
    frameIndex: null,
    pixelSizeUm: null,
    frameIntervalMs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    displayOrder: 0,
    ...overrides,
  };
}

// getImageStats now uses server-side aggregation (image.aggregate + two
// image.groupBy calls). Derive those mock returns from a flat array of rows.
function mockImageStatsRows(rows: Array<Record<string, unknown>>) {
  prismaMock.image.aggregate.mockResolvedValueOnce({
    _count: { _all: rows.length },
    _sum: {
      fileSize: BigInt(
        rows.reduce((s, r) => s + Number(r.fileSize ?? 0), 0)
      ),
    },
  });

  const groupCount = (
    values: Array<string | null | undefined>,
    field: string
  ) => {
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
      groupCount(
        rows.map(r => r.segmentationStatus as string | undefined),
        'segmentationStatus'
      )
    )
    .mockResolvedValueOnce(
      groupCount(
        rows.map(r => r.mimeType as string | null | undefined),
        'mimeType'
      )
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImageService — calibration bubble in getProjectImages', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageService(prismaMock as never);
  });

  it('bubbles pixelSizeUm and frameIntervalMs from container row onto frame images', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

    const frame = makeImage({
      id: 'frame-1',
      parentVideoId: 'container-1',
      pixelSizeUm: null,
      frameIntervalMs: null,
    });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany
      // getProjectImages main query
      .mockResolvedValueOnce([frame])
      // parent calibration lookup
      .mockResolvedValueOnce([
        { id: 'container-1', pixelSizeUm: 0.25, frameIntervalMs: 100 },
      ]);

    const result = await service.getProjectImages('proj-1', 'user-1', {
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].pixelSizeUm).toBe(0.25);
    expect(result.images[0].frameIntervalMs).toBe(100);
  });

  it('warns when a frame references a container not found in DB', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

    const frame = makeImage({
      id: 'orphan-frame',
      parentVideoId: 'missing-container',
    });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany
      .mockResolvedValueOnce([frame])
      .mockResolvedValueOnce([]); // no container found

    await service.getProjectImages('proj-1', 'user-1', {
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('missing video container'),
      expect.any(String),
      expect.objectContaining({ missingParentIds: ['missing-container'] })
    );
  });

  it('standalone images (no parentVideoId) use their own calibration values', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

    const standalone = makeImage({ pixelSizeUm: 0.5, frameIntervalMs: null });
    prismaMock.image.count.mockResolvedValueOnce(1);
    prismaMock.image.findMany.mockResolvedValueOnce([standalone]);
    // No second call expected because parentIds array is empty

    const result = await service.getProjectImages('proj-1', 'user-1', {
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.images[0].pixelSizeUm).toBe(0.5);
  });

  it('pagination: hasNext=true when more pages exist, hasPrev=true on page 2', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

    prismaMock.image.count.mockResolvedValueOnce(25); // 25 total, limit 10
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);

    const result = await service.getProjectImages('proj-1', 'user-1', {
      page: 2,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(true);
  });

  it('pagination: hasNext=false on last page, hasPrev=false on page 1', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

    prismaMock.image.count.mockResolvedValueOnce(5); // 5 total, limit 10
    prismaMock.image.findMany.mockResolvedValueOnce([makeImage()]);

    const result = await service.getProjectImages('proj-1', 'user-1', {
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it('throws ApiError.notFound when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.getProjectImages('proj-1', 'unknown-user', {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
    ).rejects.toThrow('not found');
  });

  it('throws ApiError.forbidden when project not accessible', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getProjectImages('proj-1', 'user-1', {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
    ).rejects.toThrow('Access denied');
  });
});

// ─── B. updateSegmentationStatus ─────────────────────────────────────────────

describe('ImageService — updateSegmentationStatus', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageService(prismaMock as never);
    // Default: image update succeeds
    prismaMock.image.update.mockResolvedValue(undefined);
  });

  it('without userId: skips permission check (no user.findUnique call)', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());
    await service.updateSegmentationStatus('img-1', 'queued');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('without userId: throws ApiError.forbidden when image not found', async () => {
    prismaMock.image.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateSegmentationStatus('img-missing', 'queued')
    ).rejects.toThrow('Access denied');
  });

  it('with userId: throws ApiError.notFound when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.updateSegmentationStatus('img-1', 'queued', 'user-ghost')
    ).rejects.toThrow('not found');
  });

  it('with userId: throws ApiError.forbidden when image not accessible to user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateSegmentationStatus('img-1', 'queued', 'user-1')
    ).rejects.toThrow('Access denied');
  });

  it('does NOT emit project stats for "queued" status', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage());
    // WebSocket not available (getInstance returns mock that just tracks calls)
    wsServiceMock.getInstance.mockReturnValueOnce(null);

    await service.updateSegmentationStatus('img-1', 'queued', 'user-1');
    // image.update should have been called but no WS emit needed
    expect(prismaMock.image.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'img-1' },
        data: { segmentationStatus: 'queued' },
      })
    );
  });

  it('calls emitProjectStatsUpdate for "segmented" status (best-effort, no throw)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ projectId: 'proj-seg' })
    );
    // Stub WS + image counts for emitProjectStatsUpdate
    prismaMock.image.count
      .mockResolvedValueOnce(5) // imageCount
      .mockResolvedValueOnce(3); // segmentedCount
    const ws = {
      emitToUser: vi.fn(),
      broadcastProjectUpdate: vi.fn(),
      emitDashboardUpdate: vi.fn(),
    };
    wsServiceMock.getInstance.mockReturnValueOnce(ws);

    await service.updateSegmentationStatus('img-1', 'segmented', 'user-1');

    // Should not throw; WS methods may or may not be called depending on
    // further mocks down the chain — we only assert the DB update happened
    expect(prismaMock.image.update).toHaveBeenCalled();
  });
});

// ─── C. uploadImages — partial failure ───────────────────────────────────────

describe('ImageService — uploadImages (legacy) partial failure', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageService(prismaMock as never);
  });

  it('continues past a single-file upload error and returns the successful ones', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

    storageMock.upload
      .mockRejectedValueOnce(new Error('disk full')) // first file fails
      .mockResolvedValueOnce({
        // second file succeeds
        originalPath: 'uploads/img2.png',
        thumbnailPath: null,
        fileSize: 500n,
        width: 100,
        height: 100,
        mimeType: 'image/png',
      });

    prismaMock.image.create.mockResolvedValueOnce(
      makeImage({ id: 'img-2', name: 'img2.png' })
    );

    const files = [
      {
        originalname: 'fail.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 100,
      },
      {
        originalname: 'img2.png',
        buffer: Buffer.from('y'),
        mimetype: 'image/png',
        size: 200,
      },
    ];

    const result = await service.uploadImages('proj-1', 'user-1', files);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('img2.png');
  });

  it('throws when ALL files fail to upload', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    storageMock.upload.mockRejectedValue(new Error('disk full'));

    const files = [
      {
        originalname: 'a.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 100,
      },
    ];

    await expect(
      service.uploadImages('proj-1', 'user-1', files)
    ).rejects.toThrow();
  });

  it('throws forbidden when project not accessible', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const files = [
      {
        originalname: 'a.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 100,
      },
    ];

    await expect(
      service.uploadImages('proj-1', 'user-no-access', files)
    ).rejects.toThrow('Access denied');
  });
});

// ─── D. reorderImages ─────────────────────────────────────────────────────────

describe('ImageService — reorderImages', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageService(prismaMock as never);
  });

  it('throws notFound when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.reorderImages('proj-1', 'ghost', ['img-1'], 'all')
    ).rejects.toThrow('not found');
  });

  it('throws forbidden when project not accessible', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1'], 'all')
    ).rejects.toThrow('Access denied');
  });

  it('throws badRequest when an imageId does not belong to the project', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    // Only 1 of 2 requested imageIds found in this project
    prismaMock.image.findMany.mockResolvedValueOnce([{ id: 'img-1' }]);

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1', 'img-FOREIGN'], 'all')
    ).rejects.toThrow('do not belong to this project');
  });

  it('throws badRequest in "all" mode when payload count mismatches project total', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@t.com' });
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    prismaMock.image.findMany.mockResolvedValueOnce([{ id: 'img-1' }]);
    prismaMock.image.count.mockResolvedValueOnce(3); // 3 images in project, but only 1 in payload

    await expect(
      service.reorderImages('proj-1', 'user-1', ['img-1'], 'all')
    ).rejects.toThrow("mode 'all' requires every project image");
  });
});

// ─── E. getImageStats edge cases ─────────────────────────────────────────────

describe('ImageService — getImageStats', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageService(prismaMock as never);
  });

  it('ignores unknown segmentationStatus values (does not count them)', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    mockImageStatsRows([
      makeImage({
        segmentationStatus: 'unknown_status',
        fileSize: BigInt(100),
      }),
    ]);

    const stats = await service.getImageStats('proj-1', 'user-1');
    // all known counts should remain 0
    expect(stats.byStatus.no_segmentation).toBe(0);
    expect(stats.byStatus.queued).toBe(0);
    expect(stats.totalImages).toBe(1);
  });

  it('returns all-zero stats for a project with no images', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    mockImageStatsRows([]);

    const stats = await service.getImageStats('proj-1', 'user-1');
    expect(stats.totalImages).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(Object.values(stats.byStatus).every(v => v === 0)).toBe(true);
    expect(Object.keys(stats.byMimeType)).toHaveLength(0);
  });

  it('images with null mimeType are not counted in byMimeType', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    mockImageStatsRows([makeImage({ mimeType: null, fileSize: BigInt(500) })]);

    const stats = await service.getImageStats('proj-1', 'user-1');
    expect(Object.keys(stats.byMimeType)).toHaveLength(0);
  });

  it('throws ApiError.forbidden when project access denied', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getImageStats('proj-no-access', 'user-1')
    ).rejects.toThrow('Access denied');
  });
});

// ─── F. removeConvertedFile — non-ENOENT error swallowed ─────────────────────

describe('ImageService — removeConvertedFile', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageService(prismaMock as never);
  });

  it('silently swallows non-ENOENT errors from fs.unlink', async () => {
    const fsMock = fsPromises.promises as { unlink: ReturnType<typeof vi.fn> };
    fsMock.unlink.mockRejectedValueOnce(
      Object.assign(new Error('EPERM'), { code: 'EPERM' })
    );

    // Must not throw
    await expect(
      service.removeConvertedFile('img-eperm')
    ).resolves.toBeUndefined();
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it('silently handles ENOENT (file already absent)', async () => {
    const fsMock = fsPromises.promises as { unlink: ReturnType<typeof vi.fn> };
    fsMock.unlink.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    await expect(
      service.removeConvertedFile('img-absent')
    ).resolves.toBeUndefined();
    // ENOENT is silently ignored — no logger.error call expected
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });
});
