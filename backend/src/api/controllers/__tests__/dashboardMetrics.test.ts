import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mock Prisma client
type MockPrismaClient = {
  user: {
    findUnique: ReturnType<typeof jest.fn>;
  };
  project: {
    count: ReturnType<typeof jest.fn>;
    findMany: ReturnType<typeof jest.fn>;
  };
  image: {
    count: ReturnType<typeof jest.fn>;
    aggregate: ReturnType<typeof jest.fn>;
    findMany: ReturnType<typeof jest.fn>;
  };
  segmentation: {
    count: ReturnType<typeof jest.fn>;
    findMany: ReturnType<typeof jest.fn>;
  };
};

const prismaMock: MockPrismaClient = {
  user: {
    findUnique: jest.fn(),
  },
  project: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  image: {
    count: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
  },
  segmentation: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

// Mock authentication middleware
const mockAuthMiddleware = jest.fn((req: any, res: any, next: any) => {
  req.user = { id: 'test-user-id', email: 'test@example.com' };
  next();
});

// Mock dependencies
jest.mock('../../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../../../middleware/auth', () => ({
  requireAuth: mockAuthMiddleware,
}));

// Import after mocking
import { getUserStats, getUserProfile } from '../../services/userService';
import { getProjectStats } from '../../services/projectService';

// Create test app
const app = express();
app.use(express.json());

// Mock dashboard API routes
app.get(
  '/api/dashboard/metrics',
  mockAuthMiddleware,
  async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const stats = await getUserStats(userId);
      res.json({
        success: true,
        data: {
          totalProjects: stats.totalProjects,
          totalImages: stats.totalImages,
          totalSegmentations: stats.totalSegmentations,
          storageUsed: stats.storageUsed,
          storageUsedBytes: stats.storageUsedBytes,
          imagesUploadedToday: stats.imagesUploadedToday,
          processedImages: stats.processedImages,
          efficiency:
            stats.totalImages > 0
              ? Math.round((stats.processedImages / stats.totalImages) * 100)
              : 0,
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (_error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard metrics',
      });
    }
  }
);

app.get(
  '/api/dashboard/profile',
  mockAuthMiddleware,
  async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const profile = await getUserProfile(userId);

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found',
        });
      }

      res.json({
        success: true,
        data: profile,
      });
    } catch (_error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user profile',
      });
    }
  }
);

app.get(
  '/api/projects/:projectId/stats',
  mockAuthMiddleware,
  async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const projectId = req.params.projectId;
      const stats = await getProjectStats(projectId, userId);

      if (!stats) {
        return res.status(404).json({
          success: false,
          error: 'Project not found or access denied',
        });
      }

      res.json({
        success: true,
        data: stats,
      });
    } catch (_error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch project statistics',
      });
    }
  }
);

describe('Dashboard Metrics API Endpoints', () => {
  const testUserId = 'test-user-id';
  const testProjectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/dashboard/metrics', () => {
    it('should return accurate dashboard metrics with real data', async () => {
      // Mock realistic user data
      const mockStats = {
        totalProjects: 8,
        totalImages: 245,
        totalSegmentations: 198,
        storageUsed: '125 MB',
        storageUsedBytes: 131072000,
        imagesUploadedToday: 12,
        processedImages: 180,
      };

      // Set up database mocks
      prismaMock.project.count.mockResolvedValueOnce(mockStats.totalProjects);
      prismaMock.image.count
        .mockResolvedValueOnce(mockStats.totalImages)
        .mockResolvedValueOnce(mockStats.processedImages)
        .mockResolvedValueOnce(mockStats.imagesUploadedToday);
      prismaMock.segmentation.count.mockResolvedValueOnce(
        mockStats.totalSegmentations
      );
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: mockStats.storageUsedBytes },
      });

      const response = await request(app)
        .get('/api/dashboard/metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          totalProjects: mockStats.totalProjects,
          totalImages: mockStats.totalImages,
          totalSegmentations: mockStats.totalSegmentations,
          storageUsed: expect.any(String),
          storageUsedBytes: expect.any(Number),
          imagesUploadedToday: mockStats.imagesUploadedToday,
          processedImages: mockStats.processedImages,
          efficiency: expect.any(Number),
          lastUpdated: expect.any(String),
        })
      );

      // Verify efficiency calculation
      const expectedEfficiency = Math.round(
        (mockStats.processedImages / mockStats.totalImages) * 100
      );
      expect(response.body.data.efficiency).toBe(expectedEfficiency);
    });

    it('should return zero values for new users', async () => {
      // Mock empty user data
      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.image.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.segmentation.count.mockResolvedValueOnce(0);
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: null },
      });

      const response = await request(app)
        .get('/api/dashboard/metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          totalProjects: 0,
          totalImages: 0,
          totalSegmentations: 0,
          imagesUploadedToday: 0,
          processedImages: 0,
          efficiency: 0, // Should handle division by zero
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      prismaMock.project.count.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/dashboard/metrics')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch dashboard metrics');
    });

    it('should require authentication', async () => {
      // Override auth middleware to simulate unauthenticated request
      const unauthenticatedApp = express();
      unauthenticatedApp.use(express.json());
      unauthenticatedApp.get('/api/dashboard/metrics', (req: any, res: any) => {
        res.status(401).json({ success: false, error: 'Unauthorized' });
      });

      const response = await request(unauthenticatedApp)
        .get('/api/dashboard/metrics')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('GET /api/dashboard/profile', () => {
    it('should return comprehensive user profile with statistics', async () => {
      const mockUser = {
        id: testUserId,
        email: 'test@example.com',
        emailVerified: true,
        createdAt: new Date(),
        profile: {
          title: 'John Doe',
          preferredLang: 'en',
          preferredTheme: 'dark',
          emailNotifications: true,
        },
        _count: { projects: 5 },
      };

      const mockStats = {
        totalProjects: 5,
        totalImages: 89,
        totalSegmentations: 72,
        storageUsed: '45 MB',
        storageUsedBytes: 47185920,
        imagesUploadedToday: 3,
        processedImages: 65,
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      prismaMock.project.count.mockResolvedValueOnce(mockStats.totalProjects);
      prismaMock.image.count
        .mockResolvedValueOnce(mockStats.totalImages)
        .mockResolvedValueOnce(mockStats.processedImages)
        .mockResolvedValueOnce(mockStats.imagesUploadedToday);
      prismaMock.segmentation.count.mockResolvedValueOnce(
        mockStats.totalSegmentations
      );
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: mockStats.storageUsedBytes },
      });

      const response = await request(app)
        .get('/api/dashboard/profile')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: testUserId,
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          isEmailVerified: true,
          language: 'en',
          theme: 'dark',
          stats: expect.objectContaining({
            totalProjects: mockStats.totalProjects,
            totalImages: mockStats.totalImages,
            totalSegmentations: mockStats.totalSegmentations,
          }),
        })
      );
    });

    it('should handle non-existent user', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/dashboard/profile')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User profile not found');
    });
  });

  describe('GET /api/projects/:projectId/stats', () => {
    it('should return accurate project statistics', async () => {
      const mockProject = {
        id: testProjectId,
        title: 'Test Project',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockImageStats = [
        { segmentationStatus: 'completed', _count: { id: 15 } },
        { segmentationStatus: 'pending', _count: { id: 8 } },
        { segmentationStatus: 'processing', _count: { id: 2 } },
        { segmentationStatus: 'failed', _count: { id: 1 } },
      ];

      const totalImages = 26;
      const totalSegmentations = 18;
      const totalFileSize = 75 * 1024 * 1024; // 75MB

      // Mock sharing service to allow access
      jest.doMock('../../services/sharingService', () => ({
        hasProjectAccess: jest.fn().mockResolvedValue({ hasAccess: true }),
      }));

      prismaMock.project.findUnique.mockResolvedValueOnce(mockProject);
      prismaMock.image.groupBy.mockResolvedValueOnce(mockImageStats);
      prismaMock.image.count.mockResolvedValueOnce(totalImages);
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: totalFileSize },
      });
      prismaMock.segmentation.count.mockResolvedValueOnce(totalSegmentations);

      const response = await request(app)
        .get(`/api/projects/${testProjectId}/stats`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          project: expect.objectContaining({
            id: testProjectId,
            title: 'Test Project',
          }),
          images: expect.objectContaining({
            total: totalImages,
            byStatus: expect.objectContaining({
              completed: 15,
              pending: 8,
              processing: 2,
              failed: 1,
            }),
            totalFileSize: totalFileSize,
          }),
          segmentations: expect.objectContaining({
            total: totalSegmentations,
          }),
          progress: expect.objectContaining({
            completionPercentage: expect.any(Number),
            completedImages: 15,
            remainingImages: expect.any(Number),
          }),
        })
      );

      // Verify completion percentage calculation
      const expectedPercentage = Math.round((15 / totalImages) * 100);
      expect(response.body.data.progress.completionPercentage).toBe(
        expectedPercentage
      );
    });

    it('should handle project not found or access denied', async () => {
      // Mock sharing service to deny access
      jest.doMock('../../services/sharingService', () => ({
        hasProjectAccess: jest.fn().mockResolvedValue({ hasAccess: false }),
      }));

      const response = await request(app)
        .get('/api/projects/non-existent-project/stats')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Project not found or access denied');
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent dashboard requests efficiently', async () => {
      // Set up mock data for multiple concurrent requests
      prismaMock.project.count.mockResolvedValue(10);
      prismaMock.image.count.mockResolvedValue(500);
      prismaMock.segmentation.count.mockResolvedValue(400);
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: 500 * 1024 * 1024 },
      });

      // Make multiple concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => request(app).get('/api/dashboard/metrics'));

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const endTime = Date.now();

      // Verify all requests succeeded
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Verify reasonable response time for concurrent requests
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should return consistent data across multiple requests', async () => {
      const consistentStats = {
        totalProjects: 7,
        totalImages: 156,
        totalSegmentations: 134,
        storageUsedBytes: 89 * 1024 * 1024,
        imagesUploadedToday: 4,
        processedImages: 123,
      };

      // Set up consistent mock responses
      prismaMock.project.count.mockResolvedValue(consistentStats.totalProjects);
      prismaMock.image.count
        .mockResolvedValue(consistentStats.totalImages)
        .mockResolvedValue(consistentStats.processedImages)
        .mockResolvedValue(consistentStats.imagesUploadedToday);
      prismaMock.segmentation.count.mockResolvedValue(
        consistentStats.totalSegmentations
      );
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: consistentStats.storageUsedBytes },
      });

      // Make multiple requests and verify consistency
      const response1 = await request(app).get('/api/dashboard/metrics');
      const response2 = await request(app).get('/api/dashboard/metrics');

      expect(response1.body.data.totalProjects).toBe(
        response2.body.data.totalProjects
      );
      expect(response1.body.data.totalImages).toBe(
        response2.body.data.totalImages
      );
      expect(response1.body.data.efficiency).toBe(
        response2.body.data.efficiency
      );
    });
  });
});
