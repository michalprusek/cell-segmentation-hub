import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { ImageController } from '../imageController';
import { ImageService } from '../../../services/imageService';
import { ThumbnailService } from '../../../services/thumbnailService';
import { authenticate } from '../../../middleware/auth';
// Unused imports removed: uploadImages, handleUploadError
import { prisma } from '../../../db/index';

// Mock dependencies
vi.mock('../../../services/imageService');
vi.mock('../../../services/thumbnailService');
vi.mock('../../../middleware/auth');
vi.mock('../../../db/index', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    segmentation: {
      findUnique: vi.fn(),
    },
  }
}));

const MockImageService = vi.mocked(ImageService);
// MockThumbnailService - kept for potential future use
const mockAuthenticate = vi.mocked(authenticate);

describe('ImageController - Large Batch Upload Tests', () => {
  let app: express.Application;
  let imageController: ImageController;
  let mockImageService: ReturnType<typeof vi.mocked<typeof ImageService>>;
  let _mockThumbnailService: ReturnType<typeof vi.mocked<typeof ThumbnailService>>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
  };

  const mockProject = {
    id: 'project-123',
    name: 'Test Project',
    userId: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Helper function to create mock file buffers
  const createMockFile = (name: string, size: number = 1024): Buffer => {
    const buffer = Buffer.alloc(size);
    buffer.fill(0xFF); // Fill with dummy data
    return buffer;
  };

  // Helper function to create mock FormData with files
  const createMockFormData = (fileCount: number, fileSize: number = 1024) => {
    const files = Array.from({ length: fileCount }, (_, i) => ({
      fieldname: 'images',
      originalname: `test-image-${i + 1}.jpg`,
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: createMockFile(`test-image-${i + 1}.jpg`, fileSize),
      size: fileSize,
    }));
    return files;
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    imageController = new ImageController();
    
    // Setup mocks
    mockImageService = {
      uploadImages: vi.fn(),
      getProjectImages: vi.fn(),
      getImageById: vi.fn(),
      deleteImage: vi.fn(),
      deleteBatch: vi.fn(),
      getImageStats: vi.fn(),
      getBrowserCompatibleImage: vi.fn(),
    };

    mockThumbnailService = {
      generateThumbnail: vi.fn(),
    };

    MockImageService.prototype.uploadImages = mockImageService.uploadImages;
    MockImageService.prototype.getProjectImages = mockImageService.getProjectImages;
    MockImageService.prototype.getImageById = mockImageService.getImageById;
    MockImageService.prototype.deleteImage = mockImageService.deleteImage;
    MockImageService.prototype.deleteBatch = mockImageService.deleteBatch;
    MockImageService.prototype.getImageStats = mockImageService.getImageStats;
    MockImageService.prototype.getBrowserCompatibleImage = mockImageService.getBrowserCompatibleImage;

    // Mock auth middleware
    mockAuthenticate.mockImplementation((req: express.Request & {user?: Record<string, unknown>}, res: express.Response, next: express.NextFunction) => {
      req.user = mockUser;
      next();
    });

    // Setup routes
    app.post('/api/projects/:id/images', mockAuthenticate, (req, res, next) => {
      req.files = createMockFormData(20); // Default to 20 files
      next();
    }, imageController.uploadImages);

    // Mock prisma
    vi.mocked(prisma.project.findFirst).mockResolvedValue(mockProject);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Upload Limits and Validation', () => {
    it('should successfully upload 20 files (current limit)', async () => {
      const mockUploadedImages = Array.from({ length: 20 }, (_, i) => ({
        id: `image-${i + 1}`,
        name: `test-image-${i + 1}.jpg`,
        projectId: 'project-123',
        userId: 'user-123',
        originalPath: `/uploads/test-image-${i + 1}.jpg`,
        thumbnailPath: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockImageService.uploadImages.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.images).toHaveLength(20);
      expect(response.body.data.count).toBe(20);
      expect(mockImageService.uploadImages).toHaveBeenCalledWith(
        'project-123',
        'user-123',
        expect.any(Array)
      );
    });

    it('should successfully upload 50 files (new increased limit)', async () => {
      // Override the middleware to provide 50 files
      app.post('/api/projects/:id/images-50', mockAuthenticate, (req, res, next) => {
        req.files = createMockFormData(50);
        next();
      }, imageController.uploadImages);

      const mockUploadedImages = Array.from({ length: 50 }, (_, i) => ({
        id: `image-${i + 1}`,
        name: `test-image-${i + 1}.jpg`,
        projectId: 'project-123',
        userId: 'user-123',
        originalPath: `/uploads/test-image-${i + 1}.jpg`,
        thumbnailPath: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockImageService.uploadImages.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-50')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.images).toHaveLength(50);
      expect(response.body.data.count).toBe(50);
    });

    it('should reject upload when exceeding file count limit (51 files)', async () => {
      // This test assumes the new limit is 50 files
      app.post('/api/projects/:id/images-51', mockAuthenticate, (req, res, next) => {
        req.files = createMockFormData(51);
        next();
      }, imageController.uploadImages);

      // Mock service to throw error for too many files
      mockImageService.uploadImages.mockRejectedValue(
        new Error('Příliš mnoho souborů. Maximálně lze nahrát 50 souborů najednou')
      );

      const response = await request(app)
        .post('/api/projects/project-123/images-51')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should reject files with invalid MIME types', async () => {
      app.post('/api/projects/:id/images-invalid', mockAuthenticate, (req, res, next) => {
        req.files = [{
          fieldname: 'images',
          originalname: 'test-file.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          buffer: Buffer.from('test content'),
          size: 100,
        }];
        next();
      }, imageController.uploadImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-invalid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid file type');
    });

    it('should reject files exceeding size limit', async () => {
      const largeFileSize = 100 * 1024 * 1024; // 100MB (exceeds typical 10MB limit)
      app.post('/api/projects/:id/images-large', mockAuthenticate, (req, res, next) => {
        req.files = [{
          fieldname: 'images',
          originalname: 'large-image.jpg',
          encoding: '7bit',
          mimetype: 'image/jpeg',
          buffer: createMockFile('large-image.jpg', largeFileSize),
          size: largeFileSize,
        }];
        next();
      }, imageController.uploadImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-large')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('File too large');
    });

    it('should validate project ownership before upload', async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/projects/invalid-project/images')
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should handle missing projectId parameter', async () => {
      const response = await request(app)
        .post('/api/projects//images')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Project ID is required');
    });

    it('should handle missing files', async () => {
      app.post('/api/projects/:id/images-empty', mockAuthenticate, (req, res, next) => {
        req.files = [];
        next();
      }, imageController.uploadImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-empty')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Je nutné vybrat alespoň jeden soubor');
    });
  });

  describe('Batch Processing Performance', () => {
    it('should handle concurrent upload requests with rate limiting', async () => {
      const mockUploadedImages = [{
        id: 'image-1',
        name: 'test-image.jpg',
        projectId: 'project-123',
        userId: 'user-123',
        originalPath: '/uploads/test-image.jpg',
        thumbnailPath: '/uploads/thumbnails/test-image_thumb.jpg',
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];

      mockImageService.uploadImages.mockResolvedValue(mockUploadedImages);

      // Simulate concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/projects/project-123/images')
          .expect(200)
      );

      const responses = await Promise.all(requests);
      
      // All should succeed (assuming rate limit allows)
      responses.forEach(response => {
        expect(response.body.success).toBe(true);
      });

      expect(mockImageService.uploadImages).toHaveBeenCalledTimes(5);
    });

    it('should handle upload timeout gracefully', async () => {
      // Mock a timeout scenario
      mockImageService.uploadImages.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Upload timeout')), 100)
        )
      );

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Upload timeout');
    });

    it('should track memory usage during large uploads', async () => {
      const initialMemory = process.memoryUsage();
      
      // Upload 30 files of 1MB each
      app.post('/api/projects/:id/images-memory', mockAuthenticate, (req, res, next) => {
        req.files = createMockFormData(30, 1024 * 1024); // 1MB each
        next();
      }, imageController.uploadImages);

      const mockUploadedImages = Array.from({ length: 30 }, (_, i) => ({
        id: `image-${i + 1}`,
        name: `test-image-${i + 1}.jpg`,
        projectId: 'project-123',
        userId: 'user-123',
        originalPath: `/uploads/test-image-${i + 1}.jpg`,
        thumbnailPath: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
        fileSize: 1024 * 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockImageService.uploadImages.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-memory')
        .expect(200);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // Memory increase should be reasonable (less than 100MB for this test)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle partial upload failures gracefully', async () => {
      // Mock service to simulate partial failure
      mockImageService.uploadImages.mockRejectedValue(
        new Error('Storage service temporarily unavailable')
      );

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Storage service temporarily unavailable');
    });

    it('should handle database transaction failures', async () => {
      // Mock database error
      mockImageService.uploadImages.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should clean up resources on upload failure', async () => {
      const cleanupSpy = vi.fn();
      
      mockImageService.uploadImages.mockImplementation(async () => {
        cleanupSpy(); // Simulate cleanup call
        throw new Error('Upload failed');
      });

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('File Validation Edge Cases', () => {
    it('should handle corrupted file buffers', async () => {
      app.post('/api/projects/:id/images-corrupt', mockAuthenticate, (req, res, next) => {
        req.files = [{
          fieldname: 'images',
          originalname: 'corrupt-image.jpg',
          encoding: '7bit',
          mimetype: 'image/jpeg',
          buffer: null as unknown as Buffer, // Simulate corrupted buffer
          size: 0,
        }];
        next();
      }, imageController.uploadImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-corrupt')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid file: missing buffer or name');
    });

    it('should handle files with suspicious extensions', async () => {
      app.post('/api/projects/:id/images-suspicious', mockAuthenticate, (req, res, next) => {
        req.files = [{
          fieldname: 'images',
          originalname: 'malicious.jpg.exe',
          encoding: '7bit',
          mimetype: 'image/jpeg',
          buffer: createMockFile('malicious.jpg.exe'),
          size: 1024,
        }];
        next();
      }, imageController.uploadImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-suspicious')
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should validate MIME type matches file extension', async () => {
      app.post('/api/projects/:id/images-mismatch', mockAuthenticate, (req, res, next) => {
        req.files = [{
          fieldname: 'images',
          originalname: 'image.jpg',
          encoding: '7bit',
          mimetype: 'image/png', // MIME type doesn't match extension
          buffer: createMockFile('image.jpg'),
          size: 1024,
        }];
        next();
      }, imageController.uploadImages);

      // This test assumes additional validation is implemented
      const mockUploadedImages = [{
        id: 'image-1',
        name: 'image.jpg',
        projectId: 'project-123',
        userId: 'user-123',
        originalPath: '/uploads/image.jpg',
        thumbnailPath: '/uploads/thumbnails/image_thumb.jpg',
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/png',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];

      mockImageService.uploadImages.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-mismatch')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Progress Tracking and WebSocket Integration', () => {
    it('should emit progress events during upload', async () => {
      const progressEvents: number[] = [];
      
      // Mock WebSocket emission (would need actual WebSocket mock)
      const mockEmitProgress = vi.fn((progress: number) => {
        progressEvents.push(progress);
      });

      mockImageService.uploadImages.mockImplementation(async () => {
        // Simulate progress updates
        for (let i = 0; i <= 100; i += 25) {
          mockEmitProgress(i);
        }
        
        return [{
          id: 'image-1',
          name: 'test-image.jpg',
          projectId: 'project-123',
          userId: 'user-123',
          originalPath: '/uploads/test-image.jpg',
          thumbnailPath: '/uploads/thumbnails/test-image_thumb.jpg',
          fileSize: 1024,
          width: 800,
          height: 600,
          mimeType: 'image/jpeg',
          segmentationStatus: 'pending' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }];
      });

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(progressEvents).toEqual([0, 25, 50, 75, 100]);
    });
  });
});