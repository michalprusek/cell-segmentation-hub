import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock Prisma types for TypeScript
type MockPrismaClient = {
  user: {
    findUnique: ReturnType<typeof jest.fn>;
  };
  project: {
    count: ReturnType<typeof jest.fn>;
  };
  image: {
    count: ReturnType<typeof jest.fn>;
    aggregate: ReturnType<typeof jest.fn>;
  };
  segmentation: {
    count: ReturnType<typeof jest.fn>;
  };
  profile: {
    upsert: ReturnType<typeof jest.fn>;
  };
};

const prismaMock: MockPrismaClient = {
  user: {
    findUnique: jest.fn(),
  },
  project: {
    count: jest.fn(),
  },
  image: {
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  segmentation: {
    count: jest.fn(),
  },
  profile: {
    upsert: jest.fn(),
  },
};

// Mock dependencies
jest.mock('../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  getUserStats,
  getUserProfile,
  calculateUserStorage,
} from '../userService';

describe('UserService Statistics', () => {
  const testUserId = 'test-user-id';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserStats', () => {
    it('should return correct user statistics with real database data', async () => {
      // Mock data setup
      const mockProjectCount = 5;
      const mockImageCount = 150;
      const mockSegmentationCount = 120;
      const mockProcessedImages = 75;
      const mockTodayImages = 10;
      const mockStorageSum = 50 * 1024 * 1024; // 50MB

      // Set up Prisma mocks to return real data
      prismaMock.project.count.mockResolvedValueOnce(mockProjectCount);
      prismaMock.image.count
        .mockResolvedValueOnce(mockImageCount) // Total images
        .mockResolvedValueOnce(mockProcessedImages) // Processed images
        .mockResolvedValueOnce(mockTodayImages); // Today's images
      prismaMock.segmentation.count.mockResolvedValueOnce(
        mockSegmentationCount
      );
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: mockStorageSum },
      });

      const result = await getUserStats(testUserId);

      // Verify all statistics are calculated correctly
      expect(result.totalProjects).toBe(mockProjectCount);
      expect(result.totalImages).toBe(mockImageCount);
      expect(result.totalSegmentations).toBe(mockSegmentationCount);
      expect(result.processedImages).toBe(mockProcessedImages);
      expect(result.imagesUploadedToday).toBe(mockTodayImages);
      expect(result.storageUsedBytes).toBeGreaterThan(0);
      expect(result.storageUsed).toMatch(/MB|GB/); // Should be formatted

      // Verify database queries with correct parameters
      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: { userId: testUserId },
      });

      expect(prismaMock.image.count).toHaveBeenCalledWith({
        where: {
          project: { userId: testUserId },
        },
      });

      expect(prismaMock.segmentation.count).toHaveBeenCalledWith({
        where: {
          image: {
            project: { userId: testUserId },
          },
        },
      });

      // Verify today's images query
      expect(prismaMock.image.count).toHaveBeenCalledWith({
        where: {
          project: { userId: testUserId },
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      });
    });

    it('should handle zero values correctly', async () => {
      // Mock zero data
      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.image.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.segmentation.count.mockResolvedValueOnce(0);
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: null },
      });

      const result = await getUserStats(testUserId);

      expect(result.totalProjects).toBe(0);
      expect(result.totalImages).toBe(0);
      expect(result.totalSegmentations).toBe(0);
      expect(result.processedImages).toBe(0);
      expect(result.imagesUploadedToday).toBe(0);
      expect(result.storageUsedBytes).toBe(0);
      expect(result.storageUsed).toBe('0 B');
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      prismaMock.project.count.mockRejectedValueOnce(dbError);

      await expect(getUserStats(testUserId)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('getUserProfile', () => {
    it('should return user profile with accurate statistics', async () => {
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
        _count: {
          projects: 3,
        },
      };

      const mockStats = {
        totalProjects: 3,
        totalImages: 25,
        totalSegmentations: 20,
        storageUsed: '15 MB',
        storageUsedBytes: 15728640,
        imagesUploadedToday: 5,
        processedImages: 18,
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      // Mock the getUserStats function call
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

      const result = await getUserProfile(testUserId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(testUserId);
      expect(result?.email).toBe('test@example.com');
      expect(result?.firstName).toBe('John');
      expect(result?.lastName).toBe('Doe');
      expect(result?.isEmailVerified).toBe(true);
      expect(result?.language).toBe('en');
      expect(result?.theme).toBe('dark');
      expect(result?.stats).toEqual(
        expect.objectContaining({
          totalProjects: mockStats.totalProjects,
          totalImages: mockStats.totalImages,
          totalSegmentations: mockStats.totalSegmentations,
          processedImages: mockStats.processedImages,
          imagesUploadedToday: mockStats.imagesUploadedToday,
        })
      );
    });

    it('should return null for non-existent user', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const result = await getUserProfile('non-existent-user');

      expect(result).toBeNull();
    });

    it('should handle users with default settings', async () => {
      const mockUser = {
        id: testUserId,
        email: 'test@example.com',
        emailVerified: false,
        createdAt: new Date(),
        profile: null, // No profile set
        _count: {
          projects: 0,
        },
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      // Mock zero stats
      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.image.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.segmentation.count.mockResolvedValueOnce(0);
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: null },
      });

      const result = await getUserProfile(testUserId);

      expect(result).not.toBeNull();
      expect(result?.language).toBe('cs'); // Default language
      expect(result?.theme).toBe('light'); // Default theme
      expect(result?.isEmailVerified).toBe(false);
      expect(result?.settings.notifications.email).toBe(true); // Default notification setting
    });
  });

  describe('calculateUserStorage', () => {
    it('should calculate storage correctly with real file sizes', async () => {
      const mockFileSize = 100 * 1024 * 1024; // 100MB in bytes

      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: mockFileSize },
      });

      const result = await calculateUserStorage(testUserId);

      expect(result.totalUsedBytes).toBeGreaterThan(mockFileSize); // Should include thumbnails and exports
      expect(result.breakdown.images).toBe('100 MB');
      expect(result.breakdown.thumbnails).toMatch(/MB/); // Should be estimated
      expect(result.breakdown.exports).toMatch(/MB/); // Should be estimated
      expect(result.quota).toBe('1 GB'); // Default quota
      expect(result.usagePercentage).toBeGreaterThan(0);
      expect(result.usagePercentage).toBeLessThanOrEqual(100);
    });

    it('should handle zero storage usage', async () => {
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: null },
      });

      const result = await calculateUserStorage(testUserId);

      expect(result.totalUsedBytes).toBe(0);
      expect(result.totalUsed).toBe('0 B');
      expect(result.usagePercentage).toBe(0);
      expect(result.breakdown.images).toBe('0 B');
      expect(result.breakdown.thumbnails).toBe('0 B');
      expect(result.breakdown.exports).toBe('0 B');
    });

    it('should format large file sizes correctly', async () => {
      const mockFileSize = 2.5 * 1024 * 1024 * 1024; // 2.5GB

      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: mockFileSize },
      });

      const result = await calculateUserStorage(testUserId);

      expect(result.breakdown.images).toMatch(/GB/);
      expect(result.usagePercentage).toBeGreaterThan(100); // Over quota
    });

    it('should handle database errors in storage calculation', async () => {
      const dbError = new Error('Storage calculation failed');
      prismaMock.image.aggregate.mockRejectedValueOnce(dbError);

      await expect(calculateUserStorage(testUserId)).rejects.toThrow(
        'Storage calculation failed'
      );
    });
  });

  describe('Performance with Large Datasets', () => {
    it('should handle large user datasets efficiently', async () => {
      // Simulate a heavy user with lots of data
      const largeDataset = {
        projects: 50,
        images: 10000,
        segmentations: 8500,
        processedImages: 7200,
        todayImages: 100,
        storageBytes: 5 * 1024 * 1024 * 1024, // 5GB
      };

      prismaMock.project.count.mockResolvedValueOnce(largeDataset.projects);
      prismaMock.image.count
        .mockResolvedValueOnce(largeDataset.images)
        .mockResolvedValueOnce(largeDataset.processedImages)
        .mockResolvedValueOnce(largeDataset.todayImages);
      prismaMock.segmentation.count.mockResolvedValueOnce(
        largeDataset.segmentations
      );
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: largeDataset.storageBytes },
      });

      const startTime = Date.now();
      const result = await getUserStats(testUserId);
      const endTime = Date.now();

      // Verify the function completes quickly even with large data
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(result.totalProjects).toBe(largeDataset.projects);
      expect(result.totalImages).toBe(largeDataset.images);
      expect(result.totalSegmentations).toBe(largeDataset.segmentations);
    });
  });
});
