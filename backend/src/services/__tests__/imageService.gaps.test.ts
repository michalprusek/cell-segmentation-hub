/**
 * imageService.gaps.test.ts
 *
 * Covers the paths not yet exercised in imageService.test.ts:
 *
 *  getProjectImages
 *   - container filter: isVideoContainer:false is in the where clause
 *   - calibration bubbling: frame rows get pixelSizeUm/frameIntervalMs from
 *     their parent container
 *   - missing parent container warning (orphan frame)
 *   - pagination math: hasNext/hasPrev
 *   - standalone images keep their own calibration (parentVideoId=null)
 *
 *  deleteBatch
 *   - cascade cleanup: last frame deleted → orphan container also deleted
 *   - not-found image IDs appear in failedIds + errors
 *   - storage.delete called for thumbnail when thumbnailPath set
 *
 *  reorderImages
 *   - 'all' mode rejects when count mismatches
 *   - 'partial' mode shifts omitted images to later display positions
 *   - throws when an imageId doesn't belong to the project
 *
 *  updateSegmentationStatus
 *   - emits project stats update for 'segmented' / 'failed' / 'no_segmentation'
 *   - does NOT emit for 'queued' / 'processing'
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── mocks (declared before source import) ────────────────────────────────────

const prismaMock = {
  project: { findFirst: vi.fn() as any },
  image: {
    create: vi.fn() as any,
    findMany: vi.fn() as any,
    findFirst: vi.fn() as any,
    findUnique: vi.fn() as any,
    count: vi.fn() as any,
    delete: vi.fn() as any,
    update: vi.fn() as any,
  },
  user: { findUnique: vi.fn() as any },
  $transaction: vi.fn() as any,
};

const storageMock = {
  upload: vi.fn() as any,
  getUrl: vi.fn(async (p: string) => `http://host/${p}`) as any,
  delete: vi.fn() as any,
};

const wsServiceMock = {
  emitToUser: vi.fn() as any,
  broadcastProjectUpdate: vi.fn() as any,
  emitDashboardUpdate: vi.fn() as any,
};

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => storageMock),
  LocalStorageProvider: {
    generateKey: vi.fn(
      (_u: string, _p: string, filename: string) => `uploads/${filename}`
    ),
  },
}));
vi.mock('../websocketService', () => ({
  WebSocketService: { getInstance: vi.fn(() => wsServiceMock) },
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
vi.mock('../../utils/logger');
vi.mock('../../utils/config', () => ({
  config: { NODE_ENV: 'test', UPLOAD_DIR: '/tmp/test-uploads' },
}));
vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3001'),
}));
vi.mock('sharp');
vi.mock('fs');

import { ImageService } from '../imageService';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeService = () => new ImageService(prismaMock as any);

const mockProject = { id: 'proj-1', userId: 'user-1' };

/** Produce a minimal Image DB row */
const makeImage = (overrides: Record<string, unknown> = {}) => ({
  id: `img-${Math.random().toString(36).slice(2, 8)}`,
  name: 'frame.png',
  originalPath: 'uploads/frame.png',
  thumbnailPath: null,
  segmentationThumbnailPath: null,
  projectId: 'proj-1',
  fileSize: 512n,
  width: 800,
  height: 600,
  mimeType: 'image/png',
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

// ─── test suite ──────────────────────────────────────────────────────────────

describe('ImageService — uncovered paths', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    storageMock.getUrl.mockImplementation(
      async (p: string) => `http://host/${p}`
    );
    storageMock.delete.mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
    prismaMock.project.findFirst.mockResolvedValue(mockProject);
  });

  // ─── getProjectImages ────────────────────────────────────────────────────────

  describe('getProjectImages', () => {
    it('excludes video container rows (isVideoContainer:false in where)', async () => {
      prismaMock.image.count.mockResolvedValueOnce(0);
      prismaMock.image.findMany.mockResolvedValueOnce([]);

      await service.getProjectImages('proj-1', 'user-1', paginationOpts);

      const findCall = prismaMock.image.findMany.mock.calls[0][0];
      expect(findCall.where).toMatchObject({ isVideoContainer: false });
    });

    it('computes pagination: hasNext=true when more pages remain', async () => {
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

    it('computes pagination: hasPrev=true on page 2', async () => {
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

    it('bubbles calibration from parent container onto frame row', async () => {
      const containerId = 'container-1';
      const frame = makeImage({
        id: 'frame-1',
        parentVideoId: containerId,
        pixelSizeUm: null,
        frameIntervalMs: null,
      });

      prismaMock.image.count.mockResolvedValueOnce(1);
      // findMany for images
      prismaMock.image.findMany
        .mockResolvedValueOnce([frame])
        // findMany for parent containers
        .mockResolvedValueOnce([
          {
            id: containerId,
            pixelSizeUm: 0.065,
            frameIntervalMs: 250,
          },
        ]);

      const result = await service.getProjectImages(
        'proj-1',
        'user-1',
        paginationOpts
      );

      const img = result.images[0];
      expect(img.pixelSizeUm).toBe(0.065);
      expect(img.frameIntervalMs).toBe(250);
    });

    it('keeps frame row calibration (null) when container has null values', async () => {
      const containerId = 'container-null-cal';
      const frame = makeImage({
        id: 'frame-null',
        parentVideoId: containerId,
        pixelSizeUm: null,
        frameIntervalMs: null,
      });

      prismaMock.image.count.mockResolvedValueOnce(1);
      prismaMock.image.findMany
        .mockResolvedValueOnce([frame])
        .mockResolvedValueOnce([
          { id: containerId, pixelSizeUm: null, frameIntervalMs: null },
        ]);

      const result = await service.getProjectImages(
        'proj-1',
        'user-1',
        paginationOpts
      );

      const img = result.images[0];
      expect(img.pixelSizeUm).toBeNull();
      expect(img.frameIntervalMs).toBeNull();
    });

    it('keeps standalone image own calibration when parentVideoId is null', async () => {
      const standalone = makeImage({
        id: 'standalone-1',
        parentVideoId: null,
        pixelSizeUm: 0.12,
        frameIntervalMs: null,
      });

      prismaMock.image.count.mockResolvedValueOnce(1);
      // Only one findMany call — no parent lookup needed
      prismaMock.image.findMany.mockResolvedValueOnce([standalone]);

      const result = await service.getProjectImages(
        'proj-1',
        'user-1',
        paginationOpts
      );

      expect(result.images[0].pixelSizeUm).toBe(0.12);
    });

    it('emits a warning when parent container row is missing (orphan frame)', async () => {
      const { logger } = await import('../../utils/logger');
      const frame = makeImage({
        id: 'orphan-frame',
        parentVideoId: 'ghost-container',
      });

      prismaMock.image.count.mockResolvedValueOnce(1);
      prismaMock.image.findMany
        .mockResolvedValueOnce([frame])
        // Return empty list — parent container not found
        .mockResolvedValueOnce([]);

      await service.getProjectImages('proj-1', 'user-1', paginationOpts);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('calibration bubble will fall through'),
        'ImageService',
        expect.objectContaining({ missingParentIds: ['ghost-container'] })
      );
    });

    it('throws forbidden when user not found', async () => {
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

  // ─── deleteBatch ─────────────────────────────────────────────────────────────

  describe('deleteBatch', () => {
    it('reports not-found image IDs in failedIds and errors', async () => {
      const existingImage = makeImage({ id: 'img-found' });
      prismaMock.image.findMany.mockResolvedValueOnce([existingImage]);

      // $transaction that deletes the one found image
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          image: {
            delete: vi.fn().mockResolvedValue(existingImage),
            count: vi.fn().mockResolvedValue(1), // still has siblings
            findFirst: vi.fn(),
          },
        };
        await cb(tx);
      });
      // emitProjectStatsUpdate counts
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

    it('cascades deletion of orphan container when last frame is removed', async () => {
      const frame = makeImage({
        id: 'frame-last',
        parentVideoId: 'container-orphan',
      });

      prismaMock.image.findMany.mockResolvedValueOnce([frame]);

      const txDelete = vi.fn().mockResolvedValue({});
      const txCount = vi.fn().mockResolvedValue(0); // no siblings remain
      const txFindFirst = vi.fn().mockResolvedValue({
        id: 'container-orphan',
        name: 'video.nd2',
        originalPath: 'uploads/video.nd2',
        thumbnailPath: 'uploads/video_thumb.jpg',
        isVideoContainer: true,
      });

      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        await cb({
          image: {
            delete: txDelete,
            count: txCount,
            findFirst: txFindFirst,
          },
        });
      });

      // emitProjectStatsUpdate
      prismaMock.image.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.deleteBatch(
        ['frame-last'],
        'user-1',
        'proj-1'
      );

      // Frame was deleted
      expect(result.deletedCount).toBe(1);
      // Container was also deleted (not counted in deletedCount — bookkeeping only)
      expect(txDelete).toHaveBeenCalledTimes(2);
      // Storage for both frame and container should be cleaned
      expect(storageMock.delete).toHaveBeenCalledWith('uploads/video.nd2');
      expect(storageMock.delete).toHaveBeenCalledWith(
        'uploads/video_thumb.jpg'
      );
    });

    it('deletes thumbnail from storage when thumbnailPath is set', async () => {
      const withThumb = makeImage({
        id: 'img-thumb',
        thumbnailPath: 'uploads/thumb.jpg',
      });
      prismaMock.image.findMany.mockResolvedValueOnce([withThumb]);

      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        await cb({
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

    it('throws forbidden when project not accessible', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.deleteBatch(['img-1'], 'user-1', 'proj-1')
      ).rejects.toThrow('Access denied to this project');
    });
  });

  // ─── reorderImages ───────────────────────────────────────────────────────────

  describe('reorderImages', () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      prismaMock.project.findFirst.mockResolvedValue(mockProject);
    });

    it("throws 'all' mode mismatch when count != payload length", async () => {
      // All provided images exist in project
      prismaMock.image.findMany.mockResolvedValueOnce([
        { id: 'img-1' },
        { id: 'img-2' },
      ]);
      // But total count is 3 (one extra in DB)
      prismaMock.image.count.mockResolvedValueOnce(3);

      await expect(
        service.reorderImages('proj-1', 'user-1', ['img-1', 'img-2'], 'all')
      ).rejects.toThrow("Reorder mode 'all' requires every project image");
    });

    it("throws when an imageId doesn't belong to the project", async () => {
      // Only img-1 exists; img-ghost is not returned
      prismaMock.image.findMany.mockResolvedValueOnce([{ id: 'img-1' }]);

      await expect(
        service.reorderImages('proj-1', 'user-1', ['img-1', 'img-ghost'], 'all')
      ).rejects.toThrow('Image IDs do not belong to this project');
    });

    it("'partial' mode updates only listed images and shifts omitted ones", async () => {
      prismaMock.image.findMany
        // Validation: both listed images exist
        .mockResolvedValueOnce([{ id: 'img-a' }, { id: 'img-b' }])
        // Omitted images (for the shift)
        .mockResolvedValueOnce([{ id: 'img-c' }, { id: 'img-d' }]);

      const txOps: any[] = [];
      prismaMock.image.update.mockImplementation((args: any) => {
        txOps.push(args);
        return Promise.resolve({});
      });
      prismaMock.$transaction.mockImplementationOnce(async (ops: any[]) => {
        await Promise.all(ops);
      });

      await service.reorderImages(
        'proj-1',
        'user-1',
        ['img-a', 'img-b'],
        'partial'
      );

      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      const updateCalls = prismaMock.image.update.mock.calls;
      // img-a → 0, img-b → 1, img-c → 2, img-d → 3
      const byId = Object.fromEntries(
        updateCalls.map((c: any) => [c[0].where.id, c[0].data.displayOrder])
      );
      expect(byId['img-a']).toBe(0);
      expect(byId['img-b']).toBe(1);
      expect(byId['img-c']).toBe(2);
      expect(byId['img-d']).toBe(3);
    });

    it("'all' mode succeeds when count matches payload", async () => {
      prismaMock.image.findMany.mockResolvedValueOnce([
        { id: 'img-1' },
        { id: 'img-2' },
      ]);
      prismaMock.image.count.mockResolvedValueOnce(2);
      prismaMock.image.update.mockResolvedValue({});
      prismaMock.$transaction.mockResolvedValue([]);

      await expect(
        service.reorderImages('proj-1', 'user-1', ['img-1', 'img-2'], 'all')
      ).resolves.toBeUndefined();
    });
  });

  // ─── updateSegmentationStatus ─────────────────────────────────────────────

  describe('updateSegmentationStatus — WebSocket emit gating', () => {
    const baseImage = makeImage({
      id: 'img-ws',
      projectId: 'proj-ws',
      segmentationStatus: 'no_segmentation',
    });

    beforeEach(() => {
      prismaMock.image.findFirst.mockResolvedValue(baseImage);
      prismaMock.image.update.mockResolvedValue({
        ...baseImage,
        segmentationStatus: 'segmented',
      });
    });

    it.each(['segmented', 'failed', 'no_segmentation'] as const)(
      'emits project stats update for status %s',
      async status => {
        prismaMock.user.findUnique.mockResolvedValue({ email: 'u@test.com' });
        // emitProjectStatsUpdate fetches imageCount + segmentedCount
        prismaMock.image.count
          .mockResolvedValueOnce(5)
          .mockResolvedValueOnce(3);

        await service.updateSegmentationStatus('img-ws', status, 'user-1');

        expect(wsServiceMock.emitToUser).toHaveBeenCalled();
        expect(wsServiceMock.broadcastProjectUpdate).toHaveBeenCalled();
      }
    );

    it.each(['queued', 'processing'] as const)(
      'does NOT emit project stats for status %s',
      async status => {
        prismaMock.user.findUnique.mockResolvedValue({ email: 'u@test.com' });

        await service.updateSegmentationStatus('img-ws', status, 'user-1');

        expect(wsServiceMock.emitToUser).not.toHaveBeenCalled();
        expect(wsServiceMock.broadcastProjectUpdate).not.toHaveBeenCalled();
      }
    );

    it('skips permission check (no user query) when userId is undefined', async () => {
      await service.updateSegmentationStatus('img-ws', 'segmented');

      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.image.update).toHaveBeenCalledWith({
        where: { id: 'img-ws' },
        data: { segmentationStatus: 'segmented' },
      });
    });
  });
});
