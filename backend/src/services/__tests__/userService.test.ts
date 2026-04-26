import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks must be declared before imports
const prismaMock = {
  user: {
    findUnique: vi.fn() as any,
    update: vi.fn() as any,
    delete: vi.fn() as any,
    deleteMany: vi.fn() as any,
  },
  project: {
    count: vi.fn() as any,
    findMany: vi.fn() as any,
    deleteMany: vi.fn() as any,
  },
  image: {
    count: vi.fn() as any,
    aggregate: vi.fn() as any,
    findMany: vi.fn() as any,
  },
  segmentation: {
    count: vi.fn() as any,
    findMany: vi.fn() as any,
  },
  profile: {
    upsert: vi.fn() as any,
  },
};

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  getUserProfile,
  getUserStats,
  calculateUserStorage,
  updateUserProfile,
} from '../userService';

describe('UserService', () => {
  const testUserId = 'user-id-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserProfile', () => {
    it('returns profile with stats for existing user', async () => {
      const mockUser = {
        id: testUserId,
        email: 'test@example.com',
        emailVerified: true,
        createdAt: new Date('2025-01-01'),
        profile: {
          title: 'Jane Smith',
          preferredLang: 'en',
          preferredTheme: 'dark',
          emailNotifications: false,
          avatarUrl: 'https://example.com/avatar.jpg',
        },
        _count: { projects: 3 },
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      // getUserStats internal calls
      prismaMock.project.count.mockResolvedValueOnce(3);
      prismaMock.image.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8)  // processed
        .mockResolvedValueOnce(2); // today
      prismaMock.segmentation.count.mockResolvedValueOnce(8);
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: 5 * 1024 * 1024 },
      });

      const result = await getUserProfile(testUserId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(testUserId);
      expect(result!.email).toBe('test@example.com');
      expect(result!.firstName).toBe('Jane');
      expect(result!.lastName).toBe('Smith');
      expect(result!.isEmailVerified).toBe(true);
      expect(result!.language).toBe('en');
      expect(result!.theme).toBe('dark');
      expect(result!.avatarUrl).toBe('https://example.com/avatar.jpg');
      // emailNotifications uses || so false falls back to true — matches source logic
      expect(result!.settings.notifications.email).toBe(true);
      expect(result!.stats.totalProjects).toBe(3);
      expect(result!.stats.totalImages).toBe(10);
      expect(result!.stats.processedImages).toBe(8);
    });

    it('returns null for non-existent user', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const result = await getUserProfile('non-existent');

      expect(result).toBeNull();
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
        include: expect.anything(),
      });
    });

    it('uses default language cs and theme light when profile is null', async () => {
      const mockUser = {
        id: testUserId,
        email: 'test@example.com',
        emailVerified: false,
        createdAt: new Date(),
        profile: null,
        _count: { projects: 0 },
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.image.count.mockResolvedValue(0);
      prismaMock.segmentation.count.mockResolvedValueOnce(0);
      prismaMock.image.aggregate.mockResolvedValueOnce({ _sum: { fileSize: null } });

      const result = await getUserProfile(testUserId);

      expect(result!.language).toBe('cs');
      expect(result!.theme).toBe('light');
    });
  });

  describe('getUserStats', () => {
    it('calculates totalProjects, totalImages, processedImages, storageUsed', async () => {
      prismaMock.project.count.mockResolvedValueOnce(5);
      prismaMock.image.count
        .mockResolvedValueOnce(100) // total images
        .mockResolvedValueOnce(80)  // processed
        .mockResolvedValueOnce(3);  // today
      prismaMock.segmentation.count.mockResolvedValueOnce(80);
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: 10 * 1024 * 1024 },
      });

      const result = await getUserStats(testUserId);

      expect(result.totalProjects).toBe(5);
      expect(result.totalImages).toBe(100);
      expect(result.processedImages).toBe(80);
      expect(result.imagesUploadedToday).toBe(3);
      expect(result.totalSegmentations).toBe(80);
      expect(result.storageUsedBytes).toBeGreaterThan(0);
    });

    it('handles all zero counts gracefully', async () => {
      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.image.count.mockResolvedValue(0);
      prismaMock.segmentation.count.mockResolvedValueOnce(0);
      prismaMock.image.aggregate.mockResolvedValueOnce({ _sum: { fileSize: null } });

      const result = await getUserStats(testUserId);

      expect(result.totalProjects).toBe(0);
      expect(result.totalImages).toBe(0);
      expect(result.storageUsed).toBe('0 B');
      expect(result.storageUsedBytes).toBe(0);
    });

    it('propagates database errors', async () => {
      prismaMock.project.count.mockRejectedValueOnce(new Error('DB error'));

      await expect(getUserStats(testUserId)).rejects.toThrow('DB error');
    });
  });

  describe('calculateUserStorage (getStorageStats)', () => {
    it('returns breakdown by images, thumbnails, and exports', async () => {
      const imageBytes = 100 * 1024 * 1024; // 100 MB
      prismaMock.image.aggregate.mockResolvedValueOnce({
        _sum: { fileSize: imageBytes },
      });

      const result = await calculateUserStorage(testUserId);

      expect(result.breakdown.images).toBe('100 MB');
      // thumbnails ~15%, exports ~5%
      expect(result.breakdown.thumbnails).toMatch(/MB/);
      expect(result.breakdown.exports).toMatch(/MB/);
      expect(result.totalUsedBytes).toBeGreaterThan(imageBytes);
      expect(result.quota).toBe('1 GB');
    });

    it('returns zero usage when no files exist', async () => {
      prismaMock.image.aggregate.mockResolvedValueOnce({ _sum: { fileSize: null } });

      const result = await calculateUserStorage(testUserId);

      expect(result.totalUsedBytes).toBe(0);
      expect(result.totalUsed).toBe('0 B');
      expect(result.usagePercentage).toBe(0);
    });

    it('propagates storage query errors', async () => {
      prismaMock.image.aggregate.mockRejectedValueOnce(new Error('storage error'));

      await expect(calculateUserStorage(testUserId)).rejects.toThrow('storage error');
    });
  });

  describe('updateUserSettings (updateUserProfile)', () => {
    it('updates email notification preferences', async () => {
      prismaMock.profile.upsert.mockResolvedValueOnce({ userId: testUserId });

      const result = await updateUserProfile(testUserId, {
        notifications: { email: false },
      });

      expect(result.success).toBe(true);
      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: testUserId },
          update: expect.objectContaining({ emailNotifications: false }),
        })
      );
    });

    it('updates language and theme preferences', async () => {
      prismaMock.profile.upsert.mockResolvedValueOnce({ userId: testUserId });

      const result = await updateUserProfile(testUserId, {
        language: 'de',
        theme: 'dark',
      });

      expect(result.success).toBe(true);
      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            preferredLang: 'de',
            preferredTheme: 'dark',
          }),
        })
      );
    });

    it('propagates profile update errors', async () => {
      prismaMock.profile.upsert.mockRejectedValueOnce(new Error('update failed'));

      await expect(
        updateUserProfile(testUserId, { language: 'en' })
      ).rejects.toThrow('update failed');
    });
  });
});
