import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Prisma mock ---
const prismaMock = {
  project: {
    findFirst: vi.fn() as any,
  },
  image: {
    create: vi.fn() as any,
    findMany: vi.fn() as any,
    findFirst: vi.fn() as any,
    count: vi.fn() as any,
    delete: vi.fn() as any,
    update: vi.fn() as any,
  },
  user: {
    findUnique: vi.fn() as any,
  },
  $transaction: vi.fn() as any,
};

// --- Storage provider mock ---
const storageMock = {
  upload: vi.fn() as any,
  getUrl: vi.fn() as any,
  delete: vi.fn() as any,
};

// --- WebSocket service mock ---
const wsServiceMock = {
  emitToUser: vi.fn() as any,
  broadcastProjectUpdate: vi.fn() as any,
  emitDashboardUpdate: vi.fn() as any,
};

// --- All mocks must be declared before the source import ---
vi.mock('../../db', () => ({ prisma: prismaMock }));

vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(),
  LocalStorageProvider: {
    generateKey: vi.fn(
      (_userId: string, _projectId: string, filename: string) =>
        `uploads/${filename}`
    ),
  },
}));

vi.mock('../websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => wsServiceMock),
  },
}));

vi.mock('../userService', () => ({
  getUserStats: vi.fn(),
}));

vi.mock('../../utils/logger');
vi.mock('../../utils/config', () => ({ config: { NODE_ENV: 'test' } }));
vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3001'),
}));
vi.mock('sharp');
vi.mock('fs');

import { ImageService } from '../imageService';
import { getStorageProvider, LocalStorageProvider } from '../../storage/index';
import { getBaseUrl } from '../../utils/getBaseUrl';

const makeImageService = () => new ImageService(prismaMock as any);

const mockProject = { id: 'project-id', userId: 'user-id' };
const mockImage = {
  id: 'image-id',
  name: 'test.jpg',
  originalPath: 'uploads/test.jpg',
  thumbnailPath: 'uploads/test_thumb.jpg',
  segmentationThumbnailPath: null,
  projectId: 'project-id',
  fileSize: 1024,
  width: 800,
  height: 600,
  mimeType: 'image/jpeg',
  segmentationStatus: 'no_segmentation',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUploadResult = {
  originalPath: 'uploads/test.jpg',
  thumbnailPath: 'uploads/test_thumb.jpg',
  fileSize: 1024,
  width: 800,
  height: 600,
  mimeType: 'image/jpeg',
};

const mockFile = {
  originalname: 'test.jpg',
  buffer: Buffer.from('fake-image-data'),
  mimetype: 'image/jpeg',
  size: 1024,
};

const mockGetStorageProvider = getStorageProvider as ReturnType<typeof vi.fn>;
const mockGenerateKey = (LocalStorageProvider as any).generateKey as ReturnType<typeof vi.fn>;
const mockGetBaseUrl = getBaseUrl as ReturnType<typeof vi.fn>;

describe('ImageService', () => {
  let service: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeImageService();

    // Re-set all implementations that resetMocks:true clears
    mockGetStorageProvider.mockReturnValue(storageMock);
    mockGenerateKey.mockImplementation(
      (_userId: string, _projectId: string, filename: string) =>
        `uploads/${filename}`
    );
    mockGetBaseUrl.mockReturnValue('http://localhost:3001');
    storageMock.upload.mockResolvedValue(mockUploadResult);
    storageMock.getUrl.mockResolvedValue('http://localhost:3001/uploads/test.jpg');
    storageMock.delete.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  describe('uploadImages', () => {
    it('verifies project ownership and uploads files, returning ImageWithUrls', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
      prismaMock.image.create.mockResolvedValueOnce(mockImage as any);

      const result = await service.uploadImages('project-id', 'user-id', [
        mockFile,
      ]);

      expect(prismaMock.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'project-id' }) })
      );
      expect(storageMock.upload).toHaveBeenCalledTimes(1);
      expect(prismaMock.image.create).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('originalUrl');
      expect(result[0]).toHaveProperty('displayUrl');
      expect(result[0].id).toBe('image-id');
    });

    it('throws forbidden when project not found', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.uploadImages('bad-project', 'user-id', [mockFile])
      ).rejects.toThrow('Access denied to this project');

      expect(storageMock.upload).not.toHaveBeenCalled();
    });

    it('continues on individual file failure (partial success)', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);

      const goodFile = { ...mockFile };
      const badFile = { ...mockFile, originalname: 'bad.jpg' };

      // First call (good file) succeeds; second (bad file) fails at upload
      storageMock.upload
        .mockResolvedValueOnce(mockUploadResult)
        .mockRejectedValueOnce(new Error('Storage error'));

      prismaMock.image.create.mockResolvedValueOnce(mockImage as any);

      const result = await service.uploadImages('project-id', 'user-id', [
        goodFile,
        badFile,
      ]);

      // Only the successful upload is returned
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test.jpg');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getProjectImages', () => {
    const paginationOptions = {
      page: 1,
      limit: 10,
      sortBy: 'createdAt' as const,
      sortOrder: 'desc' as const,
    };

    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue({ email: 'user@test.com' } as any);
      prismaMock.project.findFirst.mockResolvedValue(mockProject as any);
    });

    it('returns paginated images with pagination object', async () => {
      prismaMock.image.count.mockResolvedValueOnce(1);
      prismaMock.image.findMany.mockResolvedValueOnce([mockImage] as any);

      const result = await service.getProjectImages(
        'project-id',
        'user-id',
        paginationOptions
      );

      expect(result.images).toHaveLength(1);
      expect(result.pagination).toEqual(
        expect.objectContaining({ page: 1, limit: 10, total: 1, totalPages: 1 })
      );
      expect(result.images[0]).toHaveProperty('originalUrl');
    });

    it('filters by segmentation status when provided', async () => {
      prismaMock.image.count.mockResolvedValueOnce(0);
      prismaMock.image.findMany.mockResolvedValueOnce([]);

      await service.getProjectImages('project-id', 'user-id', {
        ...paginationOptions,
        status: 'completed' as any,
      });

      expect(prismaMock.image.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ segmentationStatus: 'completed' }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('getImageById', () => {
    it('returns ImageWithUrls for project owner', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        email: 'user@test.com',
      } as any);
      prismaMock.image.findFirst.mockResolvedValueOnce({
        ...mockImage,
        project: mockProject,
      } as any);

      const result = await service.getImageById('image-id', 'user-id');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('image-id');
      expect(result?.originalUrl).toBeDefined();
    });

    it('returns null when image not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        email: 'user@test.com',
      } as any);
      prismaMock.image.findFirst.mockResolvedValueOnce(null);

      const result = await service.getImageById('nonexistent', 'user-id');

      expect(result).toBeNull();
    });

    it('returns null when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.getImageById('image-id', 'bad-user');

      expect(result).toBeNull();
      expect(prismaMock.image.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('deleteImage', () => {
    it('deletes from storage and database', async () => {
      prismaMock.image.findFirst.mockResolvedValueOnce(mockImage as any);
      prismaMock.image.delete.mockResolvedValueOnce(mockImage as any);
      // emitProjectStatsUpdate calls image.count twice
      prismaMock.image.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3);

      await service.deleteImage('image-id', 'user-id');

      expect(storageMock.delete).toHaveBeenCalledWith(mockImage.originalPath);
      expect(storageMock.delete).toHaveBeenCalledWith(mockImage.thumbnailPath);
      expect(prismaMock.image.delete).toHaveBeenCalledWith({
        where: { id: 'image-id' },
      });
    });

    it('throws forbidden for unauthorized user', async () => {
      prismaMock.image.findFirst.mockResolvedValueOnce(null);

      await expect(service.deleteImage('image-id', 'bad-user')).rejects.toThrow(
        'Access denied to this image'
      );

      expect(storageMock.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('deleteBatch', () => {
    it('deletes multiple images and returns counts', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject as any);
      prismaMock.image.findMany.mockResolvedValueOnce([mockImage] as any);

      // $transaction executes the callback
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const txClient = {
          image: {
            delete: (vi.fn() as any).mockResolvedValue(mockImage),
          },
        };
        await cb(txClient);
      });

      // emitProjectStatsUpdate
      prismaMock.image.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);

      const result = await service.deleteBatch(
        ['image-id'],
        'user-id',
        'project-id'
      );

      expect(result.deletedCount).toBe(1);
      expect(result.failedIds).toHaveLength(0);
    });

    it('throws when no images found for deletion', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject as any);
      prismaMock.image.findMany.mockResolvedValueOnce([]);

      await expect(
        service.deleteBatch(['nonexistent'], 'user-id', 'project-id')
      ).rejects.toThrow('No images found for deletion');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getImageStats', () => {
    it('computes totalImages, totalSize, and byStatus correctly', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject as any);
      prismaMock.image.findMany.mockResolvedValueOnce([
        { fileSize: 500, segmentationStatus: 'segmented', mimeType: 'image/jpeg' },
        { fileSize: 300, segmentationStatus: 'no_segmentation', mimeType: 'image/png' },
        { fileSize: 200, segmentationStatus: 'failed', mimeType: 'image/jpeg' },
      ] as any);

      const stats = await service.getImageStats('project-id', 'user-id');

      expect(stats.totalImages).toBe(3);
      expect(stats.totalSize).toBe(1000);
      expect(stats.byStatus.segmented).toBe(1);
      expect(stats.byStatus.no_segmentation).toBe(1);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.byMimeType['image/jpeg']).toBe(2);
      expect(stats.byMimeType['image/png']).toBe(1);
    });

    it('throws forbidden when project not accessible', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getImageStats('bad-project', 'user-id')
      ).rejects.toThrow('Access denied to this project');
    });
  });

  // ---------------------------------------------------------------------------
  describe('updateSegmentationStatus', () => {
    it('updates status in database without userId check', async () => {
      prismaMock.image.findFirst.mockResolvedValueOnce(mockImage as any);
      prismaMock.image.update.mockResolvedValueOnce({
        ...mockImage,
        segmentationStatus: 'segmented',
      } as any);

      await service.updateSegmentationStatus('image-id', 'segmented');

      expect(prismaMock.image.update).toHaveBeenCalledWith({
        where: { id: 'image-id' },
        data: { segmentationStatus: 'segmented' },
      });
    });

    it('performs ownership check when userId is provided', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        email: 'user@test.com',
      } as any);
      prismaMock.image.findFirst.mockResolvedValueOnce(mockImage as any);
      prismaMock.image.update.mockResolvedValueOnce({
        ...mockImage,
        segmentationStatus: 'processing',
      } as any);
      // emitProjectStatsUpdate: does NOT emit for 'processing' status
      await service.updateSegmentationStatus('image-id', 'processing', 'user-id');

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        select: { email: true },
      });
      expect(prismaMock.image.update).toHaveBeenCalled();
    });

    it('throws forbidden when image not found for update', async () => {
      prismaMock.image.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.updateSegmentationStatus('bad-image', 'segmented')
      ).rejects.toThrow('Access denied to this project');
    });
  });
});
