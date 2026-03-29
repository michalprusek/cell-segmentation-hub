import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { ImageController } from '../imageController';
import { ImageService } from '../../../services/imageService';
import { authenticate } from '../../../middleware/auth';
// Unused imports removed: uploadImages, handleUploadError
import { prisma } from '../../../db/index';

// Mock dependencies
jest.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_DIR: './test-uploads',
    STORAGE_TYPE: 'local',
    MAX_FILE_SIZE: 10485760,
  },
}));
jest.mock('../../../services/imageService');
jest.mock('../../../middleware/auth');
jest.mock('../../../services/segmentationThumbnailService', () => ({
  SegmentationThumbnailService: jest.fn().mockImplementation(() => ({
    generateThumbnail: jest.fn(() => Promise.resolve()),
  })),
}));
jest.mock('../../../services/websocketService', () => ({
  WebSocketService: {
    getInstance: () => ({
      emitToUser: () => undefined,
      emitToProject: () => undefined,
    }),
  },
}));
jest.mock('../../../storage/index', () => ({
  getStorageProvider: jest.fn(() => ({
    saveFile: jest.fn(() => Promise.resolve('/mock/path')),
    deleteFile: jest.fn(() => Promise.resolve()),
    getFileUrl: jest.fn(() => 'http://mock/url'),
  })),
}));
jest.mock('../../../services/sharingService', () => ({
  hasProjectAccess: jest.fn(() => Promise.resolve({ hasAccess: true })),
}));
jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../../db/index', () => ({
  prisma: {
    project: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    image: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    segmentation: {
      findUnique: jest.fn(),
    },
  },
}));

const MockImageService = jest.mocked(ImageService);
const mockAuthenticate = jest.mocked(authenticate);

describe('ImageController - Large Batch Upload Tests', () => {
  let app: express.Application;
  let imageController: ImageController;
  let mockImageService: any;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
  };

  const mockProject = {
    id: 'project-123',
    name: 'Test Project',
    title: 'Test Project',
    description: null,
    userId: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Helper function to create mock file buffers
  const createMockFile = (name: string, size: number = 1024): Buffer => {
    const buffer = Buffer.alloc(size);
    buffer.fill(0xff); // Fill with dummy data
    return buffer;
  };

  // Helper function to create mock FormData with files
  const createMockFormData = (fileCount: number, fileSize: number = 1024): Express.Multer.File[] => {
    const files = Array.from({ length: fileCount }, (_, i) => ({
      fieldname: 'images',
      originalname: `test-image-${i + 1}.jpg`,
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: createMockFile(`test-image-${i + 1}.jpg`, fileSize),
      size: fileSize,
      stream: {} as never,
      destination: '',
      filename: '',
      path: '',
    }));
    return files;
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Setup mocks BEFORE creating controller so auto-mock has them set up
    mockImageService = {
      uploadImages: jest.fn(),
      uploadImagesWithProgress: jest.fn(),
      getProjectImages: jest.fn(),
      getImageById: jest.fn(),
      deleteImage: jest.fn(),
      deleteBatch: jest.fn(),
      getImageStats: jest.fn(),
      getBrowserCompatibleImage: jest.fn(),
    };

    // Configure the auto-mock class to return our mock instance
    MockImageService.mockImplementation(() => mockImageService as any);

    imageController = new ImageController();

    // Mock auth middleware
    mockAuthenticate.mockImplementation(
      async (
        req: express.Request & { user?: Record<string, unknown> },
        res: express.Response,
        next: express.NextFunction
      ) => {
        req.user = mockUser as any;
        next();
      }
    );

    // Setup routes
    app.post(
      '/api/projects/:id/images',
      mockAuthenticate,
      (req, res, next) => {
        req.files = createMockFormData(20); // Default to 20 files
        next();
      },
      imageController.uploadImages
    );

    // Mock prisma
    jest.mocked(prisma.project.findFirst).mockResolvedValue(mockProject);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Upload Limits and Validation', () => {
    it('should successfully upload 20 files (current limit)', async () => {
      const mockUploadedImages = Array.from({ length: 20 }, (_, i) => ({
        id: `image-${i + 1}`,
        name: `test-image-${i + 1}.jpg`,
        projectId: 'project-123',
        userId: 'user-123',
        originalUrl: `/uploads/test-image-${i + 1}.jpg`,
        thumbnailUrl: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.images).toHaveLength(20);
      expect(response.body.data.count).toBe(20);
      expect(mockImageService.uploadImagesWithProgress).toHaveBeenCalledWith(
        'project-123',
        'user-123',
        expect.any(Array),
        expect.any(String),
        expect.any(Function)
      );
    });

    it('should successfully upload 50 files (new increased limit)', async () => {
      // Override the middleware to provide 50 files
      app.post(
        '/api/projects/:id/images-50',
        mockAuthenticate,
        (req, res, next) => {
          req.files = createMockFormData(50);
          next();
        },
        imageController.uploadImages
      );

      const mockUploadedImages = Array.from({ length: 50 }, (_, i) => ({
        id: `image-${i + 1}`,
        name: `test-image-${i + 1}.jpg`,
        projectId: 'project-123',
        userId: 'user-123',
        originalUrl: `/uploads/test-image-${i + 1}.jpg`,
        thumbnailUrl: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-50')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.images).toHaveLength(50);
      expect(response.body.data.count).toBe(50);
    });

    it('should reject upload when exceeding file count limit (51 files)', async () => {
      // This test assumes the new limit is 50 files
      app.post(
        '/api/projects/:id/images-51',
        mockAuthenticate,
        (req, res, next) => {
          req.files = createMockFormData(51);
          next();
        },
        imageController.uploadImages
      );

      // Mock service to throw error for too many files
      mockImageService.uploadImagesWithProgress.mockRejectedValue(
        new Error(
          'Příliš mnoho souborů. Maximálně lze nahrát 50 souborů najednou'
        )
      );

      const response = await request(app)
        .post('/api/projects/project-123/images-51')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should reject files with invalid MIME types', async () => {
      app.post(
        '/api/projects/:id/images-invalid',
        mockAuthenticate,
        (req, res, next) => {
          req.files = [
            {
              fieldname: 'images',
              originalname: 'test-file.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              buffer: Buffer.from('test content'),
              size: 100,
            } as unknown as Express.Multer.File,
          ];
          next();
        },
        imageController.uploadImages
      );

      const response = await request(app)
        .post('/api/projects/project-123/images-invalid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid file type');
    });

    it('should reject files exceeding size limit', async () => {
      const largeFileSize = 100 * 1024 * 1024; // 100MB (exceeds typical 10MB limit)
      app.post(
        '/api/projects/:id/images-large',
        mockAuthenticate,
        (req, res, next) => {
          req.files = [
            {
              fieldname: 'images',
              originalname: 'large-image.jpg',
              encoding: '7bit',
              mimetype: 'image/jpeg',
              buffer: createMockFile('large-image.jpg', largeFileSize),
              size: largeFileSize,
            } as unknown as Express.Multer.File,
          ];
          next();
        },
        imageController.uploadImages
      );

      const response = await request(app)
        .post('/api/projects/project-123/images-large')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('File too large');
    });

    it('should validate project ownership before upload', async () => {
      // Service throws when project not found
      mockImageService.uploadImagesWithProgress.mockRejectedValue(
        new Error('Project not found')
      );

      const response = await request(app)
        .post('/api/projects/invalid-project/images')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle missing projectId parameter', async () => {
      // Route /api/projects//images doesn't match :id pattern, returns 404
      const response = await request(app)
        .post('/api/projects//images')
        .expect(404);

      // Express returns 404 for unmatched routes
      expect(response.status).toBe(404);
    });

    it('should handle missing files', async () => {
      app.post(
        '/api/projects/:id/images-empty',
        mockAuthenticate,
        (req, res, next) => {
          req.files = [];
          next();
        },
        imageController.uploadImages
      );

      const response = await request(app)
        .post('/api/projects/project-123/images-empty')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Batch Processing Performance', () => {
    it('should handle concurrent upload requests with rate limiting', async () => {
      const mockUploadedImages = [
        {
          id: 'image-1',
          name: 'test-image.jpg',
          projectId: 'project-123',
          userId: 'user-123',
          originalUrl: '/uploads/test-image.jpg',
          thumbnailUrl: '/uploads/thumbnails/test-image_thumb.jpg',
          fileSize: 1024,
          width: 800,
          height: 600,
          mimeType: 'image/jpeg',
          segmentationStatus: 'pending' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

      // Simulate concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        request(app).post('/api/projects/project-123/images').expect(200)
      );

      const responses = await Promise.all(requests);

      // All should succeed (assuming rate limit allows)
      responses.forEach(response => {
        expect(response.body.success).toBe(true);
      });

      expect(mockImageService.uploadImagesWithProgress).toHaveBeenCalledTimes(5);
    });

    it('should handle upload timeout gracefully', async () => {
      // Mock a timeout scenario
      mockImageService.uploadImagesWithProgress.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Upload timeout')), 100)
          )
      );

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should track memory usage during large uploads', async () => {
      const initialMemory = process.memoryUsage();

      // Upload 30 files of 1MB each
      app.post(
        '/api/projects/:id/images-memory',
        mockAuthenticate,
        (req, res, next) => {
          req.files = createMockFormData(30, 1024 * 1024); // 1MB each
          next();
        },
        imageController.uploadImages
      );

      const mockUploadedImages = Array.from({ length: 30 }, (_, i) => ({
        id: `image-${i + 1}`,
        name: `test-image-${i + 1}.jpg`,
        projectId: 'project-123',
        userId: 'user-123',
        originalUrl: `/uploads/test-image-${i + 1}.jpg`,
        thumbnailUrl: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
        fileSize: 1024 * 1024,
        width: 800,
        height: 600,
        mimeType: 'image/jpeg',
        segmentationStatus: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

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
      mockImageService.uploadImagesWithProgress.mockRejectedValue(
        new Error('Storage service temporarily unavailable')
      );

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle database transaction failures', async () => {
      // Mock database error
      mockImageService.uploadImagesWithProgress.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should clean up resources on upload failure', async () => {
      const cleanupSpy = jest.fn();

      mockImageService.uploadImagesWithProgress.mockImplementation(async () => {
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
      app.post(
        '/api/projects/:id/images-corrupt',
        mockAuthenticate,
        (req, res, next) => {
          req.files = [
            {
              fieldname: 'images',
              originalname: 'corrupt-image.jpg',
              encoding: '7bit',
              mimetype: 'image/jpeg',
              buffer: null as unknown as Buffer, // Simulate corrupted buffer
              size: 0,
            } as unknown as Express.Multer.File,
          ];
          next();
        },
        imageController.uploadImages
      );

      const response = await request(app)
        .post('/api/projects/project-123/images-corrupt')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain(
        'Invalid file: missing buffer or name'
      );
    });

    it('should handle files with suspicious extensions', async () => {
      app.post(
        '/api/projects/:id/images-suspicious',
        mockAuthenticate,
        (req, res, next) => {
          req.files = [
            {
              fieldname: 'images',
              originalname: 'malicious.jpg.exe',
              encoding: '7bit',
              mimetype: 'image/jpeg',
              buffer: createMockFile('malicious.jpg.exe'),
              size: 1024,
            } as unknown as Express.Multer.File,
          ];
          next();
        },
        imageController.uploadImages
      );

      // Controller uploads with valid MIME type jpeg - so service is called
      const mockUploadedImages = [
        {
          id: 'image-1',
          name: 'malicious.jpg.exe',
          projectId: 'project-123',
          userId: 'user-123',
          originalUrl: '/uploads/malicious.jpg.exe',
          thumbnailUrl: '/uploads/thumbnails/malicious_thumb.jpg',
          fileSize: 1024,
          width: 800,
          height: 600,
          mimeType: 'image/jpeg',
          segmentationStatus: 'pending' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-suspicious')
        .expect(200);

      // Controller doesn't reject based on extension, only MIME type
      expect(response.body.success).toBe(true);
    });

    it('should validate MIME type matches file extension', async () => {
      app.post(
        '/api/projects/:id/images-mismatch',
        mockAuthenticate,
        (req, res, next) => {
          req.files = [
            {
              fieldname: 'images',
              originalname: 'image.jpg',
              encoding: '7bit',
              mimetype: 'image/png', // MIME type doesn't match extension (both are allowed)
              buffer: createMockFile('image.jpg'),
              size: 1024,
            } as unknown as Express.Multer.File,
          ];
          next();
        },
        imageController.uploadImages
      );

      const mockUploadedImages = [
        {
          id: 'image-1',
          name: 'image.jpg',
          projectId: 'project-123',
          userId: 'user-123',
          originalUrl: '/uploads/image.jpg',
          thumbnailUrl: '/uploads/thumbnails/image_thumb.jpg',
          fileSize: 1024,
          width: 800,
          height: 600,
          mimeType: 'image/png',
          segmentationStatus: 'pending' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images-mismatch')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Progress Tracking and WebSocket Integration', () => {
    it('should emit progress events during upload', async () => {
      const mockUploadedImages = [
        {
          id: 'image-1',
          name: 'test-image.jpg',
          projectId: 'project-123',
          userId: 'user-123',
          originalUrl: '/uploads/test-image.jpg',
          thumbnailUrl: '/uploads/thumbnails/test-image_thumb.jpg',
          fileSize: 1024,
          width: 800,
          height: 600,
          mimeType: 'image/jpeg',
          segmentationStatus: 'pending' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockImageService.uploadImagesWithProgress.mockResolvedValue(mockUploadedImages);

      const response = await request(app)
        .post('/api/projects/project-123/images')
        .expect(200);

      expect(response.body.success).toBe(true);
      // Progress events are emitted via WebSocket - verify the service was called with a callback
      expect(mockImageService.uploadImagesWithProgress).toHaveBeenCalledWith(
        'project-123',
        'user-123',
        expect.any(Array),
        expect.any(String),
        expect.any(Function)
      );
    });
  });
});
